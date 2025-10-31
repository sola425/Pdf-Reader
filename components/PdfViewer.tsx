import React, { useState, useEffect, useRef, useCallback, forwardRef } from 'react';
import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";
import { Loader } from './Loader';
import { ZoomInIcon, ZoomOutIcon, ChevronLeftIcon, ChevronRightIcon, SidebarIcon, FullscreenEnterIcon, FullscreenExitIcon } from './Icons';

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

interface PdfViewerProps {
  file: File;
}

const ThumbnailItem = ({ pdf, pageNum, isActive, onClick }: { pdf: any, pageNum: number, isActive: boolean, onClick: () => void }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isIntersecting, setIsIntersecting] = useState(false);

    useEffect(() => {
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setIsIntersecting(true);
                    if (containerRef.current) observer.unobserve(containerRef.current);
                }
            },
            { root: containerRef.current?.parentElement, rootMargin: '200px' }
        );

        if (containerRef.current) observer.observe(containerRef.current);
        return () => {
            if (containerRef.current) {
                // eslint-disable-next-line react-hooks/exhaustive-deps
                observer.unobserve(containerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (!isIntersecting || !pdf || !canvasRef.current) return;

        let isMounted = true;
        pdf.getPage(pageNum).then((page: any) => {
            if (!isMounted || !canvasRef.current) return;
            const viewport = page.getViewport({ scale: 0.2 });
            const canvas = canvasRef.current;
            const context = canvas.getContext('2d');
            if (!context) return;
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            page.render({ canvasContext: context, viewport: viewport });
        });
        return () => { isMounted = false; }
    }, [isIntersecting, pdf, pageNum]);

    return (
        <div ref={containerRef} onClick={onClick} className={`mb-2 cursor-pointer transition-all duration-200 rounded-md overflow-hidden ${isActive ? 'ring-2 ring-indigo-500' : 'ring-1 ring-slate-300 hover:ring-indigo-400'}`}>
            {isIntersecting ? (
                 <canvas ref={canvasRef} className="w-full h-auto bg-white" />
            ) : (
                <div style={{ aspectRatio: '0.707' }} className="w-full bg-slate-200 animate-pulse" />
            )}
            <p className={`text-center text-xs py-1 ${isActive ? 'bg-indigo-500 text-white' : 'bg-slate-200 text-slate-700'}`}>{pageNum}</p>
        </div>
    );
};

const PdfPage = forwardRef<HTMLDivElement, { pdf: any, pageNum: number, scale: number }>(({ pdf, pageNum, scale }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const textLayerRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isIntersecting, setIsIntersecting] = useState(false);
    const [pageData, setPageData] = useState<{ page?: any, textContent?: any, viewport?: any }>({});

    useEffect(() => {
        let isMounted = true;
        pdf.getPage(pageNum).then((page: any) => {
            if (!isMounted) return;
            const viewport = page.getViewport({ scale });
            page.getTextContent().then((textContent: any) => {
                if (isMounted) setPageData({ page, textContent, viewport });
            });
        });
        return () => { isMounted = false; };
    }, [pdf, pageNum, scale]);

    useEffect(() => {
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setIsIntersecting(true);
                    if (containerRef.current) observer.unobserve(containerRef.current);
                }
            },
            { root: null, rootMargin: '200px' }
        );
        if (containerRef.current) observer.observe(containerRef.current);
        return () => {
             if (containerRef.current) {
                // eslint-disable-next-line react-hooks/exhaustive-deps
                observer.unobserve(containerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (!isIntersecting || !pageData.page || !canvasRef.current || !textLayerRef.current) return;
        let isMounted = true;

        const renderPage = async () => {
            const { page, textContent, viewport } = pageData;
            const canvas = canvasRef.current;
            const textLayer = textLayerRef.current;
            if (!canvas || !textLayer || !isMounted) return;

            const context = canvas.getContext('2d');
            if (!context) return;

            canvas.height = viewport.height;
            canvas.width = viewport.width;
            
            textLayer.innerHTML = '';
            textLayer.style.height = `${viewport.height}px`;
            textLayer.style.width = `${viewport.width}px`;

            await page.render({ canvasContext: context, viewport: viewport }).promise;
            
            if (isMounted) {
                await pdfjsLib.renderTextLayer({
                    textContentSource: textContent,
                    container: textLayer,
                    viewport: viewport,
                    textDivs: []
                }).promise;
            }
        };

        renderPage();
        return () => { isMounted = false; };
    }, [isIntersecting, pageData]);
    
    return (
        <div 
          ref={(node) => {
            containerRef.current = node;
            if (ref) {
              if (typeof ref === 'function') ref(node);
              else ref.current = node;
            }
          }}
          data-page-num={pageNum}
          className="relative mx-auto mb-4 shadow-xl bg-white" 
          style={{ width: pageData.viewport?.width, height: pageData.viewport?.height }}
        >
            {isIntersecting ? (
                <>
                    <canvas ref={canvasRef} />
                    <div ref={textLayerRef} className="textLayer" />
                </>
            ) : (
                <div className="w-full h-full flex items-center justify-center"><Loader /></div>
            )}
        </div>
    );
});


export function PdfViewer({ file }: PdfViewerProps) {
  const fullscreenContainerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const [pdf, setPdf] = useState<any>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.5);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadPdf = async () => {
      setError('');
      setPdf(null);
      setNumPages(0);
      setCurrentPage(1);
      pageRefs.current.clear();
      try {
        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdfDoc = await loadingTask.promise;
        setPdf(pdfDoc);
        setNumPages(pdfDoc.numPages);
      } catch (err) {
        console.error("Error loading PDF:", err);
        setError("Failed to load PDF. The file may be corrupted.");
      }
    };
    loadPdf();
  }, [file]);

  useEffect(() => {
      if (!scrollContainerRef.current || pageRefs.current.size !== numPages || numPages === 0) return;

      const observer = new IntersectionObserver(
          (entries) => {
              entries.forEach(entry => {
                  if (entry.isIntersecting) {
                      const pageNum = parseInt(entry.target.getAttribute('data-page-num') || '0', 10);
                      if (pageNum) {
                          setCurrentPage(pageNum);
                      }
                  }
              });
          },
          { root: scrollContainerRef.current, rootMargin: '-50% 0px -50% 0px', threshold: 0 }
      );

      pageRefs.current.forEach(pageEl => observer.observe(pageEl));
      return () => observer.disconnect();
  }, [numPages]);

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!fullscreenContainerRef.current) return;
    if (!document.fullscreenElement) {
      fullscreenContainerRef.current.requestFullscreen().catch(err => {
        alert(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
      });
    } else if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  };
  
  const goToPage = (pageNum: number) => {
    pageRefs.current.get(pageNum)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const goToPrevPage = () => goToPage(Math.max(1, currentPage - 1));
  const goToNextPage = () => goToPage(Math.min(numPages, currentPage + 1));
  const zoomIn = () => setScale(s => s + 0.2);
  const zoomOut = () => setScale(s => Math.max(0.5, s - 0.2));

  if (error) return <div className="flex items-center justify-center h-full bg-red-50 text-red-700">{error}</div>;
  if (!pdf) return <div className="flex items-center justify-center h-full"><Loader /></div>;
  
  return (
    <div ref={fullscreenContainerRef} className="w-full h-full flex bg-slate-100">
      {isSidebarOpen && (
        <aside className="w-48 bg-slate-50 border-r border-slate-200 shadow-md flex-shrink-0">
          <div className="h-full overflow-y-auto p-2">
            {Array.from({ length: numPages }, (_, index) => (
              <ThumbnailItem 
                key={`thumb-${index + 1}`}
                pdf={pdf}
                pageNum={index + 1}
                isActive={currentPage === index + 1}
                onClick={() => goToPage(index + 1)}
              />
            ))}
          </div>
        </aside>
      )}
      <main className="flex-1 flex flex-col">
        <header className="flex items-center justify-between p-2 bg-slate-100 border-b border-slate-200 shadow-sm flex-shrink-0 z-10">
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 rounded-md hover:bg-slate-200 transition-colors"><SidebarIcon className="h-5 w-5 text-slate-600" /></button>
          <div className="flex items-center gap-2">
            <button onClick={goToPrevPage} disabled={currentPage <= 1} className="p-2 rounded-md hover:bg-slate-200 transition-colors disabled:opacity-50"><ChevronLeftIcon className="h-5 w-5 text-slate-600" /></button>
            <span className="text-sm text-slate-700 font-medium">Page {currentPage} of {numPages}</span>
            <button onClick={goToNextPage} disabled={currentPage >= numPages} className="p-2 rounded-md hover:bg-slate-200 transition-colors disabled:opacity-50"><ChevronRightIcon className="h-5 w-5 text-slate-600" /></button>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={zoomOut} className="p-2 rounded-md hover:bg-slate-200 transition-colors"><ZoomOutIcon className="h-5 w-5 text-slate-600" /></button>
            <span className="text-sm text-slate-700 font-medium">{Math.round(scale * 100)}%</span>
            <button onClick={zoomIn} className="p-2 rounded-md hover:bg-slate-200 transition-colors"><ZoomInIcon className="h-5 w-5 text-slate-600" /></button>
            <div className="w-px h-5 bg-slate-300 mx-1"></div>
            <button onClick={toggleFullscreen} className="p-2 rounded-md hover:bg-slate-200 transition-colors" title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}>
                {isFullscreen ? <FullscreenExitIcon className="h-5 w-5 text-slate-600" /> : <FullscreenEnterIcon className="h-5 w-5 text-slate-600" />}
            </button>
          </div>
        </header>
        <div ref={scrollContainerRef} className="flex-1 overflow-auto p-4 md:p-8 bg-slate-200">
            {Array.from({ length: numPages }, (_, i) => (
                <PdfPage
                    key={i + 1}
                    ref={(el) => { if(el) pageRefs.current.set(i + 1, el) }}
                    pdf={pdf}
                    pageNum={i + 1}
                    scale={scale}
                />
            ))}
        </div>
      </main>
    </div>
  );
}
