
import React, { useState, useEffect, useCallback } from 'react';
import { Part } from '@google/genai';
import { getSummary } from '../services/geminiService';
import * as db from '../utils/db';
import { Loader } from './Loader';
import { XIcon, SparklesIcon, XCircleIcon } from './Icons';
import { ProcessedPageData } from '../types';

interface SummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  documentId: string;
  startPage: number;
  endPage: number;
}

export function SummaryModal({ isOpen, onClose, documentId, startPage, endPage }: SummaryModalProps) {
  const [summary, setSummary] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const generateSummary = useCallback(async () => {
    if (!documentId) return;
    setIsLoading(true);
    setError('');
    setSummary('');

    try {
        const allPagesData = await db.loadProcessedData(documentId);
        if (!allPagesData) throw new Error("Could not load document data.");

        const start = Math.max(1, Math.min(startPage, endPage));
        const end = Math.min(allPagesData.length, Math.max(startPage, endPage));
        
        const relevantPages = allPagesData.filter(p => p.pageNum >= start && p.pageNum <= end);
        if (relevantPages.length === 0) throw new Error("No content found for the selected pages.");
        
        const contextParts: Part[] = relevantPages.flatMap((page: ProcessedPageData) => [
            { text: `\n\n--- PAGE ${page.pageNum} ---\n` },
            { inlineData: { mimeType: 'image/jpeg', data: page.image } },
            ...(page.text ? [{ text: page.text }] : [])
        ]);

        const result = await getSummary(contextParts);
        setSummary(result);
    } catch (e) {
        console.error("Failed to generate summary:", e);
        setError(e instanceof Error ? e.message : "An unknown error occurred.");
    } finally {
        setIsLoading(false);
    }
  }, [documentId, startPage, endPage]);
  
  useEffect(() => {
      if (isOpen) {
          generateSummary();
      }
  }, [isOpen, generateSummary]);

  if (!isOpen) return null;
  
  // Basic markdown renderer
  const renderMarkdown = (text: string) => {
    return text.split('\n').map((line, index) => {
      if (line.startsWith('* ')) {
        return <li key={index} className="ml-4 list-disc">{line.substring(2)}</li>;
      }
      if (line.match(/^\d+\./)) {
        return <li key={index} className="ml-4 list-decimal">{line.replace(/^\d+\.\s*/, '')}</li>;
      }
      return <p key={index}>{line}</p>;
    });
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/50 animate-fade-in" role="dialog" aria-modal="true" aria-labelledby="summary-title">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl h-auto max-h-[80vh] flex flex-col">
            <header className="p-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2">
                    <SparklesIcon className="w-6 h-6 text-indigo-500" />
                    <h2 id="summary-title" className="text-lg font-bold text-slate-800">
                        AI Summary of Pages {startPage} - {endPage}
                    </h2>
                </div>
                <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-200" aria-label="Close summary">
                    <XIcon className="w-6 h-6 text-slate-600" />
                </button>
            </header>
            <div className="flex-1 p-6 overflow-y-auto">
                {isLoading && (
                    <div className="text-center">
                        <Loader />
                        <p className="mt-4 text-slate-600">Generating summary...</p>
                    </div>
                )}
                {error && (
                    <div className="p-3 text-red-800 bg-red-100 border border-red-200 rounded-lg flex items-center gap-2">
                        <XCircleIcon className="w-5 h-5 flex-shrink-0" />
                        <span>Error: {error}</span>
                    </div>
                )}
                {summary && (
                    <div className="prose prose-sm max-w-none">
                        {renderMarkdown(summary)}
                    </div>
                )}
            </div>
             <footer className="p-4 border-t border-slate-200 flex-shrink-0 text-right">
                <button 
                    onClick={onClose} 
                    className="px-4 py-2 bg-slate-600 text-white font-semibold rounded-md hover:bg-slate-700"
                >
                    Close
                </button>
            </footer>
        </div>
    </div>
  );
}
