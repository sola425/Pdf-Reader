import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Chat, Part } from '@google/genai';
import { startPageChatSession } from '../services/geminiService';
import * as db from '../utils/db';
import { Loader } from './Loader';
import { MicrophoneIcon, StopIcon, XCircleIcon, ChevronDownIcon, ChevronUpIcon, XIcon } from './Icons';
import { ProcessedPageData } from '../types';

interface PageChatProps {
  documentId: string;
  numPages: number;
  currentPage: number;
  isOpen: boolean;
  onClose: () => void;
}

type ChatMessage = { role: 'user' | 'model' | 'system'; text: string; };
type ChatState = 'idle' | 'loading_context' | 'context_loaded' | 'listening' | 'stopping' | 'processing_speech' | 'processing_model' | 'speaking';

const FormattedMessage = ({ text }: { text: string }) => {
    const lines = text.split('\n');
    return (
        <div className="text-sm break-words space-y-2">
            {lines.map((line, index) => {
                if (!line.trim()) return null;
                if (line.trim().startsWith('* ')) {
                    const content = line.trim().substring(2);
                    const parts = content.split(/(\*\*.*?\*\*)/g).filter(Boolean);
                    return (
                        <div key={index} className="flex items-start">
                            <span className="mr-2 mt-2 block w-1.5 h-1.5 rounded-full bg-slate-500 flex-shrink-0"></span>
                            <p>{parts.map((part, partIndex) => part.startsWith('**') && part.endsWith('**') ? <strong key={partIndex}>{part.slice(2, -2)}</strong> : <span key={partIndex}>{part}</span>)}</p>
                        </div>
                    );
                }
                const parts = line.split(/(\*\*.*?\*\*)/g).filter(Boolean);
                return <p key={index}>{parts.map((part, partIndex) => part.startsWith('**') && part.endsWith('**') ? <strong key={partIndex}>{part.slice(2, -2)}</strong> : <span key={partIndex}>{part}</span>)}</p>;
            })}
        </div>
    );
};

export function PageChat({ documentId, numPages, currentPage, isOpen, onClose }: PageChatProps) {
  const [startPage, setStartPage] = useState(currentPage);
  const [endPage, setEndPage] = useState(currentPage);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatState, setChatState] = useState<ChatState>('idle');
  const [error, setError] = useState('');
  const [isContextSettingsOpen, setIsContextSettingsOpen] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [selectedVoice, setSelectedVoice] = useState<SpeechSynthesisVoice | null>(null);
  
  const chatSessionRef = useRef<Chat | null>(null);
  const liveSessionRef = useRef<any>(null);
  const speechPlaybackRef = useRef<SpeechSynthesisUtterance | null>(null);
  const chatContentRef = useRef<HTMLDivElement | null>(null);
  const finalTranscriptRef = useRef<string>('');
  const interimTranscriptRef = useRef<string>('');
  const modalRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isMountedRef = useRef(false);

  const cleanupLiveSession = useCallback(() => {
    if (liveSessionRef.current) {
        liveSessionRef.current.session?.close();
        liveSessionRef.current.stream?.getTracks().forEach((track: MediaStreamTrack) => track.stop());
        if (liveSessionRef.current.scriptProcessor) liveSessionRef.current.scriptProcessor.disconnect();
        liveSessionRef.current.source?.disconnect();
        liveSessionRef.current.context?.close().catch(console.error);
        liveSessionRef.current = null;
    }
  }, []);

  const stopSpeechPlayback = useCallback(() => {
    if (speechPlaybackRef.current) { speechSynthesis.cancel(); speechPlaybackRef.current = null; }
  }, []);

  useEffect(() => { isMountedRef.current = true; return () => { isMountedRef.current = false; cleanupLiveSession(); stopSpeechPlayback(); }; }, [cleanupLiveSession, stopSpeechPlayback]);
  useEffect(() => { if (chatState === 'idle' || chatState === 'context_loaded') { setStartPage(currentPage); setEndPage(currentPage); } }, [currentPage, chatState]);
  useEffect(() => { if (chatContentRef.current) chatContentRef.current.scrollTop = chatContentRef.current.scrollHeight; }, [chatHistory]);
  
    // Effect to load voices and find a male one
  useEffect(() => {
    const loadAndSetVoice = () => {
        const voices = speechSynthesis.getVoices();
        if (voices.length === 0) return; 

        const maleEnglishVoices = voices.filter(voice => 
            voice.lang.startsWith('en') && 
            /male/i.test(voice.name)
        );

        let voiceToSet: SpeechSynthesisVoice | null = null;
        if (maleEnglishVoices.length > 0) {
            voiceToSet = maleEnglishVoices.find(v => /google/i.test(v.name)) || maleEnglishVoices[0];
        } else {
            const englishVoices = voices.filter(voice => voice.lang.startsWith('en'));
            if (englishVoices.length > 0) {
                voiceToSet = englishVoices[0];
            } else {
                voiceToSet = voices[0];
            }
        }
        setSelectedVoice(voiceToSet);
    };

    loadAndSetVoice();
    speechSynthesis.addEventListener('voiceschanged', loadAndSetVoice);
    return () => {
        speechSynthesis.removeEventListener('voiceschanged', loadAndSetVoice);
    };
  }, []);

  const resetChat = useCallback(() => { setChatHistory([]); chatSessionRef.current = null; setError(''); setChatState('idle'); cleanupLiveSession(); stopSpeechPlayback(); }, [cleanupLiveSession, stopSpeechPlayback]);

  const handleLoadContext = useCallback(async () => {
    resetChat();
    setChatState('loading_context');
    setError('');
    const start = Math.max(1, Math.min(startPage, endPage));
    const end = Math.min(numPages, Math.max(startPage, endPage));
    setChatHistory([{ role: 'system', text: `Loading content for pages ${start}-${end}...` }]);
    if (start > end) { if (!isMountedRef.current) return; setError('Start page cannot be after end page.'); setChatState('idle'); return; }
    
    try {
      const allPagesData = await db.loadProcessedData(documentId);
      if (!isMountedRef.current) return;
      if (!allPagesData || allPagesData.length === 0) throw new Error("No processed data found. Please try resetting.");
      const relevantPages = allPagesData.filter(p => p.pageNum >= start && p.pageNum <= end);
      if (relevantPages.length === 0) {
        if (!isMountedRef.current) return;
        setChatHistory([{ role: 'model', text: `It looks like pages ${start}-${end} are empty or couldn't be processed.` }]);
        setChatState('context_loaded'); chatSessionRef.current = null; return;
      }
      const contextParts: Part[] = relevantPages.flatMap((page: ProcessedPageData) => [
        { text: `\n\n--- PAGE ${page.pageNum} ---\n` },
        { inlineData: { mimeType: 'image/jpeg', data: page.image } },
        ...(page.text ? [{ text: page.text + '\n' }] : [])
      ]);
      chatSessionRef.current = startPageChatSession(contextParts);
      if (!isMountedRef.current) return;
      setChatState('context_loaded');
      setChatHistory([{ role: 'system', text: `AI context loaded for pages ${start}-${end}. Ask me anything about this section!` }]);
    } catch (e) {
      console.error("Failed to load context:", e);
      if (!isMountedRef.current) return;
      setError(e instanceof Error ? e.message : 'Could not load content from the database.');
      setChatState('idle');
    }
  }, [documentId, startPage, endPage, numPages, resetChat]);

  useEffect(() => { if (isOpen && chatState === 'idle') handleLoadContext(); }, [isOpen, chatState, handleLoadContext]);
  
  const handleSendMessage = useCallback(async (text: string) => {
    if (text.trim().length < 1) { if (!isMountedRef.current) return; setChatState('context_loaded'); return; }
    stopSpeechPlayback();
    if (!isMountedRef.current) return;
    setChatHistory(prev => [...prev, { role: 'user', text }]);
    setChatState('processing_model');
    setTextInput('');
    try {
      if (!chatSessionRef.current) throw new Error("Chat session not initialized.");
      const responseStream = await chatSessionRef.current.sendMessageStream({ message: text });
      let aiText = '';
      if (!isMountedRef.current) return;
      setChatState('speaking');
      for await (const chunk of responseStream) {
        if (!isMountedRef.current) break;
        aiText += chunk.text;
        setChatHistory(prev => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg?.role === 'model') return [...prev.slice(0, -1), { ...lastMsg, text: aiText }];
            return [...prev, { role: 'model', text: aiText }];
        });
      }
      if (!isMountedRef.current) return;
      if (aiText) {
        const utterance = new SpeechSynthesisUtterance(aiText);
        if (selectedVoice) {
            utterance.voice = selectedVoice;
        }
        speechPlaybackRef.current = utterance;
        utterance.onend = () => { if (!isMountedRef.current) return; speechPlaybackRef.current = null; setChatState('context_loaded'); };
        utterance.onerror = (e) => { console.error("Speech synthesis error:", e); if (!isMountedRef.current) return; speechPlaybackRef.current = null; setChatState('context_loaded'); };
        speechSynthesis.speak(utterance);
      } else {
        if (!isMountedRef.current) return;
        setChatState('context_loaded');
      }
    } catch (e) {
      console.error("Chat processing error:", e);
      if (!isMountedRef.current) return;
      const message = e instanceof Error ? e.message : 'An unknown error occurred.';
      setError(`An error occurred while talking to the AI: ${message}`);
      setChatHistory(prev => [...prev, {role: 'model', text: `Sorry, I ran into a problem: ${message}`}])
      setChatState('context_loaded');
    }
  }, [stopSpeechPlayback, selectedVoice]);
  
  const handleClose = () => { stopSpeechPlayback(); onClose(); };
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-4 bg-black/50 animate-fade-in" role="dialog" aria-modal="true">
      <div ref={modalRef} className="bg-white rounded-xl shadow-2xl w-full max-w-2xl h-[90vh] max-h-[700px] flex flex-col overflow-hidden">
        <header className="p-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Chat About Document</h2>
            <button onClick={() => setIsContextSettingsOpen(p => !p)} className="text-sm text-slate-600 hover:text-blue-600 flex items-center gap-1">
              <span>Reviewing Pages: {Math.min(startPage, endPage)} - {Math.max(startPage, endPage)}</span>
              {isContextSettingsOpen ? <ChevronUpIcon className="w-4 h-4" /> : <ChevronDownIcon className="w-4 h-4" />}
            </button>
          </div>
          <button onClick={handleClose} className="p-2 rounded-full hover:bg-slate-200 transition-colors" aria-label="Close chat"><XIcon className="w-6 h-6 text-slate-600" /></button>
        </header>
        {isContextSettingsOpen && (
            <div className="p-4 bg-slate-50 border-b border-slate-200 space-y-3">
                <div className="flex items-center gap-4">
                    <div className="flex-1"><label htmlFor="chat-start-page" className="block text-sm font-medium text-slate-700 mb-1">Start Page</label><input type="number" id="chat-start-page" value={startPage} onChange={(e) => setStartPage(Math.max(1, parseInt(e.target.value, 10) || 1))} className="w-full p-2 border border-slate-300 rounded-md" min="1" max={numPages} /></div>
                    <div className="flex-1"><label htmlFor="chat-end-page" className="block text-sm font-medium text-slate-700 mb-1">End Page</label><input type="number" id="chat-end-page" value={endPage} onChange={(e) => setEndPage(Math.min(numPages, parseInt(e.target.value, 10) || 1))} className="w-full p-2 border border-slate-300 rounded-md" min="1" max={numPages} /></div>
                </div>
                <button onClick={handleLoadContext} disabled={chatState === 'loading_context'} className="w-full px-4 py-2 bg-indigo-600 text-white font-semibold rounded-md hover:bg-indigo-700 disabled:bg-indigo-300"> {chatState === 'loading_context' ? 'Loading...' : 'Load Page Context'}</button>
            </div>
        )}
        <div ref={chatContentRef} className="flex-1 overflow-y-auto p-4 space-y-4">
            {chatHistory.map((msg, index) => (
                <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'items-start gap-3'}`}>
                    {msg.role === 'model' && (
                        <div className="w-8 h-8 rounded-full bg-slate-700 text-white flex items-center justify-center flex-shrink-0 font-bold text-sm">AI</div>
                    )}
                    <div className={`p-3 rounded-lg max-w-lg ${msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-800'}`}>
                        {msg.role === 'system' ? (
                            <p className="text-sm text-center text-slate-500 italic">{msg.text}</p>
                        ) : (
                            <FormattedMessage text={msg.text} />
                        )}
                    </div>
                </div>
            ))}
            {(chatState === 'processing_model' || chatState === 'processing_speech') && <div className="flex gap-3 items-start"><div className="w-8 h-8 rounded-full bg-slate-700 text-white flex items-center justify-center flex-shrink-0 font-bold text-sm">AI</div><div className="p-3 rounded-lg bg-slate-100 text-slate-800 flex items-center"><Loader /></div></div>}
        </div>
        {error && <div className="p-3 text-sm font-medium text-red-800 bg-red-100 border-t border-red-200 flex items-center gap-2"><XCircleIcon className="w-5 h-5 flex-shrink-0" /><span>{error}</span></div>}
        <div className="p-4 border-t border-slate-200 bg-white flex-shrink-0"><form onSubmit={(e) => { e.preventDefault(); handleSendMessage(textInput); }} className="flex items-end gap-2"><textarea ref={textareaRef} value={textInput} onChange={(e) => setTextInput(e.target.value)} onKeyDown={(e) => {if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(textInput); }}} placeholder="Type your question..." rows={1} className="flex-1 w-full p-2 border border-slate-300 rounded-md resize-none focus:ring-2 focus:ring-blue-500" disabled={chatState !== 'context_loaded' || !chatSessionRef.current} /><button type="submit" disabled={chatState !== 'context_loaded' || !chatSessionRef.current || !textInput.trim()} className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-md hover:bg-blue-700 disabled:bg-slate-400">Send</button></form></div>
      </div>
    </div>
  );
}
