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
  
  const renderMarkdown = (text: string) => {
    const elements: React.ReactNode[] = [];
    let listItems: React.ReactNode[] = [];
    const lines = text.split('\n');

    const flushList = () => {
        if (listItems.length > 0) {
            elements.push(<ul key={`ul-${elements.length}`} className="list-disc pl-5 space-y-1">{listItems}</ul>);
            listItems = [];
        }
    };

    const parseLine = (line: string, key: any) => {
        const parts = line.split(/(\*\*.*?\*\*)/g).filter(Boolean);
        return <>{parts.map((part, i) => part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part)}</>;
    };

    lines.forEach((line, index) => {
        if (line.trim().startsWith('* ') || line.trim().startsWith('- ')) {
            const content = line.trim().substring(2);
            listItems.push(<li key={index}>{parseLine(content, index)}</li>);
        } else {
            flushList();
            if (line.trim()) {
                elements.push(<p key={index}>{parseLine(line, index)}</p>);
            }
        }
    });

    flushList(); // Add any remaining list items
    return elements;
  };


  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/50 animate-fade-in" role="dialog" aria-modal="true" aria-labelledby="summary-title">
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl h-auto max-h-[80vh] flex flex-col">
            <header className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2">
                    <SparklesIcon className="w-6 h-6 text-indigo-500" />
                    <h2 id="summary-title" className="text-lg font-bold text-slate-800 dark:text-slate-100">
                        AI Summary of Pages {startPage} - {endPage}
                    </h2>
                </div>
                <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700" aria-label="Close summary">
                    <XIcon className="w-6 h-6 text-slate-600" />
                </button>
            </header>
            <div className="flex-1 p-6 overflow-y-auto">
                {isLoading && (
                    <div className="text-center">
                        <Loader />
                        <p className="mt-4 text-slate-600 dark:text-slate-400">Generating summary...</p>
                    </div>
                )}
                {error && (
                    <div className="p-3 text-red-800 bg-red-100 dark:bg-red-200 border border-red-200 rounded-lg flex items-center gap-2">
                        <XCircleIcon className="w-5 h-5 flex-shrink-0" />
                        <span>Error: {error}</span>
                    </div>
                )}
                {summary && (
                    <div className="text-sm text-slate-700 dark:text-slate-300 space-y-3">
                        {renderMarkdown(summary)}
                    </div>
                )}
            </div>
             <footer className="p-4 border-t border-slate-200 dark:border-slate-700 flex-shrink-0 text-right">
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