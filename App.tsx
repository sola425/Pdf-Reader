import React, { useState, useRef, useEffect, useCallback } from 'react';
import { DocumentInput } from './components/DocumentInput';
import { PdfViewer } from './components/PdfViewer';
import { LogoIcon, XCircleIcon } from './components/Icons';
import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";
import { Loader } from './components/Loader';
import type { ReviewResult } from './types';

// Set up the PDF.js worker.
const PDF_WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;

const SESSION_KEY = 'recallReaderSession';
const MAX_SESSION_FILE_SIZE = 2 * 1024 * 1024; // 2MB

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
  const [processingProgress, setProcessingProgress] = useState<{ current: number, total: number } | null>(null);
  const [error, setError] = useState<string>('');
  const [view, setView] = useState<'input' | 'review'>('input');
  const [highlightText, setHighlightText] = useState<string | null>(null);
  const [targetPage, setTargetPage] = useState<number | null>(null);
  const [reviewResult, setReviewResult] = useState<ReviewResult | null>(null);
  
  // Session resume state
  const [sessionChecked, setSessionChecked] = useState<boolean>(false);
  const [savedSessionData, setSavedSessionData] = useState<any | null>(null);

  const highlightTimeoutRef = useRef<number | null>(null);
  const appStateRef = useRef<any>();

  appStateRef.current = { pdfFile, documentText, reviewResult, view };

  const saveSession = useCallback(async () => {
    const currentState = appStateRef.current;
    if (!currentState.pdfFile || currentState.view !== 'review') {
      localStorage.removeItem(SESSION_KEY);
      return;
    }

    if (currentState.pdfFile.size > MAX_SESSION_FILE_SIZE) {
        console.warn(`PDF is too large (${currentState.pdfFile.size} bytes) to save session. Skipping.`);
        localStorage.removeItem(SESSION_KEY); // Clear any old session
        return;
    }

    const reader = new FileReader();
    reader.readAsDataURL(currentState.pdfFile);
    reader.onload = () => {
        const sessionData = {
            fileData: {
                dataUrl: reader.result as string,
                name: currentState.pdfFile.name,
                type: currentState.pdfFile.type,
            },
            documentText: currentState.documentText,
            reviewResult: currentState.reviewResult,
        };
        try {
            localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
        } catch (e) {
            console.error("Could not save session (storage may be full):", e);
        }
    };
    reader.onerror = (error) => {
        console.error("Could not convert file to save session:", error);
    };
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SESSION_KEY);
      if (saved) {
        setSavedSessionData(JSON.parse(saved));
      }
    } catch (e) {
      console.error("Failed to read saved session", e);
      localStorage.removeItem(SESSION_KEY);
    }
    setSessionChecked(true);
  }, []);

  const dataURLtoFile = (dataurl: string, filename: string, type: string): File => {
    const arr = dataurl.split(',');
    const mimeMatch = arr[0].match(/:(.*?);/);
    const mime = (mimeMatch && mimeMatch[1]) || type;
    const bstr = atob(arr[arr.length - 1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, { type: mime });
  };

  const resumeSession = () => {
    if (!savedSessionData) return;
    
    try {
        const file = dataURLtoFile(savedSessionData.fileData.dataUrl, savedSessionData.fileData.name, savedSessionData.fileData.type);

        setPdfFile(file);
        setDocumentText(savedSessionData.documentText);
        setReviewResult(savedSessionData.reviewResult);
        setView('review');
        setSavedSessionData(null); // Clear prompt after resuming
    } catch (e) {
        console.error("Failed to resume session:", e);
        setError("Could not resume the previous session. It may be corrupted.");
        localStorage.removeItem(SESSION_KEY);
        setSavedSessionData(null);
    }
  };


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
    setProcessingProgress(null);
    setError('');
    setDocumentText('');
    setPdfFile(null);
    setReviewResult(null);
    triggerTempHighlight(null);
    localStorage.removeItem(SESSION_KEY);
    setSavedSessionData(null);

    try {
      if (typeof data === 'string') {
        // This app flow is now focused on PDFs, so this path is less likely.
        setDocumentText(data);
      } else {
        // It's a file
        setPdfFile(data);
        // Extract text for the AI review
        const arrayBuffer = await data.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        
        const totalPages = pdf.numPages;
        setProcessingProgress({ current: 0, total: totalPages });

        const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1);
        let pagesProcessed = 0;

        const pageTextPromises = pageNumbers.map(pageNum =>
            pdf.getPage(pageNum).then(page =>
                page.getTextContent().then(textContent => {
                    pagesProcessed++;
                    setProcessingProgress({ current: pagesProcessed, total: totalPages });
                    const pageText = textContent.items.map(item => ('str' in item ? item.str : '')).join(' ');
                    return { pageNum, text: `--- PAGE ${pageNum} ---\n${pageText}\n\n` };
                })
            )
        );

        const extractedTexts = await Promise.all(pageTextPromises);
        extractedTexts.sort((a, b) => a.pageNum - b.pageNum); // Ensure correct order
        const fullText = extractedTexts.map(p => p.text).join('');
        
        setDocumentText(fullText);
      }
      setView('review');
    } catch (err) {
      console.error("Error processing document:", err);
      setError("Failed to process the document. The file might be corrupted or too large.");
      setView('input'); // Go back to input screen on error
    } finally {
      setIsProcessing(false);
      setProcessingProgress(null);
    }
  };
  
  useEffect(() => {
    if (view === 'review' && (pdfFile || documentText)) {
      saveSession();
    }
  }, [view, pdfFile, documentText, reviewResult, saveSession]);

  const handleReset = () => {
    setDocumentText('');
    setPdfFile(null);
    setError('');
    setView('input');
    triggerTempHighlight(null);
    setReviewResult(null);
    setSavedSessionData(null);
    localStorage.removeItem(SESSION_KEY);
  };

  const handleReviewComplete = (result: ReviewResult) => {
    setReviewResult(result);
  };

  if (view === 'review' && pdfFile) {
    return (
        <PdfViewer 
            file={pdfFile} 
            highlightText={highlightText} 
            targetPage={targetPage}
            onPageNavigated={() => setTargetPage(null)}
            documentText={documentText}
            initialReviewResult={reviewResult}
            onReviewComplete={handleReviewComplete}
            setHighlightAndNavigate={handleHighlightAndNavigate}
            onReset={handleReset}
        />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="w-full bg-white/80 backdrop-blur-sm border-b border-slate-200/80 sticky top-0 z-20">
        <div className="w-full max-w-7xl mx-auto flex items-center justify-between py-3 px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
            <LogoIcon className="h-10 w-10" />
            <h1 className="text-2xl sm:text-3xl font-extrabold text-blue-600 tracking-tight">
                RecallReader
            </h1>
            </div>
        </div>
      </header>
      
      <main className="w-full max-w-7xl mx-auto flex-1 px-4 sm:px-6 lg:px-8 py-8 flex flex-col">
        <div className="flex-1 min-h-0">
          {view === 'input' && sessionChecked && (
            <div className="flex justify-center pt-8">
              <DocumentInput 
                onSubmit={handleDocumentSubmit} 
                savedSessionData={savedSessionData}
                onResumeSession={resumeSession}
                onClearSavedSession={() => {
                    localStorage.removeItem(SESSION_KEY);
                    setSavedSessionData(null);
                }}
              />
            </div>
          )}
          {isProcessing && (
             <div className="text-center p-8 h-full flex flex-col justify-center items-center">
                <Loader />
                <p className="mt-4 text-slate-600 font-semibold">Processing Document...</p>
                {processingProgress && (
                    <p className="mt-2 text-sm text-slate-500">
                        Page {processingProgress.current} of {processingProgress.total}
                    </p>
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