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
import type { ReviewResult } from '../types';
import { Thumbnail } from './Thumbnail';

const PDF_WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";
if (pdfjsLib.GlobalWorkerOptions.workerSrc !== PDF_WORKER_URL) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
}

interface PdfViewerProps {
  file: File;
  highlightText: string | null;
  targetPage: number | null;
  onPageNavigated: () => void;
  initialReviewResult: ReviewResult | null;
  onReviewComplete: (result: ReviewResult) => void;
  setHighlightAndNavigate: (text: string | null, page: number | null) => void;
  onReset: () => void;
  onLoadError: (message: string) => void;
}

export function PdfViewer({ 
    file, highlightText, targetPage, onPageNavigated, initialReviewResult,
    onReviewComplete, setHighlightAndNavigate, onReset, onLoadError 
}: PdfViewerProps) {
  const [pdfDoc, setPdfDoc] = useState<any | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [isLoading, setIsLoading] = useState(true);
  const [pageViewports, setPageViewports] = useState<any[]>([]);

  const viewerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const renderTaskRefs = useRef<Record<number, any>>({});
  const renderedPages = useRef<Map<number, number>>(new Map()); // pageNum -> scale
  
  // Pinned panel state for desktop
  const [isReviewPanelOpen, setIsReviewPanelOpen] = useState(false);
  const [isThumbnailsPanelOpen, setIsThumbnailsPanelOpen] = useState(false);

  // Drawer state for mobile
  const [isMobileThumbnailsOpen, setIsMobileThumbnailsOpen] = useState(false);
  const [isMobileReviewOpen, setIsMobileReviewOpen] = useState(false);

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [thumbnailCache, setThumbnailCache] = useState<Record<number, string>>({});

  const renderPage = useCallback(async (pageNum: number) => {
    if (!pdfDoc || !pageRefs.current[pageNum - 1]) return;

    if (renderedPages.current.get(pageNum) === scale) {
      return; // Already rendered at the correct scale
    }

    if (renderTaskRefs.current[pageNum]) {
        renderTaskRefs.current[pageNum].cancel();
    }
    
    const pageContainer = pageRefs.current[pageNum - 1];
    if (!pageContainer) return;
    
    const canvas = pageContainer.querySelector('canvas');
    const textLayer = pageContainer.querySelector('.textLayer') as HTMLDivElement;

    if (!canvas || !textLayer) return;

    try {
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale });
        const context = canvas.getContext('2d');

        canvas.height = viewport.height;
        canvas.width = viewport.width;
        
        textLayer.style.width = `${viewport.width}px`;
        textLayer.style.height = `${viewport.height}px`;

        const renderTask = page.render({ canvasContext: context!, viewport });
        renderTaskRefs.current[pageNum] = renderTask;
        
        await renderTask.promise;
        
        renderedPages.current.set(pageNum, scale);
        delete renderTaskRefs.current[pageNum];

        const textContent = await page.getTextContent();
        await pdfjsLib.renderTextLayer({ textContentSource: textContent, container: textLayer, viewport }).promise;
    } catch (error: any) {
        if (error.name !== 'RenderingCancelledException') {
            console.error(`Error rendering page ${pageNum}:`, error);
        }
    }
  }, [pdfDoc, scale]);

  const fitToWidth = useCallback(async (isInitial = false) => {
      if (!pdfDoc || !viewerRef.current) return;
      
      const page = await pdfDoc.getPage(1); // Use page 1 for reference
      const unscaledViewport = page.getViewport({ scale: 1 });
      
      const styles = window.getComputedStyle(viewerRef.current);
      const paddingX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
      
      const availableWidth = viewerRef.current.clientWidth - paddingX;
      
      const newScale = availableWidth / unscaledViewport.width;
      
      // On initial load, set scale directly. Otherwise, let the scale effect handle it.
      if(isInitial) {
          setScale(newScale);
      } else {
           // Prevent re-render loop if scale is already correct
          if (Math.abs(scale - newScale) > 0.01) {
              setScale(newScale);
          }
      }
  }, [pdfDoc, scale]);

  useEffect(() => {
    const loadPdf = async () => {
      setIsLoading(true);
      setPdfDoc(null);
      setNumPages(0);
      setPageViewports([]);
      pageRefs.current = [];
      renderedPages.current.clear();
      setThumbnailCache({});
      try {
        const fileUrl = URL.createObjectURL(file);
        const loadingTask = pdfjsLib.getDocument(fileUrl);
        const doc = await loadingTask.promise;
        setPdfDoc(doc);
        setNumPages(doc.numPages);

        const viewports = [];
        for (let i = 1; i <= doc.numPages; i++) {
            const page = await doc.getPage(i);
            viewports.push(page.getViewport({ scale: 1 }));
        }
        setPageViewports(viewports);
        URL.revokeObjectURL(fileUrl);
        setIsLoading(false);
      } catch (error) {
        console.error("Error loading PDF:", error);
        onLoadError("Failed to load PDF. The file might be corrupted or unsupported.");
      }
    };
    if (file) loadPdf();
  }, [file, onLoadError]);
  
  useEffect(() => {
    if (pageViewports.length > 0) {
      fitToWidth(true);
    }
  }, [pageViewports, fitToWidth]);

  useEffect(() => {
    const container = viewerRef.current;
    if (!container || !pdfDoc) return;
    const resizeObserver = new ResizeObserver(() => {
        fitToWidth(false);
    });
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [pdfDoc, fitToWidth]);
  
  // Effect for IntersectionObserver to render pages and update current page
  useEffect(() => {
      const viewer = viewerRef.current;
      if (!viewer || numPages === 0) return;

      const observer = new IntersectionObserver(
          (entries) => {
              let mostVisiblePage = null;
              let maxVisibility = -1;

              entries.forEach(entry => {
                  const pageNum = parseInt((entry.target as HTMLElement).dataset.pageNumber!, 10);
                  if (entry.isIntersecting) {
                      renderPage(pageNum);
                  }
                  
                  // Update current page based on which page is most visible
                  if (entry.intersectionRatio > maxVisibility) {
                      maxVisibility = entry.intersectionRatio;
                      mostVisiblePage = pageNum;
                  }
              });

              if (mostVisiblePage) {
                  setCurrentPage(mostVisiblePage);
              }
          },
          { root: viewer, threshold: [0, 0.25, 0.5, 0.75, 1] }
      );

      pageRefs.current.forEach(ref => {
          if (ref) observer.observe(ref);
      });

      return () => observer.disconnect();
  }, [numPages, renderPage]);

  // Effect to handle scale changes - clear existing renders
  useEffect(() => {
    if (!pdfDoc) return;
    renderedPages.current.clear();
    // Re-render currently visible pages
    pageRefs.current.forEach((ref, index) => {
      const pageNum = index + 1;
      // A simple check if the ref is in the viewport (might not be perfect)
      if (ref && ref.getBoundingClientRect().top < window.innerHeight && ref.getBoundingClientRect().bottom > 0) {
        renderPage(pageNum);
      }
    });
  }, [scale, pdfDoc, renderPage]);

  const scrollToPage = (num: number) => {
    const pageNum = Math.min(Math.max(1, num), numPages);
    pageRefs.current[pageNum - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  
  useEffect(() => {
    if (targetPage) {
      scrollToPage(targetPage);
      onPageNavigated();
    }
  }, [targetPage, onPageNavigated]); // Removed currentPage dependency

  useEffect(() => {
    // Clear all old highlights first
    pageRefs.current.forEach(pageRef => {
        pageRef?.querySelectorAll('.temporary-highlight').forEach(el => {
            // A bit of a hack to unwrap the span without losing the text node
            const parent = el.parentNode;
            while (el.firstChild) {
                parent?.insertBefore(el.firstChild, el);
            }
            parent?.removeChild(el);
        });
    });

    if (!highlightText) return;
    
    const pageContainer = pageRefs.current[currentPage - 1];
    const textLayer = pageContainer?.querySelector('.textLayer');

    if (!textLayer) return;

    const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT, null);
    const ranges = [];
    let node;
    while (node = walker.nextNode()) {
        const text = node.nodeValue || '';
        let index = text.indexOf(highlightText);
        while (index !== -1) {
            const range = document.createRange();
            range.setStart(node, index);
            range.setEnd(node, index + highlightText.length);
            ranges.push(range);
            index = text.indexOf(highlightText, index + 1);
        }
    }
    ranges.forEach(range => {
        const highlightSpan = document.createElement('span');
        highlightSpan.className = 'temporary-highlight';
        try { range.surroundContents(highlightSpan); } 
        catch(e) { console.warn("Could not highlight text across multiple elements:", highlightText); }
    });
  }, [highlightText, currentPage]);

  const handleThumbGenerated = useCallback((pageNum: number, dataUrl: string) => {
    setThumbnailCache(prev => ({ ...prev, [pageNum]: dataUrl }));
  }, []);
  
  const ThumbnailsList = (
    <div className="grid grid-cols-1 gap-3">
        {Array.from({ length: numPages }, (_, i) => i + 1).map(pageNum => (
            <Thumbnail
                key={pageNum}
                pdfDoc={pdfDoc}
                pageNum={pageNum}
                cachedThumb={thumbnailCache[pageNum] || null}
                onThumbGenerated={handleThumbGenerated}
                onClick={() => {
                  scrollToPage(pageNum);
                  setIsMobileThumbnailsOpen(false);
                }}
                isActive={currentPage === pageNum}
            />
        ))}
    </div>
  );

  if (isLoading || pageViewports.length === 0) {
      return (
        <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center">
            <Loader />
            <p className="mt-4 text-slate-600 font-semibold">Preparing Document...</p>
        </div>
      );
  }

  return (
    <div className="h-screen w-screen bg-slate-200 flex flex-col overflow-hidden">
      <header className="bg-slate-800 text-white p-2 flex items-center justify-between z-20 shadow-md flex-shrink-0 sticky top-0">
          {/* Mobile Header */}
          <div className="flex lg:hidden items-center justify-between w-full">
              <button onClick={() => setIsMobileThumbnailsOpen(true)} className="p-2 rounded-md hover:bg-slate-700" aria-label="Open thumbnails panel">
                  <MenuIcon className="w-6 h-6" />
              </button>
              <div className="text-sm font-semibold">
                  Page {currentPage} of {numPages}
              </div>
              <button onClick={() => setIsMobileReviewOpen(true)} className="p-2 rounded-md hover:bg-slate-700" aria-label="Open review panel">
                  <BookOpenIcon className="w-6 h-6" />
              </button>
          </div>

          {/* Desktop Header */}
          <div className="hidden lg:flex items-center justify-between w-full">
              <div className="flex items-center gap-4">
                  <button onClick={onReset} className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-slate-700 transition-colors">
                      <ArrowLeftIcon className="w-5 h-5" />
                      <span className="font-semibold text-sm">New File</span>
                  </button>
                  <div className="w-px h-6 bg-slate-600"></div>
                  <button onClick={() => setIsThumbnailsPanelOpen(p => !p)} className={`px-3 py-1.5 rounded-md transition-colors ${isThumbnailsPanelOpen ? 'bg-blue-600' : 'hover:bg-slate-700'}`} aria-label="Toggle thumbnails panel">
                      <DocumentDuplicateIcon className="w-5 h-5" />
                  </button>
              </div>
              
              <div className="flex items-center gap-2">
                  <button onClick={() => scrollToPage(1)} disabled={currentPage === 1} className="p-1.5 rounded-md disabled:opacity-50 hover:bg-slate-700"><ChevronDoubleLeftIcon className="w-5 h-5" /></button>
                  <button onClick={() => scrollToPage(currentPage - 1)} disabled={currentPage === 1} className="p-1.5 rounded-md disabled:opacity-50 hover:bg-slate-700"><ChevronLeftIcon className="w-5 h-5" /></button>
                  <div className="text-sm">
                      <span>Page </span>
                      <input type="number" value={currentPage} onChange={e => setCurrentPage(parseInt(e.target.value,10) || 1)} onBlur={(e) => scrollToPage(parseInt(e.target.value, 10))} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} className="w-12 text-center bg-slate-900 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <span> of {numPages}</span>
                  </div>
                  <button onClick={() => scrollToPage(currentPage + 1)} disabled={currentPage === numPages} className="p-1.5 rounded-md disabled:opacity-50 hover:bg-slate-700"><ChevronRightIcon className="w-5 h-5" /></button>
                  <button onClick={() => scrollToPage(numPages)} disabled={currentPage === numPages} className="p-1.5 rounded-md disabled:opacity-50 hover:bg-slate-700"><ChevronDoubleRightIcon className="w-5 h-5" /></button>
              </div>

              <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1">
                    <button onClick={() => setScale(s => Math.max(0.25, s - 0.25))} className="p-1.5 rounded-md hover:bg-slate-700" aria-label="Zoom out"><ZoomOutIcon className="w-5 h-5" /></button>
                    <button onClick={() => fitToWidth(false)} className="p-1.5 rounded-md hover:bg-slate-700" title="Fit to Width" aria-label="Fit to width"><FitToWidthIcon className="w-5 h-5" /></button>
                    <button onClick={() => setScale(s => Math.min(3, s + 0.25))} className="p-1.5 rounded-md hover:bg-slate-700" aria-label="Zoom in"><ZoomInIcon className="w-5 h-5" /></button>
                    <span className="text-sm font-semibold w-12 text-center">{(scale * 100).toFixed(0)}%</span>
                  </div>
                  <div className="w-px h-6 bg-slate-600"></div>
                  <button onClick={() => setIsChatOpen(true)} className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-slate-700 transition-colors">
                      <ChatBubbleIcon className="w-5 h-5" />
                      <span className="font-semibold text-sm">Chat</span>
                  </button>
                  <button onClick={() => setIsReviewPanelOpen(p => !p)} className={`px-3 py-1.5 rounded-md transition-colors ${isReviewPanelOpen ? 'bg-blue-600' : 'hover:bg-slate-700'}`} aria-label="Toggle review panel">
                      <BookOpenIcon className="w-5 h-5" />
                  </button>
              </div>
          </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* DESKTOP THUMBNAILS - pinned */}
        <aside className={`hidden lg:block flex-shrink-0 bg-slate-300 shadow-lg overflow-y-auto transition-all duration-300 ${isThumbnailsPanelOpen ? 'w-48 p-2' : 'w-0 p-0'}`}>
          {isThumbnailsPanelOpen && ThumbnailsList}
        </aside>

        {/* MOBILE THUMBNAILS - drawer */}
        {isMobileThumbnailsOpen && (
          <>
            <div onClick={() => setIsMobileThumbnailsOpen(false)} className="fixed inset-0 bg-black/60 z-30 lg:hidden animate-fade-in" aria-hidden="true"/>
            <aside className="fixed top-0 left-0 bottom-0 w-64 bg-slate-300 z-40 lg:hidden p-2 overflow-y-auto shadow-lg animate-slide-in-left">
              <div className="flex justify-between items-center mb-2 p-1">
                <h3 className="font-bold text-slate-800 text-lg">Pages</h3>
                <button onClick={() => setIsMobileThumbnailsOpen(false)} className="p-1 rounded-full hover:bg-slate-400" aria-label="Close thumbnails panel"><XIcon className="w-6 h-6 text-slate-700"/></button>
              </div>
              {ThumbnailsList}
            </aside>
          </>
        )}

        <main className="flex-1 overflow-auto bg-slate-200 p-4 md:p-8" ref={viewerRef}>
          <div className="flex flex-col items-center gap-4 md:gap-8">
            {Array.from({ length: numPages }, (_, i) => i + 1).map(pageNum => {
                const viewport = pageViewports[pageNum - 1];
                const placeholderStyle = viewport ? {
                    width: viewport.width * scale,
                    height: viewport.height * scale,
                } : { height: '1000px' }; // Fallback height

                return (
                    <div
                        key={pageNum}
                        ref={el => pageRefs.current[pageNum-1] = el}
                        data-page-number={pageNum}
                        className="relative mx-auto shadow-xl bg-white"
                        style={placeholderStyle}
                    >
                        <canvas className="block" />
                        <div className="textLayer" />
                    </div>
                )
            })}
          </div>
        </main>
        
        {/* DESKTOP REVIEW - pinned */}
        <aside className={`hidden lg:flex flex-col flex-shrink-0 bg-white border-l border-slate-300 transition-all duration-300 overflow-hidden ${isReviewPanelOpen ? 'w-full max-w-md' : 'w-0'}`}>
          {isReviewPanelOpen && pdfDoc && (
            <VoiceReviewer pdfDoc={pdfDoc} numPages={numPages} currentPage={currentPage} setHighlightAndNavigate={setHighlightAndNavigate} onReviewComplete={onReviewComplete} initialReviewResult={initialReviewResult} onClose={() => setIsReviewPanelOpen(false)} />
          )}
        </aside>
        
        {/* MOBILE REVIEW - drawer */}
        {isMobileReviewOpen && (
          <>
            <div onClick={() => setIsMobileReviewOpen(false)} className="fixed inset-0 bg-black/60 z-30 lg:hidden animate-fade-in" aria-hidden="true"/>
            <aside className="fixed top-0 right-0 bottom-0 w-full max-w-md bg-white z-40 lg:hidden shadow-lg animate-slide-in-right">
              <VoiceReviewer pdfDoc={pdfDoc} numPages={numPages} currentPage={currentPage} setHighlightAndNavigate={setHighlightAndNavigate} onReviewComplete={onReviewComplete} initialReviewResult={initialReviewResult} onClose={() => setIsMobileReviewOpen(false)} />
            </aside>
          </>
        )}

        <PageChat pdfDoc={pdfDoc} numPages={numPages} currentPage={currentPage} isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} />
      </div>

       {/* Mobile Controls Footer */}
       <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-slate-800/90 backdrop-blur-sm text-white p-2 shadow-t-lg z-20 flex justify-around items-center gap-4">
          <div className="flex items-center gap-1">
            <button onClick={() => scrollToPage(currentPage - 1)} disabled={currentPage <= 1} className="p-2 rounded-md disabled:opacity-50 hover:bg-slate-700"><ChevronLeftIcon className="w-6 h-6" /></button>
            <div className="text-sm font-medium">
                <input 
                  type="number" 
                  value={currentPage} 
                  onChange={e => setCurrentPage(parseInt(e.target.value,10) || 1)} 
                  onBlur={(e) => scrollToPage(parseInt(e.target.value, 10))}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  className="w-12 text-center bg-slate-900 rounded-md py-1"
                  aria-label="Current page"
                />
                <span className="px-1">/</span>
                <span>{numPages}</span>
            </div>
            <button onClick={() => scrollToPage(currentPage + 1)} disabled={currentPage >= numPages} className="p-2 rounded-md disabled:opacity-50 hover:bg-slate-700"><ChevronRightIcon className="w-6 h-6" /></button>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setScale(s => Math.max(0.25, s - 0.25))} className="p-2 rounded-md hover:bg-slate-700" aria-label="Zoom out"><ZoomOutIcon className="w-6 h-6" /></button>
            <button onClick={() => fitToWidth(false)} className="p-2 rounded-md hover:bg-slate-700" aria-label="Fit to width"><FitToWidthIcon className="w-6 h-6" /></button>
            <button onClick={() => setScale(s => Math.min(3, s + 0.25))} className="p-2 rounded-md hover:bg-slate-700" aria-label="Zoom in"><ZoomInIcon className="w-6 h-6" /></button>
          </div>
       </div>
    </div>
  );
}