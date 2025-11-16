



import React, { useState, useEffect, useCallback, useRef } from 'react';
import { PdfViewer } from './components/PdfViewer';
import { XCircleIcon } from './components/Icons';
import * as db from './utils/db';
import { Document, ProcessedPageData } from './types';
import { Dashboard } from './components/Dashboard';
import { Loader } from './components/Loader';
import { ErrorBoundary } from './components/ErrorBoundary';

// FIX: Embed worker code to avoid CORS issues when loading from a different origin.
// This code is a plain JavaScript version of the PdfProcessingWorker.ts file.
// UPDATED: Worker now batches page data to reduce message frequency.
// UPDATED: Switched to jsdelivr CDN for PDF.js for better reliability.
const PDF_WORKER_CODE = `
import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs";

const post = (message) => {
  self.postMessage(message);
};

const BATCH_SIZE = 5;

self.onmessage = async (event) => {
  if (event.data.type === 'process') {
    const file = event.data.file;
    const docId = event.data.docId;

    try {
      const fileBuffer = await file.arrayBuffer();
      const typedarray = new Uint8Array(fileBuffer);
      const doc = await pdfjsLib.getDocument({ data: typedarray }).promise;
      const numPages = doc.numPages;

      post({ type: 'total_pages', docId, total: numPages });

      let pageDataBatch = [];

      for (let i = 1; i <= numPages; i++) {
        const page = await doc.getPage(i);
        
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item) => item.str).join(' ').trim();
        
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = new OffscreenCanvas(viewport.width, viewport.height);
        const context = canvas.getContext('2d');
        
        if (!context) {
          post({ type: 'error', docId, message: 'Could not get canvas context for page ' + i });
          return;
        }

        await page.render({ canvasContext: context, viewport }).promise;
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
        
        const blobBuffer = await blob.arrayBuffer();
        const uint8Array = new Uint8Array(blobBuffer);
        let binary = '';
        for (let j = 0; j < uint8Array.byteLength; j++) {
          binary += String.fromCharCode(uint8Array[j]);
        }
        const base64Data = btoa(binary);

        pageDataBatch.push({
          pageNum: i,
          text: pageText,
          image: base64Data
        });
        
        // Post batch if it's full or if it's the last page
        if (pageDataBatch.length >= BATCH_SIZE || i === numPages) {
          post({ type: 'page_batch_complete', docId, data: pageDataBatch });
          pageDataBatch = [];
        }
      }

      post({ type: 'all_complete', docId });

    } catch (err) {
      post({ type: 'error', docId, message: 'PDF Processing Error: ' + err.message });
    }
  }
};
`;


type ProcessingState = {
  status: 'idle' | 'processing' | 'error' | 'success';
  docId: string | null;
  progress: number;
  total: number;
  message: string;
};

type Theme = 'light' | 'dark';

export default function App() {
  // FIX: All hook calls (useState, useEffect, etc.) must be at the top level of the component,
  // before any conditional returns. This resolves a "Rules of Hooks" violation.
  const [documents, setDocuments] = useState<Document[]>([]);
  const [currentDocument, setCurrentDocument] = useState<Document | null>(null);
  const [view, setView] = useState<'loading' | 'dashboard' | 'viewer'>('loading');
  const [theme, setTheme] = useState<Theme>('light');
  const [processingState, setProcessingState] = useState<ProcessingState>({
    status: 'idle',
    docId: null,
    progress: 0,
    total: 0,
    message: ''
  });
  const workerRef = useRef<Worker | null>(null);
  
   useEffect(() => {
    const storedTheme = localStorage.getItem('theme') as Theme | null;
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialTheme = storedTheme || (prefersDark ? 'dark' : 'light');
    setTheme(initialTheme);
  }, []);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);
  
  const refreshDocuments = useCallback(async () => {
      try {
        const docs = await db.getAllDocuments();
        setDocuments(docs);
      } catch (e) {
        console.error("Failed to refresh documents from DB", e);
      }
  }, []);

  useEffect(() => {
    async function loadDocs() {
      try {
        await refreshDocuments();
      } catch (e) {
        console.error("Failed to load documents from DB", e);
      } finally {
        setView('dashboard');
      }
    }
    loadDocs();
  }, [refreshDocuments]);

  useEffect(() => {
    let worker: Worker | null = null;
    let workerUrl: string | null = null;
    try {
        const blob = new Blob([PDF_WORKER_CODE], { type: 'application/javascript' });
        workerUrl = URL.createObjectURL(blob);
        worker = new Worker(workerUrl, { type: 'module' });
        workerRef.current = worker;

        worker.onmessage = async (event: MessageEvent<{ type: string; docId: string; data?: any; total?: number; message?: string }>) => {
            const { type, docId, data, total, message } = event.data;
            
            if (type === 'total_pages') {
                const doc = await db.getDocument(docId);
                if (doc) {
                    doc.totalPages = total;
                    await db.updateDocument(doc);
                    await refreshDocuments();
                    setProcessingState({ status: 'processing', docId, progress: 0, total: total!, message: `Processing page 1 of ${total}...` });
                }
            } else if (type === 'page_batch_complete') {
                const pageBatch = data as ProcessedPageData[];
                if (pageBatch.length === 0) return;

                await db.appendProcessedPages(docId, pageBatch);
                const doc = await db.getDocument(docId);
                if (doc) {
                    doc.processedPages = (doc.processedPages || 0) + pageBatch.length;
                    await db.updateDocument(doc);
                }
                const latestPageNum = pageBatch[pageBatch.length - 1].pageNum;
                setProcessingState(prev => ({ ...prev, progress: latestPageNum, message: `Processing page ${latestPageNum + 1} of ${prev.total}...` }));
                // Refresh documents less frequently to avoid UI churn
                if (latestPageNum % 10 === 0 || latestPageNum === total) {
                    await refreshDocuments();
                }

            } else if (type === 'all_complete') {
                const doc = await db.getDocument(docId);
                if (doc) {
                    doc.processingStatus = 'completed';
                    await db.updateDocument(doc);
                    setProcessingState({ status: 'success', docId, progress: doc.totalPages!, total: doc.totalPages!, message: 'Processing complete!' });
                    setCurrentDocument(doc);
                    setView('viewer');
                }
                await refreshDocuments();
            } else if (type === 'error') {
                const doc = await db.getDocument(docId);
                if (doc) {
                    doc.processingStatus = 'failed';
                    await db.updateDocument(doc);
                }
                setProcessingState({ status: 'error', docId, progress: 0, total: 0, message: message || 'An unknown worker error occurred.' });
                await refreshDocuments();
            }
        };
        worker.onerror = (err) => {
            console.error("Worker error:", err);
            setProcessingState({ status: 'error', docId: null, progress: 0, total: 0, message: `A background processor error occurred: ${err.message}` });
        };
    } catch (err: any) {
        console.error("Failed to create worker:", err);
        setProcessingState({ status: 'error', docId: null, progress: 0, total: 0, message: 'Could not start the document processor.' });
    }

    return () => {
      workerRef.current?.terminate();
      if (workerUrl) URL.revokeObjectURL(workerUrl);
    };
  }, [refreshDocuments]);

  // After all hooks are declared, we can safely perform conditional checks and return early.
  // FIX: Made the API key check more robust. The previous check (`!process`) could cause a `ReferenceError` if the `process` object is not defined at all. This new check safely handles cases where `process` is undeclared, null, or missing its `env` property, preventing a fatal startup crash.
  if (typeof process === 'undefined' || !process || !process.env || !process.env.API_KEY) {
    return (
      <div className="min-h-screen bg-red-50 flex flex-col items-center justify-center p-4">
        <div className="bg-white p-8 rounded-xl shadow-lg border border-red-200 text-center max-w-lg">
          <XCircleIcon className="mx-auto h-12 w-12 text-red-400" />
          <h1 className="mt-4 text-2xl font-bold text-slate-900">Application Not Configured</h1>
          <p className="mt-2 text-md text-slate-600">
            This application requires a Gemini API key to function. The API key is missing from the environment configuration.
          </p>
        </div>
      </div>
    );
  }

  const toggleTheme = useCallback(() => {
    setTheme(prevTheme => prevTheme === 'light' ? 'dark' : 'light');
  }, []);

  const handleFileSelect = async (file: File) => {
      const newDoc = await db.addDocument(file);
      await refreshDocuments();
      
      if (file.type === 'application/pdf') {
          setProcessingState({ status: 'processing', docId: newDoc.id, progress: 0, total: 0, message: 'Preparing to process...' });
          workerRef.current?.postMessage({ type: 'process', file: file, docId: newDoc.id });
      } else if (file.type.startsWith('image/')) {
          setProcessingState({ status: 'processing', docId: newDoc.id, progress: 0, total: 1, message: 'Processing image...' });
          try {
              const reader = new FileReader();
              reader.onload = async (e) => {
                  const base64Data = (e.target?.result as string).split(',')[1];
                  const processedData: ProcessedPageData[] = [{ pageNum: 1, text: '', image: base64Data }];
                  await db.saveProcessedData(newDoc.id, processedData);
                  const freshDoc = await db.getDocument(newDoc.id);
                  if (freshDoc) {
                    freshDoc.processingStatus = 'completed';
                    freshDoc.processedPages = 1;
                    freshDoc.totalPages = 1;
                    await db.updateDocument(freshDoc);
                    setProcessingState({ status: 'success', docId: newDoc.id, progress: 1, total: 1, message: 'Image processed!' });
                    setCurrentDocument(freshDoc);
                    setView('viewer');
                  }
                  await refreshDocuments();
              };
              reader.onerror = () => { throw new Error("Could not read image file."); }
              reader.readAsDataURL(file);
          } catch(e) {
               console.error(e);
               const doc = await db.getDocument(newDoc.id);
               if(doc) {
                 doc.processingStatus = 'failed';
                 await db.updateDocument(doc);
               }
               setProcessingState({ status: 'error', docId: newDoc.id, progress: 0, total: 0, message: 'Failed to process the image.' });
               await refreshDocuments();
          }
      }
  };

  const handleDocumentSelect = async (doc: Document) => {
    if (doc.processingStatus !== 'completed') {
        // Optionally, add logic here to resume processing.
        // For now, we'll just prevent opening it.
        alert("This document is still processing or has failed. Please wait or try re-uploading.");
        return;
    }
    const updatedDoc = { ...doc, lastOpenedAt: new Date() };
    await db.updateDocument(updatedDoc);
    setCurrentDocument(updatedDoc);
    setView('viewer');
    refreshDocuments();
  };

  const handleBackToDashboard = useCallback(() => {
    setCurrentDocument(null);
    setView('dashboard');
    setProcessingState({ status: 'idle', docId: null, progress: 0, total: 0, message: '' });
  }, []);
  
  const handleDeleteDocument = async (docId: string) => {
    try {
        await db.deleteDocument(docId);
        await refreshDocuments();
    } catch(e) {
        console.error("Failed to delete document", e);
    }
  };

  const handleLoadError = useCallback((message: string) => {
    setProcessingState({ status: 'error', docId: currentDocument?.id || null, progress: 0, total: 0, message });
    setCurrentDocument(null);
    setView('dashboard');
  }, [currentDocument]);
  
  if (view === 'loading') {
    return <div className="min-h-screen bg-[var(--rr-bg-primary)] flex flex-col items-center justify-center"><Loader /></div>;
  }
  
  return (
    <div key={view} className="animate-fade-in">
    {view === 'viewer' && currentDocument ? (
        <ErrorBoundary>
            <PdfViewer 
                key={currentDocument.id}
                document={currentDocument} 
                onReset={handleBackToDashboard}
                onLoadError={handleLoadError}
                theme={theme}
                toggleTheme={toggleTheme}
            />
        </ErrorBoundary>
    ) : (
        <ErrorBoundary>
            <Dashboard 
                documents={documents}
                onDocumentSelect={handleDocumentSelect}
                onFileSelect={handleFileSelect}
                onDeleteDocument={handleDeleteDocument}
                processingState={processingState}
                theme={theme}
                toggleTheme={toggleTheme}
            />
        </ErrorBoundary>
    )}
    </div>
  );
}