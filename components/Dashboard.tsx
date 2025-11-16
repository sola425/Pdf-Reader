import React, { useState } from 'react';
import { Document } from '../types';
import { LogoIcon, CameraIcon, TrashIcon, BookOpenIcon, XCircleIcon, SunIcon, MoonIcon, PlusIcon, XIcon, SparklesIcon } from './Icons';
import { DocumentInput } from './DocumentInput';
import { ScanDocument } from './ScanDocument';

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

const DocumentCard = React.memo(({ doc, onSelect, onDelete }: { doc: Document, onSelect: () => void, onDelete: (e: React.MouseEvent) => void }) => {
    const isProcessing = doc.processingStatus === 'processing';
    const hasFailed = doc.processingStatus === 'failed';
    const progress = (doc.totalPages && doc.processedPages) ? (doc.processedPages / doc.totalPages) * 100 : 0;
    
    return (
        <div className="group relative">
             <button 
                onClick={onSelect} 
                disabled={isProcessing} 
                className="w-full aspect-[3/4] bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden transition-all duration-300 hover:shadow-xl hover:-translate-y-1.5 text-left p-4 flex flex-col justify-between disabled:cursor-wait"
            >
                <div className="flex-shrink-0">
                    <BookOpenIcon className={`w-12 h-12 ${hasFailed ? 'text-red-500' : 'text-blue-500'}`} />
                </div>
                <div className="flex-1 min-h-0 mt-4">
                    <h3 className="font-bold text-slate-800 dark:text-slate-100 break-words line-clamp-3">{doc.name}</h3>
                </div>
                <div>
                  {isProcessing && (
                    <div className="mt-2">
                        <p className="text-xs font-semibold text-blue-600 dark:text-blue-400">Processing...</p>
                        <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 mt-1">
                            <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${progress}%` }}></div>
                        </div>
                    </div>
                  )}
                  {hasFailed && (
                     <p className="text-xs font-semibold text-red-600 dark:text-red-400 mt-2">Processing Failed</p>
                  )}
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 flex-shrink-0">{doc.createdAt.toLocaleDateString()}</p>
                </div>
            </button>
            <button 
                onClick={onDelete} 
                disabled={isProcessing}
                className="absolute top-2 right-2 p-2 bg-white/50 dark:bg-slate-700/50 rounded-full text-slate-600 dark:text-slate-300 hover:bg-red-500 hover:text-white dark:hover:bg-red-500 opacity-100 lg:opacity-0 group-hover:opacity-100 transition-all disabled:opacity-0 transform active:scale-90"
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

    const isOverallProcessing = processingState.status === 'processing';
    
    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200">
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
                 <section className="text-center py-8 sm:py-12">
                    <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight text-slate-900 dark:text-white">Your AI-Powered Study Space</h2>
                    <p className="mt-4 max-w-2xl mx-auto text-lg text-slate-600 dark:text-slate-400">Upload documents, practice recall with an AI coach, and master your material.</p>
                    <div className="mt-8 flex justify-center gap-4">
                        <button onClick={() => setView('upload')} className="px-6 py-3 bg-blue-600 text-white font-bold rounded-lg shadow-md hover:bg-blue-700 transition-all transform hover:scale-105 active:scale-95 flex items-center gap-2">
                            <PlusIcon className="w-6 h-6" /> Add Document
                        </button>
                         <button onClick={() => setView('scan')} className="px-6 py-3 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 font-semibold rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-all transform hover:scale-105 active:scale-95 flex items-center gap-2 shadow-sm">
                            <CameraIcon className="w-5 h-5" /> Scan
                        </button>
                    </div>
                </section>

                {isOverallProcessing && (
                     <div className="text-center p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg my-8 animate-fade-in">
                        <p className="text-blue-800 dark:text-blue-200 font-semibold text-base">A document is processing in the background.</p>
                        <p className="text-sm text-blue-700 dark:text-blue-300">Please keep this tab open for best results.</p>
                     </div>
                )}
                {processingState.status === 'error' && (
                   <div className="p-3 my-8 text-red-800 dark:text-red-200 bg-red-100 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg flex items-center gap-2 animate-fade-in">
                       <XCircleIcon className="w-5 h-5 flex-shrink-0" />
                       <span>{processingState.message}</span>
                   </div>
                )}
                
                {documents.length > 0 ? (
                  <section className="my-12">
                      <h3 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white mb-6">Your Library</h3>
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-6">
                          {documents.map(doc => (
                              <DocumentCard 
                                  key={doc.id} 
                                  doc={doc} 
                                  onSelect={() => onDocumentSelect(doc)} 
                                  onDelete={(e) => { e.stopPropagation(); onDeleteDocument(doc.id); }}
                              />
                          ))}
                      </div>
                  </section>
                ) : !isOverallProcessing ? (
                     <section className="text-center py-16 bg-slate-100 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700/50">
                        <SparklesIcon className="mx-auto h-16 w-16 text-blue-500" />
                        <h3 className="mt-4 text-2xl font-bold text-slate-800 dark:text-slate-100">Welcome to RecallReader!</h3>
                        <p className="mt-2 max-w-lg mx-auto text-slate-600 dark:text-slate-400">This is your personal library. To get started, upload your first document using the buttons above. Once processed, you can read, chat with, and test your knowledge on it.</p>
                    </section>
                ) : null}
            </main>

            {(view === 'upload' || view === 'scan') && (
                <div className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm animate-fade-in flex items-center justify-center p-4" role="dialog" aria-modal="true">
                    <div className="relative bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-2xl shadow-2xl w-full max-w-xl animate-pop-in">
                        <button onClick={() => setView('dashboard')} className="absolute top-3 right-3 p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors" aria-label="Close">
                            <XIcon className="w-6 h-6 text-slate-500 dark:text-slate-400"/>
                        </button>
                        <h2 className="text-2xl font-bold text-center mb-6 text-slate-900 dark:text-slate-100">{view === 'upload' ? 'Upload New Document' : 'Scan a Document'}</h2>
                        {view === 'upload' && <DocumentInput onFileSelect={handleFileSelect} />}
                        {view === 'scan' && <ScanDocument onFileScan={handleFileSelect} />}
                    </div>
                </div>
            )}
        </div>
    );
}
