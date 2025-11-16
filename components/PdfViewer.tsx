
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
    ChevronLeftIcon, ChevronRightIcon, ZoomInIcon, ZoomOutIcon, 
    ArrowLeftIcon, BookOpenIcon,
    ChevronDoubleLeftIcon, ChevronDoubleRightIcon, ChatBubbleIcon,
    FitToWidthIcon, SparklesIcon, XIcon, SunIcon, MoonIcon,
    DocumentTextIcon, LightbulbIcon, HighlighterIcon,
    AcademicCapIcon, MessageQuestionIcon
} from './Icons';
import { Loader } from './Loader';
import { PageChat } from './PageChat';
import { StudyPanel } from './StudyPanel';
import { AiCoachPanel } from './AiCoachPanel';
import { Thumbnail } from './Thumbnail';
import * as db from '../utils/db';
import { Document, ProcessedPageData, Annotation, Rect } from '../types';
import { SummaryModal } from './SummaryModal';
import { summarizeText, explainText } from '../services/geminiService';

// This utility function ensures that the PDF.js library is loaded and configured
// before any of its APIs are called, preventing a critical race condition.
let pdfJsPromise: Promise<{ pdfjsLib: any; pdfjsViewer: any; }> | null = null;

function getPdfJs(): Promise<{ pdfjsLib: any; pdfjsViewer: any; }> {
  if (pdfJsPromise) {
    return pdfJsPromise;
  }

  pdfJsPromise = new Promise(async (resolve, reject) => {
    try {
      // Dynamically import the libraries to control loading and initialization.
      // FIX: Switched to jsdelivr CDN for better reliability and caching.
      const [lib, viewer] = await Promise.all([
        import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs"),
        import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/web/pdf_viewer.min.mjs")
      ]);

      // Configure the worker globally, once, immediately after import.
      // This prevents a race condition where the library might be used before
      // the worker path is set.
      const PDF_WORKER_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs";
      if (lib.GlobalWorkerOptions.workerSrc !== PDF_WORKER_URL) {
        lib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
      }
      
      resolve({ pdfjsLib: lib, pdfjsViewer: viewer });
    } catch (error) {
      console.error("Failed to load PDF.js library", error);
      reject(error);
    }
  });

  return pdfJsPromise;
}

const ZOOM_LEVELS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0];
const PAGE_MARGIN = 16;
const OVERSCAN_COUNT = 3;

type ActivePanel = 'none' | 'thumbnails' | 'chat' | 'study' | 'aiCoach';
type AiAction = { type: 'summary' | 'explanation', content: string };
type Selection = { text: string, pageNum: number, rects: Rect[], clientRect: DOMRect };

function debounce(func: (...args: any[]) => void, delay: number) {
    let timeoutId: number;
    return function(this: any, ...args: any[]) {
        clearTimeout(timeoutId);
        timeoutId = window.setTimeout(() => func.apply(this, args), delay);
    };
}

interface PdfViewerProps {
  document: Document;
  onReset: () => void;
  onLoadError: (message: string) => void;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
}

export const PdfViewer = React.memo(function PdfViewer({ 
    document: doc, onReset, onLoadError, theme, toggleTheme 
}: PdfViewerProps) {
  const [pdfDoc, setPdfDoc] = useState<any | null>(null);
  const [processedData, setProcessedData] = useState<ProcessedPageData[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [scale, setScale] = useState(doc.lastScale ?? 1.0);
  const [isLoading, setIsLoading] = useState(true);
  const [isMobileToolbarVisible, setIsMobileToolbarVisible] = useState(true);
  
  const [pageDimensions, setPageDimensions] = useState<{ width: number, height: number }[]>([]);
  const [visiblePageRange, setVisiblePageRange] = useState<{ start: number, end: number }>({ start: 0, end: 0 });

  const viewerRef = useRef<HTMLDivElement>(null);
  const lastScrollTop = useRef(0);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const renderTaskRefs = useRef<Record<number, any>>({});
  const renderedPages = useRef<Map<number, number>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const isProgrammaticScroll = useRef(false);
  const isMountedRef = useRef(false);
  const initialFitApplied = useRef(false);
  const initialPositionRestored = useRef(false);
  const scaleRef = useRef(scale);
  const thumbnailContainerRef = useRef<HTMLDivElement>(null);
  
  const [activePanel, setActivePanel] = useState<ActivePanel>('none');
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const [thumbnailCache, setThumbnailCache] = useState<Record<number, string>>({});
  const [isThumbnailsVisible, setIsThumbnailsVisible] = useState(true);
  
  const [selection, setSelection] = useState<Selection | null>(null);
  const [aiAction, setAiAction] = useState<AiAction | null>(null);
  const [isAiActionLoading, setIsAiActionLoading] = useState(false);
  
  const [selectionPopoverStyle, setSelectionPopoverStyle] = useState<React.CSSProperties>({ opacity: 0, pointerEvents: 'none' });
  const [aiActionPopoverStyle, setAiActionPopoverStyle] = useState<React.CSSProperties>({ opacity: 0, pointerEvents: 'none' });

  // Refs for touch interactions
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);
  const initialPinchDistanceRef = useRef(0);
  const initialScaleRef = useRef(scale);

  useEffect(() => { isMountedRef.current = true; return () => { isMountedRef.current = false; }; }, []);

  // Keep refs in sync with state for use in cleanup functions / callbacks
  useEffect(() => {
    initialScaleRef.current = scale;
    scaleRef.current = scale;
  }, [scale]);
  
  // Save position and scale on unmount
  useEffect(() => {
    return () => {
        const viewer = viewerRef.current;
        if (viewer && doc) {
            const updatedDoc = {
                ...doc,
                lastScrollTop: viewer.scrollTop,
                lastScale: scaleRef.current,
            };
            db.updateDocument(updatedDoc).catch(err => {
                console.error("Failed to save view state:", err);
            });
        }
    };
  }, [doc]);

  const pageMetas = useMemo(() => {
    let top = PAGE_MARGIN / 2;
    return pageDimensions.map(dim => {
        const scaledWidth = dim.width * scale;
        const scaledHeight = dim.height * scale;
        const meta = { width: scaledWidth, height: scaledHeight, top: top };
        top += scaledHeight + PAGE_MARGIN;
        return meta;
    });
  }, [pageDimensions, scale]);

  const totalHeight = pageMetas.length > 0 ? pageMetas[pageMetas.length - 1].top + pageMetas[pageMetas.length - 1].height + (PAGE_MARGIN / 2) : 0;
  
  // Restore scroll position once content is laid out
  useEffect(() => {
    const viewer = viewerRef.current;
    if (viewer && totalHeight > 0 && doc.lastScrollTop !== undefined && !initialPositionRestored.current) {
      viewer.scrollTop = doc.lastScrollTop;
      initialPositionRestored.current = true;
    }
  }, [totalHeight, doc.lastScrollTop]);


  const handleScroll = useCallback(() => {
    if (!viewerRef.current || pageMetas.length === 0) return;
    const viewer = viewerRef.current;
    const { scrollTop, clientHeight } = viewer;

    // Mobile toolbar visibility
    if (scrollTop > lastScrollTop.current && scrollTop > 100) {
      setIsMobileToolbarVisible(false);
    } else {
      setIsMobileToolbarVisible(true);
    }
    lastScrollTop.current = scrollTop <= 0 ? 0 : scrollTop;

    // Page visibility calculation
    let start = pageMetas.findIndex(p => p.top + p.height > scrollTop);
    if (start === -1) start = 0;
    let end = pageMetas.findIndex(p => p.top > scrollTop + clientHeight);
    if (end === -1) end = pageMetas.length - 1;
    const startIndex = Math.max(0, start - OVERSCAN_COUNT);
    const endIndex = Math.min(pageMetas.length - 1, end + OVERSCAN_COUNT);
    if (startIndex !== visiblePageRange.start || endIndex !== visiblePageRange.end) {
        setVisiblePageRange({ start: startIndex, end: endIndex });
    }
  }, [pageMetas, visiblePageRange.start, visiblePageRange.end]);

  const goToPage = useCallback((num: number) => {
    const pageNum = Math.min(Math.max(1, num), numPages);
    if (viewerRef.current && pageMetas[pageNum - 1]) {
        isProgrammaticScroll.current = true;
        viewerRef.current.scrollTo({ top: pageMetas[pageNum - 1].top, behavior: 'auto' });
        setCurrentPage(pageNum);
        setTimeout(() => { isProgrammaticScroll.current = false; }, 500);
    }
  }, [numPages, pageMetas]);

  // FIX: Changed `String(currentPage)` to `currentPage.toString()` to avoid potential issues with the global `String` object being shadowed, which can cause a "not callable" error.
  useEffect(() => { setPageInput(currentPage.toString()); }, [currentPage]);
  
  const handlePageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => { setPageInput(e.target.value); };
  const navigateToInputPage = () => {
      const pageNum = parseInt(pageInput, 10);
      if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= numPages) goToPage(pageNum);
      // FIX: Changed `String(currentPage)` to `currentPage.toString()` to avoid potential issues with the global `String` object being shadowed, which can cause a "not callable" error.
      else setPageInput(currentPage.toString());
  };
  
  const zoomIn = useCallback(() => setScale(s => ZOOM_LEVELS.find(l => l > s + 0.01) || s), []);
  const zoomOut = useCallback(() => setScale(s => [...ZOOM_LEVELS].reverse().find(l => l < s - 0.01) || s), []);
  
  const fitToWidth = useCallback(() => {
    if (!viewerRef.current || pageDimensions.length === 0) return;
    const viewerWidth = viewerRef.current.clientWidth;
    const pageContentWidth = pageDimensions[0].width;
    setScale((viewerWidth - (PAGE_MARGIN * 2)) / pageContentWidth);
  }, [pageDimensions]);

  useEffect(() => {
    if (pageDimensions.length > 0 && !initialFitApplied.current) {
      if (doc.lastScale === undefined && window.innerWidth < 768) {
        fitToWidth();
      }
      initialFitApplied.current = true;
    }
  }, [pageDimensions, fitToWidth, doc.lastScale]);

  const renderPage = useCallback(async (pageNum: number) => {
    const pageContainer = pageRefs.current[pageNum - 1];
    if (!pageContainer || renderedPages.current.get(pageNum) === scale) return;
    const contentContainer = pageContainer.querySelector('.pdf-page-content') as HTMLDivElement;
    if (!contentContainer) return;
    if (renderTaskRefs.current[pageNum]) renderTaskRefs.current[pageNum].cancel();
    
    try {
      // Get the library here before using it. The promise is cached,
      // so this is a fast, synchronous operation after the first load.
      const { pdfjsLib, pdfjsViewer } = await getPdfJs();
      
      if (pdfDoc) {
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale });
        
        contentContainer.innerHTML = ''; // Clear previous renders
        
        const canvas = document.createElement('canvas');
        canvas.className = "w-full h-auto";
        const canvasContext = canvas.getContext('2d', { willReadFrequently: true });
        if (!canvasContext) return;
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const textLayer = document.createElement('div');
        textLayer.className = 'textLayer';
        
        const annotationLayer = document.createElement('div');
        annotationLayer.className = 'annotationLayer';

        contentContainer.appendChild(canvas);
        contentContainer.appendChild(textLayer);
        contentContainer.appendChild(annotationLayer);
        
        const renderTask = page.render({ canvasContext, viewport });
        renderTaskRefs.current[pageNum] = renderTask;
        await renderTask.promise;
        
        const textContent = await page.getTextContent();
        pdfjsLib.renderTextLayer({ textContentSource: textContent, container: textLayer, viewport: viewport, textDivs: [] });
        
        const linkService = {
            goToDestination: async (dest: any) => {
                let pageNumber;
                if (typeof dest === 'string') {
                    const explicitDest = await pdfDoc.getDestination(dest);
                    pageNumber = await pdfDoc.getPageIndex(explicitDest[0]) + 1;
                } else if (Array.isArray(dest)) {
                    pageNumber = await pdfDoc.getPageIndex(dest[0]) + 1;
                }
                if (pageNumber) goToPage(pageNumber);
            },
            getAnchorUrl: (url: string) => url,
            executeLink: (data: { url?: string; dest?: any; }) => {
                if (data.url) {
                    window.open(data.url, '_blank', 'noopener,noreferrer');
                } else if (data.dest) {
                    linkService.goToDestination(data.dest);
                }
            },
        };

        const downloadManager = {
            downloadUrl() {},
            download() {},
            openOrDownloadData() {},
        };
        
        // FIX: Provide a dummy annotationStorage. Certain annotation types, like interactive
        // form fields, require this storage service to function. Its absence can cause
        // the annotation rendering process to fail internally, leading to the observed error.
        const annotationStorage = {
            getValue(key: string, defaultValue: any) { return defaultValue; },
            setValue(key: string, value: any) {},
        };

        const annotationLayerBuilder = new pdfjsViewer.AnnotationLayerBuilder({
            div: annotationLayer,
            page: page,
            viewport: viewport.clone({ dontFlip: true }),
            linkService: linkService,
            downloadManager: downloadManager,
            annotationStorage: annotationStorage,
        });
        
        annotationLayerBuilder.render(viewport);

      } else { // Handle image documents
        const pageData = processedData[pageNum - 1];
        if (pageData) {
          contentContainer.innerHTML = `<img src="data:image/jpeg;base64,${pageData.image}" alt="Page ${pageNum}" class="w-full h-auto" />`;
        }
      }
      renderedPages.current.set(pageNum, scale);
      delete renderTaskRefs.current[pageNum];
    } catch (error: any) {
      if (error.name !== 'RenderingCancelledException') {
        console.error(`Failed to render page ${pageNum}:`, error);
        contentContainer.innerHTML = `<div class="p-4 text-center text-red-600 font-semibold">Page failed to load</div>`;
      }
    }
  }, [pdfDoc, scale, processedData, goToPage]);

  useEffect(() => {
    if (!doc) return;
    const loadDocumentData = async () => {
      setIsLoading(true);
      try {
        // This is the core fix: ensure the library is loaded and configured
        // before any of its APIs are used on the main thread.
        const { pdfjsLib } = await getPdfJs();

        const [data, annos] = await Promise.all([
            db.loadProcessedData(doc.id),
            db.getAnnotationsForDocument(doc.id)
        ]);
        if (!data || data.length === 0) throw new Error("Document has not been processed yet.");
        if (!isMountedRef.current) return;
        
        setProcessedData(data);
        setAnnotations(annos);
        setNumPages(data.length);
        pageRefs.current = Array(data.length).fill(null);

        if (doc.file.type === 'application/pdf') {
          const typedarray = new Uint8Array(await doc.file.arrayBuffer());
          const pdfJsDoc = await pdfjsLib.getDocument({ data: typedarray }).promise;
          if (!isMountedRef.current) return;
          setPdfDoc(pdfJsDoc);
          const dims = [];
          for (let i = 1; i <= pdfJsDoc.numPages; i++) {
              const page = await pdfJsDoc.getPage(i);
              const viewport = page.getViewport({ scale: 1.0 });
              dims.push({ width: viewport.width, height: viewport.height });
          }
          if (isMountedRef.current) setPageDimensions(dims);
        } else { // Image document
           const img = new Image();
           img.onload = () => {
             if (isMountedRef.current) setPageDimensions([{ width: img.width, height: img.height }]);
           };
           img.src = `data:image/jpeg;base64,${data[0].image}`;
        }
        setIsLoading(false);
      } catch (err: any) {
        if (isMountedRef.current) onLoadError(err.message || "Failed to load document data.");
      }
    };
    loadDocumentData();
  }, [doc, onLoadError]);
  
  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();
    const options = { root: viewerRef.current, rootMargin: "-40% 0px -40% 0px", threshold: 0 };
    const handleIntersect = (entries: IntersectionObserverEntry[]) => {
        if (isProgrammaticScroll.current) return;
        const intersecting = entries.filter(e => e.isIntersecting);
        if (intersecting.length > 0) {
            const best = intersecting.reduce((p, c) => (p.intersectionRatio > c.intersectionRatio) ? p : c);
            const pageNum = parseInt(best.target.getAttribute('data-page-number') || '0', 10);
            if (pageNum) setCurrentPage(pageNum);
        }
    };
    observerRef.current = new IntersectionObserver(handleIntersect, options);
    const observer = observerRef.current;
    pageRefs.current.forEach(pageEl => { if (pageEl) observer.observe(pageEl); });
    return () => observer.disconnect();
  }, [visiblePageRange]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const debouncedScroll = debounce(handleScroll, 50);
    handleScroll();
    viewer.addEventListener('scroll', debouncedScroll);
    window.addEventListener('resize', debouncedScroll);
    return () => {
        viewer.removeEventListener('scroll', debouncedScroll);
        window.removeEventListener('resize', debouncedScroll);
    }
  }, [handleScroll]);

  useEffect(() => { renderedPages.current.clear(); handleScroll(); }, [scale, handleScroll]);

  useEffect(() => {
      for (let i = visiblePageRange.start; i <= visiblePageRange.end; i++) {
          renderPage(i + 1);
      }
  }, [visiblePageRange, renderPage]);

  // --- Unified Touch Handlers for Swipe and Pinch-to-Zoom ---
  const handleViewerTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
        // Start of a pinch gesture
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        initialPinchDistanceRef.current = Math.sqrt(dx * dx + dy * dy);
        initialScaleRef.current = scale; // Capture scale at the beginning
        // Prevent swipe logic from starting
        touchStartX.current = 0;
        touchEndX.current = 0;
    } else if (e.touches.length === 1) {
        // Start of a potential swipe gesture
        touchStartX.current = e.touches[0].clientX;
        touchEndX.current = e.touches[0].clientX;
    }
  };

  const handleViewerTouchMove = (e: React.TouchEvent) => {
    // --- PINCH TO ZOOM LOGIC ---
    if (e.touches.length === 2 && initialPinchDistanceRef.current > 0 && viewerRef.current) {
        e.preventDefault();
        const viewer = viewerRef.current;
        const viewerRect = viewer.getBoundingClientRect();

        // Calculate new scale based on pinch distance
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const currentDistance = Math.sqrt(dx * dx + dy * dy);
        const zoomFactor = currentDistance / initialPinchDistanceRef.current;
        let newScale = initialScaleRef.current * zoomFactor;

        // Clamp the scale to predefined min/max
        const minScale = ZOOM_LEVELS[0];
        const maxScale = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
        newScale = Math.max(minScale, Math.min(newScale, maxScale));
        
        // --- Centered Zoom Logic ---
        const midpoint = {
            x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
            y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        };
        const pointOnScreen = {
            x: midpoint.x - viewerRect.left,
            y: midpoint.y - viewerRect.top,
        };
        const pointOnContent = {
            x: (viewer.scrollLeft + pointOnScreen.x) / scale,
            y: (viewer.scrollTop + pointOnScreen.y) / scale,
        };
        
        const newScrollTop = (pointOnContent.y * newScale) - pointOnScreen.y;
        const newScrollLeft = (pointOnContent.x * newScale) - pointOnScreen.x;
        
        viewer.scrollTop = newScrollTop;
        viewer.scrollLeft = newScrollLeft;
        setScale(newScale);

    } 
    // --- SWIPE LOGIC ---
    else if (e.touches.length === 1 && touchStartX.current !== 0) {
        touchEndX.current = e.touches[0].clientX;
    }
  };

  const handleViewerTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length < 2) {
        initialPinchDistanceRef.current = 0;
    }
    
    if (e.touches.length === 0 && touchStartX.current !== 0) {
        const deltaX = touchStartX.current - touchEndX.current;
        const SWIPE_THRESHOLD = 75;
        if (deltaX > SWIPE_THRESHOLD) {
            goToPage(currentPage + 1); // Swipe left
        } else if (deltaX < -SWIPE_THRESHOLD) {
            goToPage(currentPage - 1); // Swipe right
        }
        
        touchStartX.current = 0;
        touchEndX.current = 0;
    }
  };
  
  // --- Annotation & Selection Logic ---
  const handleMouseUp = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    // Don't trigger selection if a link was clicked
    if (target.closest('.linkAnnotation')) return;

    if (aiAction || isAiActionLoading) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) { setSelection(null); return; }

    const range = sel.getRangeAt(0);
    const text = sel.toString().trim();
    if (!text) { setSelection(null); return; }

    const container = range.commonAncestorContainer;
    const pageEl = ((container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement) as Element)?.closest('[data-page-number]');
    if (!pageEl || !viewerRef.current) { setSelection(null); return; }
    
    const pageNum = parseInt(pageEl.getAttribute('data-page-number')!, 10);
    const pageRect = pageEl.getBoundingClientRect();
    const clientRect = range.getBoundingClientRect();

    const rects: Rect[] = Array.from(range.getClientRects()).map(r => ({
        x: r.left - pageRect.left,
        y: r.top - pageRect.top,
        width: r.width,
        height: r.height,
    }));

    setSelection({ text, pageNum, rects, clientRect });
  };
  
  useEffect(() => {
    if (selection && viewerRef.current) {
        const popoverWidth = 132;
        const popoverHeight = 44;
        const viewerRect = viewerRef.current.getBoundingClientRect();

        let top = selection.clientRect.top - popoverHeight - 4;
        let left = selection.clientRect.left + (selection.clientRect.width / 2) - (popoverWidth / 2);

        if (top < viewerRect.top) {
            top = selection.clientRect.bottom + 8;
        }

        left = Math.max(viewerRect.left + 8, left);
        left = Math.min(viewerRect.right - popoverWidth - 8, left);

        setSelectionPopoverStyle({
            left: `${left}px`,
            top: `${top}px`,
            opacity: 1,
            pointerEvents: 'auto',
        });
    } else {
        setSelectionPopoverStyle({ opacity: 0, pointerEvents: 'none' });
    }
  }, [selection]);
  
  useEffect(() => {
    if (aiAction && selection && viewerRef.current) {
        const popoverMaxWidth = 320;
        const viewerRect = viewerRef.current.getBoundingClientRect();

        let top = selection.clientRect.bottom + 8;
        let left = selection.clientRect.left;

        if (top + 200 > viewerRect.bottom) { // rough height check
            top = selection.clientRect.top - 200 - 8;
        }

        left = Math.max(viewerRect.left + 8, left);
        if (left + popoverMaxWidth > viewerRect.right - 8) {
            left = viewerRect.right - popoverMaxWidth - 8;
        }

        setAiActionPopoverStyle({
            left: `${left}px`,
            top: `${top}px`,
            opacity: 1,
            pointerEvents: 'auto',
        });
    } else {
        setAiActionPopoverStyle({ opacity: 0, pointerEvents: 'none' });
    }
  }, [aiAction, selection]);

  const handleAiAction = async (type: 'summary' | 'explanation') => {
      if (!selection) return;
      setIsAiActionLoading(true);
      setAiAction({ type, content: 'Loading...' });
      try {
          const content = type === 'summary'
              ? await summarizeText(selection.text)
              : await explainText(selection.text);
          if(isMountedRef.current) setAiAction({ type, content });
      } catch (e) {
          if(isMountedRef.current) setAiAction({ type, content: 'Sorry, an error occurred.' });
      } finally {
          if(isMountedRef.current) setIsAiActionLoading(false);
      }
  };
  
  const clearSelection = useCallback(() => {
      window.getSelection()?.removeAllRanges();
      setSelection(null);
      setAiAction(null);
  }, []);
  
  const handleHighlight = async () => {
    if (!selection) return;
    const newAnnotation: Annotation = {
      id: crypto.randomUUID(),
      docId: doc.id,
      pageNum: selection.pageNum,
      type: 'highlight',
      content: selection.text,
      rects: selection.rects,
      createdAt: new Date(),
    };
    await db.saveAnnotation(newAnnotation);
    setAnnotations(prev => [...prev, newAnnotation]);
    clearSelection();
  };
  
  // --- Side Panel Logic ---
  const togglePanel = useCallback((panel: ActivePanel) => {
    setActivePanel(prev => prev === panel ? 'none' : panel);
  }, []);
  
  const handleAnnotationSelect = (annotation: Annotation) => {
    goToPage(annotation.pageNum);
    
    // Briefly highlight the annotation
    const pageEl = pageRefs.current[annotation.pageNum - 1];
    if (pageEl) {
        annotation.rects.forEach((rect, index) => {
            const highlight = document.createElement('div');
            highlight.className = 'temporary-highlight';
            highlight.style.position = 'absolute';
            highlight.style.left = `${rect.x}px`;
            highlight.style.top = `${rect.y}px`;
            highlight.style.width = `${rect.width}px`;
            highlight.style.height = `${rect.height}px`;
            
            const contentContainer = pageEl.querySelector('.pdf-page-content');
            contentContainer?.appendChild(highlight);
            setTimeout(() => contentContainer?.removeChild(highlight), 4000);
        });
    }
  };
  
  const handleAnnotationDelete = async (id: string) => {
      await db.deleteAnnotation(id);
      setAnnotations(prev => prev.filter(a => a.id !== id));
  };
  
  // --- Component Render ---
  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-slate-100 dark:bg-slate-900">
        <Loader />
      </div>
    );
  }
  
  const viewerContainerClasses = [
    'h-full',
    'transition-all',
    'duration-300',
    'ease-in-out',
    'md:pr-0',
    activePanel !== 'none' ? 'md:pr-[350px]' : 'md:pr-0',
    isThumbnailsVisible ? 'md:pl-[150px]' : 'md:pl-0',
  ].join(' ');
  
  return (
    <div className="h-screen w-screen bg-slate-100 dark:bg-slate-900 overflow-hidden flex flex-col">
      {/* Viewer Header */}
      <header className="flex-shrink-0 w-full bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border-b border-slate-200 dark:border-slate-700 z-20">
        <div className="flex items-center justify-between p-2">
            <div className="flex items-center gap-1 sm:gap-2">
                <button onClick={onReset} className="p-2 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700" aria-label="Back to Dashboard"><ArrowLeftIcon className="w-5 h-5"/></button>
                <button onClick={() => setIsThumbnailsVisible(v => !v)} className="p-2 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 hidden md:block" aria-label="Toggle Thumbnails"><BookOpenIcon className="w-5 h-5"/></button>
                <div className="h-6 w-px bg-slate-200 dark:bg-slate-700 hidden md:block"></div>
                <h1 className="font-semibold text-sm sm:text-base text-slate-700 dark:text-slate-200 line-clamp-1 break-all px-2">{doc.name}</h1>
            </div>

            <div className="hidden md:flex items-center gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
                <button onClick={zoomOut} className="p-2 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50" disabled={scale <= ZOOM_LEVELS[0]} aria-label="Zoom Out"><ZoomOutIcon className="w-5 h-5"/></button>
                <button onClick={zoomIn} className="p-2 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50" disabled={scale >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]} aria-label="Zoom In"><ZoomInIcon className="w-5 h-5"/></button>
                <div className="h-5 w-px bg-slate-300 dark:bg-slate-600"></div>
                <span className="text-sm font-semibold w-16 text-center">{Math.round(scale * 100)}%</span>
                <div className="h-5 w-px bg-slate-300 dark:bg-slate-600"></div>
                <button onClick={fitToWidth} className="p-2 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700" aria-label="Fit to Width"><FitToWidthIcon className="w-5 h-5"/></button>
            </div>

            <div className="flex items-center gap-1 sm:gap-2">
                <button onClick={() => setIsSummaryOpen(true)} className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-semibold hover:bg-slate-200 dark:hover:bg-slate-700`}>
                    <DocumentTextIcon className="w-5 h-5 text-indigo-500 dark:text-indigo-400"/>
                </button>
                 <button onClick={() => togglePanel('chat')} className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-semibold ${activePanel === 'chat' ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300' : 'hover:bg-slate-200 dark:hover:bg-slate-700'}`}>
                    <ChatBubbleIcon className="w-5 h-5"/>
                </button>
                <button onClick={() => togglePanel('study')} className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-semibold ${activePanel === 'study' ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300' : 'hover:bg-slate-200 dark:hover:bg-slate-700'}`}>
                    <AcademicCapIcon className="w-5 h-5"/>
                </button>
                 <button onClick={() => togglePanel('aiCoach')} className={`hidden md:flex items-center gap-2 px-3 py-2 rounded-md text-sm font-semibold ${activePanel === 'aiCoach' ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300' : 'hover:bg-slate-200 dark:hover:bg-slate-700'}`}>
                    <SparklesIcon className="w-5 h-5"/>
                    <span>AI Coach</span>
                </button>
                <button onClick={toggleTheme} className="p-2 rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700" aria-label="Toggle theme">
                    {theme === 'light' ? <MoonIcon className="w-5 h-5" /> : <SunIcon className="w-5 h-5" />}
                </button>
            </div>
        </div>
      </header>
      
      {/* Main Content Area */}
      <main className="flex-1 min-h-0 relative">
        <div className={viewerContainerClasses}>
            {/* Thumbnail Sidebar */}
            <aside ref={thumbnailContainerRef} className={`hidden md:block fixed top-[61px] left-0 bottom-0 w-[150px] bg-slate-200/50 dark:bg-black/20 p-2 overflow-y-auto transition-transform duration-300 ease-in-out ${isThumbnailsVisible ? 'translate-x-0' : '-translate-x-full'}`}>
                <div className="space-y-2">
                    {Array.from({ length: numPages }, (_, i) => i + 1).map(pageNum => (
                        <Thumbnail 
                            key={pageNum}
                            pdfDoc={pdfDoc}
                            pageNum={pageNum}
                            pageData={processedData[pageNum - 1]}
                            cachedThumb={thumbnailCache[pageNum]}
                            onThumbGenerated={(num, dataUrl) => setThumbnailCache(prev => ({...prev, [num]: dataUrl}))}
                            onClick={() => goToPage(pageNum)}
                            isActive={currentPage === pageNum}
                            scrollContainerRef={thumbnailContainerRef}
                        />
                    ))}
                </div>
            </aside>
            
            {/* PDF Viewer */}
            <div
                ref={viewerRef}
                className="w-full h-full overflow-y-auto overflow-x-auto"
                onTouchStart={handleViewerTouchStart}
                onTouchMove={handleViewerTouchMove}
                onTouchEnd={handleViewerTouchEnd}
                onMouseUp={handleMouseUp}
            >
              <div className="relative mx-auto" style={{ height: `${totalHeight}px`, width: pageMetas[0] ? `${pageMetas[0].width}px` : '100%' }}>
                {pageMetas.map((meta, index) => {
                  const pageNum = index + 1;
                  const isVisible = pageNum >= visiblePageRange.start + 1 && pageNum <= visiblePageRange.end + 1;
                  
                  return (
                    <div
                      key={pageNum}
                      // FIX: The `ref` callback should not return a value.
                      // By wrapping the assignment in curly braces, we ensure the arrow function
                      // implicitly returns `undefined`, satisfying the `RefCallback` type.
                      ref={el => { pageRefs.current[index] = el; }}
                      data-page-number={pageNum}
                      className="absolute pdf-page-container bg-white dark:bg-slate-800 shadow-md"
                      style={{
                        left: '50%',
                        transform: 'translateX(-50%)',
                        top: `${meta.top}px`,
                        width: `${meta.width}px`,
                        height: `${meta.height}px`,
                      }}
                    >
                      <div className="pdf-page-content w-full h-full relative">
                        {isVisible ? null : <div className="w-full h-full flex items-center justify-center"><Loader /></div>}
                      </div>
                      {annotations.filter(a => a.pageNum === pageNum).map(anno => (
                          anno.rects.map((rect, i) => (
                            <div key={`${anno.id}-${i}`} className="annotation-highlight" style={{
                              left: `${rect.x}px`,
                              top: `${rect.y}px`,
                              width: `${rect.width}px`,
                              height: `${rect.height}px`,
                            }} />
                          ))
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
        </div>

        {/* Right Side Panel */}
        <aside className={`fixed top-[61px] right-0 bottom-0 w-[350px] bg-white dark:bg-slate-800 shadow-lg border-l border-slate-200 dark:border-slate-700 transition-transform duration-300 ease-in-out z-10 ${activePanel !== 'none' ? 'translate-x-0' : 'translate-x-full'}`}>
          {activePanel === 'chat' && <PageChat documentId={doc.id} numPages={numPages} currentPage={currentPage} isOpen={true} onClose={() => setActivePanel('none')} />}
          {activePanel === 'study' && <StudyPanel documentId={doc.id} numPages={numPages} currentPage={currentPage} onClose={() => setActivePanel('none')} />}
          {activePanel === 'aiCoach' && <AiCoachPanel documentId={doc.id} numPages={numPages} currentPage={currentPage} onClose={() => setActivePanel('none')} onGoToPage={goToPage} />}
        </aside>
      </main>

       {/* Mobile bottom toolbar */}
       <div className={`md:hidden fixed bottom-0 left-0 right-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border-t border-slate-200 dark:border-slate-700 p-2 shadow-[0_-2px_10px_rgba(0,0,0,0.1)] transition-transform duration-300 ${isMobileToolbarVisible ? 'translate-y-0' : 'translate-y-full'}`}>
            <div className="flex items-center justify-between">
                {/* Page Navigation */}
                <div className="flex items-center gap-1">
                    <button onClick={() => goToPage(currentPage - 1)} className="p-2 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50" disabled={currentPage <= 1}><ChevronLeftIcon className="w-6 h-6" /></button>
                    <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                        <input
                            type="text"
                            pattern="\d*"
                            value={pageInput}
                            onChange={handlePageInputChange}
                            onBlur={navigateToInputPage}
                            onKeyDown={(e) => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); navigateToInputPage(); } }}
                            className="w-10 text-center bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md p-1"
                        />
                        / {numPages}
                    </div>
                    <button onClick={() => goToPage(currentPage + 1)} className="p-2 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50" disabled={currentPage >= numPages}><ChevronRightIcon className="w-6 h-6" /></button>
                </div>
                
                {/* AI Coach Button */}
                <button onClick={() => setActivePanel(p => p === 'aiCoach' ? 'none' : 'aiCoach')} className="p-3 rounded-full bg-blue-600 text-white shadow-lg transform active:scale-95 transition-transform">
                    <SparklesIcon className="w-6 h-6"/>
                </button>
                
                {/* Zoom Controls */}
                <div className="flex items-center gap-1">
                    <button onClick={zoomOut} className="p-2 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50" disabled={scale <= ZOOM_LEVELS[0]}><ZoomOutIcon className="w-6 h-6" /></button>
                     <span className="text-sm font-semibold w-14 text-center tabular-nums">{Math.round(scale * 100)}%</span>
                    <button onClick={zoomIn} className="p-2 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50" disabled={scale >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}><ZoomInIcon className="w-6 h-6" /></button>
                </div>
            </div>
        </div>
      
      {isSummaryOpen && <SummaryModal isOpen={isSummaryOpen} onClose={() => setIsSummaryOpen(false)} documentId={doc.id} startPage={currentPage} endPage={currentPage} />}
      
        {/* AI Action Popover */}
        {aiAction && (
            <div
                style={aiActionPopoverStyle}
                className="fixed z-30 bg-white dark:bg-slate-800 rounded-lg shadow-xl w-80 max-h-96 flex flex-col transition-opacity duration-150 animate-pop-in"
                onMouseDown={(e) => e.preventDefault()}
            >
                <header className="flex items-center justify-between p-2 border-b border-slate-200 dark:border-slate-700">
                    <h4 className="text-sm font-semibold capitalize">{aiAction.type}</h4>
                    <button onClick={clearSelection} className="p-1 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700"><XIcon className="w-4 h-4"/></button>
                </header>
                <div className="p-3 overflow-y-auto text-sm">
                    {isAiActionLoading ? <div className="flex justify-center py-4"><Loader /></div> : aiAction.content}
                </div>
            </div>
        )}
    </div>
  );
});