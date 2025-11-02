import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";
import { ChevronLeftIcon, ChevronRightIcon, ZoomInIcon, ZoomOutIcon, ChatBubbleIcon, SearchIcon, ChevronUpIcon, ChevronDownIcon, XCircleIcon } from './Icons';
import { Loader } from './Loader';
import { PageChat } from './PageChat';

// It seems worker is already set in App.tsx, but good to be safe.
const PDF_WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";
if (pdfjsLib.GlobalWorkerOptions.workerSrc !== PDF_WORKER_URL) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
}

type SearchResult = {
    pageNum: number;
};

interface PdfViewerProps {
  file: File;
  highlightText: string | null;
  targetPage: number | null;
  onPageNavigated: () => void;
}

export function PdfViewer({ file, highlightText, targetPage, onPageNavigated }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageInputRef = useRef<HTMLInputElement>(null);

  const [pdfDoc, setPdfDoc] = useState<any>(null); // Using 'any' for pdfjs document proxy
  const [currentPage, setCurrentPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.5);
  const [isRendering, setIsRendering] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  
  // Search state
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [currentResultIndex, setCurrentResultIndex] = useState(-1);
  const [isSearching, setIsSearching] = useState(false);

  const renderPage = useCallback(async (pageNum: number, pdfDocument: any) => {
    if (!pdfDocument) return;
    setIsRendering(true);

    try {
        const page = await pdfDocument.getPage(pageNum);
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const textLayer = textLayerRef.current;
        const container = containerRef.current;
        if (!canvas || !container || !textLayer) return;

        canvas.height = viewport.height;
        canvas.width = viewport.width;
        
        container.style.height = `${viewport.height}px`;
        container.style.width = `${viewport.width}px`;

        const renderContext = {
            canvasContext: canvas.getContext('2d')!,
            viewport: viewport,
        };

        await page.render(renderContext).promise;

        // Render text layer for highlighting and selection
        textLayer.innerHTML = ''; // Clear previous text layer
        textLayer.style.height = `${viewport.height}px`;
        textLayer.style.width = `${viewport.width}px`;

        const textContent = await page.getTextContent();
        await pdfjsLib.renderTextLayer({
            textContentSource: textContent,
            container: textLayer,
            viewport: viewport,
        }).promise;
        
    } catch (error) {
        console.error("Error rendering page:", error);
    } finally {
        setIsRendering(false);
    }
  }, [scale]);

  useEffect(() => {
    const loadPdf = async () => {
      if (!file) return;
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      setPdfDoc(pdf);
      setNumPages(pdf.numPages);
      setCurrentPage(1); // Explicitly set to 1 on new file
      if (pageInputRef.current) {
        pageInputRef.current.value = '1';
      }
    };
    loadPdf();
  }, [file]);

  useEffect(() => {
    if (pdfDoc) {
      renderPage(currentPage, pdfDoc);
    }
  }, [pdfDoc, currentPage, renderPage]);
  
  useEffect(() => {
      if (targetPage && targetPage !== currentPage) {
          setCurrentPage(targetPage);
          onPageNavigated();
      }
  }, [targetPage, currentPage, onPageNavigated]);


  useEffect(() => {
    if (highlightText && !isRendering && textLayerRef.current) {
        const textLayer = textLayerRef.current;
        // FIX: Cast the result of querySelectorAll to HTMLElement[] to fix type inference issues.
        const spans = Array.from(textLayer.querySelectorAll('span[role="presentation"]')) as HTMLElement[];
        
        spans.forEach(span => {
            // Clear previous temporary highlights
            if (span.classList.contains('temporary-highlight')) {
                span.classList.remove('temporary-highlight');
                span.style.backgroundColor = '';
                span.style.boxShadow = '';
            }
        });

        const allText = spans.map(s => s.textContent || '').join('');
        const startIndex = allText.indexOf(highlightText);

        if (startIndex === -1) return;

        let charCount = 0;
        let found = false;
        for (const span of spans) {
            const spanText = span.textContent || '';
            const nextCharCount = charCount + spanText.length;
            
            if (startIndex >= charCount && startIndex < nextCharCount) {
                span.classList.add('temporary-highlight');
                if (!found) {
                     span.scrollIntoView({ behavior: 'smooth', block: 'center' });
                     found = true;
                }
            }
            charCount = nextCharCount;
            if (charCount > startIndex + highlightText.length) break;
        }
    }
  }, [highlightText, currentPage, isRendering]);

  // Search highlighting effect
  useEffect(() => {
    const textLayer = textLayerRef.current;
    if (!textLayer || isRendering) return;

    // Clear old highlights
    const oldMarks = textLayer.querySelectorAll('mark');
    oldMarks.forEach(mark => {
        const parent = mark.parentNode;
        if(parent) {
            parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
            parent.normalize();
        }
    });

    if (!searchQuery) return;

    const spans = textLayer.querySelectorAll('span[role="presentation"]');
    const regex = new RegExp(searchQuery, 'gi');

    spans.forEach(span => {
        const htmlSpan = span as HTMLElement;
        const text = htmlSpan.textContent || '';
        if (text.match(regex)) {
            htmlSpan.innerHTML = text.replace(regex, match => `<mark class="search-highlight">${match}</mark>`);
        }
    });

    if (currentResultIndex !== -1 && searchResults[currentResultIndex]?.pageNum === currentPage) {
        // FIX: Cast the result of querySelectorAll to HTMLElement[] to fix type inference issues.
        const allPageMarks = Array.from(textLayer.querySelectorAll('mark.search-highlight')) as HTMLElement[];
        const matchesOnPrevPages = searchResults.slice(0, currentResultIndex).filter(r => r.pageNum < currentPage).length;
        const currentMatchOnPageIndex = currentResultIndex - matchesOnPrevPages;
        
        const currentMark = allPageMarks[currentMatchOnPageIndex];
        if (currentMark) {
            currentMark.classList.add('current-search-highlight');
            currentMark.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        }
    }
  }, [isRendering, searchQuery, currentResultIndex, searchResults, currentPage]);


  const goToPrevPage = () => setCurrentPage(prev => Math.max(1, prev - 1));
  const goToNextPage = () => setCurrentPage(prev => Math.min(numPages, prev + 1));
  const zoomIn = () => setScale(prev => Math.min(3, prev + 0.25));
  const zoomOut = () => setScale(prev => Math.max(0.5, prev - 0.25));
  
  const handlePageInputChange = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const newPage = parseInt(e.currentTarget.value, 10);
    if (!isNaN(newPage)) {
        if(e.key === 'Enter') {
            setCurrentPage(Math.max(1, Math.min(newPage, numPages)));
        }
    }
  };
  const handlePageInputBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      const newPage = parseInt(e.target.value, 10);
      if (isNaN(newPage) || newPage < 1 || newPage > numPages) {
          e.target.value = currentPage.toString();
      }
  };

  const performSearch = async () => {
    if (!searchQuery || !pdfDoc) return;
    setIsSearching(true);
    setSearchResults([]);
    setCurrentResultIndex(-1);

    const allMatches: SearchResult[] = [];
    const lowerCaseQuery = searchQuery.toLowerCase();

    for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item: any) => ('str' in item ? item.str : '')).join('').toLowerCase();
        
        let match;
        const regex = new RegExp(lowerCaseQuery, 'g');
        while ((match = regex.exec(pageText)) !== null) {
            allMatches.push({ pageNum: i });
        }
    }

    setSearchResults(allMatches);
    if (allMatches.length > 0) {
        navigateToResult(0);
    }
    setIsSearching(false);
  };

  const navigateToResult = (index: number) => {
    if (index < 0 || index >= searchResults.length) return;
    const result = searchResults[index];
    setCurrentResultIndex(index);
    if (result.pageNum !== currentPage) {
        setCurrentPage(result.pageNum);
    }
  };
  const goToNextResult = () => navigateToResult((currentResultIndex + 1) % searchResults.length);
  const goToPrevResult = () => navigateToResult((currentResultIndex - 1 + searchResults.length) % searchResults.length);

  const clearSearch = () => {
    setIsSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    setCurrentResultIndex(-1);
  };


  return (
    <div className="h-full flex flex-col bg-slate-100">
      <div className="flex-shrink-0 bg-white border-b border-slate-200 p-2 flex items-center justify-center gap-4 sticky top-0 z-10 shadow-sm">
        <button onClick={goToPrevPage} disabled={currentPage <= 1} className="p-2 rounded-md hover:bg-slate-100 disabled:opacity-50">
          <ChevronLeftIcon className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-1.5">
            <input 
              ref={pageInputRef}
              type="number" 
              defaultValue={currentPage}
              onKeyDown={handlePageInputChange} 
              onBlur={handlePageInputBlur}
              className="w-14 p-1 text-center border border-slate-300 rounded-md"
            />
            <span className="text-slate-600">/ {numPages || '...'}</span>
        </div>
        <button onClick={goToNextPage} disabled={currentPage >= numPages} className="p-2 rounded-md hover:bg-slate-100 disabled:opacity-50">
          <ChevronRightIcon className="w-5 h-5" />
        </button>
        <div className="h-6 w-px bg-slate-300 mx-2"></div>
        <button onClick={zoomOut} className="p-2 rounded-md hover:bg-slate-100">
          <ZoomOutIcon className="w-5 h-5" />
        </button>
        <button onClick={zoomIn} className="p-2 rounded-md hover:bg-slate-100">
          <ZoomInIcon className="w-5 h-5" />
        </button>
        <div className="h-6 w-px bg-slate-300 mx-2"></div>
        <button onClick={() => setIsSearchOpen(true)} className="p-2 rounded-md hover:bg-slate-100" title="Search document">
            <SearchIcon className="w-5 h-5" />
        </button>
         <button 
          onClick={() => setIsChatOpen(true)} 
          className="flex items-center gap-2 p-2 px-3 rounded-md hover:bg-slate-100 text-blue-600 font-semibold"
          title="Chat with this page"
        >
          <ChatBubbleIcon className="w-5 h-5" />
          <span>Chat</span>
        </button>
        
        {isSearchOpen && (
            <div className="absolute top-full mt-1 right-4 bg-white p-2 rounded-md shadow-lg border border-slate-200 flex items-center gap-2 z-20 animate-fade-in">
                <input 
                    type="text"
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && performSearch()}
                    className="px-2 py-1 border border-slate-300 rounded-md w-48"
                    autoFocus
                />
                <button onClick={performSearch} className="p-2 rounded-md hover:bg-slate-100" title="Execute search">
                    {isSearching ? <div className="w-4 h-4 border-2 border-t-blue-500 border-slate-200 rounded-full animate-spin"></div> : <SearchIcon className="w-4 h-4"/>}
                </button>
                <div className="h-5 w-px bg-slate-300"></div>
                <button onClick={goToPrevResult} disabled={searchResults.length === 0} className="p-2 rounded-md hover:bg-slate-100 disabled:opacity-50" title="Previous match">
                    <ChevronUpIcon className="w-4 h-4" />
                </button>
                <span className="text-sm text-slate-600 min-w-[50px] text-center">
                    {searchResults.length > 0 ? `${currentResultIndex + 1} / ${searchResults.length}` : '0 / 0'}
                </span>
                <button onClick={goToNextResult} disabled={searchResults.length === 0} className="p-2 rounded-md hover:bg-slate-100 disabled:opacity-50" title="Next match">
                    <ChevronDownIcon className="w-4 h-4" />
                </button>
                <button onClick={clearSearch} className="p-2 rounded-md hover:bg-slate-100" title="Close search">
                    <XCircleIcon className="w-4 h-4 text-slate-500" />
                </button>
            </div>
        )}
      </div>

      <div className="flex-1 overflow-auto p-4 flex justify-center" id="viewer-container">
        {!pdfDoc ? (
            <div className="flex flex-col items-center justify-center h-full">
                <Loader />
                <p className="mt-4 text-slate-600">Loading Document...</p>
            </div>
        ) : (
            <div ref={containerRef} className="relative shadow-lg bg-white">
                <canvas ref={canvasRef} />
                <div ref={textLayerRef} className="textLayer absolute top-0 left-0" />
                {isRendering && (
                    <div className="absolute inset-0 bg-white/50 flex items-center justify-center">
                        <Loader />
                    </div>
                )}
            </div>
        )}
      </div>
      
      {pdfDoc && isChatOpen && (
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