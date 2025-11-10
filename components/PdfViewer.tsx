import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";
import { 
    ChevronLeftIcon, ChevronRightIcon, ZoomInIcon, ZoomOutIcon, XCircleIcon, 
    ArrowLeftIcon, BookOpenIcon, DocumentDuplicateIcon, XIcon,
    ChevronDoubleLeftIcon, ChevronDoubleRightIcon, ChatBubbleIcon,
    MenuIcon, FitToWidthIcon
} from './Icons';
import { Loader } from './Loader';
import { PageChat } from './PageChat';
import { VoiceReviewer } from './VoiceReviewer';
import { Thumbnail } from './Thumbnail';

const PDF_WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";
if (pdfjsLib.GlobalWorkerOptions.workerSrc !== PDF_WORKER_URL) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
}

function debounce(func: (...args: any[]) => void, delay: number) {
    let timeoutId: number;
    return function(this: any, ...args: any[]) {
        clearTimeout(timeoutId);
        timeoutId = window.setTimeout(() => func.apply(this, args), delay);
    };
}

interface PdfViewerProps {
  file: File;
  highlightText: string | null;
  targetPage: number | null;
  onPageNavigated: () => void;
  setHighlightAndNavigate: (text: string | null, page: number | null) => void;
  onReset: () => void;
  onLoadError: (message: string) => void;
}

export function PdfViewer({ 
    file, highlightText, targetPage, onPageNavigated,
    setHighlightAndNavigate, onReset, onLoadError 
}: PdfViewerProps) {
  const [pdfDoc, setPdfDoc] = useState<any | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [scale, setScale] = useState(1.0);
  const [isLoading, setIsLoading] = useState(true);
  const [pageViewports, setPageViewports] = useState<any[]>([]);

  const viewerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const renderTaskRefs = useRef<Record<number, any>>({});
  const renderedPages = useRef<Map<number, number>>(new Map()); // pageNum -> scale
  const observerRef = useRef<IntersectionObserver | null>(null);
  const isProgrammaticScroll = useRef(false);
  
  // Pinned panel state for desktop
  const [isReviewPanelOpen, setIsReviewPanelOpen] = useState(false);
  const [isThumbnailsPanelOpen, setIsThumbnailsPanelOpen] = useState(false);

  // Drawer state for mobile
  const [isMobileThumbnailsOpen, setIsMobileThumbnailsOpen] = useState(false);
  const [isMobileReviewOpen, setIsMobileReviewOpen] = useState(false);

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [thumbnailCache, setThumbnailCache] = useState<Record<number, string>>({});

  const goToPage = useCallback((num: number) => {
    const pageNum = Math.min(Math.max(1, num), numPages);
    isProgrammaticScroll.current = true;
    pageRefs.current[pageNum - 1]?.scrollIntoView({ behavior: 'auto', block: 'start' });
    setCurrentPage(pageNum); 

    setTimeout(() => {
        isProgrammaticScroll.current = false;
    }, 500); // Allow time for scroll to complete
  }, [numPages]);

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);
  
  const handlePageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPageInput(e.target.value);
  };

  const navigateToInputPage = () => {
      const pageNum = parseInt(pageInput, 10);
      if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= numPages) {
          goToPage(pageNum);
      } else {
          setPageInput(String(currentPage));
      }
  };

  const handlePageInputBlur = () => {
      navigateToInputPage();
  };

  const handlePageInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
          navigateToInputPage();
          (e.target as HTMLInputElement).blur();
      }
  };

  const renderPage = useCallback(async (pageNum: number) => {
    if (!pdfDoc) return;

    if (renderedPages.current.get(pageNum) === scale) {
      return;
    }

    const pageContainer = pageRefs.current[pageNum - 1];
    if (!pageContainer) return;

    const contentContainer = pageContainer.querySelector('.relative');
    if (!contentContainer) return;

    if (renderTaskRefs.current[pageNum]) {
        renderTaskRefs.current[pageNum].cancel();
    }
    
    try {
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale });
        
        // Clear previous content
        while (contentContainer.firstChild) {
            contentContainer.removeChild(contentContainer.firstChild);
        }

        const canvas = document.createElement('canvas');
        canvas.className = "w-full h-auto";
        const canvasContext = canvas.getContext('2d', { willReadFrequently: true });
        if (!canvasContext) return;
        
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        contentContainer.appendChild(canvas);
        
        const renderContext = {
            canvasContext,
            viewport,
        };
        const renderTask = page.render(renderContext);
        renderTaskRefs.current[pageNum] = renderTask;
        
        await renderTask.promise;

        // Render text layer
        const textContent = await page.getTextContent();
        const textLayer = document.createElement('div');
        textLayer.className = 'textLayer';
        contentContainer.appendChild(textLayer);
        pdfjsLib.renderTextLayer({
            textContentSource: textContent,
            container: textLayer,
            viewport: viewport,
            textDivs: []
        });

        renderedPages.current.set(pageNum, scale);
        delete renderTaskRefs.current[pageNum];
    } catch (error: any) {
        if (error.name !== 'RenderingCancelledException') {
            console.error(`Failed to render page ${pageNum}:`, error);
        }
    }
  }, [pdfDoc, scale]);

  const updateVisiblePages = useCallback(() => {
    if (!pdfDoc || !viewerRef.current) return;
    const viewerRect = viewerRef.current.getBoundingClientRect();

    for (let i = 0; i < numPages; i++) {
        const pageEl = pageRefs.current[i];
        if (pageEl) {
            const pageRect = pageEl.getBoundingClientRect();
            // Check if page is within the viewport
            if (pageRect.top < viewerRect.bottom && pageRect.bottom > viewerRect.top) {
                renderPage(i + 1);
            }
        }
    }
  }, [pdfDoc, numPages, renderPage]);

  // Main effect to load the PDF document
  useEffect(() => {
    if (!file) return;
    setIsLoading(true);

    const loadPdf = async () => {
      try {
        const fileReader = new FileReader();
        fileReader.onload = async (e) => {
          if (!e.target?.result) {
            onLoadError("Failed to read the file.");
            return;
          }
          const typedarray = new Uint8Array(e.target.result as ArrayBuffer);
          const doc = await pdfjsLib.getDocument({ data: typedarray }).promise;
          
          const viewports = [];
          for (let i = 1; i <= doc.numPages; i++) {
              const page = await doc.getPage(i);
              viewports.push(page.getViewport({ scale: 1.0 }));
          }
          setPageViewports(viewports);

          setPdfDoc(doc);
          setNumPages(doc.numPages);
          pageRefs.current = Array(doc.numPages).fill(null);
          setIsLoading(false);
        };
        fileReader.onerror = () => {
          onLoadError("Error reading the file.");
        };
        fileReader.readAsArrayBuffer(file);
      } catch (err: any) {
        onLoadError(err.message || "Failed to load PDF.");
      }
    };

    loadPdf();
  }, [file, onLoadError]);
  
  // Effect for IntersectionObserver to sync current page on scroll
  useEffect(() => {
    if (!pdfDoc || !viewerRef.current) return;

    if (observerRef.current) observerRef.current.disconnect();

    const options = {
        root: viewerRef.current,
        rootMargin: "-40% 0px -40% 0px", // Page is "current" when it's in the middle 20% of the screen
        threshold: 0,
    };
    
    const handleIntersect = (entries: IntersectionObserverEntry[]) => {
        if (isProgrammaticScroll.current) return;

        const intersectingPages = entries.filter(e => e.isIntersecting);
        if (intersectingPages.length > 0) {
            // Find the one with the largest intersection ratio
            const bestPage = intersectingPages.reduce((prev, current) => 
                (prev.intersectionRatio > current.intersectionRatio) ? prev : current
            );
            const pageNum = parseInt(bestPage.target.getAttribute('data-page-number') || '0', 10);
            if (pageNum) {
                setCurrentPage(pageNum);
            }
        }
    };
    
    observerRef.current = new IntersectionObserver(handleIntersect, options);
    const observer = observerRef.current;
    pageRefs.current.forEach(pageEl => {
        if (pageEl) observer.observe(pageEl);
    });

    return () => observer.disconnect();
  }, [pdfDoc]);

  // Effect to handle lazy rendering on scroll
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const debouncedUpdate = debounce(updateVisiblePages, 150);
    
    updateVisiblePages(); // Initial render
    viewer.addEventListener('scroll', debouncedUpdate);
    window.addEventListener('resize', debouncedUpdate);

    return () => {
        viewer.removeEventListener('scroll', debouncedUpdate);
        window.removeEventListener('resize', debouncedUpdate);
    }
  }, [updateVisiblePages]);
  
  // Effect to handle targeted page navigation
  useEffect(() => {
    if (targetPage && pdfDoc) {
      goToPage(targetPage);
      onPageNavigated();
    }
  }, [targetPage, pdfDoc, goToPage, onPageNavigated]);
  
  useEffect(() => {
    // Re-render pages on scale change
    renderedPages.current.clear();
    updateVisiblePages();
  }, [scale, updateVisiblePages]);

  // Temporary highlighting logic
  useEffect(() => {
    if (!highlightText) return;

    document.querySelectorAll('.temporary-highlight').forEach(el => el.classList.remove('temporary-highlight'));
    
    const pageContainer = pageRefs.current[currentPage - 1];
    if (!pageContainer) return;
    
    const textLayer = pageContainer.querySelector('.textLayer');
    if (!textLayer) return;

    // FIX: Specify HTMLSpanElement as the generic type to querySelectorAll to ensure
    // that the elements are correctly typed. This resolves errors where properties
    // like `textContent` and `getBoundingClientRect` could not be accessed on
    // what TypeScript was inferring as an `unknown` type.
    const textSpans = Array.from(textLayer.querySelectorAll<HTMLSpanElement>('span'));
    const textContent = textSpans.map(span => span.textContent || '').join('');
    
    const startIndex = textContent.indexOf(highlightText);
    if (startIndex === -1) return;
    
    let charCount = 0;
    let startSpanIndex = -1, endSpanIndex = -1;
    let startOffset = 0, endOffset = 0;

    for (let i = 0; i < textSpans.length; i++) {
        const spanText = textSpans[i].textContent || '';
        const spanLength = spanText.length;
        if (startSpanIndex === -1 && charCount + spanLength >= startIndex) {
            startSpanIndex = i;
            startOffset = startIndex - charCount;
        }
        if (endSpanIndex === -1 && charCount + spanLength >= startIndex + highlightText.length) {
            endSpanIndex = i;
            endOffset = (startIndex + highlightText.length) - charCount;
            break;
        }
        charCount += spanLength;
    }
    
    if (startSpanIndex !== -1 && endSpanIndex !== -1) {
        for (let i = startSpanIndex; i <= endSpanIndex; i++) {
            const span = textSpans[i];
            const originalSpanRect = span.getBoundingClientRect();
            const textLayerRect = textLayer.getBoundingClientRect();

            const highlightDiv = document.createElement('div');
            highlightDiv.className = 'absolute temporary-highlight';
            highlightDiv.style.left = `${originalSpanRect.left - textLayerRect.left}px`;
            highlightDiv.style.top = `${originalSpanRect.top - textLayerRect.top}px`;
            highlightDiv.style.width = `${originalSpanRect.width}px`;
            highlightDiv.style.height = `${originalSpanRect.height}px`;

            textLayer.appendChild(highlightDiv);
        }
    }
  }, [highlightText, currentPage]);


  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-100">
        <Loader />
        <p className="mt-4 font-semibold text-slate-700">Loading Document...</p>
      </div>
    );
  }
  
  const mainContent = (
    <main 
        ref={viewerRef}
        className="flex-1 bg-slate-200 overflow-y-auto scroll-smooth"
    >
        <div className="mx-auto my-4">
            {Array.from({ length: numPages }, (_, i) => (
                <div
                    key={i}
                    ref={el => pageRefs.current[i] = el}
                    data-page-number={i + 1}
                    className="relative mx-auto my-4 bg-white shadow-lg"
                    style={{ width: `${(pageViewports[i]?.width || 800) * scale}px` }}
                >
                    <div className="relative">
                        {/* Canvas and text layer will be inserted here by renderPage */}
                    </div>
                    <div className="absolute bottom-2 right-2 bg-black/50 text-white text-xs font-bold px-2 py-1 rounded">
                        {i + 1} / {numPages}
                    </div>
                </div>
            ))}
        </div>
    </main>
  );

  const header = (
    <header className="bg-slate-800 text-white shadow-md p-2 flex items-center justify-between z-20 flex-shrink-0">
        <div className="flex items-center gap-2">
            <button onClick={onReset} className="p-2 rounded-md hover:bg-slate-700 transition-colors" aria-label="Go back">
                <ArrowLeftIcon className="w-6 h-6" />
            </button>
            <button onClick={() => setIsMobileThumbnailsOpen(true)} className="p-2 rounded-md hover:bg-slate-700 transition-colors lg:hidden" aria-label="Toggle thumbnails">
                <BookOpenIcon className="w-6 h-6" />
            </button>
            <h2 className="font-semibold text-lg truncate max-w-xs sm:max-w-md hidden sm:block">{file.name}</h2>
        </div>
        <div className="flex items-center gap-2 justify-center">
            <button onClick={() => goToPage(1)} className="p-2 rounded-md hover:bg-slate-700 transition-colors" aria-label="First page">
                <ChevronDoubleLeftIcon className="w-5 h-5" />
            </button>
            <button onClick={() => goToPage(currentPage - 1)} className="p-2 rounded-md hover:bg-slate-700 transition-colors" aria-label="Previous page">
                <ChevronLeftIcon className="w-5 h-5" />
            </button>
            <div className="flex items-center text-sm">
                <input 
                    type="text"
                    value={pageInput}
                    onChange={handlePageInputChange}
                    onKeyDown={handlePageInputKeyDown}
                    onBlur={handlePageInputBlur}
                    className="w-12 bg-slate-700 text-center rounded-md border-slate-600 focus:ring-blue-500 focus:border-blue-500"
                />
                <span className="px-2">/ {numPages}</span>
            </div>
            <button onClick={() => goToPage(currentPage + 1)} className="p-2 rounded-md hover:bg-slate-700 transition-colors" aria-label="Next page">
                <ChevronRightIcon className="w-5 h-5" />
            </button>
            <button onClick={() => goToPage(numPages)} className="p-2 rounded-md hover:bg-slate-700 transition-colors" aria-label="Last page">
                <ChevronDoubleRightIcon className="w-5 h-5" />
            </button>
        </div>
        <div className="flex items-center gap-2">
            <button onClick={() => setScale(s => s + 0.1)} className="p-2 rounded-md hover:bg-slate-700 transition-colors" aria-label="Zoom in">
                <ZoomInIcon className="w-6 h-6" />
            </button>
            <button onClick={() => setScale(s => s - 0.1)} className="p-2 rounded-md hover:bg-slate-700 transition-colors" aria-label="Zoom out">
                <ZoomOutIcon className="w-6 h-6" />
            </button>
            <button onClick={() => setIsChatOpen(true)} className="p-2 rounded-md hover:bg-slate-700 transition-colors" aria-label="Chat about page">
                <ChatBubbleIcon className="w-6 h-6" />
            </button>
            <button onClick={() => isReviewPanelOpen ? setIsReviewPanelOpen(false) : setIsMobileReviewOpen(true)} className="p-2 rounded-md hover:bg-slate-700 transition-colors" aria-label="Start voice review">
                <DocumentDuplicateIcon className="w-6 h-6" />
            </button>
        </div>
    </header>
  );
  
  const thumbnailSidebar = (
    <aside className="w-48 bg-slate-100 border-r border-slate-300 p-2 overflow-y-auto hidden lg:block">
        <div className="space-y-2">
            {Array.from({ length: numPages }).map((_, i) => (
                <Thumbnail 
                    key={i}
                    pdfDoc={pdfDoc}
                    pageNum={i + 1}
                    cachedThumb={thumbnailCache[i + 1]}
                    onThumbGenerated={(pageNum, dataUrl) => setThumbnailCache(prev => ({...prev, [pageNum]: dataUrl}))}
                    onClick={() => goToPage(i + 1)}
                    isActive={currentPage === i + 1}
                />
            ))}
        </div>
    </aside>
  );

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-50 overflow-hidden">
        {header}
        <div className="flex flex-1 min-h-0">
            {thumbnailSidebar}
            {mainContent}
            {isReviewPanelOpen && (
                <aside className="w-96 bg-white border-l border-slate-300 hidden lg:flex flex-col">
                    <VoiceReviewer pdfDoc={pdfDoc} numPages={numPages} currentPage={currentPage} onClose={() => setIsReviewPanelOpen(false)} />
                </aside>
            )}
        </div>

        {isChatOpen && (
            <PageChat
                pdfDoc={pdfDoc}
                numPages={numPages}
                currentPage={currentPage}
                isOpen={isChatOpen}
                onClose={() => setIsChatOpen(false)}
            />
        )}
        
        {/* Mobile Drawers */}
        {isMobileThumbnailsOpen && (
            <div className="lg:hidden fixed inset-0 z-30">
                <div className="absolute inset-0 bg-black/50 animate-fade-in" onClick={() => setIsMobileThumbnailsOpen(false)}></div>
                <div className="absolute top-0 left-0 bottom-0 w-48 bg-slate-100 p-2 overflow-y-auto animate-slide-in-left">
                    <div className="space-y-2">
                        {Array.from({ length: numPages }).map((_, i) => (
                            <Thumbnail 
                                key={i}
                                pdfDoc={pdfDoc}
                                pageNum={i + 1}
                                cachedThumb={thumbnailCache[i + 1]}
                                onThumbGenerated={(pageNum, dataUrl) => setThumbnailCache(prev => ({...prev, [pageNum]: dataUrl}))}
                                onClick={() => { goToPage(i + 1); setIsMobileThumbnailsOpen(false); }}
                                isActive={currentPage === i + 1}
                            />
                        ))}
                    </div>
                </div>
            </div>
        )}

        {isMobileReviewOpen && (
            <div className="lg:hidden fixed inset-0 z-30">
                 <div className="absolute inset-0 bg-black/50 animate-fade-in" onClick={() => setIsMobileReviewOpen(false)}></div>
                <div className="absolute top-0 right-0 bottom-0 w-full max-w-md bg-white animate-slide-in-right flex flex-col">
                    <VoiceReviewer pdfDoc={pdfDoc} numPages={numPages} currentPage={currentPage} onClose={() => setIsMobileReviewOpen(false)} />
                </div>
            </div>
        )}
    </div>
  );
}