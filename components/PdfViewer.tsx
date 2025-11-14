import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";
import { 
    ChevronLeftIcon, ChevronRightIcon, ZoomInIcon, ZoomOutIcon, 
    ArrowLeftIcon, BookOpenIcon,
    ChevronDoubleLeftIcon, ChevronDoubleRightIcon, ChatBubbleIcon,
    FitToWidthIcon, SparklesIcon, XIcon, SunIcon, MoonIcon,
    DocumentTextIcon, LightbulbIcon, HighlighterIcon, EyeSlashIcon
} from './Icons';
import { Loader } from './Loader';
import { PageChat } from './PageChat';
import { VoiceReviewer } from './VoiceReviewer';
import { StudyPanel } from './StudyPanel';
import { Thumbnail } from './Thumbnail';
import * as db from '../utils/db';
import { Document, ProcessedPageData, Annotation, Rect } from '../types';
import { SummaryModal } from './SummaryModal';
import { summarizeText, explainText } from '../services/geminiService';

const PDF_WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";
if (pdfjsLib.GlobalWorkerOptions.workerSrc !== PDF_WORKER_URL) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
}

const ZOOM_LEVELS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0];
const PAGE_MARGIN = 16;
const OVERSCAN_COUNT = 3;

type ActivePanel = 'none' | 'thumbnails' | 'chat' | 'review' | 'study';
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
  const [scale, setScale] = useState(1.0);
  const [isLoading, setIsLoading] = useState(true);
  const [isDistractionFree, setIsDistractionFree] = useState(false);
  
  const [pageDimensions, setPageDimensions] = useState<{ width: number, height: number }[]>([]);
  const [visiblePageRange, setVisiblePageRange] = useState<{ start: number, end: number }>({ start: 0, end: 0 });

  const viewerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const renderTaskRefs = useRef<Record<number, any>>({});
  const renderedPages = useRef<Map<number, number>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const isProgrammaticScroll = useRef(false);
  const isMountedRef = useRef(false);
  
  const [activePanel, setActivePanel] = useState<ActivePanel>('none');
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const [thumbnailCache, setThumbnailCache] = useState<Record<number, string>>({});
  
  const [selection, setSelection] = useState<Selection | null>(null);
  const [aiAction, setAiAction] = useState<AiAction | null>(null);
  const [isAiActionLoading, setIsAiActionLoading] = useState(false);
  
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);

  useEffect(() => { isMountedRef.current = true; return () => { isMountedRef.current = false; }; }, []);

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

  const handleScroll = useCallback(() => {
    if (!viewerRef.current || pageMetas.length === 0) return;
    const viewer = viewerRef.current;
    const { scrollTop, clientHeight } = viewer;
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

  useEffect(() => { setPageInput(String(currentPage)); }, [currentPage]);
  
  const handlePageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => { setPageInput(e.target.value); };
  const navigateToInputPage = () => {
      const pageNum = parseInt(pageInput, 10);
      if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= numPages) goToPage(pageNum);
      else setPageInput(String(currentPage));
  };
  
  const zoomIn = useCallback(() => setScale(s => ZOOM_LEVELS.find(l => l > s + 0.01) || s), []);
  const zoomOut = useCallback(() => setScale(s => [...ZOOM_LEVELS].reverse().find(l => l < s - 0.01) || s), []);
  
  const fitToWidth = useCallback(() => {
    if (!viewerRef.current || pageDimensions.length === 0) return;
    const viewerWidth = viewerRef.current.clientWidth;
    const pageContentWidth = pageDimensions[0].width;
    setScale((viewerWidth - (PAGE_MARGIN * 2)) / pageContentWidth);
  }, [pageDimensions]);

  const renderPage = useCallback(async (pageNum: number) => {
    const pageContainer = pageRefs.current[pageNum - 1];
    if (!pageContainer || renderedPages.current.get(pageNum) === scale) return;
    const contentContainer = pageContainer.querySelector('.pdf-page-content') as HTMLDivElement;
    if (!contentContainer) return;
    if (renderTaskRefs.current[pageNum]) renderTaskRefs.current[pageNum].cancel();
    
    try {
      if (pdfDoc) {
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale });
        // FIX: Aliasing the `document` prop to `doc` resolves the name collision, allowing `document` here to correctly refer to the global DOM document.
        const canvas = document.createElement('canvas');
        canvas.className = "w-full h-auto";
        const canvasContext = canvas.getContext('2d', { willReadFrequently: true });
        if (!canvasContext) return;
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        // FIX: Aliasing the `document` prop to `doc` resolves the name collision, allowing `document` here to correctly refer to the global DOM document.
        const textLayer = document.createElement('div');
        textLayer.className = 'textLayer';
        contentContainer.innerHTML = '';
        contentContainer.appendChild(canvas);
        contentContainer.appendChild(textLayer);
        const renderTask = page.render({ canvasContext, viewport });
        renderTaskRefs.current[pageNum] = renderTask;
        await renderTask.promise;
        const textContent = await page.getTextContent();
        pdfjsLib.renderTextLayer({ textContentSource: textContent, container: textLayer, viewport: viewport, textDivs: [] });
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
  }, [pdfDoc, scale, processedData]);

  useEffect(() => {
    if (!doc) return;
    const loadDocumentData = async () => {
      setIsLoading(true);
      try {
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
  
  const handleTouchStart = (e: React.TouchEvent) => { touchStartX.current = e.targetTouches[0].clientX; };
  const handleTouchMove = (e: React.TouchEvent) => { touchEndX.current = e.targetTouches[0].clientX; };
  const handleTouchEnd = () => {
    if (touchStartX.current - touchEndX.current > 75) goToPage(currentPage + 1); // Swipe left
    if (touchStartX.current - touchEndX.current < -75) goToPage(currentPage - 1); // Swipe right
  };
  
  // --- Annotation & Selection Logic ---
  const handleMouseUp = (e: React.MouseEvent) => {
    if (aiAction || isAiActionLoading) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) { setSelection(null); return; }

    const range = sel.getRangeAt(0);
    const text = sel.toString().trim();
    if (!text) { setSelection(null); return; }

    const container = range.commonAncestorContainer;
    // FIX: Cast the container/parentElement to an Element to ensure the `closest` method is available, as it doesn't exist on the base Node type.
    const pageEl = ((container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement) as Element)?.closest('[data-page-number]');
    if (!pageEl || !viewerRef.current) { setSelection(null); return; }
    
    const pageNum = parseInt(pageEl.getAttribute('data-page-number')!, 10);
    const viewerRect = viewerRef.current.getBoundingClientRect();
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
  
  const handleHighlight = useCallback(async () => {
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
    setSelection(null);
  }, [selection, doc.id]);

  const handleAiAction = useCallback(async (actionType: 'summary' | 'explanation') => {
    if (!selection) return;
    setIsAiActionLoading(true);
    setAiAction({ type: actionType, content: '' });
    try {
        const result = actionType === 'summary' 
            ? await summarizeText(selection.text)
            : await explainText(selection.text);
        setAiAction({ type: actionType, content: result });
    } catch (e) {
        setAiAction({ type: actionType, content: 'Sorry, an error occurred.' });
    } finally {
        setIsAiActionLoading(false);
    }
  }, [selection]);

  const closeAiAction = () => {
    setAiAction(null);
    setSelection(null);
  };
  
  const togglePanel = (panel: ActivePanel) => {
    setActivePanel(prev => prev === panel ? 'none' : panel);
  };

  const pageAnnotations = useMemo(() => {
    return annotations
      .filter(a => a.pageNum >= visiblePageRange.start + 1 && a.pageNum <= visiblePageRange.end + 1)
      .reduce((acc, anno) => {
        if (!acc[anno.pageNum]) acc[anno.pageNum] = [];
        acc[anno.pageNum].push(anno);
        return acc;
      }, {} as Record<number, Annotation[]>);
  }, [annotations, visiblePageRange]);

  if (isLoading || numPages === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-100 dark:bg-slate-900">
        <Loader />
        <p className="mt-4 font-semibold text-slate-700 dark:text-slate-200">{isLoading ? "Loading Document..." : "Preparing..."}</p>
      </div>
    );
  }

  const pagesToRender = [];
  if (pageMetas.length > 0) {
      for (let i = visiblePageRange.start; i <= visiblePageRange.end; i++) {
          pagesToRender.push({ pageNum: i + 1, meta: pageMetas[i] });
      }
  }

  const mainContentClass = `flex-1 bg-slate-200 dark:bg-slate-900 overflow-y-auto transition-all duration-300 ease-in-out ${activePanel !== 'none' && 'lg:mr-[28rem]'}`;

  return (
    <div className={`h-screen w-screen flex flex-col bg-slate-50 dark:bg-slate-800 overflow-hidden ${isDistractionFree ? 'distraction-free' : ''}`} role="application">
        <header className={`sticky top-0 bg-slate-800 text-white shadow-md p-2 flex items-center justify-between z-30 flex-shrink-0 transition-transform duration-300 ${isDistractionFree ? '-translate-y-full' : ''}`}>
             <div className="flex items-center gap-2">
                <button onClick={onReset} className="p-2 rounded-md hover:bg-slate-700 transition-colors" aria-label="Back to Dashboard">
                    <ArrowLeftIcon className="w-6 h-6" />
                </button>
                <button onClick={() => togglePanel('thumbnails')} className="p-2 rounded-md hover:bg-slate-700 transition-colors lg:hidden" aria-label="Toggle thumbnails">
                    <BookOpenIcon className="w-6 h-6" />
                </button>
                <h2 className="font-semibold text-lg truncate max-w-xs sm:max-w-md hidden sm:block">{doc.file.name}</h2>
            </div>
            <div className="absolute left-1/2 -translate-x-1/2 items-center gap-2 justify-center hidden md:flex">
                <button onClick={() => goToPage(1)} className="p-2 rounded-md hover:bg-slate-700 transition-colors" aria-label="First page"><ChevronDoubleLeftIcon className="w-5 h-5" /></button>
                <button onClick={() => goToPage(currentPage - 1)} className="p-2 rounded-md hover:bg-slate-700 transition-colors" aria-label="Previous page"><ChevronLeftIcon className="w-5 h-5" /></button>
                <div className="flex items-center text-sm">
                    <input type="text" value={pageInput} onChange={handlePageInputChange} onKeyDown={e => e.key === 'Enter' && navigateToInputPage()} onBlur={navigateToInputPage} className="w-12 bg-slate-700 text-center rounded-md border-slate-600 focus:ring-blue-500 focus:border-blue-500" />
                    <span className="px-2">/ {numPages}</span>
                </div>
                <button onClick={() => goToPage(currentPage + 1)} className="p-2 rounded-md hover:bg-slate-700 transition-colors" aria-label="Next page"><ChevronRightIcon className="w-5 h-5" /></button>
                <button onClick={() => goToPage(numPages)} className="p-2 rounded-md hover:bg-slate-700 transition-colors" aria-label="Last page"><ChevronDoubleRightIcon className="w-5 h-5" /></button>
            </div>
            <div className="flex items-center gap-1 sm:gap-2">
                <button onClick={zoomOut} className="p-2 rounded-md hover:bg-slate-700 transition-colors disabled:opacity-50" aria-label="Zoom out" disabled={scale <= ZOOM_LEVELS[0]}><ZoomOutIcon className="w-6 h-6" /></button>
                <div className="w-16 text-center font-semibold text-sm tabular-nums" aria-live="polite">{`${Math.round(scale * 100)}%`}</div>
                <button onClick={zoomIn} className="p-2 rounded-md hover:bg-slate-700 transition-colors disabled:opacity-50" aria-label="Zoom in" disabled={scale >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}><ZoomInIcon className="w-6 h-6" /></button>
                <button onClick={fitToWidth} className="p-2 rounded-md hover:bg-slate-700 transition-colors hidden sm:block" aria-label="Fit to width"><FitToWidthIcon className="w-6 h-6" /></button>
                <button onClick={() => setIsDistractionFree(p => !p)} className="p-2 rounded-md hover:bg-slate-700 transition-colors hidden sm:block" aria-label="Toggle distraction free mode"><EyeSlashIcon className="w-6 h-6" /></button>
                <span className="h-6 w-px bg-slate-600 mx-1 hidden sm:block"></span>
                <button onClick={() => setIsSummaryOpen(true)} title="Summarize" className="p-2 rounded-md hover:bg-slate-700 transition-colors"><SparklesIcon className="w-6 h-6"/></button>
                <button onClick={() => togglePanel('chat')} title="Chat" className={`p-2 rounded-md hover:bg-slate-700 transition-colors ${activePanel === 'chat' && 'bg-slate-700'}`}><ChatBubbleIcon className="w-6 h-6" /></button>
                <button onClick={() => togglePanel('study')} title="Study Quiz" className={`p-2 rounded-md hover:bg-slate-700 transition-colors ${activePanel === 'study' && 'bg-slate-700'}`}><BookOpenIcon className="w-6 h-6"/></button>
                <button onClick={toggleTheme} className="p-2 rounded-md hover:bg-slate-700">{theme === 'light' ? <MoonIcon className="w-6 h-6"/> : <SunIcon className="w-6 h-6"/>}</button>
            </div>
        </header>
        <div className="flex flex-1 min-h-0 relative">
            <aside className={`w-48 bg-slate-100 dark:bg-slate-900 border-r border-slate-300 dark:border-slate-700 p-2 overflow-y-auto hidden lg:block transition-transform duration-300 ${isDistractionFree ? '-translate-x-full' : ''}`}><div className="space-y-2">{Array.from({ length: numPages }).map((_, i) => (<Thumbnail key={i} pdfDoc={pdfDoc} pageNum={i + 1} cachedThumb={thumbnailCache[i + 1]} onThumbGenerated={(p, d) => setThumbnailCache(prev => ({...prev, [p]: d}))} onClick={() => goToPage(i + 1)} isActive={currentPage === i + 1}/>))}</div></aside>
            <main ref={viewerRef} className={mainContentClass} onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd} onMouseUp={handleMouseUp}>
                <div className="relative mx-auto" style={{ height: `${totalHeight}px` }}>{pagesToRender.map(({ pageNum, meta }) => (<div key={pageNum} ref={el => pageRefs.current[pageNum - 1] = el} data-page-number={pageNum} className="absolute left-1/2 -translate-x-1/2 bg-white dark:bg-slate-800 shadow-lg" style={{ top: `${meta.top}px`, width: `${meta.width}px`, height: `${meta.height}px` }}><div className="relative w-full h-full pdf-page-content"><div className="absolute inset-0 flex items-center justify-center page-loader"><div className="w-8 h-8 border-4 border-t-blue-500 border-slate-300 rounded-full animate-spin"></div></div></div>{pageAnnotations[pageNum]?.map(anno => anno.rects.map((rect, i) => <div key={`${anno.id}-${i}`} className="annotation-highlight" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} />))}<div className="absolute bottom-2 right-2 bg-black/50 text-white text-xs font-bold px-2 py-1 rounded">{pageNum} / {numPages}</div></div>))}</div>
                {selection && !aiAction && (
                    <div className="fixed z-20" style={{ left: selection.clientRect.left, top: selection.clientRect.top - 44 }}>
                        <div className="flex items-center gap-1 bg-slate-900 text-white p-1 rounded-lg shadow-lg animate-pop-in">
                           <button onClick={handleHighlight} className="p-2 rounded-md hover:bg-slate-700"><HighlighterIcon className="w-5 h-5" /></button>
                           <button onClick={() => handleAiAction('summary')} className="p-2 rounded-md hover:bg-slate-700"><DocumentTextIcon className="w-5 h-5" /></button>
                           <button onClick={() => handleAiAction('explanation')} className="p-2 rounded-md hover:bg-slate-700"><LightbulbIcon className="w-5 h-5" /></button>
                        </div>
                    </div>
                )}
                {aiAction && (
                     <div className="fixed z-20 p-4" style={{ left: selection?.clientRect.left, top: (selection?.clientRect.bottom || 0) + 8, maxWidth: '320px' }}>
                        <div className="bg-white dark:bg-slate-800 p-4 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 animate-pop-in">
                            <h4 className="font-bold text-md mb-2 text-slate-800 dark:text-slate-100">{aiAction.type === 'summary' ? 'Summary' : 'Explanation'}</h4>
                            <div className="text-sm text-slate-600 dark:text-slate-300 max-h-48 overflow-y-auto">{isAiActionLoading ? <Loader /> : aiAction.content}</div>
                            <button onClick={closeAiAction} className="mt-4 w-full text-sm font-semibold text-white bg-slate-700 hover:bg-slate-800 py-1.5 rounded-md">Close</button>
                        </div>
                    </div>
                )}
            </main>
            <aside className={`fixed top-0 bottom-0 right-0 z-20 w-full max-w-md lg:max-w-none lg:w-[28rem] bg-white dark:bg-slate-800 border-l border-slate-200 dark:border-slate-700 flex-col transform transition-transform duration-300 ease-in-out ${activePanel !== 'none' ? 'translate-x-0' : 'translate-x-full'}`}>
                 {activePanel === 'chat' && <PageChat documentId={doc.id} numPages={numPages} currentPage={currentPage} isOpen={true} onClose={() => setActivePanel('none')} />}
                 {activePanel === 'review' && <VoiceReviewer documentId={doc.id} numPages={numPages} currentPage={currentPage} onClose={() => setActivePanel('none')} />}
                 {activePanel === 'study' && <StudyPanel documentId={doc.id} numPages={numPages} currentPage={currentPage} onClose={() => setActivePanel('none')} />}
            </aside>
            {activePanel !== 'none' && <div onClick={() => setActivePanel('none')} className="fixed inset-0 z-10 bg-black/20 lg:hidden animate-fade-in"></div>}
        </div>
        <SummaryModal isOpen={isSummaryOpen} onClose={() => setIsSummaryOpen(false)} documentId={doc.id} startPage={currentPage} endPage={currentPage} />
        <div className={`lg:hidden fixed inset-0 z-30 transition-opacity duration-300 ${activePanel === 'thumbnails' ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`} role="dialog" aria-modal="true">
            <div className="absolute inset-0 bg-black/50" onClick={() => togglePanel('thumbnails')}></div>
            <aside className={`absolute top-0 left-0 bottom-0 w-48 bg-slate-100 dark:bg-slate-900 p-2 overflow-y-auto transition-transform duration-300 ease-in-out ${activePanel === 'thumbnails' ? 'translate-x-0' : '-translate-x-full'}`}>
                <div className="space-y-2">{Array.from({ length: numPages }).map((_, i) => (<Thumbnail key={i} pdfDoc={pdfDoc} pageNum={i + 1} cachedThumb={thumbnailCache[i + 1]} onThumbGenerated={(p, d) => setThumbnailCache(prev => ({...prev, [p]: d}))} onClick={() => { goToPage(i + 1); togglePanel('thumbnails'); }} isActive={currentPage === i + 1}/>))}</div>
            </aside>
        </div>
    </div>
  );
});