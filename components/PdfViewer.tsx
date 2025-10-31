import React, { useState, useEffect, useRef, useCallback, forwardRef, useMemo } from 'react';
import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";
import { Loader } from './Loader';
import { ZoomInIcon, ZoomOutIcon, ChevronLeftIcon, ChevronRightIcon, SidebarIcon, FullscreenEnterIcon, FullscreenExitIcon, ChatBubbleIcon, SearchIcon, ChevronUpIcon, ChevronDownIcon, ChevronDoubleLeftIcon, ChevronDoubleRightIcon } from './Icons';
import { PageChat } from './PageChat';

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

interface PdfViewerProps {
  file: File;
  highlightText: string | null;
}

type HighlightRect = { left: number; top: number; width: number; height: number; };
type FlatHighlight = { pageNum: number; highlightIndex: number; };

interface ThumbnailItemProps {
    pdf: any;
    pageNum: number;
    isActive: boolean;
    onClick: () => void;
}

const ThumbnailItem: React.FC<ThumbnailItemProps> = ({ pdf, pageNum, isActive, onClick }) => {
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

interface PdfPageProps {
    pdf: any;
    pageNum: number;
    scale: number;
    highlightText: string | null;
    searchHighlights: HighlightRect[] | undefined;
    currentHighlight: FlatHighlight | null;
}

const PdfPage = forwardRef<HTMLDivElement, PdfPageProps>(({ pdf, pageNum, scale, highlightText, searchHighlights, currentHighlight }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const textLayerRef = useRef<HTMLDivElement>(null);
    const highlightLayerRef = useRef<HTMLDivElement>(null);
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
                const textDivs: HTMLSpanElement[] = [];
                await pdfjsLib.renderTextLayer({
                    textContentSource: textContent,
                    container: textLayer,
                    viewport: viewport,
                    textDivs: textDivs
                }).promise;

                // Handle temporary highlighting
                const highlightLayer = highlightLayerRef.current;
                if (highlightLayer) {
                    highlightLayer.innerHTML = ''; // Clear previous highlights
                    if (highlightText && textDivs.length > 0) {
                        const pageText = textDivs.map(div => div.textContent || '').join('').toLowerCase();
                        const matchIndex = pageText.indexOf(highlightText.toLowerCase());

                        if (matchIndex !== -1) {
                            let charCount = 0;
                            const highlightEndIndex = matchIndex + highlightText.length;

                            for (const textDiv of textDivs) {
                                const text = textDiv.textContent || '';
                                const start = charCount;
                                const end = start + text.length;

                                if (end > matchIndex && start < highlightEndIndex) {
                                    const highlight = document.createElement('div');
                                    highlight.className = 'temporary-highlight';
                                    highlight.style.position = 'absolute';
                                    
                                    const containerRect = textLayer.getBoundingClientRect();
                                    const rect = textDiv.getBoundingClientRect();

                                    highlight.style.left = `${rect.left - containerRect.left}px`;
                                    highlight.style.top = `${rect.top - containerRect.top}px`;
                                    highlight.style.width = `${rect.width}px`;
                                    highlight.style.height = `${rect.height}px`;
                                    
                                    highlightLayer.appendChild(highlight);
                                }

                                charCount = end;
                                if (charCount >= highlightEndIndex) break;
                            }
                        }
                    }
                }
            }
        };

        renderPage();
        return () => { isMounted = false; };
    }, [isIntersecting, pageData, highlightText]);
    
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
                    <div ref={highlightLayerRef} className="absolute top-0 left-0 pointer-events-none" />
                    <div className="absolute top-0 left-0 pointer-events-none w-full h-full">
                        {searchHighlights?.map((rect, index) => {
                            const isCurrent = currentHighlight?.pageNum === pageNum && currentHighlight?.highlightIndex === index;
                            return (
                                <div
                                    key={index}
                                    className={`search-highlight ${isCurrent ? 'current-search-highlight' : ''}`}
                                    style={{
                                        left: `${rect.left * scale}px`,
                                        top: `${rect.top * scale}px`,
                                        width: `${rect.width * scale}px`,
                                        height: `${rect.height * scale}px`,
                                    }}
                                />
                            );
                        })}
                    </div>
                </>
            ) : (
                <div className="w-full h-full flex items-center justify-center"><Loader /></div>
            )}
        </div>
    );
});


export function PdfViewer({ file, highlightText }: PdfViewerProps) {
  const fullscreenContainerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const searchTimeoutRef = useRef<number | null>(null);

  const [pdf, setPdf] = useState<any>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.5);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [error, setError] = useState('');
  
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchHighlights, setSearchHighlights] = useState<Map<number, HighlightRect[]>>(new Map());
  const [flatHighlights, setFlatHighlights] = useState<FlatHighlight[]>([]);
  const [currentHighlightIndex, setCurrentHighlightIndex] = useState(-1);

  const currentHighlight = useMemo(() => {
    if (currentHighlightIndex === -1 || flatHighlights.length === 0) return null;
    return flatHighlights[currentHighlightIndex];
  }, [currentHighlightIndex, flatHighlights]);

  const goToPage = useCallback((pageNum: number) => {
    const pageEl = pageRefs.current.get(pageNum);
    if (pageEl) {
        pageEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  const performSearch = useCallback(async (query: string) => {
    if (!query || !pdf) {
        setSearchHighlights(new Map());
        setFlatHighlights([]);
        setCurrentHighlightIndex(-1);
        return;
    }
    setIsSearching(true);
    
    const newHighlights = new Map<number, HighlightRect[]>();
    const newFlatHighlights: FlatHighlight[] = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        
        const viewport = page.getViewport({ scale: 1 }); // Use scale 1 for coordinate calculations
        const container = document.createElement('div');
        Object.assign(container.style, { visibility: 'hidden', position: 'absolute', top: '0', left: '0' });
        document.body.appendChild(container);
        
        const textDivs: HTMLSpanElement[] = [];
        await pdfjsLib.renderTextLayer({ textContentSource: textContent, container, viewport, textDivs }).promise;

        const pageText = textDivs.map(div => div.textContent || '').join('');
        const regex = new RegExp(query, 'gi');
        const matches = [...pageText.matchAll(regex)];
        
        if (matches.length > 0) {
            const pageHighlights: HighlightRect[] = [];
            for (const match of matches) {
                if (typeof match.index !== 'number') continue;

                const matchStart = match.index;
                const matchEnd = matchStart + match[0].length;
                let charOffset = 0;
                
                const relevantDivs = textDivs.filter(div => {
                    const divStart = charOffset;
                    const divEnd = charOffset + (div.textContent?.length || 0);
                    charOffset = divEnd;
                    return divEnd > matchStart && divStart < matchEnd;
                });
                
                if (relevantDivs.length > 0) {
                    const firstDiv = relevantDivs[0];
                    const lastDiv = relevantDivs[relevantDivs.length - 1];
                    const left = parseFloat(firstDiv.style.left);
                    const top = parseFloat(firstDiv.style.top);
                    const height = parseFloat(firstDiv.style.height);
                    const right = parseFloat(lastDiv.style.left) + parseFloat(lastDiv.style.width);
                    pageHighlights.push({ left, top, width: right - left, height });
                    newFlatHighlights.push({ pageNum, highlightIndex: pageHighlights.length - 1 });
                }
            }
            if (pageHighlights.length > 0) newHighlights.set(pageNum, pageHighlights);
        }
        document.body.removeChild(container);
    }

    setSearchHighlights(newHighlights);
    setFlatHighlights(newFlatHighlights);
    setCurrentHighlightIndex(newFlatHighlights.length > 0 ? 0 : -1);
    setIsSearching(false);

    if (newFlatHighlights.length > 0) {
        goToPage(newFlatHighlights[0].pageNum);
    }
  }, [pdf, goToPage]);

  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (!searchQuery) {
        performSearch('');
        return;
    }
    searchTimeoutRef.current = window.setTimeout(() => {
        performSearch(searchQuery);
    }, 500); // Debounce search
    return () => {
        if(searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchQuery, performSearch]);

  useEffect(() => {
    const loadPdf = async () => {
      setError('');
      setPdf(null);
      setNumPages(0);
      setCurrentPage(1);
      setIsChatOpen(false);
      setSearchQuery('');
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
      if (!highlightText || !pdf) return;

      const findAndScroll = async (text: string) => {
          for (let i = 1; i <= numPages; i++) {
              const page = await pdf.getPage(i);
              const content = await page.getTextContent();
              const pageText = content.items.map((item: any) => ('str' in item ? item.str : '')).join('');
              if (pageText.toLowerCase().includes(text.toLowerCase())) {
                  goToPage(i);
                  return; 
              }
          }
      };

      findAndScroll(highlightText);
  }, [highlightText, pdf, numPages, goToPage]);

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

  const goToNextHighlight = () => {
    const newIndex = (currentHighlightIndex + 1) % flatHighlights.length;
    setCurrentHighlightIndex(newIndex);
    goToPage(flatHighlights[newIndex].pageNum);
  };
  const goToPrevHighlight = () => {
    const newIndex = (currentHighlightIndex - 1 + flatHighlights.length) % flatHighlights.length;
    setCurrentHighlightIndex(newIndex);
    goToPage(flatHighlights[newIndex].pageNum);
  };
  
  const zoomIn = () => setScale(s => s + 0.2);
  const zoomOut = () => setScale(s => Math.max(0.5, s - 0.2));

  if (error) return <div className="flex items-center justify-center h-full bg-red-50 text-red-700">{error}</div>;
  if (!pdf) return <div className="flex items-center justify-center h-full"><Loader /></div>;
  
  return (
    <div ref={fullscreenContainerRef} className="w-full h-full flex bg-slate-100 relative">
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
        <header className="flex-wrap items-center justify-between p-2 bg-slate-100 border-b border-slate-200 shadow-sm flex-shrink-0 z-10 grid grid-cols-3 gap-2">
          <div className="flex items-center gap-1">
            <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 rounded-md hover:bg-slate-200 transition-colors"><SidebarIcon className="h-5 w-5 text-slate-600" /></button>
            <div className="w-px h-5 bg-slate-300 mx-1"></div>
            <button onClick={zoomOut} className="p-2 rounded-md hover:bg-slate-200 transition-colors"><ZoomOutIcon className="h-5 w-5 text-slate-600" /></button>
            <span className="text-sm text-slate-700 font-medium whitespace-nowrap">{Math.round(scale * 100)}%</span>
            <button onClick={zoomIn} className="p-2 rounded-md hover:bg-slate-200 transition-colors"><ZoomInIcon className="h-5 w-5 text-slate-600" /></button>
          </div>

          <div className="flex items-center justify-center gap-1">
            <button onClick={() => goToPage(1)} disabled={currentPage <= 1} className="p-2 rounded-md hover:bg-slate-200 transition-colors disabled:opacity-50"><ChevronDoubleLeftIcon className="h-5 w-5 text-slate-600" /></button>
            <button onClick={() => goToPage(Math.max(1, currentPage - 1))} disabled={currentPage <= 1} className="p-2 rounded-md hover:bg-slate-200 transition-colors disabled:opacity-50"><ChevronLeftIcon className="h-5 w-5 text-slate-600" /></button>
            <span className="text-sm text-slate-700 font-medium whitespace-nowrap">Page {currentPage} of {numPages}</span>
            <button onClick={() => goToPage(Math.min(numPages, currentPage + 1))} disabled={currentPage >= numPages} className="p-2 rounded-md hover:bg-slate-200 transition-colors disabled:opacity-50"><ChevronRightIcon className="h-5 w-5 text-slate-600" /></button>
            <button onClick={() => goToPage(numPages)} disabled={currentPage >= numPages} className="p-2 rounded-md hover:bg-slate-200 transition-colors disabled:opacity-50"><ChevronDoubleRightIcon className="h-5 w-5 text-slate-600" /></button>
          </div>

          <div className="flex items-center gap-1 justify-end">
             <div className="relative">
                <input
                    type="text"
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-32 sm:w-40 pl-8 pr-2 py-1.5 text-sm border border-slate-300 rounded-md focus:ring-1 focus:ring-indigo-500"
                />
                <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            </div>
            {isSearching ? <Loader /> : flatHighlights.length > 0 && (
                <div className="flex items-center gap-1 text-sm text-slate-600">
                    <span>{currentHighlightIndex + 1}/{flatHighlights.length}</span>
                    <button onClick={goToPrevHighlight} className="p-1 rounded-md hover:bg-slate-200"><ChevronUpIcon className="h-4 w-4" /></button>
                    <button onClick={goToNextHighlight} className="p-1 rounded-md hover:bg-slate-200"><ChevronDownIcon className="h-4 w-4" /></button>
                </div>
            )}
            <div className="w-px h-5 bg-slate-300 mx-1"></div>
            <button onClick={() => setIsChatOpen(true)} className="p-2 rounded-md hover:bg-slate-200 transition-colors" title="Chat with AI about document pages">
                <ChatBubbleIcon className="h-5 w-5 text-slate-600" />
            </button>
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
                    highlightText={highlightText}
                    searchHighlights={searchHighlights.get(i + 1)}
                    currentHighlight={currentHighlight}
                />
            ))}
        </div>
      </main>
      {isChatOpen && (
        <PageChat 
            pdfDoc={pdf} 
            numPages={numPages} 
            currentPage={currentPage}
            isOpen={isChatOpen} 
            onClose={() => setIsChatOpen(false)} 
        />
      )}
    </div>
  );
}