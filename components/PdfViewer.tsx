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
  const [pageInput, setPageInput] = useState('1');
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

  const goToPage = useCallback((num: number) => {
    const pageNum = Math.min(Math.max(1, num), numPages);
    if (pageNum !== currentPage) {
      setCurrentPage(pageNum);
      pageRefs.current[pageNum - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [numPages, currentPage]);

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

    // A page is considered rendered if the scale matches.
    if (renderedPages.current.get(pageNum) === scale) {
      return;
    }

    const pageContainer = pageRefs.current[pageNum - 1];
    if (!pageContainer) return;

    const contentContainer = pageContainer.querySelector('.relative');
    if (!contentContainer) return;

    // Cancel any previous render task for this page to avoid conflicts.
    if (renderTaskRefs.current[pageNum]) {
        renderTaskRefs.current[pageNum].cancel();
    }
    
    try {
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale });
        
        // Create fresh canvas and text layer elements for each render operation.
        // This is the core of the fix to prevent "Cannot use the same canvas" errors.
        const canvas = document.createElement('canvas');
        const textLayer = document.createElement('div');
        textLayer.className = 'textLayer';

        const context = canvas.getContext('2d');
        if (!context) {
            console.error("Could not get 2D context for canvas.");
            return;
        }

        canvas.height = viewport.height;
        canvas.width = viewport.width;
        
        textLayer.style.width = `${viewport.width}px`;
        textLayer.style.height = `${viewport.height}px`;

        // Clear any old content and append the new, clean elements.
        while (contentContainer.firstChild) {
            contentContainer.removeChild(contentContainer.firstChild);
        }
        contentContainer.appendChild(canvas);
        contentContainer.appendChild(textLayer);

        const renderTask = page.render({ canvasContext: context, viewport });
        renderTaskRefs.current[pageNum] = renderTask;
        
        await renderTask.promise;
        
        // On successful render, mark it as rendered at the current scale.
        renderedPages.current.set(pageNum, scale);

        const textContent = await page.getTextContent();
        // The text layer must be rendered after the canvas.
        await pdfjsLib.renderTextLayer({ textContentSource: textContent, container: textLayer, viewport }).promise;

    } catch (error: any) {
        // 'RenderingCancelledException' is expected when a new render call interrupts an old one.
        // We only log other, unexpected errors.
        if (error.name !== 'RenderingCancelledException') {
            console.error(`Error rendering page ${pageNum}:`, error);
        }
    } finally {
        // Ensure the task reference is cleaned up, regardless of success, failure, or cancellation.
        delete renderTaskRefs.current[pageNum];
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
      
      if(isInitial) {
          setScale(newScale);
      } else {
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

  useEffect(() => {
    if (!pdfDoc) return;
    renderedPages.current.clear();
    pageRefs.current.forEach((ref, index) => {
      const pageNum = index + 1;
      if (ref && ref.getBoundingClientRect().top < window.innerHeight && ref.getBoundingClientRect().bottom > 0) {
        renderPage(pageNum);
      }
    });
  }, [scale, pdfDoc, renderPage]);
  
  useEffect(() => {
    if (targetPage) {
      goToPage(targetPage);
      onPageNavigated();
    }
  }, [targetPage, onPageNavigated, goToPage]);

  useEffect(() => {
    pageRefs.current.forEach(pageRef => {
        pageRef?.querySelectorAll('.temporary-highlight').forEach(el => {
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
                  goToPage(pageNum);
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
      <header className="bg-slate-800 text-white p-2 flex items-center justify-between z-20 shadow-md">
        <div className="flex items-center gap-2">
            <button onClick={onReset} className="p-2 rounded-md hover:bg-slate-700 flex items-center gap-2 text-sm">
                <ArrowLeftIcon className="w-5 h-5" /> Back
            </button>
            <span className="w-px h-6 bg-slate-600"></span>
            <h2 className="text-lg font-semibold truncate max-w-xs sm:max-w-md" title={file.name}>{file.name}</h2>
        </div>
        
        <div className="flex items-center gap-1 sm:gap-2">
            <button onClick={() => setIsChatOpen(o => !o)} className={`p-2 rounded-md ${isChatOpen ? 'bg-blue-600' : 'hover:bg-slate-700'}`} aria-label="Chat with page content">
                <ChatBubbleIcon className="w-5 h-5"/>
            </button>
            <button onClick={() => setIsReviewPanelOpen(o => !o)} className={`hidden md:flex p-2 rounded-md ${isReviewPanelOpen ? 'bg-blue-600' : 'hover:bg-slate-700'}`} aria-label="Toggle review panel">
                <DocumentDuplicateIcon className="w-5 h-5" />
            </button>
            <button onClick={() => setIsThumbnailsPanelOpen(o => !o)} className={`hidden md:flex p-2 rounded-md ${isThumbnailsPanelOpen ? 'bg-blue-600' : 'hover:bg-slate-700'}`} aria-label="Toggle thumbnails panel">
                <BookOpenIcon className="w-5 h-5" />
            </button>
             <button onClick={() => setIsMobileReviewOpen(o => !o)} className="md:hidden p-2 rounded-md hover:bg-slate-700" aria-label="Open review panel">
                <DocumentDuplicateIcon className="w-5 h-5" />
            </button>
            <button onClick={() => setIsMobileThumbnailsOpen(o => !o)} className="md:hidden p-2 rounded-md hover:bg-slate-700" aria-label="Open thumbnails panel">
                <MenuIcon className="w-5 h-5" />
            </button>
        </div>
      </header>
      
      <div className="flex-1 flex min-h-0">
        {/* Thumbnails Panel (Desktop) */}
        <aside className={`flex-shrink-0 bg-slate-100 border-r border-slate-300 overflow-y-auto transition-all duration-300 ease-in-out ${isThumbnailsPanelOpen ? 'w-48 p-2' : 'w-0'}`}>
          {ThumbnailsList}
        </aside>
        
        <main className="flex-1 flex flex-col min-w-0">
            <div ref={viewerRef} className="flex-1 overflow-y-auto bg-slate-100 p-4 relative scroll-smooth">
                {pageViewports.map((viewport, index) => {
                    const pageNum = index + 1;
                    return (
                        <div
                            key={pageNum}
                            ref={el => pageRefs.current[pageNum - 1] = el}
                            data-page-number={pageNum}
                            className="mb-4 shadow-lg mx-auto"
                            style={{ width: viewport.width * scale, height: viewport.height * scale }}
                        >
                            <div className="relative">
                                <canvas />
                                <div className="textLayer" />
                            </div>
                        </div>
                    );
                })}
            </div>
        </main>
        
        {/* Review Panel (Desktop) */}
        <aside className={`flex-shrink-0 bg-white border-l border-slate-300 transition-all duration-300 ease-in-out ${isReviewPanelOpen ? 'w-96' : 'w-0'}`}>
            <div className="w-96 h-full overflow-hidden">
              <VoiceReviewer 
                pdfDoc={pdfDoc}
                numPages={numPages}
                currentPage={currentPage}
                setHighlightAndNavigate={setHighlightAndNavigate}
                onReviewComplete={onReviewComplete}
                initialReviewResult={initialReviewResult}
              />
            </div>
        </aside>
      </div>

      {/* Floating Controls */}
      <div className="fixed bottom-0 md:bottom-4 left-0 right-0 md:left-1/2 md:-translate-x-1/2 md:w-auto z-30 flex justify-center">
          <div className="flex items-center justify-between md:justify-center w-full md:w-auto md:gap-2 bg-white/80 backdrop-blur-md text-slate-800 p-2 md:rounded-full shadow-xl border border-slate-200/80">
              {/* Page controls */}
              <div className="flex items-center gap-2">
                 <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1} className="p-1 rounded-full hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed" aria-label="Previous page">
                     <ChevronLeftIcon className="w-6 h-6" />
                 </button>
                 <div className="flex items-center text-sm font-medium">
                     <input 
                         type="text" 
                         value={pageInput}
                         onChange={handlePageInputChange}
                         onBlur={handlePageInputBlur}
                         onKeyDown={handlePageInputKeyDown}
                         className="w-10 text-center bg-slate-100/50 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
                         aria-label={`Current page, page ${currentPage} of ${numPages}`}
                     />
                     <span className="px-1">/ {numPages}</span>
                 </div>
                 <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= numPages} className="p-1 rounded-full hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed" aria-label="Next page">
                     <ChevronRightIcon className="w-6 h-6" />
                 </button>
              </div>
              
              <div className="hidden md:block w-px h-6 bg-slate-300 mx-2"></div>
              
              <div className="flex items-center gap-2">
                  <button onClick={() => setScale(s => Math.max(0.25, s * 0.9))} className="p-1 rounded-full hover:bg-slate-200" aria-label="Zoom out">
                      <ZoomOutIcon className="w-6 h-6" />
                  </button>
                  <button onClick={() => setScale(s => Math.min(3, s * 1.1))} className="p-1 rounded-full hover:bg-slate-200" aria-label="Zoom in">
                      <ZoomInIcon className="w-6 h-6" />
                  </button>
                  <button onClick={() => fitToWidth(false)} className="p-1 rounded-full hover:bg-slate-200" aria-label="Fit to width">
                      <FitToWidthIcon className="w-6 h-6" />
                  </button>
              </div>
          </div>
      </div>
      
      {/* Mobile Thumbnail Drawer */}
      {isMobileThumbnailsOpen && (
          <div className="md:hidden fixed inset-0 z-40 animate-fade-in" role="dialog" aria-modal="true">
              <div onClick={() => setIsMobileThumbnailsOpen(false)} className="absolute inset-0 bg-black/40"></div>
              <div className="absolute top-0 left-0 bottom-0 w-4/5 max-w-xs bg-slate-100 shadow-xl p-2 overflow-y-auto animate-slide-in-left">
                  <div className="flex justify-end mb-2">
                      <button onClick={() => setIsMobileThumbnailsOpen(false)} className="p-1 rounded-full hover:bg-slate-200" aria-label="Close thumbnails">
                          <XIcon className="w-6 h-6 text-slate-600"/>
                      </button>
                  </div>
                  {ThumbnailsList}
              </div>
          </div>
      )}

      {/* Mobile Review Drawer */}
      {isMobileReviewOpen && (
          <div className="md:hidden fixed inset-0 z-40 animate-fade-in" role="dialog" aria-modal="true">
              <div onClick={() => setIsMobileReviewOpen(false)} className="absolute inset-0 bg-black/40"></div>
              <div className="absolute top-0 right-0 bottom-0 w-full sm:w-4/5 sm:max-w-md bg-white shadow-xl overflow-y-auto animate-slide-in-right">
                <VoiceReviewer 
                  pdfDoc={pdfDoc}
                  numPages={numPages}
                  currentPage={currentPage}
                  setHighlightAndNavigate={setHighlightAndNavigate}
                  onReviewComplete={onReviewComplete}
                  initialReviewResult={initialReviewResult}
                  onClose={() => setIsMobileReviewOpen(false)}
                />
              </div>
          </div>
      )}

      {/* Chat Modal */}
      {isChatOpen && (
        <PageChat 
            pdfDoc={pdfDoc} 
            numPages={numPages} 
            currentPage={currentPage} 
            isOpen={isChatOpen}
            onClose={() => setIsChatOpen(false)}
        />
      )}
    </div>
  );
}