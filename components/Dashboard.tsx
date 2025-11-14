import React, { useState } from 'react';
import { Document } from '../types';
import { LogoIcon, CameraIcon, TrashIcon, BookOpenIcon, XCircleIcon, SunIcon, MoonIcon, PlusIcon } from './Icons';
import { DocumentInput } from './DocumentInput';
import { ScanDocument } from './ScanDocument';
import { Loader } from './Loader';

interface ProcessingState {
  status: 'idle' | 'processing' | 'error' | 'success';
  docId: string | null;
  progress: number;
  total: number;
  message: string;
}

interface DashboardProps {
    documents: Document[];
    onDocumentSelect: (doc: Document) => void;
    onFileSelect: (file: File) => void;
    onDeleteDocument: (docId: string) => void;
    processingState: ProcessingState;
    theme: 'light' | 'dark';
    toggleTheme: () => void;
}

const DocumentCard = React.memo(({ doc, onSelect, onDelete, isProcessing }: { doc: Document, onSelect: () => void, onDelete: (e: React.MouseEvent) => void, isProcessing: boolean }) => {
    return (
        <div className="group relative aspect-[3/4] bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden transition-all duration-300 hover:shadow-lg hover:-translate-y-1">
            <button onClick={onSelect} disabled={isProcessing} className="w-full h-full text-left p-4 flex flex-col justify-between disabled:cursor-wait">
                <div className="flex-shrink-0">
                    <BookOpenIcon className="w-12 h-12 text-blue-500" />
                </div>
                <div className="flex-1 min-h-0 mt-4">
                    <h3 className="font-bold text-slate-800 dark:text-slate-100 break-words line-clamp-3">{doc.name}</h3>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 flex-shrink-0">{doc.createdAt.toLocaleDateString()}</p>
            </button>
            <button 
                onClick={onDelete} 
                disabled={isProcessing}
                className="absolute top-2 right-2 p-2 bg-white/50 dark:bg-slate-700/50 rounded-full text-slate-600 dark:text-slate-300 hover:bg-red-500 hover:text-white dark:hover:bg-red-500 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-0"
                aria-label={`Delete ${doc.name}`}
            >
                <TrashIcon className="w-5 h-5" />
            </button>
        </div>
    );
});

export function Dashboard({ documents, onDocumentSelect, onFileSelect, onDeleteDocument, processingState, theme, toggleTheme }: DashboardProps) {
    const [view, setView] = useState<'dashboard' | 'upload' | 'scan'>('dashboard');

    const handleFileSelect = (file: File) => {
        onFileSelect(file);
        setView('dashboard');
    };

    const isProcessing = processingState.status === 'processing';
    const recentDocuments = documents.sort((a, b) => b.lastOpenedAt.getTime() - a.lastOpenedAt.getTime()).slice(0, 5);

    if (view === 'upload' || view === 'scan') {
        return (
            <div className="min-h-screen bg-slate-100 dark:bg-slate-900 flex items-center justify-center p-4">
                <div className="w-full max-w-2xl">
                     <div className="max-w-xl mx-auto">
                        <button onClick={() => setView('dashboard')} className="mb-6 font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                               <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
                            </svg>
                            Back to Dashboard
                        </button>
                        <div className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-2xl shadow-lg">
                           <h2 className="text-2xl font-bold text-center mb-6 text-slate-900 dark:text-slate-100">{view === 'upload' ? 'Upload New Document' : 'Scan a Document'}</h2>
                           {view === 'upload' && <DocumentInput onFileSelect={handleFileSelect} />}
                           {view === 'scan' && <ScanDocument onFileScan={handleFileSelect} />}
                        </div>
                    </div>
                </div>
            </div>
        )
    }
    
    return (
        <div className="min-h-screen bg-slate-100 dark:bg-slate-900 text-slate-800 dark:text-slate-200">
            <header className="w-full bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border-b border-slate-200/80 dark:border-slate-700/80 sticky top-0 z-20">
                <div className="w-full max-w-screen-xl mx-auto flex items-center justify-between py-3 px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center gap-3">
                        <LogoIcon className="h-10 w-10" />
                        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight brand-gradient">RecallReader</h1>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={toggleTheme} className="p-2 rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700" aria-label="Toggle theme">
                           {theme === 'light' ? <MoonIcon className="w-6 h-6" /> : <SunIcon className="w-6 h-6" />}
                        </button>
                    </div>
                </div>
            </header>

            <main className="w-full max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
                 <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
                    <div>
                        <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white">Dashboard</h2>
                        <p className="mt-2 text-slate-600 dark:text-slate-400">Welcome back! Let's get learning.</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                        <button onClick={() => setView('scan')} className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 font-semibold rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center gap-2 text-sm sm:text-base shadow-sm">
                            <CameraIcon className="w-5 h-5" /> Scan
                        </button>
                        <button onClick={() => setView('upload')} className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 text-sm sm:text-base shadow-sm">
                            <PlusIcon className="w-5 h-5" /> Add New
                        </button>
                    </div>
                </div>

                {isProcessing && (
                     <div className="text-center p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg mb-6">
                        <Loader />
                        <p className="mt-2 text-blue-800 dark:text-blue-200 font-semibold text-base">{processingState.message}</p>
                     </div>
                )}
                {processingState.status === 'error' && (
                   <div className="p-3 mb-6 text-red-800 dark:text-red-200 bg-red-100 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg flex items-center gap-2">
                       <XCircleIcon className="w-5 h-5 flex-shrink-0" />
                       <span>{processingState.message}</span>
                   </div>
                )}
                
                {documents.length > 0 && (
                  <section className="mb-12">
                    <h3 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white mb-4">Continue Reading</h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                      {recentDocuments.map(doc => (
                          <DocumentCard key={doc.id} doc={doc} onSelect={() => onDocumentSelect(doc)} onDelete={(e) => { e.stopPropagation(); onDeleteDocument(doc.id); }} isProcessing={isProcessing && processingState.docId === doc.id} />
                      ))}
                    </div>
                  </section>
                )}

                <section>
                    <h3 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white mb-4">All Documents</h3>
                     {documents.length === 0 && !isProcessing ? (
                        <div className="text-center py-16 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800/50">
                            <BookOpenIcon className="mx-auto h-16 w-16 text-slate-400 dark:text-slate-500" />
                            <h3 className="mt-4 text-xl font-semibold text-slate-800 dark:text-slate-100">Your library is empty</h3>
                            <p className="mt-1 text-slate-500 dark:text-slate-400">Upload or scan your first document to get started.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                            {documents.sort((a,b) => b.createdAt.getTime() - a.createdAt.getTime()).map(doc => (
                                <DocumentCard 
                                    key={doc.id} 
                                    doc={doc} 
                                    onSelect={() => onDocumentSelect(doc)} 
                                    onDelete={(e) => { e.stopPropagation(); onDeleteDocument(doc.id); }}
                                    isProcessing={isProcessing && processingState.docId === doc.id}
                                />
                            ))}
                        </div>
                    )}
                </section>
            </main>
        </div>
    );
}