import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Part, LiveServerMessage } from '@google/genai';
import { startReviewConversation, analyzeRecall } from '../services/geminiService';
import { decode, decodeAudioData, encode } from '../utils/audio';
import { getAudioContext } from '../utils/audioContext';
import * as db from '../utils/db';
import { 
    MicrophoneIcon, StopIcon, AcademicCapIcon, XIcon, ChevronDownIcon, 
    SpeakerWaveIcon, ChevronUpIcon, MessageQuestionIcon, WaveformIcon
} from './Icons';
import { Loader } from './Loader';
import { AudioVisualizer } from './AudioVisualizer';
import { ProcessedPageData, RecallAnalysisResult } from '../types';

interface AiCoachPanelProps {
  documentId: string;
  numPages: number;
  currentPage: number;
  onClose?: () => void;
  onGoToPage: (pageNum: number) => void;
}

type CoachMode = 'guided' | 'open';
type GuidedState = 'idle' | 'preparing' | 'conversing' | 'thinking' | 'stopping' | 'error';
type OpenRecallState = 'idle' | 'recording' | 'analyzing' | 'results' | 'error';
type ConversationTurn = { role: 'user' | 'model'; text: string; isFinal: boolean; };

const ThinkingIndicator = () => (
    <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-pulse [animation-delay:-0.3s]"></span>
        <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-pulse [animation-delay:-0.15s]"></span>
        <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-pulse"></span>
    </div>
);

export function AiCoachPanel({ documentId, numPages, currentPage, onClose, onGoToPage }: AiCoachPanelProps) {
  const [mode, setMode] = useState<CoachMode>('guided');
  const [error, setError] = useState<string>('');
  
  const [startPage, setStartPage] = useState(currentPage);
  const [endPage, setEndPage] = useState(currentPage);
  const [isContextSettingsOpen, setIsContextSettingsOpen] = useState(true);

  // --- Guided Q&A State ---
  const [guidedState, setGuidedState] = useState<GuidedState>('idle');
  const [conversationHistory, setConversationHistory] = useState<ConversationTurn[]>([]);
  
  // --- Open Recall State ---
  const [openRecallState, setOpenRecallState] = useState<OpenRecallState>('idle');
  const [analysisResult, setAnalysisResult] = useState<RecallAnalysisResult | null>(null);
  const [transcript, setTranscript] = useState('');

  // --- Shared Refs & State ---
  const liveSessionRef = useRef<any>(null);
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  const isMountedRef = useRef(false);
  
  // --- Audio Playback Refs (for Guided Q&A) ---
  const nextAudioStartTime = useRef(0);
  const activeAudioSources = useRef<Set<AudioBufferSourceNode>>(new Set());
  const chatContentRef = useRef<HTMLDivElement | null>(null);
  
  const hapticFeedback = () => {
    if (navigator.vibrate) {
        navigator.vibrate(10);
    }
  };

  const cleanupLiveSession = useCallback(() => {
    if (liveSessionRef.current) {
        liveSessionRef.current.session?.close();
        liveSessionRef.current.stream?.getTracks().forEach((track: MediaStreamTrack) => track.stop());
        if (liveSessionRef.current.scriptProcessor) liveSessionRef.current.scriptProcessor.disconnect();
        liveSessionRef.current.source?.disconnect();
        if(liveSessionRef.current.context.state !== 'closed') {
          liveSessionRef.current.context.close().catch(console.error);
        }
        liveSessionRef.current = null;
    }
    setAnalyserNode(null);
  }, []);

  const stopAllActivity = useCallback(() => {
      cleanupLiveSession();
      speechSynthesis.cancel();
      activeAudioSources.current.forEach(source => source.stop());
      activeAudioSources.current.clear();
      nextAudioStartTime.current = 0;
      setGuidedState('idle');
      setOpenRecallState('idle');
  }, [cleanupLiveSession]);
  
  useEffect(() => { 
    isMountedRef.current = true; 
    return () => { 
      isMountedRef.current = false; 
      stopAllActivity();
    }; 
  }, [stopAllActivity]);

  useEffect(() => { 
    if (guidedState === 'idle' && openRecallState === 'idle') { 
      setStartPage(currentPage); 
      setEndPage(currentPage); 
    } 
  }, [currentPage, guidedState, openRecallState]);

  useEffect(() => { if (chatContentRef.current) chatContentRef.current.scrollTop = chatContentRef.current.scrollHeight; }, [conversationHistory]);

  const switchMode = (newMode: CoachMode) => {
    stopAllActivity();
    setError('');
    setMode(newMode);
  };

  // --- GUIDED Q&A LOGIC ---
  const stopConversation = useCallback(() => {
    hapticFeedback();
    setGuidedState('stopping');
    cleanupLiveSession();
    activeAudioSources.current.forEach(source => source.stop());
    activeAudioSources.current.clear();
    nextAudioStartTime.current = 0;
    setConversationHistory(prev => { const last = prev[prev.length - 1]; if (last && !last.isFinal) { return [...prev.slice(0, -1), { ...last, isFinal: true }]; } return prev; });
    setGuidedState('idle');
  }, [cleanupLiveSession]);
  
  const buildContext = useCallback(async (): Promise<Part[] | null> => {
    const start = Math.max(1, Math.min(startPage, endPage));
    const end = Math.min(numPages, Math.max(startPage, endPage));
    if (start > end) { setError('Start page cannot be after end page.'); return null; }
    try {
      const allPagesData = await db.loadProcessedData(documentId);
      if (!isMountedRef.current) return null;
      if (!allPagesData) throw new Error("Could not load processed data.");
      const relevantPages = allPagesData.filter(p => p.pageNum >= start && p.pageNum <= end);
      if (relevantPages.length === 0) throw new Error(`Could not find data for pages ${start}-${end}.`);
      return relevantPages.flatMap((page: ProcessedPageData) => [
        { text: `\n\n--- PAGE ${page.pageNum} ---\n` },
        { inlineData: { mimeType: 'image/jpeg', data: page.image } },
        ...(page.text ? [{ text: page.text }] : [])
      ]);
    } catch (e) { console.error("Failed to build context:", e); if (isMountedRef.current) setError(e instanceof Error ? e.message : 'Could not extract content from pages.'); return null; }
  }, [documentId, startPage, endPage, numPages]);

  const startConversation = useCallback(async () => {
    if (guidedState !== 'idle' && guidedState !== 'error') return;
    hapticFeedback();
    setGuidedState('preparing'); setError(''); setConversationHistory([]);
    activeAudioSources.current.clear();
    nextAudioStartTime.current = 0;

    const context = await buildContext();
    if (!isMountedRef.current) return;
    if (!context) { setGuidedState('error'); return; }
    try {
      const sessionData = await startReviewConversation({
        contextParts: context,
        onMessage: async (message: LiveServerMessage) => {
            if (!isMountedRef.current) return;
            const { serverContent, toolCall } = message;

            if (serverContent?.inputTranscription) {
                // FIX: Use functional update to avoid stale state issues and fix TypeScript error.
                setGuidedState(s => (s === 'thinking' ? 'conversing' : s));
                const { text, isFinal } = serverContent.inputTranscription;
                setConversationHistory(prev => { const last = prev[prev.length - 1]; if (last?.role === 'user' && !last.isFinal) { return [...prev.slice(0, -1), { role: 'user', text: last.text + text, isFinal }]; } return [...prev, { role: 'user', text, isFinal }]; });
                if (isFinal) setGuidedState('thinking');
            }
            if (serverContent?.outputTranscription) {
                // FIX: Use functional update to avoid stale state issues and fix TypeScript error.
                setGuidedState(s => (s === 'thinking' ? 'conversing' : s));
                const { text, isFinal } = serverContent.outputTranscription;
                setConversationHistory(prev => { const last = prev[prev.length - 1]; if (last?.role === 'model' && !last.isFinal) { return [...prev.slice(0, -1), { role: 'model', text: last.text + text, isFinal }]; } return [...prev, { role: 'model', text, isFinal }]; });
            }
            if (serverContent?.interrupted) {
                activeAudioSources.current.forEach(source => source.stop());
                activeAudioSources.current.clear();
                nextAudioStartTime.current = 0;
            }
            const base64Audio = serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio) {
                 // FIX: Use functional update to avoid stale state issues and fix TypeScript error.
                 setGuidedState(s => (s === 'thinking' ? 'conversing' : s));
                try {
                    const outputAudioContext = getAudioContext();
                    nextAudioStartTime.current = Math.max(nextAudioStartTime.current, outputAudioContext.currentTime);
                    const audioBuffer = await decodeAudioData(decode(base64Audio), outputAudioContext, 24000, 1);
                    if (!isMountedRef.current) return;

                    const source = outputAudioContext.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(outputAudioContext.destination);
                    source.onended = () => { activeAudioSources.current.delete(source); };
                    
                    source.start(nextAudioStartTime.current);
                    nextAudioStartTime.current += audioBuffer.duration;
                    activeAudioSources.current.add(source);
                } catch (e) {
                    console.error('Audio playback error:', e);
                    if (isMountedRef.current) setError('Could not play back audio.');
                }
            }
            if (toolCall) {
              for (const fc of toolCall.functionCalls) {
                  if (fc.name === 'recordAnswer') {
                      console.log('AI recorded an answer:', fc.args);
                      liveSessionRef.current?.session.sendToolResponse({ functionResponses: { id : fc.id, name: fc.name, response: { result: "Answer recorded successfully." } } });
                  }
              }
            }
        },
        onError: (err) => { if (!isMountedRef.current) return; console.error('Conversation error:', err); setError('An error occurred during the session.'); setGuidedState('error'); cleanupLiveSession(); },
        // FIX: Use functional update to avoid stale state issues and fix TypeScript error.
        onClose: () => { if (!isMountedRef.current) return; setGuidedState(s => (s !== 'stopping' ? 'idle' : s)); cleanupLiveSession(); }
      });
      if (!isMountedRef.current) { sessionData.session?.close(); sessionData.stream?.getTracks().forEach((t: MediaStreamTrack) => t.stop()); return; }
      liveSessionRef.current = sessionData;
      setGuidedState('thinking');
      const analyser = sessionData.context.createAnalyser();
      sessionData.source.connect(analyser);
      setAnalyserNode(analyser);
    } catch (e: any) {
        if (!isMountedRef.current) return;
        console.error('Failed to start conversation:', e);
        if (e.name === 'NotAllowedError' || e.message.includes('Permission denied')) setError('Microphone access denied.');
        else setError('Could not start the conversation. Check your microphone.');
        setGuidedState('error'); cleanupLiveSession();
    }
  }, [guidedState, buildContext, cleanupLiveSession]);

  // --- OPEN RECALL LOGIC ---
  const startRecording = async () => {
    hapticFeedback();
    setOpenRecallState('recording');
    setError('');
    setTranscript('');
    setAnalysisResult(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const context = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const source = context.createMediaStreamSource(stream);
      const scriptProcessor = context.createScriptProcessor(4096, 1, 1);
      const analyser = context.createAnalyser();
      source.connect(analyser);

      const ai = new (await import('@google/genai')).GoogleGenAI({ apiKey: process.env.API_KEY });
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
              const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) int16[i] = Math.max(-1, Math.min(1, inputData[i])) * 32767;
              sessionPromise.then(session => session.sendRealtimeInput({ media: { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' } })).catch(console.error);
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(context.destination);
          },
          onmessage: (msg: LiveServerMessage) => {
            if (!isMountedRef.current) return;
            const text = msg.serverContent?.inputTranscription?.text;
            if (text) setTranscript(prev => prev + text);
          },
          onerror: (e) => { if (isMountedRef.current) { console.error(e); setError('A live connection error occurred.'); setOpenRecallState('error'); cleanupLiveSession(); } },
          onclose: () => { if (isMountedRef.current && openRecallState === 'recording') { setError('The connection closed unexpectedly.'); setOpenRecallState('error'); cleanupLiveSession(); } }
        },
        config: { inputAudioTranscription: {} }
      });
      
      const session = await sessionPromise;
      liveSessionRef.current = { session, stream, context, scriptProcessor, source };
      setAnalyserNode(analyser);

    } catch (e: any) {
        if (isMountedRef.current) {
          console.error('Failed to start recording:', e);
          setError(e.name === 'NotAllowedError' ? 'Microphone access was denied.' : 'Could not start recording.');
          setOpenRecallState('error');
        }
    }
  };

  const stopRecordingAndAnalyze = useCallback(async () => {
    hapticFeedback();
    if (openRecallState !== 'recording') return;
    setOpenRecallState('analyzing');
    cleanupLiveSession();
    
    if (transcript.trim().length < 10) {
      setError("Your summary was too short to analyze. Please try again.");
      setOpenRecallState('error');
      return;
    }
    
    try {
      const context = await buildContext();
      if (!context || !isMountedRef.current) {
        throw new Error("Could not build context for analysis.");
      }
      const result = await analyzeRecall(context, transcript);
      if (!isMountedRef.current) return;
      setAnalysisResult(result);
      setOpenRecallState('results');

    } catch(e) {
      if (!isMountedRef.current) return;
      console.error(e);
      setError(e instanceof Error ? e.message : "Failed to analyze your summary.");
      setOpenRecallState('error');
    }
  }, [openRecallState, cleanupLiveSession, transcript, buildContext]);
  
  const readFeedbackAloud = () => {
    if (!analysisResult || !analysisResult.feedback) return;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(analysisResult.feedback);
    speechSynthesis.speak(utterance);
  };
  
  const resetRecall = () => {
    setOpenRecallState('idle');
    setError('');
    setTranscript('');
    setAnalysisResult(null);
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200">
      <header className="flex-shrink-0 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AcademicCapIcon className="w-7 h-7 text-indigo-600 dark:text-indigo-400" />
          <h3 className="text-lg font-bold">AI Coach</h3>
        </div>
        {onClose && <button onClick={onClose} className="p-1 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700"><XIcon className="w-5 h-5 text-slate-600 dark:text-slate-300" /></button>}
      </header>

      <div className="p-2 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-center bg-slate-200 dark:bg-slate-700 rounded-lg p-1">
          <button onClick={() => switchMode('guided')} className={`flex-1 text-sm font-semibold p-2 rounded-md transition-colors flex items-center justify-center gap-2 ${mode === 'guided' ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-300 shadow-sm' : 'text-slate-600 dark:text-slate-300'}`}><MessageQuestionIcon className="w-5 h-5"/>Guided Q&A</button>
          <button onClick={() => switchMode('open')} className={`flex-1 text-sm font-semibold p-2 rounded-md transition-colors flex items-center justify-center gap-2 ${mode === 'open' ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-300 shadow-sm' : 'text-slate-600 dark:text-slate-300'}`}><WaveformIcon className="w-5 h-5"/>Open Recall</button>
        </div>
      </div>

      <div className="p-3 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
        <button onClick={() => setIsContextSettingsOpen(p => !p)} className="w-full flex justify-between items-center text-left p-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700">
            <span className="font-semibold text-slate-700 dark:text-slate-200">Practice Pages: {Math.min(startPage, endPage)} - {Math.max(startPage, endPage)}</span>
            {isContextSettingsOpen ? <ChevronUpIcon className="w-5 h-5 text-slate-500" /> : <ChevronDownIcon className="w-5 h-5 text-slate-500" />}
        </button>
        {isContextSettingsOpen && (
        <div className="mt-3 space-y-3 px-2">
            <div className="flex items-center gap-2"><label htmlFor="start-page-coach" className="text-sm font-medium text-slate-600 dark:text-slate-300 w-12">Start:</label><input type="number" id="start-page-coach" value={startPage} onChange={(e) => setStartPage(Math.max(1, parseInt(e.target.value, 10)))} min="1" max={numPages} disabled={guidedState !== 'idle' || openRecallState !== 'idle'} className="w-full p-1 border border-slate-300 dark:border-slate-600 rounded-md text-sm bg-slate-50 dark:bg-slate-700" /></div>
            <div className="flex items-center gap-2"><label htmlFor="end-page-coach" className="text-sm font-medium text-slate-600 dark:text-slate-300 w-12">End:</label><input type="number" id="end-page-coach" value={endPage} onChange={(e) => setEndPage(Math.min(numPages, parseInt(e.target.value, 10)))} min="1" max={numPages} disabled={guidedState !== 'idle' || openRecallState !== 'idle'} className="w-full p-1 border border-slate-300 dark:border-slate-600 rounded-md text-sm bg-slate-50 dark:bg-slate-700" /></div>
        </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 relative">
        {error && <div className="absolute top-4 left-4 right-4 z-10 p-3 text-sm text-red-700 dark:text-red-200 bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-600 rounded-md">{error}</div>}
        {mode === 'guided' ? (
            <div ref={chatContentRef} className="h-full space-y-4">
                {conversationHistory.map((turn, index) => (<div key={index} className={`flex gap-3 ${turn.role === 'user' ? 'justify-end' : ''}`}>{turn.role === 'model' && <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center flex-shrink-0"><SpeakerWaveIcon className="w-5 h-5 text-white"/></div>}<div className={`max-w-xs md:max-w-sm lg:max-w-md p-3 rounded-2xl ${turn.role === 'user' ? 'bg-blue-500 text-white rounded-br-lg' : 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-bl-lg'}`}><p className="text-sm">{turn.text || '...'}</p></div></div>))}
                {guidedState === 'preparing' && <div className="text-center text-sm text-slate-500 dark:text-slate-400 flex items-center justify-center gap-2"><Loader /> Loading context...</div>}
                {guidedState === 'thinking' && <div className="flex gap-3"><div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center flex-shrink-0"><SpeakerWaveIcon className="w-5 h-5 text-white"/></div><div className="max-w-xs p-3 rounded-2xl bg-slate-200 dark:bg-slate-700"><ThinkingIndicator /></div></div>}
            </div>
        ) : (
            <>
            {openRecallState === 'idle' && <div className="text-center p-8"><p className="font-semibold">Ready to practice your recall?</p><p className="text-sm text-slate-500 dark:text-slate-400">When you're ready, start recording and explain the content of the selected pages in your own words.</p></div>}
            {openRecallState === 'recording' && <div className="h-full flex flex-col"><p className="text-sm font-semibold text-center mb-2">Your summary:</p><div className="flex-1 bg-white dark:bg-slate-800 rounded-lg p-2 border border-slate-200 dark:border-slate-700 overflow-y-auto"><p className="text-sm">{transcript || '...'}</p></div></div>}
            {openRecallState === 'analyzing' && <div className="text-center p-8"><Loader /><p className="mt-4 font-semibold">Analyzing your summary...</p></div>}
            {openRecallState === 'results' && analysisResult && (
              <div className="space-y-6">
                <div><h4 className="text-xl font-bold mb-2 text-center">Analysis Complete!</h4>
                <div className="flex justify-around bg-slate-100 dark:bg-slate-800 p-4 rounded-lg">
                    <div className="text-center"><div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Recall</div><div className="text-3xl font-bold text-blue-600 dark:text-blue-400">{analysisResult.score.recall}<span className="text-lg">%</span></div></div>
                    <div className="text-center"><div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Accuracy</div><div className="text-3xl font-bold text-green-600 dark:text-green-400">{analysisResult.score.accuracy}<span className="text-lg">%</span></div></div>
                </div></div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <h5 className="font-bold">Feedback:</h5>
                    <button onClick={readFeedbackAloud} className="p-1.5 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700" aria-label="Read feedback aloud">
                        <SpeakerWaveIcon className="w-5 h-5 text-slate-600 dark:text-slate-300"/>
                    </button>
                  </div>
                  <p className="text-sm p-3 bg-slate-100 dark:bg-slate-800 rounded-lg">{analysisResult.feedback}</p>
                </div>
                <div><h5 className="font-bold mb-2">Key Points to Review:</h5>
                    <div className="space-y-2">
                    {analysisResult.missedPoints.map((point, i) => (
                        <button key={i} onClick={() => onGoToPage(point.pageNum)} className="w-full text-left p-3 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-700 rounded-lg hover:bg-yellow-100 dark:hover:bg-yellow-900/50 transition-colors">
                            <p className="font-semibold text-sm text-yellow-900 dark:text-yellow-200">{point.topic} (Page {point.pageNum})</p>
                            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 italic">"{point.quoteFromDocument}"</p>
                        </button>
                    ))}
                    </div>
                </div>
              </div>
            )}
            </>
        )}
      </div>

      <div className="flex-shrink-0 p-4 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700">
        <div className="flex flex-col items-center justify-center gap-3">
          <div className="h-[75px] w-full flex items-center justify-center">
            <AudioVisualizer analyserNode={analyserNode} />
          </div>
          {mode === 'guided' && (
            <>
            {guidedState === 'idle' || guidedState === 'error' ? (<button onClick={startConversation} className="w-full px-6 py-3 bg-blue-600 text-white font-bold rounded-lg shadow-sm hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"><MicrophoneIcon className="w-6 h-6" />Start Conversation</button>) 
            : guidedState === 'conversing' || guidedState === 'thinking' ? (<button onClick={stopConversation} className="w-full px-6 py-3 bg-red-600 text-white font-bold rounded-lg shadow-sm hover:bg-red-700 transition-colors flex items-center justify-center gap-2 animate-pulse"><StopIcon className="w-6 h-6" />End Conversation</button>) 
            : (<button disabled className="w-full px-6 py-3 bg-slate-400 text-white font-bold rounded-lg cursor-not-allowed flex items-center justify-center gap-2"><Loader />{guidedState === 'preparing' ? 'Preparing...' : 'Stopping...'}</button>)}
            </>
          )}
          {mode === 'open' && (
            <>
            {openRecallState === 'idle' || openRecallState === 'error' ? (<button onClick={startRecording} className="w-full px-6 py-3 bg-blue-600 text-white font-bold rounded-lg shadow-sm hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"><MicrophoneIcon className="w-6 h-6" />Start Recording</button>)
            : openRecallState === 'recording' ? (<button onClick={stopRecordingAndAnalyze} className="w-full px-6 py-3 bg-red-600 text-white font-bold rounded-lg shadow-sm hover:bg-red-700 transition-colors flex items-center justify-center gap-2 animate-pulse"><StopIcon className="w-6 h-6" />Stop & Analyze</button>)
            : openRecallState === 'results' ? (<button onClick={resetRecall} className="w-full px-6 py-3 bg-slate-600 text-white font-bold rounded-lg shadow-sm hover:bg-slate-700 transition-colors">Try Again</button>)
            : (<button disabled className="w-full px-6 py-3 bg-slate-400 text-white font-bold rounded-lg cursor-not-allowed flex items-center justify-center gap-2"><Loader />Analyzing...</button>)}
            </>
          )}
        </div>
      </div>
    </div>
  );
}