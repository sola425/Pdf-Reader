import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";
import { 
    ChevronLeftIcon, ChevronRightIcon, ZoomInIcon, ZoomOutIcon, SearchIcon, XCircleIcon, 
    ArrowLeftIcon, EllipsisVerticalIcon, BookOpenIcon, DocumentDuplicateIcon, XIcon
} from './Icons';
import { Loader } from './Loader';
import { PageChat } from './PageChat';
import { VoiceReviewer } from './VoiceReviewer';
import type { ReviewResult } from '../types';

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
  documentText: string;
  initialReviewResult: ReviewResult | null;
  onReviewComplete: (result: ReviewResult) => void;
  setHighlightAndNavigate: (text: string | null, page: number | null) => void;
  onReset: () => void;
}

export function PdfViewer({ 
    file, highlightText, targetPage, onPageNavigated, documentText, initialReviewResult,
    onReviewComplete, setHighlightAndNavigate, onReset 
}: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageInputRef = useRef<HTMLInputElement>(null);
  const pageTextCache = useRef(new Map<number, string>());

  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.5);
  const [isRendering, setIsRendering] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [isGeneratingThumbnails, setIsGeneratingThumbnails] = useState(false);
  
  // UI State for new design
  const [isOptionsMenuOpen, setIsOptionsMenuOpen] = useState(false);
  const [isReviewPanelOpen, setIsReviewPanelOpen] = useState(false);
  const [isThumbnailPanelOpen, setIsThumbnailPanelOpen] = useState(false);

  // Search state
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [currentResultIndex, setCurrentResultIndex] = useState(-1);
  const [isSearching, setIsSearching] = useState(false);
  const [searchMessage, setSearchMessage] = useState('');

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

        textLayer.innerHTML = '';
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
    const loadPdfAndThumbnails = async () => {
      if (!file) return;
      
      // Reset UI state for new document
      setIsReviewPanelOpen(false);
      setIsThumbnailPanelOpen(false);
      setIsOptionsMenuOpen(false);
      
      setPdfDoc(null);
      setThumbnails([]);
      setNumPages(0);
      pageTextCache.current.clear();
      setIsGeneratingThumbnails(true);
      clearSearch();

      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      setPdfDoc(pdf);
      setNumPages(pdf.numPages);
      setCurrentPage(1);

      const THUMBNAIL_WIDTH = 120;
      const thumbnailPromises = Array.from({ length: pdf.numPages }, (_, i) => i + 1).map(async pageNum => {
          const page = await pdf.getPage(pageNum);
          const viewport = page.getViewport({ scale: 1 });
          const scale = THUMBNAIL_WIDTH / viewport.width;
          const thumbViewport = page.getViewport({ scale });
          
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = thumbViewport.width;
          tempCanvas.height = thumbViewport.height;
          const canvasContext = tempCanvas.getContext('2d')!;
          
          await page.render({ canvasContext, viewport: thumbViewport }).promise;
          return tempCanvas.toDataURL();
      });
      
      const thumbUrls = await Promise.all(thumbnailPromises);
      setThumbnails(thumbUrls);
      setIsGeneratingThumbnails(false);
    };
    loadPdfAndThumbnails();
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
        Array.from(textLayer.querySelectorAll('span.temporary-highlight')).forEach(el => (el as Element).classList.remove('temporary-highlight'));

        const spans = Array.from(textLayer.querySelectorAll('span[role="presentation"]')) as HTMLElement[];
        const allText = spans.map(s => s.textContent || '').join('');
        const startIndex = allText.indexOf(highlightText);
        if (startIndex === -1) return;

        let charCount = 0;
        let found = false;
        for (const span of spans) {
            const spanText = span.textContent || '';
            const nextCharCount = charCount + spanText.length;
            if (startIndex < nextCharCount && startIndex + highlightText.length > charCount) {
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

  useEffect(() => {
    const textLayer = textLayerRef.current;
    if (!textLayer || isRendering) return;

    const unwrapMarks = (node: Element) => {
        const marks = Array.from(node.querySelectorAll('mark.search-highlight'));
        marks.forEach(mark => {
            const parent = mark.parentNode;
            if (parent) {
                while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
                parent.removeChild(mark);
                parent.normalize();
            }
        });
    };
    unwrapMarks(textLayer);

    if (!searchQuery) return;

    const spans = Array.from(textLayer.querySelectorAll('span[role="presentation"]')) as HTMLElement[];
    const regex = new RegExp(searchQuery.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'gi');
    spans.forEach(span => {
        const text = span.textContent;
        if (!text || !text.match(regex)) return;
        
        const fragment = document.createDocumentFragment();
        let lastIndex = 0;
        let match;
        regex.lastIndex = 0;
        while ((match = regex.exec(text)) !== null) {
            if (match.index > lastIndex) fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
            const mark = document.createElement('mark');
            mark.className = 'search-highlight';
            mark.textContent = match[0];
            fragment.appendChild(mark);
            lastIndex = regex.lastIndex;
        }
        if (lastIndex < text.length) fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
        span.replaceChildren(fragment);
    });

    if (currentResultIndex !== -1 && searchResults[currentResultIndex]?.pageNum === currentPage) {
        const allPageMarks = Array.from(textLayer.querySelectorAll('mark.search-highlight')) as HTMLElement[];
        const matchesOnThisPage = searchResults.filter(r => r.pageNum === currentPage);
        const globalIndexOfFirstMatchOnPage = searchResults.findIndex(r => r.pageNum === currentPage);
        const localMatchIndex = currentResultIndex - globalIndexOfFirstMatchOnPage;
        const currentMark = allPageMarks[localMatchIndex];
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
    if(e.key === 'Enter') {
        const newPage = parseInt(e.currentTarget.value, 10);
        if (!isNaN(newPage)) setCurrentPage(Math.max(1, Math.min(newPage, numPages)));
        e.currentTarget.blur();
    }
  };
  const handlePageInputBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      const newPage = parseInt(e.target.value, 10);
      e.target.value = (!isNaN(newPage) && newPage >= 1 && newPage <= numPages) ? newPage.toString() : currentPage.toString();
  };

  const getPageText = async (pageNum: number) => {
    if (pageTextCache.current.has(pageNum)) return pageTextCache.current.get(pageNum)!;
    const page = await pdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item: any) => 'str' in item ? item.str : '').join('');
    pageTextCache.current.set(pageNum, pageText);
    return pageText;
  };

  const performSearch = async () => {
    if (!searchQuery || !pdfDoc) return;
    setIsSearching(true);
    setSearchMessage('Searching...');
    setSearchResults([]);
    setCurrentResultIndex(-1);
    const allMatches: SearchResult[] = [];
    for (let i = 1; i <= pdfDoc.numPages; i++) {
        const pageText = await getPageText(i);
        if (pageText.toLowerCase().includes(searchQuery.toLowerCase())) {
            const count = pageText.toLowerCase().split(searchQuery.toLowerCase()).length - 1;
            for(let j=0; j<count; j++) allMatches.push({ pageNum: i });
        }
    }
    setSearchResults(allMatches);
    setSearchMessage(`${allMatches.length} result${allMatches.length === 1 ? '' : 's'} found.`);
    if (allMatches.length > 0) navigateToResult(0);
    setIsSearching(false);
  };

  const navigateToResult = (index: number) => {
    if (index < 0 || index >= searchResults.length) return;
    const result = searchResults[index];
    setCurrentResultIndex(index);
    if (result.pageNum !== currentPage) setCurrentPage(result.pageNum);
  };
  const goToNextResult = () => navigateToResult(searchResults.length > 0 ? (currentResultIndex + 1) % searchResults.length : -1);
  const goToPrevResult = () => navigateToResult(searchResults.length > 0 ? (currentResultIndex - 1 + searchResults.length) % searchResults.length : -1);

  const clearSearch = () => {
    setIsSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    setCurrentResultIndex(-1);
    setSearchMessage('');
  };

  return (
    <div className="h-screen w-screen bg-slate-200 flex flex-col fixed inset-0">
      
      {/* Top Header */}
      <header className="absolute top-0 left-0 right-0 z-20 bg-white/80 backdrop-blur-md shadow-sm transition-transform duration-300">
        {!isSearchOpen ? (
            <div className="h-14 flex items-center justify-between px-2 sm:px-4">
                <button onClick={onReset} className="p-2 rounded-full hover:bg-slate-200" aria-label="Go Back">
                    <ArrowLeftIcon className="w-6 h-6 text-slate-700" />
                </button>
                <h1 className="text-slate-800 font-semibold text-center truncate px-2">{file.name}</h1>
                <button onClick={() => setIsOptionsMenuOpen(true)} className="p-2 rounded-full hover:bg-slate-200" aria-label="Options">
                    <EllipsisVerticalIcon className="w-6 h-6 text-slate-700" />
                </button>
            </div>
        ) : (
             <div className="h-14 flex items-center gap-1 px-2">
                <input 
                    type="text"
                    placeholder="Search document..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && performSearch()}
                    className="px-2 py-1 border-0 bg-transparent focus:ring-0 w-full flex-grow text-slate-800"
                    autoFocus
                />
                <button onClick={performSearch} className="p-2 rounded-md hover:bg-slate-200 text-slate-600" aria-label="Execute search">
                    {isSearching ? <div className="w-4 h-4 border-2 border-t-blue-500 border-slate-200 rounded-full animate-spin"></div> : <SearchIcon className="w-5 h-5"/>}
                </button>
                <button onClick={clearSearch} className="p-2 rounded-md hover:bg-slate-200 text-slate-600" aria-label="Close search">
                    <XCircleIcon className="w-6 h-6 text-slate-500" />
                </button>
            </div>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-auto pt-16 pb-20">
            <div ref={containerRef} className="relative mx-auto shadow-xl bg-white">
                <canvas ref={canvasRef}></canvas>
                <div ref={textLayerRef} className="textLayer"></div>
            </div>
            {isRendering && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/50 z-10">
                    <Loader />
                </div>
            )}
      </main>

      {/* Floating Bottom Controls */}
      <footer className="absolute bottom-0 left-0 right-0 z-20 p-2 flex justify-center">
          <div className="bg-white/80 backdrop-blur-md shadow-lg rounded-xl flex items-center justify-center gap-2 p-2">
             {searchResults.length > 0 && isSearchOpen ? (
                <>
                    <button onClick={goToPrevResult} className="p-2 rounded-md hover:bg-slate-200 text-slate-600" aria-label="Previous match">
                        <ChevronLeftIcon className="w-5 h-5" />
                    </button>
                    <span className="text-sm text-slate-600 min-w-[70px] text-center font-medium">
                        {`${currentResultIndex + 1} / ${searchResults.length}`}
                    </span>
                    <button onClick={goToNextResult} className="p-2 rounded-md hover:bg-slate-200 text-slate-600" aria-label="Next match">
                        <ChevronRightIcon className="w-5 h-5" />
                    </button>
                </>
             ) : (
                <>
                    <button onClick={goToPrevPage} disabled={currentPage <= 1} className="p-2 rounded-md hover:bg-slate-100 disabled:opacity-50 text-slate-600" aria-label="Previous Page">
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
                    <button onClick={goToNextPage} disabled={currentPage >= numPages} className="p-2 rounded-md hover:bg-slate-100 disabled:opacity-50 text-slate-600" aria-label="Next Page">
                        <ChevronRightIcon className="w-5 h-5" />
                    </button>
                    <div className="h-6 w-px bg-slate-300 mx-2"></div>
                    <button onClick={zoomOut} className="p-2 rounded-md hover:bg-slate-100 text-slate-600" aria-label="Zoom Out">
                        <ZoomOutIcon className="w-5 h-5" />
                    </button>
                    <span className="text-sm font-medium text-slate-700 w-16 text-center">{`${Math.round(scale * 100)}%`}</span>
                    <button onClick={zoomIn} className="p-2 rounded-md hover:bg-slate-100 text-slate-600" aria-label="Zoom In">
                        <ZoomInIcon className="w-5 h-5" />
                    </button>
                </>
             )}
          </div>
      </footer>

      {/* Options Menu Modal */}
      {isOptionsMenuOpen && (
        <>
            <div onClick={() => setIsOptionsMenuOpen(false)} className="fixed inset-0 bg-black/30 z-30 animate-fade-in"></div>
            <div className="fixed bottom-0 left-0 right-0 z-40 bg-white rounded-t-2xl shadow-2xl p-4 transition-transform duration-300 ease-in-out transform translate-y-0">
                <style>{`
                  @keyframes slide-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
                  .animate-slide-up { animation: slide-up 0.3s ease-out; }
                  @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
                  .animate-fade-in { animation: fade-in 0.3s ease-out; }
                `}</style>
                <div className="grid grid-cols-1 divide-y divide-slate-200">
                    <button onClick={() => { setIsReviewPanelOpen(true); setIsOptionsMenuOpen(false); }} className="flex items-center gap-4 py-3 text-left text-lg text-slate-700 font-medium hover:bg-slate-100 rounded-lg px-2">
                        <BookOpenIcon className="w-6 h-6 text-blue-600" /> Comprehensive Review
                    </button>
                    <button onClick={() => { setIsThumbnailPanelOpen(true); setIsOptionsMenuOpen(false); }} className="flex items-center gap-4 py-3 text-left text-lg text-slate-700 font-medium hover:bg-slate-100 rounded-lg px-2">
                        <DocumentDuplicateIcon className="w-6 h-6 text-blue-600" /> Pages
                    </button>
                    <button onClick={() => { setIsSearchOpen(true); setIsOptionsMenuOpen(false); }} className="flex items-center gap-4 py-3 text-left text-lg text-slate-700 font-medium hover:bg-slate-100 rounded-lg px-2">
                        <SearchIcon className="w-6 h-6 text-blue-600" /> Search
                    </button>
                </div>
            </div>
        </>
      )}

      {/* Review Panel Modal */}
      <div className={`fixed inset-0 z-30 bg-black/30 transition-opacity duration-300 ${isReviewPanelOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={() => setIsReviewPanelOpen(false)}></div>
      <aside className={`transform transition-transform duration-300 ease-in-out fixed top-0 right-0 h-full w-full max-w-sm z-40 md:w-[26rem] md:max-w-none ${isReviewPanelOpen ? 'translate-x-0' : 'translate-x-full'}`}>
          {isReviewPanelOpen && <VoiceReviewer 
              documentText={documentText} 
              setHighlightAndNavigate={setHighlightAndNavigate}
              onReviewComplete={onReviewComplete}
              initialReviewResult={initialReviewResult}
              onClose={() => setIsReviewPanelOpen(false)}
          />}
      </aside>

      {/* Thumbnail Panel Modal */}
      <div className={`fixed inset-0 z-30 bg-black/30 transition-opacity duration-300 ${isThumbnailPanelOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={() => setIsThumbnailPanelOpen(false)}></div>
      <aside className={`transform transition-transform duration-300 ease-in-out fixed top-0 left-0 h-full w-full max-w-xs z-40 bg-slate-100 shadow-xl ${isThumbnailPanelOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          {isThumbnailPanelOpen && <div className="h-full flex flex-col">
              <div className="p-4 flex justify-between items-center border-b bg-white flex-shrink-0">
                  <h3 className="font-bold text-slate-800">Pages</h3>
                  <button onClick={() => setIsThumbnailPanelOpen(false)} className="p-1 rounded-full hover:bg-slate-200">
                      <XIcon className="w-5 h-5 text-slate-600" />
                  </button>
              </div>
              <div className="flex-grow overflow-y-auto p-4 grid grid-cols-2 gap-4">
                  {isGeneratingThumbnails && <div className="col-span-2 flex justify-center pt-8"><Loader /></div>}
                  {thumbnails.map((src, index) => {
                      const pageNum = index + 1;
                      return (
                          <div 
                              key={index} 
                              onClick={() => { setCurrentPage(pageNum); setIsThumbnailPanelOpen(false); }} 
                              className={`cursor-pointer border-2 p-1 ${currentPage === pageNum ? 'border-blue-500' : 'border-transparent'} rounded-md hover:border-blue-400 bg-white`}
                              role="button" tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setCurrentPage(pageNum)}
                          >
                              <img src={src} alt={`Page ${pageNum}`} className="shadow-md rounded-sm w-full" />
                              <p className="text-center text-xs font-semibold text-slate-700 mt-1">{pageNum}</p>
                          </div>
                      );
                  })}
              </div>
          </div>}
      </aside>

      <PageChat 
        pdfDoc={pdfDoc} 
        numPages={numPages} 
        currentPage={currentPage} 
        isOpen={isChatOpen} 
        onClose={() => setIsChatOpen(false)} 
      />
    </div>
  );
}