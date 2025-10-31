import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Chat } from '@google/genai';
import { startPageChatSession, generateSpeech, createLiveSession } from '../services/geminiService';
import { decode, decodeAudioData } from '../utils/audio';
import { Loader } from './Loader';
import { MicrophoneIcon, StopIcon, XCircleIcon } from './Icons';

interface PageChatProps {
  pdfDoc: any;
  numPages: number;
  currentPage: number;
  isOpen: boolean;
  onClose: () => void;
}

type ChatMessage = {
  role: 'user' | 'model' | 'system';
  text: string;
};

type ChatState = 'idle' | 'loading_context' | 'context_loaded' | 'listening' | 'processing_speech' | 'processing_model' | 'speaking';

export function PageChat({ pdfDoc, numPages, currentPage, isOpen, onClose }: PageChatProps) {
  const [startPage, setStartPage] = useState(currentPage);
  const [endPage, setEndPage] = useState(currentPage);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatState, setChatState] = useState<ChatState>('idle');
  const [error, setError] = useState('');
  
  const chatSessionRef = useRef<Chat | null>(null);
  const liveSessionCleanupRef = useRef<(() => void) | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const chatContentRef = useRef<HTMLDivElement>(null);
  const finalTranscriptRef = useRef<string>('');

  useEffect(() => {
    setStartPage(currentPage);
    setEndPage(currentPage);
  }, [currentPage]);

  useEffect(() => {
      if (chatContentRef.current) {
        chatContentRef.current.scrollTop = chatContentRef.current.scrollHeight;
      }
  }, [chatHistory]);

  const resetChat = () => {
    setChatHistory([]);
    chatSessionRef.current = null;
    setError('');
    setChatState('idle');
    if (liveSessionCleanupRef.current) liveSessionCleanupRef.current();
  };

  const handleLoadContext = async () => {
    resetChat();
    setChatState('loading_context');
    setError('');

    const start = Math.max(1, Math.min(startPage, endPage));
    const end = Math.min(numPages, Math.max(startPage, endPage));
    
    if (start > end) {
        setError('Start page cannot be after end page.');
        setChatState('idle');
        return;
    }
    
    try {
      let fullText = '';
      for (let i = start; i <= end; i++) {
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item: any) => 'str' in item ? item.str : '').join(' ');
        fullText += `--- Page ${i} ---\n${pageText}\n\n`;
      }
      
      chatSessionRef.current = startPageChatSession(fullText);
      setChatState('context_loaded');
      setChatHistory([{ role: 'system', text: `AI context loaded for pages ${start}-${end}. Ask me anything about these pages!` }]);
    } catch (e) {
      console.error("Failed to load context:", e);
      setError('Could not extract text from the specified pages.');
      setChatState('idle');
    }
  };

  const playAudio = async (base64Audio: string) => {
    if (!outputAudioContextRef.current || outputAudioContextRef.current.state === 'closed') {
        outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    const context = outputAudioContextRef.current;
    
    try {
        const decoded = decode(base64Audio);
        const audioBuffer = await decodeAudioData(decoded, context, 24000, 1);
        const source = context.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(context.destination);
        source.start();
        source.onended = () => {
            setChatState('context_loaded');
        };
    } catch (e) {
        console.error("Failed to play audio:", e);
        setError("Could not play the AI's response.");
        setChatState('context_loaded');
    }
  };

  const processUserSpeech = useCallback(async (text: string) => {
    if (text.trim().length < 2) {
      setChatState('context_loaded');
      return;
    }
    
    setChatHistory(prev => [...prev, { role: 'user', text }]);
    setChatState('processing_model');

    try {
      if (!chatSessionRef.current) throw new Error("Chat session not initialized.");
      
      const response = await chatSessionRef.current.sendMessage({ message: text });
      const aiText = response.text;
      
      setChatHistory(prev => [...prev, { role: 'model', text: aiText }]);
      setChatState('speaking');

      const audioData = await generateSpeech(aiText);
      if (audioData) {
        await playAudio(audioData);
      } else {
        setError("Could not generate speech for the AI's response.");
        setChatState('context_loaded');
      }

    } catch (e) {
      console.error("Chat processing error:", e);
      setError("An error occurred while talking to the AI.");
      setChatState('context_loaded');
    }
  }, []);

  const startListening = async () => {
    setChatState('listening');
    finalTranscriptRef.current = '';

    try {
        const { session, stream, context, workletNode, source } = await createLiveSession({
            onTranscriptionUpdate: (textChunk) => {
                // Not showing interim results for this UI to keep it clean
            },
            onTurnComplete: () => {
                // Since the live session can have multiple turns, we'll just capture the first one.
                if (finalTranscriptRef.current === '' && session.transcription) {
                    finalTranscriptRef.current = session.transcription;
                    stopListeningAndProcess();
                }
            },
            onError: (err) => {
              console.error('Live session error:', err);
              setError('A recording error occurred.');
              setChatState('context_loaded');
            }
        });

        liveSessionCleanupRef.current = () => {
            session.close();
            stream.getTracks().forEach(track => track.stop());
            workletNode.disconnect();
            source.disconnect();
            if (context.state !== 'closed') context.close();
        };

    } catch (e) {
        console.error("Failed to start listening:", e);
        setError("Could not access microphone.");
        setChatState('context_loaded');
    }
  };

  const stopListeningAndProcess = () => {
    setChatState('processing_speech');
    if (liveSessionCleanupRef.current) {
        liveSessionCleanupRef.current();
        liveSessionCleanupRef.current = null;
    }
    // A small delay to ensure the final transcript is captured.
    setTimeout(() => {
        processUserSpeech(finalTranscriptRef.current);
    }, 100);
  };
  
  if (!isOpen) return null;

  const renderMicButton = () => {
    const isMicDisabled = chatState === 'idle' || chatState === 'loading_context' || chatState === 'processing_model' || chatState === 'speaking' || chatState === 'processing_speech';
    
    if (chatState === 'listening') {
        return (
            <button onClick={stopListeningAndProcess} className="w-16 h-16 bg-red-600 text-white rounded-full flex items-center justify-center shadow-lg animate-pulse">
                <StopIcon className="w-8 h-8" />
            </button>
        );
    }

    return (
        <button onClick={startListening} disabled={isMicDisabled} className="w-16 h-16 bg-indigo-600 text-white rounded-full flex items-center justify-center shadow-lg disabled:bg-slate-400 disabled:cursor-not-allowed">
            <MicrophoneIcon className="w-8 h-8" />
        </button>
    );
  };

  return (
    <div className="absolute bottom-4 right-4 w-full max-w-md h-[70vh] max-h-[600px] bg-white rounded-xl shadow-2xl border border-gray-200 flex flex-col z-50 animate-fade-in">
        <header className="p-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
            <h2 className="text-lg font-bold text-slate-800">Chat with AI</h2>
            <button onClick={onClose} className="p-1 rounded-full hover:bg-slate-200">
                <XCircleIcon className="w-6 h-6 text-slate-500" />
            </button>
        </header>

        <div className="p-4 flex-shrink-0 border-b border-gray-200 bg-slate-50">
            <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-700">Pages:</span>
                <input type="number" value={startPage} onChange={e => setStartPage(parseInt(e.target.value, 10))} min={1} max={numPages} className="w-16 p-1 border border-slate-300 rounded-md text-sm" />
                <span className="text-sm font-medium text-slate-700">-</span>
                <input type="number" value={endPage} onChange={e => setEndPage(parseInt(e.target.value, 10))} min={1} max={numPages} className="w-16 p-1 border border-slate-300 rounded-md text-sm" />
                <button onClick={handleLoadContext} disabled={chatState === 'loading_context'} className="px-3 py-1 bg-indigo-100 text-indigo-700 text-sm font-semibold rounded-md hover:bg-indigo-200 disabled:opacity-50">
                    {chatState === 'loading_context' ? 'Loading...' : 'Load Context'}
                </button>
            </div>
            {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        </div>

        <div ref={chatContentRef} className="flex-1 p-4 overflow-y-auto space-y-4">
            {chatHistory.map((msg, index) => (
                <div key={index} className={`flex items-end gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                   {msg.role === 'model' && <div className="w-6 h-6 rounded-full bg-indigo-500 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">AI</div>}
                   <div className={`max-w-xs md:max-w-sm px-3 py-2 rounded-xl ${
                       msg.role === 'user' ? 'bg-indigo-500 text-white' : 
                       msg.role === 'model' ? 'bg-slate-100 text-slate-800' : 'bg-transparent text-slate-500 text-sm italic text-center w-full'
                   }`}>
                       <p className="text-sm">{msg.text}</p>
                   </div>
                </div>
            ))}
            {['processing_model', 'processing_speech'].includes(chatState) && (
                <div className="flex items-end gap-2 justify-start">
                    <div className="w-6 h-6 rounded-full bg-indigo-500 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">AI</div>
                    <div className="px-3 py-2 rounded-xl bg-slate-100 text-slate-800">
                        <span className="inline-block w-2 h-2 bg-indigo-400 rounded-full animate-bounce delay-0"></span>
                        <span className="inline-block w-2 h-2 bg-indigo-400 rounded-full animate-bounce delay-100 mx-1"></span>
                        <span className="inline-block w-2 h-2 bg-indigo-400 rounded-full animate-bounce delay-200"></span>
                    </div>
                </div>
            )}
        </div>
        
        <footer className="p-4 border-t border-gray-200 flex flex-col items-center justify-center flex-shrink-0">
             {renderMicButton()}
             <p className="text-xs text-slate-500 mt-2 h-4">
                 {chatState === 'listening' && 'Listening...'}
                 {chatState === 'speaking' && 'AI is speaking...'}
                 {chatState === 'processing_speech' && 'Processing your speech...'}
                 {chatState === 'processing_model' && 'Thinking...'}
             </p>
        </footer>
    </div>
  );
}
