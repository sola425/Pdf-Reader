import React, { useState, useRef, useEffect, useCallback } from 'react';
import { DocumentInput } from './components/DocumentInput';
import { PdfViewer } from './components/PdfViewer';
import { LogoIcon, XCircleIcon } from './components/Icons';
import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";
import { Loader } from './components/Loader';
import * as db from './utils/db';

// Set up the PDF.js worker.
const PDF_WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;

const SESSION_KEY = 'recallReaderSession';

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

  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [view, setView] = useState<'input' | 'review'>('input');
  const [highlightText, setHighlightText] = useState<string | null>(null);
  const [targetPage, setTargetPage] = useState<number | null>(null);
  
  // Session resume state
  const [sessionChecked, setSessionChecked] = useState<boolean>(false);
  const [savedSessionData, setSavedSessionData] = useState<any | null>(null);

  const highlightTimeoutRef = useRef<number | null>(null);
  const appStateRef = useRef<any>();

  appStateRef.current = { pdfFile, view };

  const saveSession = useCallback(async () => {
    const currentState = appStateRef.current;
    if (!currentState.pdfFile || currentState.view !== 'review') {
      await db.deleteFile(SESSION_KEY);
      localStorage.removeItem(SESSION_KEY);
      return;
    }

    try {
        await db.saveFile(SESSION_KEY, currentState.pdfFile);
        const sessionData = {
            fileData: {
                name: currentState.pdfFile.name,
                type: currentState.pdfFile.type,
            },
        };
        localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
    } catch (e) {
        console.error("Could not save session:", e);
        // Clean up if saving failed
        await db.deleteFile(SESSION_KEY);
        localStorage.removeItem(SESSION_KEY);
    }
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

  const resumeSession = async () => {
    if (!savedSessionData) return;
    
    try {
        const file = await db.loadFile(SESSION_KEY);
        if (!file) {
            throw new Error("File not found in the local session database.");
        }

        setPdfFile(file);
        setView('review');
        setSavedSessionData(null); // Clear prompt after resuming
    } catch (e) {
        console.error("Failed to resume session:", e);
        setError("Could not resume the previous session. Please upload the file again.");
        await db.deleteFile(SESSION_KEY);
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
    setError('');
    setPdfFile(null);
    triggerTempHighlight(null);
    await db.deleteFile(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
    setSavedSessionData(null);

    try {
      // This app is now PDF-focused. The string path is unlikely.
      if (typeof data === 'string') {
        setError("Text input is not supported. Please upload a PDF file.");
        setView('input');
      } else {
        // Text extraction is now deferred, so we just set the file and switch views.
        // This makes the initial load feel instantaneous.
        setPdfFile(data);
        setView('review');
      }
    } catch (err) {
      console.error("Error processing document:", err);
      setError("Failed to load the document. The file might be corrupted.");
      setView('input');
    } finally {
      setIsProcessing(false);
    }
  };
  
  useEffect(() => {
    if (view === 'review' && pdfFile) {
      saveSession();
    }
  }, [view, pdfFile, saveSession]);

  const handleReset = async () => {
    setPdfFile(null);
    setError('');
    setView('input');
    triggerTempHighlight(null);
    setSavedSessionData(null);
    await db.deleteFile(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
  };
  
  const handleLoadError = async (message: string) => {
    setError(message);
    setPdfFile(null);
    setView('input');
    setSavedSessionData(null);
    await db.deleteFile(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
  };

  if (view === 'review' && pdfFile) {
    return (
        <PdfViewer 
            file={pdfFile} 
            highlightText={highlightText} 
            targetPage={targetPage}
            onPageNavigated={() => setTargetPage(null)}
            setHighlightAndNavigate={handleHighlightAndNavigate}
            onReset={handleReset}
            onLoadError={handleLoadError}
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
                onClearSavedSession={async () => {
                    await db.deleteFile(SESSION_KEY);
                    localStorage.removeItem(SESSION_KEY);
                    setSavedSessionData(null);
                }}
              />
            </div>
          )}
          {isProcessing && (
             <div className="text-center p-8 h-full flex flex-col justify-center items-center">
                <Loader />
                <p className="mt-4 text-slate-600 font-semibold">Loading Document...</p>
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