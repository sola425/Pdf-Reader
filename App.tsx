import React, { useState } from 'react';
import { DocumentInput } from './components/DocumentInput';
import { VoiceReviewer } from './components/VoiceReviewer';
import { PdfViewer } from './components/PdfViewer';
import { LogoIcon } from './components/Icons';
import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";
import { Loader } from './components/Loader';

// Set up the PDF.js worker.
pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

export default function App() {
  const [documentText, setDocumentText] = useState<string>('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [view, setView] = useState<'input' | 'review'>('input');

  const handleDocumentSubmit = async (data: string | File) => {
    setIsProcessing(true);
    setError('');
    setDocumentText('');
    setPdfFile(null);

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
          fullText += pageText + '\n\n';
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
  };

  const renderReviewView = () => {
     if (!documentText && !pdfFile) return null;

     if (pdfFile) {
        return (
            <div className="rounded-xl shadow-md border border-gray-200 h-full overflow-hidden">
                <PdfViewer file={pdfFile} />
            </div>
        );
     }
     
     return (
        <div className="bg-white p-6 rounded-xl shadow-md border border-gray-200 h-full flex flex-col">
            <h2 className="text-xl font-bold mb-4 text-slate-800 border-b pb-2 flex-shrink-0">Document Content</h2>
            <div className="prose prose-slate max-w-none flex-1 overflow-y-auto pr-2">
                <p className="whitespace-pre-wrap">{documentText}</p>
            </div>
        </div>
     );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="w-full max-w-7xl mx-auto flex items-center justify-between my-6 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <LogoIcon className="h-10 w-10 text-indigo-600" />
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            Comprehension Reviewer
          </h1>
        </div>
        {view === 'review' && (
          <button
            onClick={handleReset}
            className="px-4 py-2 text-sm font-semibold text-indigo-600 bg-indigo-100 rounded-lg hover:bg-indigo-200 transition-colors"
          >
            Start Over
          </button>
        )}
      </header>
      
      <main className="w-full max-w-7xl mx-auto flex-1 px-4 sm:px-6 lg:px-8 pb-24 flex flex-col">
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
          {view === 'review' && !isProcessing && renderReviewView()}
          {error && view === 'input' && (
             <p className="mt-4 text-center text-red-600 bg-red-50 p-3 rounded-md">{error}</p>
          )}
        </div>
      </main>

      {view === 'review' && !isProcessing && documentText && (
          <VoiceReviewer documentText={documentText} />
      )}
    </div>
  );
}