import React, { useState } from 'react';
import { Flashcard } from '../types';
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from './Icons';

interface FlashcardViewerProps {
  flashcards: Flashcard[];
  onClose: () => void;
}

export function FlashcardViewer({ flashcards, onClose }: FlashcardViewerProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);

  const goToNext = () => {
    setIsFlipped(false);
    setTimeout(() => setCurrentIndex(prev => (prev + 1) % flashcards.length), 150);
  };

  const goToPrev = () => {
    setIsFlipped(false);
    setTimeout(() => setCurrentIndex(prev => (prev - 1 + flashcards.length) % flashcards.length), 150);
  };

  const currentCard = flashcards[currentIndex];

  return (
    <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" role="dialog" aria-modal="true">
      <div className="relative w-full max-w-lg">
        <div className="w-full aspect-video" style={{ perspective: '1000px' }}>
          <div 
            className="relative w-full h-full transition-transform duration-500"
            style={{ transformStyle: 'preserve-3d', transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}
            onClick={() => setIsFlipped(f => !f)}
          >
            {/* Front of Card */}
            <div className="absolute w-full h-full bg-white dark:bg-slate-800 rounded-2xl shadow-2xl flex items-center justify-center p-8 text-center" style={{ backfaceVisibility: 'hidden' }}>
              <h2 className="text-3xl font-bold text-slate-800 dark:text-slate-100">{currentCard.term}</h2>
            </div>
            {/* Back of Card */}
            <div className="absolute w-full h-full bg-slate-100 dark:bg-slate-700 rounded-2xl shadow-2xl flex items-center justify-center p-8 text-center" style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
              <p className="text-lg text-slate-600 dark:text-slate-200">{currentCard.definition}</p>
            </div>
          </div>
        </div>
        
        <div className="mt-6 flex items-center justify-between">
          <button onClick={goToPrev} className="p-3 bg-white/20 rounded-full hover:bg-white/40 transition-colors" aria-label="Previous card">
            <ChevronLeftIcon className="w-6 h-6 text-white" />
          </button>
          <p className="text-white font-semibold tabular-nums">{currentIndex + 1} / {flashcards.length}</p>
          <button onClick={goToNext} className="p-3 bg-white/20 rounded-full hover:bg-white/40 transition-colors" aria-label="Next card">
            <ChevronRightIcon className="w-6 h-6 text-white" />
          </button>
        </div>

        <button onClick={onClose} className="absolute -top-12 right-0 p-2 bg-white/20 rounded-full hover:bg-white/40 transition-colors" aria-label="Close flashcards">
          <XIcon className="w-6 h-6 text-white" />
        </button>
      </div>
    </div>
  );
}
