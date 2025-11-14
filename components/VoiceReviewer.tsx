import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Part, LiveServerMessage, FunctionDeclaration, Type } from '@google/genai';
import { startReviewConversation } from '../services/geminiService';
import { decode, decodeAudioData } from '../utils/audio';
import { getAudioContext } from '../utils/audioContext';
import * as db from '../utils/db';
import { MicrophoneIcon, StopIcon, AcademicCapIcon, XIcon, ChevronDownIcon, SpeakerWaveIcon, ChevronUpIcon } from './Icons';
import { Loader } from './Loader';
import { AudioVisualizer } from './AudioVisualizer';
import { ProcessedPageData } from '../types';

interface VoiceReviewerProps {
  documentId: string;
  numPages: number;
  currentPage: number;
  onClose?: () => void;
}

type ConversationState = 'idle' | 'preparing' | 'conversing' | 'stopping' | 'error';
type ConversationTurn = { role: 'user' | 'model'; text: string; isFinal: boolean; };

export function VoiceReviewer({ documentId, numPages, currentPage, onClose }: VoiceReviewerProps) {
  const [conversationState, setConversationState] = useState<ConversationState>('idle');
  const [conversationHistory, setConversationHistory] = useState<ConversationTurn[]>([]);
  const [error, setError] = useState<string>('');
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  
  const [startPage, setStartPage] = useState(currentPage);
  const [endPage, setEndPage] = useState(currentPage);
  const [isContextSettingsOpen, setIsContextSettingsOpen] = useState(true);

  const liveSessionRef = useRef<any>(null);
  const nextAudioStartTime = useRef(0);
  const activeAudioSources = useRef<Set<AudioBufferSourceNode>>(new Set());
  const chatContentRef = useRef<HTMLDivElement>(null);
  const isMountedRef = useRef(false);
  
  const cleanupLiveSession = useCallback(() => {
    if (liveSessionRef.current) {
        liveSessionRef.current.session?.close();
        liveSessionRef.current.stream?.getTracks().forEach((track: MediaStreamTrack) => track.stop());
        if (liveSessionRef.current.scriptProcessor) liveSessionRef.current.scriptProcessor.disconnect();
        liveSessionRef.current.source?.disconnect();
        liveSessionRef.current.context.close().catch(console.error);
        liveSessionRef.current = null;
    }
    setAnalyserNode(null);
  }, []);
  
  const stopConversation = useCallback(() => {
    setConversationState('stopping');
    cleanupLiveSession();
    activeAudioSources.current.forEach(source => source.stop());
    activeAudioSources.current.clear();
    nextAudioStartTime.current = 0;
    setConversationHistory(prev => { const last = prev[prev.length - 1]; if (last && !last.isFinal) { return [...prev.slice(0, -1), { ...last, isFinal: true }]; } return prev; });
    setConversationState('idle');
  }, [cleanupLiveSession]);

  useEffect(() => { 
      isMountedRef.current = true; 
      return () => { 
        isMountedRef.current = false; 
        stopConversation();
      }; 
  }, [stopConversation]);
  useEffect(() => { if (conversationState === 'idle' || conversationState === 'error') { setStartPage(currentPage); setEndPage(currentPage); } }, [currentPage, conversationState]);
  useEffect(() => { if (chatContentRef.current) chatContentRef.current.scrollTop = chatContentRef.current.scrollHeight; }, [conversationHistory]);
  
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
    if (conversationState !== 'idle' && conversationState !== 'error') return;
    setConversationState('preparing'); setError(''); setConversationHistory([]);
    activeAudioSources.current.clear();
    nextAudioStartTime.current = 0;

    const context = await buildContext();
    if (!isMountedRef.current) return;
    if (!context) { setConversationState('error'); return; }
    try {
      const sessionData = await startReviewConversation({
        contextParts: context,
        onMessage: async (message: LiveServerMessage) => {
            if (!isMountedRef.current) return;
            const { serverContent, toolCall } = message;

            if (serverContent?.inputTranscription) {
                const { text, isFinal } = serverContent.inputTranscription;
                setConversationHistory(prev => { const last = prev[prev.length - 1]; if (last?.role === 'user' && !last.isFinal) { return [...prev.slice(0, -1), { role: 'user', text: last.text + text, isFinal }]; } return [...prev, { role: 'user', text, isFinal }]; });
            }
            if (serverContent?.outputTranscription) {
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
                      // Here you would save this to IndexedDB for progress tracking
                      liveSessionRef.current?.session.sendToolResponse({ functionResponses: { id : fc.id, name: fc.name, response: { result: "Answer recorded successfully." } } });
                  }
              }
            }
        },
        onError: (err) => { if (!isMountedRef.current) return; console.error('Conversation error:', err); setError('An error occurred during the session.'); setConversationState('error'); cleanupLiveSession(); },
        onClose: () => { if (!isMountedRef.current) return; if (conversationState !== 'stopping') setConversationState('idle'); cleanupLiveSession(); }
      });
      if (!isMountedRef.current) { sessionData.session?.close(); sessionData.stream?.getTracks().forEach((t: MediaStreamTrack) => t.stop()); return; }
      liveSessionRef.current = sessionData;
      setConversationState('conversing');
      const analyser = sessionData.context.createAnalyser();
      sessionData.source.connect(analyser);
      setAnalyserNode(analyser);
    } catch (e: any) {
        if (!isMountedRef.current) return;
        console.error('Failed to start conversation:', e);
        if (e.name === 'NotAllowedError' || e.message.includes('Permission denied')) setError('Microphone access denied.');
        else setError('Could not start the conversation. Check your microphone.');
        setConversationState('error'); cleanupLiveSession();
    }
  }, [conversationState, buildContext, cleanupLiveSession]);

  return (
    <div className="flex flex-col h-full bg-slate-50">
        <header className="flex-shrink-0 bg-white border-b border-slate-200 p-3 flex items-center justify-between"><div className="flex items-center gap-2"><AcademicCapIcon className="w-7 h-7 text-indigo-600" /><h3 className="text-lg font-bold text-slate-800">Comprehension Review</h3></div>{onClose && (<button onClick={onClose} className="p-1 rounded-full hover:bg-slate-200"><XIcon className="w-5 h-5 text-slate-600" /></button>)}</header>
        <div className="p-3 bg-white border-b border-slate-200">
            <button onClick={() => setIsContextSettingsOpen(p => !p)} className="w-full flex justify-between items-center text-left p-2 rounded-md hover:bg-slate-100"><span className="font-semibold text-slate-700">Review Pages: {Math.min(startPage, endPage)} - {Math.max(startPage, endPage)}</span>{isContextSettingsOpen ? <ChevronUpIcon className="w-5 h-5 text-slate-500" /> : <ChevronDownIcon className="w-5 h-5 text-slate-500" />}</button>
            {isContextSettingsOpen && (
                <div className="mt-3 space-y-3 px-2">
                    <div className="flex items-center gap-2"><label htmlFor="start-page" className="text-sm font-medium text-slate-600 w-12">Start:</label><input type="number" id="start-page" value={startPage} onChange={(e) => setStartPage(Math.max(1, parseInt(e.target.value, 10)))} min="1" max={numPages} disabled={conversationState === 'conversing' || conversationState === 'preparing'} className="w-full p-1 border border-slate-300 rounded-md text-sm" /></div>
                    <div className="flex items-center gap-2"><label htmlFor="end-page" className="text-sm font-medium text-slate-600 w-12">End:</label><input type="number" id="end-page" value={endPage} onChange={(e) => setEndPage(Math.min(numPages, parseInt(e.target.value, 10)))} min="1" max={numPages} disabled={conversationState === 'conversing' || conversationState === 'preparing'} className="w-full p-1 border border-slate-300 rounded-md text-sm" /></div>
                </div>
            )}
        </div>
        <div ref={chatContentRef} className="flex-1 overflow-y-auto p-4 space-y-4">{conversationHistory.map((turn, index) => (<div key={index} className={`flex gap-3 ${turn.role === 'user' ? 'justify-end' : ''}`}>{turn.role === 'model' && <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center flex-shrink-0"><SpeakerWaveIcon className="w-5 h-5 text-white"/></div>}<div className={`max-w-xs md:max-w-sm lg:max-w-md p-3 rounded-2xl ${turn.role === 'user' ? 'bg-blue-500 text-white rounded-br-lg' : 'bg-slate-200 text-slate-800 rounded-bl-lg'}`}><p className="text-sm">{turn.text || '...'}</p></div></div>))}{conversationState === 'preparing' && <div className="text-center text-sm text-slate-500 flex items-center justify-center gap-2"><Loader /> Loading context...</div>}</div>
        {error && <div className="p-3 text-sm text-red-700 bg-red-100 border-t border-red-200">{error}</div>}
        <div className="flex-shrink-0 p-4 bg-white border-t border-slate-200"><div className="flex flex-col items-center justify-center gap-4"><AudioVisualizer analyserNode={analyserNode} />{conversationState === 'idle' || conversationState === 'error' ? (<button onClick={startConversation} className="px-6 py-3 bg-blue-600 text-white font-bold rounded-full shadow-lg hover:bg-blue-700 transition-colors flex items-center gap-2"><MicrophoneIcon className="w-6 h-6" />Start Conversation</button>) : conversationState === 'conversing' ? (<button onClick={stopConversation} className="px-6 py-3 bg-red-600 text-white font-bold rounded-full shadow-lg hover:bg-red-700 transition-colors flex items-center gap-2 animate-pulse"><StopIcon className="w-6 h-6" />End Conversation</button>) : (<button disabled className="px-6 py-3 bg-slate-400 text-white font-bold rounded-full cursor-not-allowed flex items-center gap-2"><Loader />{conversationState === 'preparing' ? 'Preparing...' : 'Stopping...'}</button>)}</div></div>
    </div>
  );
}
