import React, { useState, useRef } from 'react';
import { DocumentInput } from './components/DocumentInput';
import { VoiceReviewer } from './components/VoiceReviewer';
import { PdfViewer } from './components/PdfViewer';
import { LogoIcon, XCircleIcon, ChevronDoubleLeftIcon, ChevronDoubleRightIcon, ArrowPathIcon } from './components/Icons';
import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";
import { Loader } from './components/Loader';

// Set up the PDF.js worker.
const PDF_WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;

export default function App() {
  if (!process.env.API_KEY) {
    return (
      <div className="min-h-screen bg-red-50 flex flex-col items-center justify-center p-4">
        <div className="bg-white p-8 rounded-xl shadow-lg border border-red-200 text-center max-w-lg">
          <XCircleIcon className="mx-auto h-12 w-12 text-red-400" />
          <h1 className="mt-4 text-2xl font-bold text-slate-900">Application Not Configured</h1>
          <p className="mt-2 text-md text-slate-600">
            This application requires a Gemini API key to function. The API key is missing from the environment configuration.
          </p>
          <p className="mt-4 text-sm text-slate-500">
            Please ensure the <code>API_KEY</code> environment variable is correctly set up before running the application.
          </p>
        </div>
      </div>
    );
  }

  const [documentText, setDocumentText] = useState<string>('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [view, setView] = useState<'input' | 'review'>('input');
  const [highlightText, setHighlightText] = useState<string | null>(null);
  const [targetPage, setTargetPage] = useState<number | null>(null);
  const [isReviewerOpen, setIsReviewerOpen] = useState(true);

  const highlightTimeoutRef = useRef<number | null>(null);

  const triggerTempHighlight = (text: string | null) => {
    if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
    }
    if (!text) {
        setHighlightText(null);
        return;
    }
    setHighlightText(text);
    highlightTimeoutRef.current = window.setTimeout(() => {
        setHighlightText(null);
    }, 4000); // Highlight lasts for 4 seconds
  };

  const handleHighlightAndNavigate = (text: string | null, page: number | null) => {
    triggerTempHighlight(text);
    if (page) {
        setTargetPage(page);
    }
  };

  const handleDocumentSubmit = async (data: string | File) => {
    setIsProcessing(true);
    setError('');
    setDocumentText('');
    setPdfFile(null);
    triggerTempHighlight(null);

    try {
      if (typeof data === 'string') {
        setDocumentText(data);
      } else {
        // It's a file
        setPdfFile(data);
        // Extract text for the AI review
        const arrayBuffer = await data.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        
        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map(item => ('str' in item ? item.str : '')).join(' ');
          fullText += `--- PAGE ${i} ---\n${pageText}\n\n`;
        }
        setDocumentText(fullText);
      }
      setView('review');
    } catch (err) {
      console.error("Error processing document:", err);
      setError("Failed to process the document. The file might be corrupted or too large.");
      setView('input'); // Go back to input screen on error
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReset = () => {
    setDocumentText('');
    setPdfFile(null);
    setError('');
    setView('input');
    triggerTempHighlight(null);
    setIsReviewerOpen(true);
  };

  const renderReviewView = () => {
     if (!documentText && !pdfFile) return null;

     if (pdfFile) {
        return (
            <div className="rounded-xl shadow-lg border border-slate-200/80 h-full overflow-hidden">
                <PdfViewer 
                    file={pdfFile} 
                    highlightText={highlightText} 
                    targetPage={targetPage}
                    onPageNavigated={() => setTargetPage(null)}
                />
            </div>
        );
     }
     
     return (
        <div className="bg-white p-6 rounded-xl shadow-lg border border-slate-200/80 h-full flex flex-col">
            <h2 className="text-xl font-bold mb-4 text-slate-800 border-b pb-2 flex-shrink-0">Document Content</h2>
            <div className="prose prose-slate max-w-none flex-1 overflow-y-auto pr-2">
                <p className="whitespace-pre-wrap">{documentText}</p>
            </div>
        </div>
     );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="w-full bg-white/80 backdrop-blur-sm border-b border-slate-200/80 sticky top-0 z-20">
        <div className="w-full max-w-7xl mx-auto flex items-center justify-between py-3 px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
            <LogoIcon className="h-10 w-10" />
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight brand-gradient">
                RecallReader
            </h1>
            </div>
            {view === 'review' && (
            <div className="flex items-center gap-2 sm:gap-4">
                <button
                onClick={handleReset}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
                >
                <ArrowPathIcon className="h-4 w-4" />
                <span>Start Over</span>
                </button>
                <button
                onClick={() => setIsReviewerOpen(!isReviewerOpen)}
                className="p-2 text-sm font-semibold text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
                title={isReviewerOpen ? 'Hide Review Panel' : 'Show Review Panel'}
                >
                {isReviewerOpen ? <ChevronDoubleRightIcon className="h-5 w-5" /> : <ChevronDoubleLeftIcon className="h-5 w-5" />}
                </button>
            </div>
            )}
        </div>
      </header>
      
      <main className="w-full max-w-7xl mx-auto flex-1 px-4 sm:px-6 lg:px-8 py-8 flex flex-col">
        <div className="flex-1 min-h-0">
          {view === 'input' && (
            <div className="flex justify-center pt-8">
              <DocumentInput onSubmit={handleDocumentSubmit} />
            </div>
          )}
          {isProcessing && (
             <div className="text-center p-8 h-full flex flex-col justify-center items-center">
                <Loader />
                <p className="mt-4 text-slate-600 font-semibold">Processing Document...</p>
             </div>
          )}
          {view === 'review' && !isProcessing && (
             <div className="flex h-full gap-6">
                <div className="flex-1 min-w-0 h-full">
                    {renderReviewView()}
                </div>
                {documentText && (
                    <aside className={`transition-all duration-300 ease-in-out flex-shrink-0 ${isReviewerOpen ? 'w-[26rem]' : 'w-0'}`}>
                        <div className={`h-full overflow-hidden transition-opacity duration-300 ${isReviewerOpen ? 'opacity-100' : 'opacity-0'}`}>
                            <VoiceReviewer 
                                documentText={documentText} 
                                setHighlightAndNavigate={handleHighlightAndNavigate}
                            />
                        </div>
                    </aside>
                )}
             </div>
          )}
          {error && view === 'input' && (
             <p className="mt-4 text-center text-red-600 bg-red-50 p-3 rounded-md">{error}</p>
          )}
        </div>
      </main>
    </div>
  );
}