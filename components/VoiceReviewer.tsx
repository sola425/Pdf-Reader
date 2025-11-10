import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Part, LiveServerMessage } from '@google/genai';
import { startReviewConversation } from '../services/geminiService';
import { decode, decodeAudioData } from '../utils/audio';
import { getAudioContext } from '../utils/audioContext';
import { MicrophoneIcon, StopIcon, AcademicCapIcon, XIcon, ChevronDownIcon, SpeakerWaveIcon, ChevronUpIcon } from './Icons';
import { Loader } from './Loader';
import { AudioVisualizer } from './AudioVisualizer';

interface VoiceReviewerProps {
  pdfDoc: any;
  numPages: number;
  currentPage: number;
  onClose?: () => void;
}

type ConversationState = 'idle' | 'preparing' | 'conversing' | 'stopping' | 'error';
type ConversationTurn = {
    role: 'user' | 'model';
    text: string;
    isFinal: boolean;
};

export function VoiceReviewer({ pdfDoc, numPages, currentPage, onClose }: VoiceReviewerProps) {
  const [conversationState, setConversationState] = useState<ConversationState>('idle');
  const [conversationHistory, setConversationHistory] = useState<ConversationTurn[]>([]);
  const [error, setError] = useState<string>('');
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  
  const [startPage, setStartPage] = useState(currentPage);
  const [endPage, setEndPage] = useState(currentPage);
  const [isContextSettingsOpen, setIsContextSettingsOpen] = useState(true);

  const liveSessionRef = useRef<any>(null);
  const audioPlaybackQueue = useRef<string[]>([]);
  const isPlayingAudio = useRef(false);
  const nextAudioStartTime = useRef(0);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const conversationContextRef = useRef<Part[]>([]);
  const chatContentRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (conversationState === 'idle' || conversationState === 'error') {
        setStartPage(currentPage);
        setEndPage(currentPage);
    }
  }, [currentPage, conversationState]);

  useEffect(() => {
    if (chatContentRef.current) {
        chatContentRef.current.scrollTop = chatContentRef.current.scrollHeight;
    }
  }, [conversationHistory]);
  
  const playNextAudioChunk = useCallback(async () => {
    if (isPlayingAudio.current || audioPlaybackQueue.current.length === 0) {
      return;
    }
    isPlayingAudio.current = true;
    
    const base64Audio = audioPlaybackQueue.current.shift();
    if (!base64Audio) {
      isPlayingAudio.current = false;
      return;
    }

    try {
      const outputAudioContext = getAudioContext();
      nextAudioStartTime.current = Math.max(nextAudioStartTime.current, outputAudioContext.currentTime);
      
      const decoded = decode(base64Audio);
      const audioBuffer = await decodeAudioData(decoded, outputAudioContext, 24000, 1);
      
      const source = outputAudioContext.createBufferSource();
      audioSourceRef.current = source;
      source.buffer = audioBuffer;
      source.connect(outputAudioContext.destination);
      source.start(nextAudioStartTime.current);
      
      nextAudioStartTime.current += audioBuffer.duration;

      source.onended = () => {
        if (audioSourceRef.current === source) {
            audioSourceRef.current = null;
        }
        isPlayingAudio.current = false;
        playNextAudioChunk();
      };
    } catch (e) {
      console.error('Audio playback error:', e);
      setError('Could not play back audio.');
      isPlayingAudio.current = false;
    }
  }, []);
  
  const cleanupLiveSession = useCallback(() => {
    if (liveSessionRef.current) {
        liveSessionRef.current.session?.close();
        liveSessionRef.current.stream?.getTracks().forEach((track: MediaStreamTrack) => track.stop());
        if (liveSessionRef.current.scriptProcessor) {
            liveSessionRef.current.scriptProcessor.onaudioprocess = null;
            liveSessionRef.current.scriptProcessor.disconnect();
        }
        liveSessionRef.current.source?.disconnect();
        liveSessionRef.current.context?.close().catch(console.error);
        liveSessionRef.current = null;
    }
    setAnalyserNode(null);
  }, []);

  const stopConversation = useCallback(() => {
    setConversationState('stopping');
    cleanupLiveSession();
    
    if (audioSourceRef.current) {
        audioSourceRef.current.onended = null;
        audioSourceRef.current.stop();
        audioSourceRef.current = null;
    }
    audioPlaybackQueue.current = [];
    isPlayingAudio.current = false;

    setConversationHistory(prev => {
        const last = prev[prev.length - 1];
        // If the last turn was not final, mark it as such
        if (last && !last.isFinal) {
            return [...prev.slice(0, -1), { ...last, isFinal: true }];
        }
        return prev;
    });
    setConversationState('idle');
  }, [cleanupLiveSession]);
  
  const buildContext = useCallback(async (): Promise<Part[] | null> => {
    const start = Math.max(1, Math.min(startPage, endPage));
    const end = Math.min(numPages, Math.max(startPage, endPage));

    if (start > end) {
      setError('Start page cannot be after end page.');
      return null;
    }

    try {
      const contextParts: Part[] = [];
      let hasContent = false;
      
      for (let i = start; i <= end; i++) {
        const page = await pdfDoc.getPage(i);
        
        // Render image for OCR - lower quality for stability
        const viewport = page.getViewport({ scale: 1.2 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) continue;

        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({ canvasContext: context, viewport }).promise;
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        const base64Data = dataUrl.split(',')[1];
        
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item: any) => item.str).join(' ').trim();

        contextParts.push({ text: `\n\n--- PAGE ${i} ---\n` });
        contextParts.push({ inlineData: { mimeType: 'image/jpeg', data: base64Data } });
        if (pageText) {
          contextParts.push({ text: pageText });
        }
        hasContent = true;
      }
      
      if (!hasContent) {
        setError(`Could not find any content on pages ${start}-${end}.`);
        return null;
      }
      return contextParts;
    } catch (e) {
      console.error("Failed to build context:", e);
      setError('Could not extract content from the specified pages.');
      return null;
    }
  }, [pdfDoc, startPage, endPage, numPages]);

  const startConversation = useCallback(async () => {
    if (conversationState !== 'idle' && conversationState !== 'error') return;
    
    setConversationState('preparing');
    setError('');
    setConversationHistory([]);
    audioPlaybackQueue.current = [];
    
    const context = await buildContext();
    if (!context) {
        setConversationState('error');
        return;
    }
    conversationContextRef.current = context;

    try {
      const sessionData = await startReviewConversation({
        contextParts: conversationContextRef.current,
        onMessage: (message: LiveServerMessage) => {
            const { serverContent } = message;
            if (serverContent?.inputTranscription) {
                const { text, isFinal } = serverContent.inputTranscription;
                setConversationHistory(prev => {
                    const lastTurn = prev[prev.length - 1];
                    if (lastTurn?.role === 'user' && !lastTurn.isFinal) {
                        return [...prev.slice(0, -1), { role: 'user', text: lastTurn.text + text, isFinal }];
                    }
                    return [...prev, { role: 'user', text, isFinal }];
                });
            }
            if (serverContent?.outputTranscription) {
                const { text, isFinal } = serverContent.outputTranscription;
                setConversationHistory(prev => {
                    const lastTurn = prev[prev.length - 1];
                    if (lastTurn?.role === 'model' && !lastTurn.isFinal) {
                        return [...prev.slice(0, -1), { role: 'model', text: lastTurn.text + text, isFinal }];
                    }
                    return [...prev, { role: 'model', text, isFinal }];
                });
            }
            if (serverContent?.modelTurn?.parts[0]?.inlineData?.data) {
                audioPlaybackQueue.current.push(serverContent.modelTurn.parts[0].inlineData.data);
                playNextAudioChunk();
            }
        },
        onError: (err) => {
            console.error('Conversation error:', err);
            setError('An error occurred during the session. Please try again.');
            setConversationState('error');
            cleanupLiveSession();
        },
        onClose: () => {
            if (conversationState !== 'stopping') {
                setConversationState('idle');
            }
            cleanupLiveSession();
        },
      });
      liveSessionRef.current = sessionData;
      setConversationState('conversing');

      const audioContext = liveSessionRef.current.context;
      const analyser = audioContext.createAnalyser();
      liveSessionRef.current.source.connect(analyser);
      setAnalyserNode(analyser);

    } catch (e: any) {
        console.error('Failed to start conversation:', e);
        if (e.name === 'NotAllowedError' || e.message.includes('Permission denied')) {
            setError('Microphone access denied. Please enable it in browser settings.');
        } else {
            setError('Could not start the conversation. Please check your microphone.');
        }
        setConversationState('error');
        cleanupLiveSession();
    }
  }, [conversationState, buildContext, cleanupLiveSession, playNextAudioChunk]);

  return (
    <div className="flex flex-col h-full bg-slate-50">
        <header className="flex-shrink-0 bg-white border-b border-slate-200 p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
                <AcademicCapIcon className="w-7 h-7 text-indigo-600" />
                <h3 className="text-lg font-bold text-slate-800">Comprehension Review</h3>
            </div>
            {onClose && (
                <button onClick={onClose} className="p-1 rounded-full hover:bg-slate-200">
                    <XIcon className="w-5 h-5 text-slate-600" />
                </button>
            )}
        </header>
        
        <div className="p-3 bg-white border-b border-slate-200">
            <button 
                onClick={() => setIsContextSettingsOpen(prev => !prev)}
                className="w-full flex justify-between items-center text-left p-2 rounded-md hover:bg-slate-100"
            >
                <span className="font-semibold text-slate-700">Review Pages: {Math.min(startPage, endPage)} - {Math.max(startPage, endPage)}</span>
                {isContextSettingsOpen ? <ChevronUpIcon className="w-5 h-5 text-slate-500" /> : <ChevronDownIcon className="w-5 h-5 text-slate-500" />}
            </button>
            {isContextSettingsOpen && (
                <div className="mt-3 space-y-3 px-2">
                    <div className="flex items-center gap-2">
                        <label htmlFor="start-page" className="text-sm font-medium text-slate-600 w-12">Start:</label>
                        <input
                            type="number" id="start-page"
                            value={startPage}
                            onChange={(e) => setStartPage(Math.max(1, parseInt(e.target.value, 10)))}
                            min="1" max={numPages}
                            disabled={conversationState === 'conversing' || conversationState === 'preparing'}
                            className="w-full p-1 border border-slate-300 rounded-md text-sm"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <label htmlFor="end-page" className="text-sm font-medium text-slate-600 w-12">End:</label>
                        <input
                            type="number" id="end-page"
                            value={endPage}
                            onChange={(e) => setEndPage(Math.min(numPages, parseInt(e.target.value, 10)))}
                            min="1" max={numPages}
                            disabled={conversationState === 'conversing' || conversationState === 'preparing'}
                            className="w-full p-1 border border-slate-300 rounded-md text-sm"
                        />
                    </div>
                </div>
            )}
        </div>

        <div ref={chatContentRef} className="flex-1 overflow-y-auto p-4 space-y-4">
            {conversationHistory.map((turn, index) => (
                <div key={index} className={`flex gap-3 ${turn.role === 'user' ? 'justify-end' : ''}`}>
                    {turn.role === 'model' && <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center flex-shrink-0"><SpeakerWaveIcon className="w-5 h-5 text-white"/></div>}
                    <div className={`max-w-xs md:max-w-sm lg:max-w-md p-3 rounded-2xl ${turn.role === 'user' ? 'bg-blue-500 text-white rounded-br-lg' : 'bg-slate-200 text-slate-800 rounded-bl-lg'}`}>
                        <p className="text-sm">{turn.text || '...'}</p>
                    </div>
                </div>
            ))}
            {conversationState === 'preparing' && 
                <div className="text-center text-sm text-slate-500 flex items-center justify-center gap-2">
                    <Loader /> Loading context...
                </div>
            }
        </div>

        {error && <div className="p-3 text-sm text-red-700 bg-red-100 border-t border-red-200">{error}</div>}

        <div className="flex-shrink-0 p-4 bg-white border-t border-slate-200">
            <div className="flex flex-col items-center justify-center gap-4">
                <AudioVisualizer analyserNode={analyserNode} />
                {conversationState === 'idle' || conversationState === 'error' ? (
                    <button onClick={startConversation} className="px-6 py-3 bg-blue-600 text-white font-bold rounded-full shadow-lg hover:bg-blue-700 transition-colors flex items-center gap-2">
                        <MicrophoneIcon className="w-6 h-6" />
                        Start Conversation
                    </button>
                ) : conversationState === 'conversing' ? (
                    <button onClick={stopConversation} className="px-6 py-3 bg-red-600 text-white font-bold rounded-full shadow-lg hover:bg-red-700 transition-colors flex items-center gap-2 animate-pulse">
                        <StopIcon className="w-6 h-6" />
                        End Conversation
                    </button>
                ) : (
                    <button disabled className="px-6 py-3 bg-slate-400 text-white font-bold rounded-full cursor-not-allowed flex items-center gap-2">
                        <Loader />
                        {conversationState === 'preparing' ? 'Preparing...' : 'Stopping...'}
                    </button>
                )}
            </div>
        </div>
    </div>
  );
}