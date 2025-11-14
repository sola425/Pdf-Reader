
import React, { useState } from 'react';
import { Document } from '../types';
import { LogoIcon, CameraIcon, TrashIcon, BookOpenIcon, XCircleIcon } from './Icons';
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

interface DocumentLibraryProps {
    documents: Document[];
    onDocumentSelect: (doc: Document) => void;
    onFileSelect: (file: File) => void;
    onDeleteDocument: (docId: string) => void;
    processingState: ProcessingState;
}

const DocumentCard = React.memo(({ doc, onSelect, onDelete, isProcessing }: { doc: Document, onSelect: () => void, onDelete: (e: React.MouseEvent) => void, isProcessing: boolean }) => {
    return (
        <div className="group relative aspect-[3/4] bg-slate-100 rounded-lg shadow-sm border border-slate-200 overflow-hidden">
            <button onClick={onSelect} disabled={isProcessing} className="w-full h-full text-left p-4 flex flex-col justify-between hover:bg-slate-200 transition-colors disabled:cursor-wait">
                <div className="flex-shrink-0">
                    <BookOpenIcon className="w-12 h-12 text-blue-500" />
                </div>
                <div className="flex-1 min-h-0 mt-4">
                    <h3 className="font-bold text-slate-800 break-words line-clamp-3">{doc.name}</h3>
                </div>
                <p className="text-xs text-slate-500 mt-2 flex-shrink-0">{doc.createdAt.toLocaleDateString()}</p>
            </button>
            <button 
                onClick={onDelete} 
                disabled={isProcessing}
                className="absolute top-2 right-2 p-2 bg-white/50 rounded-full text-slate-600 hover:bg-red-500 hover:text-white opacity-0 group-hover:opacity-100 transition-all disabled:opacity-0"
                aria-label={`Delete ${doc.name}`}
            >
                <TrashIcon className="w-5 h-5" />
            </button>
        </div>
    );
});

export function DocumentLibrary({ documents, onDocumentSelect, onFileSelect, onDeleteDocument, processingState }: DocumentLibraryProps) {
    const [view, setView] = useState<'library' | 'upload' | 'scan'>('library');

    const handleFileSelect = (file: File) => {
        onFileSelect(file);
        setView('library');
    };

    const isProcessing = processingState.status === 'processing';
    
    return (
        <div className="min-h-screen bg-slate-50 flex flex-col">
            <header className="w-full bg-white/80 backdrop-blur-sm border-b border-slate-200/80 sticky top-0 z-20">
                <div className="w-full max-w-7xl mx-auto flex items-center justify-between py-3 px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center gap-3">
                        <LogoIcon className="h-10 w-10" />
                        <h1 className="text-2xl sm:text-3xl font-extrabold text-blue-600 tracking-tight">RecallReader</h1>
                    </div>
                     <a href="mailto:feedback@recallreader.app" className="text-sm font-semibold text-slate-600 hover:text-blue-600 hidden sm:block">Feedback</a>
                </div>
            </header>

            <main className="w-full max-w-7xl mx-auto flex-1 px-4 sm:px-6 lg:px-8 py-8">
                {view === 'library' && (
                    <>
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
                            <div>
                                <h2 className="text-3xl font-extrabold tracking-tight text-slate-900">Your Library</h2>
                                <p className="mt-1 text-slate-600">Select a document to review, or add a new one.</p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                                <button onClick={() => setView('scan')} className="px-4 py-2 bg-white border border-slate-300 text-slate-700 font-semibold rounded-md hover:bg-slate-100 transition-colors flex items-center gap-2 text-sm sm:text-base">
                                    <CameraIcon className="w-5 h-5" /> Scan
                                </button>
                                <button onClick={() => setView('upload')} className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-md hover:bg-blue-700 transition-colors flex items-center gap-2 text-sm sm:text-base">
                                    + Add New
                                </button>
                            </div>
                        </div>

                        {isProcessing && (
                             <div className="text-center p-4 bg-blue-50 border border-blue-200 rounded-lg mb-6">
                                <Loader />
                                <p className="mt-2 text-blue-800 font-semibold text-base">{processingState.message}</p>
                             </div>
                        )}
                        {processingState.status === 'error' && (
                           <div className="p-3 mb-6 text-red-800 bg-red-100 border border-red-200 rounded-lg flex items-center gap-2">
                               <XCircleIcon className="w-5 h-5 flex-shrink-0" />
                               <span>{processingState.message}</span>
                           </div>
                        )}
                        
                        {documents.length === 0 && !isProcessing ? (
                            <div className="text-center py-16 border-2 border-dashed border-slate-300 rounded-lg">
                                <BookOpenIcon className="mx-auto h-16 w-16 text-slate-400" />
                                <h3 className="mt-4 text-xl font-semibold text-slate-800">Your library is empty</h3>
                                <p className="mt-1 text-slate-500">Upload or scan your first document to get started.</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                                {documents.map(doc => (
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
                    </>
                )}

                {view === 'upload' && (
                    <div className="max-w-xl mx-auto">
                        <button onClick={() => setView('library')} className="mb-4 font-semibold text-slate-600 hover:text-slate-900">&larr; Back to Library</button>
                        <h2 className="text-2xl font-bold text-center mb-4">Upload New Document</h2>
                        <DocumentInput onFileSelect={handleFileSelect} />
                    </div>
                )}
                
                {view === 'scan' && (
                     <div className="max-w-xl mx-auto">
                        <button onClick={() => setView('library')} className="mb-4 font-semibold text-slate-600 hover:text-slate-900">&larr; Back to Library</button>
                         <ScanDocument onFileScan={handleFileSelect} />
                     </div>
                )}
            </main>
        </div>
    );
}
