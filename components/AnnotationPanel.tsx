import React, { useMemo } from 'react';
import { Annotation } from '../types';
import { HighlighterIcon, XIcon, TrashIcon } from './Icons';

interface AnnotationPanelProps {
  annotations: Annotation[];
  onAnnotationSelect: (annotation: Annotation) => void;
  onAnnotationDelete: (id: string) => void;
  onClose?: () => void;
}

export function AnnotationPanel({ annotations, onAnnotationSelect, onAnnotationDelete, onClose }: AnnotationPanelProps) {
  
  const annotationsByPage = useMemo(() => {
    return annotations.reduce((acc, anno) => {
      if (!acc[anno.pageNum]) {
        acc[anno.pageNum] = [];
      }
      acc[anno.pageNum].push(anno);
      return acc;
    }, {} as Record<number, Annotation[]>);
  }, [annotations]);

  const sortedPageNumbers = Object.keys(annotationsByPage).map(Number).sort((a, b) => a - b);

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200">
      <header className="flex-shrink-0 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HighlighterIcon className="w-7 h-7 text-indigo-600 dark:text-indigo-400" />
          <h3 className="text-lg font-bold">Annotations</h3>
        </div>
        {onClose && (
          <button onClick={onClose} className="p-1 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700">
            <XIcon className="w-5 h-5 text-slate-600 dark:text-slate-300" />
          </button>
        )}
      </header>
      
      <div className="flex-1 overflow-y-auto">
        {annotations.length === 0 ? (
          <div className="text-center p-8 h-full flex flex-col items-center justify-center">
            <HighlighterIcon className="w-16 h-16 text-slate-400 dark:text-slate-500" />
            <p className="mt-4 font-semibold">No Highlights Yet</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">Select text in the document to create your first highlight.</p>
          </div>
        ) : (
          <div className="p-2 space-y-4">
            {sortedPageNumbers.map(pageNum => (
              <div key={pageNum}>
                <h4 className="font-bold text-sm text-slate-500 dark:text-slate-400 px-2 pb-1 border-b border-slate-200 dark:border-slate-700">Page {pageNum}</h4>
                <div className="mt-2 space-y-1">
                  {annotationsByPage[pageNum].map(anno => (
                    <div key={anno.id} className="group relative">
                        <button onClick={() => onAnnotationSelect(anno)} className="w-full text-left p-2 rounded-md hover:bg-slate-200/50 dark:hover:bg-slate-800/50 transition-colors">
                            <p className="text-sm italic text-slate-600 dark:text-slate-300 line-clamp-3">"{anno.content}"</p>
                        </button>
                         <button 
                            onClick={(e) => { e.stopPropagation(); onAnnotationDelete(anno.id); }} 
                            className="absolute top-1 right-1 p-1.5 bg-slate-200/50 dark:bg-slate-700/50 rounded-full text-slate-500 dark:text-slate-400 hover:bg-red-500 hover:text-white dark:hover:bg-red-500 opacity-0 group-hover:opacity-100 transition-all transform active:scale-90"
                            aria-label={`Delete highlight`}
                        >
                            <TrashIcon className="w-4 h-4" />
                        </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
