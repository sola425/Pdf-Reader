import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Part } from '@google/genai';
import { generateQuiz, generateFlashcards } from '../services/geminiService';
import * as db from '../utils/db';
import { Loader } from './Loader';
import { AcademicCapIcon, XIcon, ChevronDownIcon, ChevronUpIcon, CollectionIcon, BookOpenIcon, SparklesIcon, TrashIcon } from './Icons';
import { ProcessedPageData, QuizQuestion, StudyProgress, Flashcard, StudyTopicProgress } from '../types';
import { FlashcardViewer } from './FlashcardViewer';
import { ErrorBoundary } from './ErrorBoundary';

interface StudyPanelProps {
  documentId: string;
  numPages: number;
  currentPage: number;
  onClose?: () => void;
}

type QuizState = 'idle' | 'generating' | 'active' | 'finished' | 'error';
type AnswerState = { selected: string | null; isCorrect: boolean | null };
type ActiveTab = 'quiz' | 'flashcards' | 'progress';

const getButtonClass = (option: string, currentAnswer: AnswerState, currentQuestion: QuizQuestion) => {
    if (currentAnswer?.isCorrect === null) {
      return 'bg-white dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 border-slate-300 dark:border-slate-600'; // Default
    }
    if (option === currentQuestion.answer) {
      return 'bg-green-100 dark:bg-green-900/50 border-green-500 text-green-800 dark:text-green-200 font-semibold'; // Correct answer
    }
    if (option === currentAnswer.selected) {
      return 'bg-red-100 dark:bg-red-900/50 border-red-500 text-red-800 dark:text-red-200 font-semibold'; // Incorrectly selected
    }
    return 'bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600 opacity-70'; // Not selected
};

const QuizView = ({ documentId, numPages, currentPage, studyProgress, onUpdateProgress }: { documentId: string, numPages: number, currentPage: number, studyProgress: StudyProgress | null, onUpdateProgress: () => void }) => {
  const [quizState, setQuizState] = useState<QuizState>('idle');
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerState[]>([]);
  const [error, setError] = useState('');
  
  const [startPage, setStartPage] = useState(currentPage);
  const [endPage, setEndPage] = useState(currentPage);
  const [numQuestions, setNumQuestions] = useState(5);
  const [isContextSettingsOpen, setIsContextSettingsOpen] = useState(true);

  useEffect(() => {
    if (quizState === 'idle') {
      setStartPage(currentPage);
      setEndPage(currentPage);
    }
  }, [currentPage, quizState]);

  const handleGenerateQuiz = useCallback(async () => {
    setQuizState('generating');
    setError('');
    setQuestions([]);
    setAnswers([]);
    setCurrentQuestionIndex(0);

    const start = Math.max(1, Math.min(startPage, endPage));
    const end = Math.min(numPages, Math.max(startPage, endPage));
    if (start > end) {
      setError('Start page cannot be after end page.');
      setQuizState('error');
      return;
    }
    
    try {
      const allPagesData = await db.loadProcessedData(documentId);
      if (!allPagesData) throw new Error("Could not load processed data.");
      
      const relevantPages = allPagesData.filter(p => p.pageNum >= start && p.pageNum <= end);
      if (relevantPages.length === 0) throw new Error(`Could not find data for pages ${start}-${end}.`);
      
      const contextParts: Part[] = relevantPages.flatMap((page: ProcessedPageData) => [
        { text: `\n\n--- PAGE ${page.pageNum} ---\n` },
        { inlineData: { mimeType: 'image/jpeg', data: page.image } },
        ...(page.text ? [{ text: page.text }] : [])
      ]);

      const generatedQuestions = await generateQuiz(contextParts, numQuestions, studyProgress);
      if (generatedQuestions && generatedQuestions.length > 0) {
        setQuestions(generatedQuestions);
        setAnswers(Array(generatedQuestions.length).fill({ selected: null, isCorrect: null }));
        setQuizState('active');
      } else {
        throw new Error("The AI didn't generate any questions. Try a different page range.");
      }
    } catch (e) {
      console.error("Failed to generate quiz:", e);
      setError(e instanceof Error ? e.message : 'An unknown error occurred while generating the quiz.');
      setQuizState('error');
    }
  }, [documentId, startPage, endPage, numPages, studyProgress, numQuestions]);

  const handleAnswerSelect = (option: string) => {
    if (answers[currentQuestionIndex]?.isCorrect !== null) return; 

    const isCorrect = option === questions[currentQuestionIndex].answer;
    const newAnswers = [...answers];
    newAnswers[currentQuestionIndex] = { selected: option, isCorrect };
    setAnswers(newAnswers);
  };
  
  const handleNextQuestion = async () => {
      const topic = questions[currentQuestionIndex].topic;
      const isCorrect = !!answers[currentQuestionIndex].isCorrect;
      
      const currentProgress = await db.getStudyProgress(documentId) || { docId: documentId, progress: [] };
      const topicIndex = currentProgress.progress.findIndex(p => p.topic === topic);
      if (topicIndex > -1) {
          currentProgress.progress[topicIndex].total += 1;
          if (isCorrect) currentProgress.progress[topicIndex].correct += 1;
          currentProgress.progress[topicIndex].lastReviewed = new Date();
      } else {
          currentProgress.progress.push({ topic, correct: isCorrect ? 1 : 0, total: 1, lastReviewed: new Date() });
      }
      await db.saveStudyProgress(currentProgress);
      onUpdateProgress();

      if (currentQuestionIndex < questions.length - 1) {
          setCurrentQuestionIndex(prev => prev + 1);
      } else {
          setQuizState('finished');
      }
  };

  const score = useMemo(() => {
    const correctCount = answers.filter(a => a.isCorrect).length;
    return { correct: correctCount, total: questions.length };
  }, [answers, questions]);

  const resetQuiz = () => {
      setQuizState('idle');
      setQuestions([]);
      setCurrentQuestionIndex(0);
      setAnswers([]);
      setError('');
  };
  
  return <>
    <div className="p-3 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
        <button onClick={() => setIsContextSettingsOpen(p => !p)} className="w-full flex justify-between items-center text-left p-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700">
            <span className="font-semibold text-slate-700 dark:text-slate-200">Quiz Settings</span>
            {isContextSettingsOpen ? <ChevronUpIcon className="w-5 h-5 text-slate-500" /> : <ChevronDownIcon className="w-5 h-5 text-slate-500" />}
        </button>
        {isContextSettingsOpen && (
            <div className="mt-3 space-y-3 px-2">
                <div className="flex items-center gap-2">
                    <label htmlFor="start-page-study" className="text-sm font-medium text-slate-600 dark:text-slate-300 w-24">Start Page:</label>
                    <input type="number" id="start-page-study" value={startPage} onChange={(e) => setStartPage(Math.max(1, parseInt(e.target.value, 10) || 1))} min="1" max={numPages} disabled={quizState !== 'idle' && quizState !== 'error'} className="w-full p-1 border border-slate-300 dark:border-slate-600 rounded-md text-sm bg-slate-50 dark:bg-slate-700" />
                </div>
                <div className="flex items-center gap-2">
                    <label htmlFor="end-page-study" className="text-sm font-medium text-slate-600 dark:text-slate-300 w-24">End Page:</label>
                    <input type="number" id="end-page-study" value={endPage} onChange={(e) => setEndPage(Math.min(numPages, parseInt(e.target.value, 10) || 1))} min="1" max={numPages} disabled={quizState !== 'idle' && quizState !== 'error'} className="w-full p-1 border border-slate-300 dark:border-slate-600 rounded-md text-sm bg-slate-50 dark:bg-slate-700" />
                </div>
                <div className="flex items-center gap-2">
                    <label htmlFor="num-questions" className="text-sm font-medium text-slate-600 dark:text-slate-300 w-24"># Questions:</label>
                    <input type="number" id="num-questions" value={numQuestions} onChange={(e) => setNumQuestions(Math.max(1, parseInt(e.target.value, 10)))} min="1" max={20} disabled={quizState !== 'idle' && quizState !== 'error'} className="w-full p-1 border border-slate-300 dark:border-slate-600 rounded-md text-sm bg-slate-50 dark:bg-slate-700" />
                </div>
            </div>
        )}
    </div>
    <div className="flex-1 overflow-y-auto p-4">
    {quizState === 'idle' && (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <AcademicCapIcon className="w-16 h-16 text-slate-400 dark:text-slate-500" />
        <p className="mt-4 font-semibold">Ready to test your knowledge?</p>
        <p className="text-sm text-slate-500 dark:text-slate-400">Select a page range and generate a quiz.</p>
      </div>
    )}
    {quizState === 'generating' && (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <Loader />
        <p className="mt-4 font-semibold">Generating questions...</p>
        <p className="text-sm text-slate-500 dark:text-slate-400">The AI is creating your personalized quiz.</p>
      </div>
    )}
    {error && (
        <div className="p-3 text-sm text-red-700 dark:text-red-200 bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-600 rounded-md">{error}</div>
    )}
    {quizState === 'active' && questions[currentQuestionIndex] && (
        <div>
            <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 mb-1">Question {currentQuestionIndex + 1} of {questions.length}</p>
            <p className="font-bold mb-4">{questions[currentQuestionIndex].question}</p>
            <div className="space-y-3">
                {questions[currentQuestionIndex].options.map((option, index) => (
                    <button key={index} onClick={() => handleAnswerSelect(option)} disabled={answers[currentQuestionIndex]?.selected !== null} className={`w-full text-left p-3 border rounded-lg transition-colors text-sm ${getButtonClass(option, answers[currentQuestionIndex], questions[currentQuestionIndex])}`}>
                        {option}
                    </button>
                ))}
            </div>
        </div>
    )}
    {quizState === 'finished' && (
        <div className="text-center">
            <h4 className="text-xl font-bold">Quiz Complete!</h4>
            <p className="mt-2">You scored:</p>
            <p className="text-5xl font-extrabold my-4">
                <span className={score.correct > score.total / 2 ? 'text-green-500' : 'text-red-500'}>{score.correct}</span>
                <span className="text-3xl text-slate-400"> / {score.total}</span>
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400">Great job reviewing the material!</p>
        </div>
    )}
  </div>
  <div className="flex-shrink-0 p-4 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700">
    {quizState === 'idle' || quizState === 'error' ? (
      <button onClick={handleGenerateQuiz} className="w-full px-6 py-3 bg-blue-600 text-white font-bold rounded-lg shadow-sm hover:bg-blue-700 transition-colors">
        Generate Quiz
      </button>
    ) : quizState === 'active' && answers[currentQuestionIndex]?.selected !== null ? (
       <button onClick={handleNextQuestion} className="w-full px-6 py-3 bg-indigo-600 text-white font-bold rounded-lg shadow-sm hover:bg-indigo-700 transition-colors">
        {currentQuestionIndex < questions.length - 1 ? 'Next Question' : 'Finish Quiz'}
      </button>
    ) : quizState === 'finished' ? (
       <button onClick={resetQuiz} className="w-full px-6 py-3 bg-slate-600 text-white font-bold rounded-lg shadow-sm hover:bg-slate-700 transition-colors">
        Take Another Quiz
      </button>
    ) : <div className="h-[52px]"></div>}
  </div>
  </>;
};

const FlashcardsTabView = ({ documentId, numPages, currentPage }: { documentId: string, numPages: number, currentPage: number }) => {
    const [savedFlashcards, setSavedFlashcards] = useState<Flashcard[]>([]);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isFetching, setIsFetching] = useState(true);
    const [error, setError] = useState('');
    const [showViewer, setShowViewer] = useState(false);
    
    const [startPage, setStartPage] = useState(1);
    const [endPage, setEndPage] = useState(numPages);
    const [numFlashcards, setNumFlashcards] = useState(10);
    const [isContextSettingsOpen, setIsContextSettingsOpen] = useState(false);
    
    const fetchFlashcards = useCallback(async () => {
        setIsFetching(true);
        const cards = await db.getFlashcardsForDocument(documentId);
        setSavedFlashcards(cards);
        setIsFetching(false);
    }, [documentId]);
    
    useEffect(() => {
        fetchFlashcards();
    }, [fetchFlashcards]);

    const handleGenerateFlashcards = useCallback(async () => {
        setIsGenerating(true);
        setError('');
        try {
            const allPagesData = await db.loadProcessedData(documentId);
            if (!allPagesData) throw new Error("Could not load processed data.");
            
            const start = Math.max(1, Math.min(startPage, endPage));
            const end = Math.min(numPages, Math.max(startPage, endPage));
            
            const relevantPages = allPagesData.filter(p => p.pageNum >= start && p.pageNum <= end);
            if (relevantPages.length === 0) throw new Error(`Could not find data for pages ${start}-${end}.`);

            const contextParts: Part[] = relevantPages.flatMap((page: ProcessedPageData) => [
                { text: `\n\n--- PAGE ${page.pageNum} ---\n` },
                { inlineData: { mimeType: 'image/jpeg', data: page.image } },
                ...(page.text ? [{ text: page.text }] : [])
            ]);

            const cards = await generateFlashcards(contextParts, numFlashcards);
            if (cards && cards.length > 0) {
                const newFlashcards: Flashcard[] = cards.map(card => ({
                    ...card,
                    id: crypto.randomUUID(),
                    docId: documentId,
                }));
                await db.saveFlashcards(newFlashcards);
                await fetchFlashcards();
            } else {
                throw new Error("The AI didn't generate any flashcards.");
            }
        } catch (e) {
            console.error(e);
            setError(e instanceof Error ? e.message : 'An unknown error occurred.');
        } finally {
            setIsGenerating(false);
        }
    }, [documentId, numPages, startPage, endPage, numFlashcards, fetchFlashcards]);
    
    const handleDeleteCard = async (id: string) => {
        await db.deleteFlashcard(id);
        await fetchFlashcards();
    }

    return (
        <div className="flex flex-col h-full">
             <div className="p-3 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                <button onClick={() => setIsContextSettingsOpen(p => !p)} className="w-full flex justify-between items-center text-left p-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700">
                    <span className="font-semibold text-slate-700 dark:text-slate-200">Generate New Flashcards</span>
                    {isContextSettingsOpen ? <ChevronUpIcon className="w-5 h-5 text-slate-500" /> : <ChevronDownIcon className="w-5 h-5 text-slate-500" />}
                </button>
                {isContextSettingsOpen && (
                    <div className="mt-3 space-y-3 px-2">
                        <div className="flex items-center gap-2">
                            <label htmlFor="start-page-flash" className="text-sm font-medium text-slate-600 dark:text-slate-300 w-24">Start Page:</label>
                            <input type="number" id="start-page-flash" value={startPage} onChange={(e) => setStartPage(Math.max(1, parseInt(e.target.value, 10)))} min="1" max={numPages} className="w-full p-1 border border-slate-300 dark:border-slate-600 rounded-md text-sm bg-slate-50 dark:bg-slate-700" />
                        </div>
                        <div className="flex items-center gap-2">
                            <label htmlFor="end-page-flash" className="text-sm font-medium text-slate-600 dark:text-slate-300 w-24">End Page:</label>
                            <input type="number" id="end-page-flash" value={endPage} onChange={(e) => setEndPage(Math.min(numPages, parseInt(e.target.value, 10)))} min="1" max={numPages} className="w-full p-1 border border-slate-300 dark:border-slate-600 rounded-md text-sm bg-slate-50 dark:bg-slate-700" />
                        </div>
                         <div className="flex items-center gap-2">
                            <label htmlFor="num-flashcards" className="text-sm font-medium text-slate-600 dark:text-slate-300 w-24"># of Cards:</label>
                            <input type="number" id="num-flashcards" value={numFlashcards} onChange={(e) => setNumFlashcards(Math.max(1, parseInt(e.target.value, 10)))} min="1" max={50} className="w-full p-1 border border-slate-300 dark:border-slate-600 rounded-md text-sm bg-slate-50 dark:bg-slate-700" />
                        </div>
                        <button onClick={handleGenerateFlashcards} disabled={isGenerating} className="w-full px-4 py-2 bg-blue-600 text-white font-bold rounded-lg shadow-sm hover:bg-blue-700 disabled:bg-blue-400 transition-colors flex items-center justify-center gap-2">
                           {isGenerating ? <><Loader /> Generating...</> : <><SparklesIcon className="w-5 h-5"/>Generate</>}
                        </button>
                        {error && <p className="mt-2 text-center text-sm text-red-600 dark:text-red-400">{error}</p>}
                    </div>
                )}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
                 <h4 className="font-bold text-slate-800 dark:text-slate-100 mb-2">Your Flashcard Deck</h4>
                 {isFetching ? <div className="flex justify-center pt-8"><Loader /></div> : 
                 savedFlashcards.length === 0 ? (
                    <div className="text-center pt-8 text-slate-500 dark:text-slate-400">
                        <CollectionIcon className="w-12 h-12 mx-auto" />
                        <p className="mt-2 font-semibold">No flashcards yet.</p>
                        <p className="text-sm">Generate some cards to get started!</p>
                    </div>
                 ) : (
                    <>
                        <button onClick={() => setShowViewer(true)} className="w-full mb-4 px-6 py-3 bg-indigo-600 text-white font-bold rounded-lg shadow-sm hover:bg-indigo-700 transition-colors">
                           Start Studying ({savedFlashcards.length} cards)
                        </button>
                        <div className="space-y-2">
                            {savedFlashcards.map(card => (
                                <div key={card.id} className="group flex items-center justify-between p-2 bg-white dark:bg-slate-800 rounded-md border border-slate-200 dark:border-slate-700">
                                    <div>
                                        <p className="text-sm font-semibold">{card.term}</p>
                                        <p className="text-xs text-slate-500 dark:text-slate-400">Page {card.pageNum}</p>
                                    </div>
                                    <button onClick={() => handleDeleteCard(card.id)} className="p-1.5 rounded-full text-slate-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/50 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <TrashIcon className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </>
                 )}
            </div>
            {showViewer && savedFlashcards.length > 0 && (
                <FlashcardViewer flashcards={savedFlashcards} onClose={() => setShowViewer(false)} />
            )}
        </div>
    );
};

const ProgressView = ({ studyProgress }: { studyProgress: StudyProgress | null }) => {
    const sortedProgress = useMemo(() => {
        if (!studyProgress) return [];
        return [...studyProgress.progress].sort((a, b) => b.lastReviewed.getTime() - a.lastReviewed.getTime());
    }, [studyProgress]);
    
    if (!studyProgress || studyProgress.progress.length === 0) {
        return (
             <div className="flex flex-col items-center justify-center h-full text-center p-4">
                <BookOpenIcon className="w-16 h-16 text-slate-400 dark:text-slate-500" />
                <p className="mt-4 font-semibold">No Study Progress Yet</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">Take a quiz to start tracking your mastery of different topics.</p>
            </div>
        )
    }
    
    return (
         <div className="p-4 space-y-4">
            <h4 className="font-bold text-lg text-slate-800 dark:text-slate-100">Topic Mastery</h4>
            {sortedProgress.map((item: StudyTopicProgress) => {
                const mastery = item.total > 0 ? (item.correct / item.total) * 100 : 0;
                return (
                    <div key={item.topic}>
                        <div className="flex justify-between items-baseline mb-1">
                            <h5 className="font-semibold text-sm text-slate-700 dark:text-slate-200">{item.topic}</h5>
                            <span className="text-xs font-mono text-slate-500 dark:text-slate-400">{item.correct}/{item.total}</span>
                        </div>
                        <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2.5">
                            <div className="bg-green-500 h-2.5 rounded-full" style={{ width: `${mastery}%` }}></div>
                        </div>
                    </div>
                )
            })}
        </div>
    )
}

export function StudyPanel({ documentId, numPages, currentPage, onClose }: StudyPanelProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('quiz');
  const [studyProgress, setStudyProgress] = useState<StudyProgress | null>(null);

  const fetchStudyProgress = useCallback(async () => {
    const progress = await db.getStudyProgress(documentId);
    setStudyProgress(progress);
  }, [documentId]);
  
  useEffect(() => {
      fetchStudyProgress();
  }, [fetchStudyProgress]);

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200">
      <header className="flex-shrink-0 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AcademicCapIcon className="w-7 h-7 text-indigo-600 dark:text-indigo-400" />
          <h3 className="text-lg font-bold">Study Tools</h3>
        </div>
        {onClose && (
          <button onClick={onClose} className="p-1 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700">
            <XIcon className="w-5 h-5 text-slate-600 dark:text-slate-300" />
          </button>
        )}
      </header>
      
      <div className="flex-shrink-0 p-2 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-center bg-slate-200 dark:bg-slate-700 rounded-lg p-1">
          <button onClick={() => setActiveTab('quiz')} className={`flex-1 text-sm font-semibold p-2 rounded-md transition-colors flex items-center justify-center gap-2 ${activeTab === 'quiz' ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-300 shadow-sm' : 'text-slate-600 dark:text-slate-300'}`}>Quiz</button>
          <button onClick={() => setActiveTab('flashcards')} className={`flex-1 text-sm font-semibold p-2 rounded-md transition-colors flex items-center justify-center gap-2 ${activeTab === 'flashcards' ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-300 shadow-sm' : 'text-slate-600 dark:text-slate-300'}`}>Flashcards</button>
          <button onClick={() => setActiveTab('progress')} className={`flex-1 text-sm font-semibold p-2 rounded-md transition-colors flex items-center justify-center gap-2 ${activeTab === 'progress' ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-300 shadow-sm' : 'text-slate-600 dark:text-slate-300'}`}>Progress</button>
        </div>
      </div>
      
      <div className="flex-1 flex flex-col min-h-0">
          <ErrorBoundary>
            <>
            {activeTab === 'quiz' && <QuizView documentId={documentId} numPages={numPages} currentPage={currentPage} studyProgress={studyProgress} onUpdateProgress={fetchStudyProgress}/>}
            {activeTab === 'flashcards' && <FlashcardsTabView documentId={documentId} numPages={numPages} currentPage={currentPage} />}
            {activeTab === 'progress' && <ProgressView studyProgress={studyProgress}/>}
            </>
          </ErrorBoundary>
      </div>
    </div>
  );
}