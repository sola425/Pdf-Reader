import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Chat, Part } from '@google/genai';
import { startPageChatSession } from '../services/geminiService';
import { createLiveSession } from '../services/geminiService';
import { decode, decodeAudioData } from '../utils/audio';
import { getAudioContext } from '../utils/audioContext';
import { Loader } from './Loader';
import { MicrophoneIcon, StopIcon, XCircleIcon, ChevronDownIcon, SpeakerWaveIcon, ChevronUpIcon, XIcon } from './Icons';

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

type ChatState = 'idle' | 'loading_context' | 'context_loaded' | 'listening' | 'stopping' | 'processing_speech' | 'processing_model' | 'speaking';

// Renders model responses with simple formatting for lists and bold text.
const FormattedMessage = ({ text }: { text: string }) => {
    const lines = text.split('\n');

    return (
        <div className="text-sm break-words space-y-2">
            {lines.map((line, index) => {
                if (!line.trim()) return null;

                // Handle list items: "* Item"
                if (line.trim().startsWith('* ')) {
                    const content = line.trim().substring(2);
                    const parts = content.split(/(\*\*.*?\*\*)/g).filter(Boolean);
                    return (
                        <div key={index} className="flex items-start">
                            <span className="mr-2 mt-2 block w-1.5 h-1.5 rounded-full bg-slate-500 flex-shrink-0"></span>
                            <p>
                                {parts.map((part, partIndex) => 
                                    part.startsWith('**') && part.endsWith('**')
                                        ? <strong key={partIndex}>{part.slice(2, -2)}</strong>
                                        : <span key={partIndex}>{part}</span>
                                )}
                            </p>
                        </div>
                    );
                }
                
                // Handle regular paragraph lines with bolding: "**Bolded** text"
                const parts = line.split(/(\*\*.*?\*\*)/g).filter(Boolean);
                return (
                    <p key={index}>
                        {parts.map((part, partIndex) => 
                            part.startsWith('**') && part.endsWith('**')
                                ? <strong key={partIndex}>{part.slice(2, -2)}</strong>
                                : <span key={partIndex}>{part}</span>
                        )}
                    </p>
                );
            })}
        </div>
    );
};

export function PageChat({ pdfDoc, numPages, currentPage, isOpen, onClose }: PageChatProps) {
  const [startPage, setStartPage] = useState(currentPage);
  const [endPage, setEndPage] = useState(currentPage);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatState, setChatState] = useState<ChatState>('idle');
  const [error, setError] = useState('');
  const [isContextSettingsOpen, setIsContextSettingsOpen] = useState(false);
  const [textInput, setTextInput] = useState('');
  
  const chatSessionRef = useRef<Chat | null>(null);
  const liveSessionRef = useRef<any>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const chatContentRef = useRef<HTMLDivElement>(null);
  const finalTranscriptRef = useRef<string>('');
  const interimTranscriptRef = useRef<string>('');
  const modalRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Update page range selectors when the main viewer page changes, but only if chat is idle.
    if (chatState === 'idle' || chatState === 'context_loaded') {
        setStartPage(currentPage);
        setEndPage(currentPage);
    }
  }, [currentPage, chatState]);

  useEffect(() => {
      if (chatContentRef.current) {
        chatContentRef.current.scrollTop = chatContentRef.current.scrollHeight;
      }
  }, [chatHistory]);
  
  // Focus trapping for accessibility
  useEffect(() => {
    if (!isOpen) return;
    const modal = modalRef.current;
    if (!modal) return;

    const focusableElements = Array.from(modal.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )) as HTMLElement[];

    if (focusableElements.length === 0) return;
    
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key !== 'Tab') return;
        if (e.shiftKey) { // Shift+Tab
            if (document.activeElement === firstElement) {
                lastElement.focus();
                e.preventDefault();
            }
        } else { // Tab
            if (document.activeElement === lastElement) {
                firstElement.focus();
                e.preventDefault();
            }
        }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    firstElement?.focus();

    return () => {
        document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  // Auto-growing textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto'; // Reset height to recalculate
      const scrollHeight = textarea.scrollHeight;
      const maxHeight = 120; // Approx 5 * 24px line-height
      if (scrollHeight > maxHeight) {
        textarea.style.height = `${maxHeight}px`;
        textarea.style.overflowY = 'auto';
      } else {
        textarea.style.height = `${scrollHeight}px`;
        textarea.style.overflowY = 'hidden';
      }
    }
  }, [textInput]);

  const cleanupLiveSession = useCallback(() => {
    if (liveSessionRef.current) {
        liveSessionRef.current.session?.close();
        liveSessionRef.current.stream?.getTracks().forEach((track: MediaStreamTrack) => track.stop());
        if (liveSessionRef.current.scriptProcessor) {
            liveSessionRef.current.scriptProcessor.onaudioprocess = null;
            liveSessionRef.current.scriptProcessor.disconnect();
        }
        liveSessionRef.current.source?.disconnect();
        if (liveSessionRef.current.context?.state !== 'closed') {
            liveSessionRef.current.context?.close();
        }
        liveSessionRef.current = null;
    }
  }, []);

  const resetChat = useCallback(() => {
    setChatHistory([]);
    chatSessionRef.current = null;
    setError('');
    setChatState('idle');
    cleanupLiveSession();
  }, [cleanupLiveSession]);

  const handleLoadContext = useCallback(async () => {
    resetChat();
    setChatState('loading_context');
    setError('');

    const start = Math.max(1, Math.min(startPage, endPage));
    const end = Math.min(numPages, Math.max(startPage, endPage));
    
    setChatHistory([{ role: 'system', text: `Loading content for pages ${start}-${end}...` }]);

    if (start > end) {
        setError('Start page cannot be after end page.');
        setChatState('idle');
        return;
    }
    
    try {
        const contextParts: Part[] = [];
        let hasContent = false;

        for (let i = start; i <= end; i++) {
            const page = await pdfDoc.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map((item: any) => item.str).join(' ').trim();
            const hasMeaningfulText = pageText.replace(/\s/g, '').length > 50;

            const viewport = page.getViewport({ scale: 1.5 });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            if (!context) continue;

            canvas.height = viewport.height;
            canvas.width = viewport.width;

            await page.render({ canvasContext: context, viewport }).promise;

            const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
            const base64Data = dataUrl.split(',')[1];
            
            contextParts.push({ text: `\n\n--- PAGE ${i} ---\n` });

            if (hasMeaningfulText) {
                const cleanedText = pageText.replace(/ +/g, ' ').replace(/ \n/g, '\n');
                // Send image first, then text, to help model ground its analysis
                contextParts.push({ inlineData: { mimeType: 'image/jpeg', data: base64Data }});
                contextParts.push({ text: cleanedText + '\n' });
                hasContent = true;
            } else {
                // For pages with little text (like charts), the image is the primary content
                contextParts.push({ inlineData: { mimeType: 'image/jpeg', data: base64Data }});
                if(pageText) contextParts.push({ text: `\nSparse text found on page: "${pageText}"\n`});
                hasContent = true;
            }
        }
      
      if (!hasContent) {
        const pageRange = start === end ? `page ${start}` : `pages ${start}-${end}`;
        setChatHistory([{ 
            role: 'model',
            text: `It looks like ${pageRange} is empty. I can't find any text or images to analyze. Please select a different page or range with content.` 
        }]);
        setChatState('context_loaded');
        chatSessionRef.current = null;
        return;
      }

      chatSessionRef.current = startPageChatSession(contextParts);
      setChatState('context_loaded');
      setChatHistory([{ role: 'system', text: `AI context loaded for pages ${start}-${end}. Ask me anything about this section!` }]);
    } catch (e) {
      console.error("Failed to load context:", e);
      setError('Could not extract content from the specified pages.');
      setChatState('idle');
    }
  }, [pdfDoc, startPage, endPage, numPages, resetChat]);


  // Auto-load context when the component becomes visible
  useEffect(() => {
    if (isOpen && chatState === 'idle') {
        handleLoadContext();
    }
  }, [isOpen, chatState, handleLoadContext]);

  const handleSendMessage = useCallback(async (text: string) => {
    if (text.trim().length < 1) {
      setChatState('context_loaded');
      return;
    }
    
    setChatHistory(prev => [...prev, { role: 'user', text }]);
    setChatState('processing_model');
    setTextInput('');

    try {
      if (!chatSessionRef.current) throw new Error("Chat session not initialized.");
      
      const responseStream = await chatSessionRef.current.sendMessageStream({ message: text });
      
      let aiText = '';
      setChatState('speaking');
      
      for await (const chunk of responseStream) {
        aiText += chunk.text;
        setChatHistory(prev => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg.role === 'model') {
                lastMsg.text = aiText;
                return [...prev];
            }
            return [...prev, { role: 'model', text: aiText }];
        });
      }
      
      setChatState('context_loaded');

    } catch (e) {
      console.error("Chat processing error:", e);
      const message = e instanceof Error ? e.message : 'An unknown error occurred.';
      const errorMessage = `An error occurred while talking to the AI: ${message}`;
      setError(errorMessage);
      setChatHistory(prev => [...prev, {role: 'model', text: `Sorry, I ran into a problem: ${message}`}])
      setChatState('context_loaded');
    }
  }, []);
  
  const processTranscriptAndSend = useCallback(() => {
    const fullTranscript = (finalTranscriptRef.current + interimTranscriptRef.current).trim();
    finalTranscriptRef.current = '';
    interimTranscriptRef.current = '';
    
    if (fullTranscript) {
        setChatState('processing_speech');
        handleSendMessage(fullTranscript);
    } else {
        setChatState('context_loaded');
    }
  }, [handleSendMessage]);

  const processTranscriptRef = useRef(processTranscriptAndSend);
  useEffect(() => {
    processTranscriptRef.current = processTranscriptAndSend;
  }, [processTranscriptAndSend]);

  const stopListeningAndProcess = useCallback(() => {
    if (chatState !== 'listening' || !liveSessionRef.current) {
      return;
    }
    setChatState('stopping');
    liveSessionRef.current.session.close();
  }, [chatState]);
  
  const startListening = async () => {
    if (chatState !== 'context_loaded') return;
    setError('');

    try {
      const permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      if (permissionStatus.state === 'denied') {
        setError('Microphone access is denied. Please enable it in your browser settings to chat.');
        return;
      }
    } catch (err) {
      console.warn("Permissions API not supported, proceeding with recording attempt.", err);
    }

    setChatState('listening');
    finalTranscriptRef.current = '';
    interimTranscriptRef.current = '';

    try {
        const sessionData = await createLiveSession({
            onTranscriptionUpdate: (textChunk) => {
                interimTranscriptRef.current = textChunk;
            },
            onTurnComplete: () => {
                finalTranscriptRef.current += interimTranscriptRef.current + ' ';
                interimTranscriptRef.current = '';
            },
            onError: (err) => {
              console.error('Live session error:', err);
              setError('A recording error occurred. Please try again.');
              setChatState('context_loaded');
              cleanupLiveSession();
            },
            onClose: () => {
                cleanupLiveSession();
                processTranscriptRef.current();
            }
        });
        liveSessionRef.current = sessionData;
    } catch (e) {
        console.error("Failed to start listening:", e);
        if (e instanceof Error && e.name === 'NotAllowedError') {
            setError("Microphone access was denied. Please allow access and try again.");
        } else {
            setError("Could not access microphone. Please ensure it is connected and allowed.");
        }
        setChatState('context_loaded');
    }
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSendMessage(textInput);
  };
  
  if (!isOpen) return null;

  const renderMicButton = () => {
    const isMicDisabled = chatState !== 'context_loaded' || !chatSessionRef.current;
    
    if (chatState === 'listening') {
        return (
            <button onClick={stopListeningAndProcess} className="p-2 bg-red-600 text-white rounded-full flex items-center justify-center shadow-lg animate-pulse" aria-label="Stop listening">
                <StopIcon className="w-5 h-5" />
            </button>
        );
    }

    return (
        <button onClick={startListening} disabled={isMicDisabled} className="p-2 bg-blue-600 text-white rounded-full flex items-center justify-center shadow-lg hover:bg-blue-700 disabled:bg-slate-400 disabled:cursor-not-allowed" aria-label="Start listening">
            <MicrophoneIcon className="w-5 h-5" />
        </button>
    );
  };

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
          <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-200 transition-colors">
            <XIcon className="w-6 h-6 text-slate-600" />
          </button>
        </header>

        {isContextSettingsOpen && (
            <div className="p-4 bg-slate-50 border-b border-slate-200 space-y-3">
                <div className="flex items-center gap-4">
                    <div className="flex-1">
                        <label htmlFor="chat-start-page" className="block text-sm font-medium text-slate-700 mb-1">Start Page</label>
                        <input
                            type="number" id="chat-start-page" value={startPage}
                            onChange={(e) => setStartPage(Math.max(1, parseInt(e.target.value, 10) || 1))}
                            className="w-full p-2 border border-slate-300 rounded-md"
                            min="1" max={numPages}
                        />
                    </div>
                    <div className="flex-1">
                        <label htmlFor="chat-end-page" className="block text-sm font-medium text-slate-700 mb-1">End Page</label>
                        <input
                            type="number" id="chat-end-page" value={endPage}
                            onChange={(e) => setEndPage(Math.min(numPages, parseInt(e.target.value, 10) || 1))}
                            className="w-full p-2 border border-slate-300 rounded-md"
                            min="1" max={numPages}
                        />
                    </div>
                </div>
                <button 
                    onClick={handleLoadContext} 
                    disabled={chatState === 'loading_context'}
                    className="w-full px-4 py-2 bg-indigo-600 text-white font-semibold rounded-md hover:bg-indigo-700 disabled:bg-indigo-300"
                >
                    {chatState === 'loading_context' ? 'Loading...' : 'Load Page Context'}
                </button>
            </div>
        )}

        <div ref={chatContentRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {chatHistory.map((msg, index) => (
            <div key={index} className={`flex gap-3 items-start ${msg.role === 'user' ? 'justify-end' : ''}`}>
              {msg.role === 'model' && <div className="w-8 h-8 rounded-full bg-slate-700 text-white flex items-center justify-center flex-shrink-0 font-bold text-sm">AI</div>}
              <div className={`p-3 rounded-lg max-w-lg ${msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-800'}`}>
                {msg.role === 'system' 
                    ? <p className="text-sm text-center text-slate-500 italic">{msg.text}</p>
                    : <FormattedMessage text={msg.text} />
                }
              </div>
            </div>
          ))}
          {(chatState === 'processing_model' || chatState === 'processing_speech') && 
            <div className="flex gap-3 items-start">
              <div className="w-8 h-8 rounded-full bg-slate-700 text-white flex items-center justify-center flex-shrink-0 font-bold text-sm">AI</div>
              <div className="p-3 rounded-lg bg-slate-100 text-slate-800 flex items-center">
                <Loader />
              </div>
            </div>
          }
        </div>

        {error && 
            <div className="p-3 text-sm font-medium text-red-800 bg-red-100 border-t border-red-200 flex items-center gap-2">
                <XCircleIcon className="w-5 h-5 flex-shrink-0" />
                <span>{error}</span>
            </div>
        }

        <div className="p-4 border-t border-slate-200 bg-white flex-shrink-0">
          <form onSubmit={handleTextSubmit} className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage(textInput);
                }
              }}
              placeholder="Type your question or use the microphone..."
              rows={1}
              className="flex-1 w-full p-2 border border-slate-300 rounded-md resize-none focus:ring-2 focus:ring-blue-500"
              disabled={chatState !== 'context_loaded' || !chatSessionRef.current}
            />
            {renderMicButton()}
            <button 
                type="submit" 
                disabled={chatState !== 'context_loaded' || !chatSessionRef.current || !textInput.trim()}
                className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-md hover:bg-blue-700 disabled:bg-slate-400 disabled:cursor-not-allowed"
            >
                Send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}