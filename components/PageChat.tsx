import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Chat, Part } from '@google/genai';
import { startPageChatSession, generateSpeech, createLiveSession } from '../services/geminiService';
import { decode, decodeAudioData } from '../utils/audio';
import { getAudioContext } from '../utils/audioContext';
import { Loader } from './Loader';
import { MicrophoneIcon, StopIcon, XCircleIcon, ChevronDownIcon } from './Icons';

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
            
            contextParts.push({ text: `\n\n--- PAGE ${i} ---\n` });

            if (textContent.items && textContent.items.length > 0) {
                const viewport = page.getViewport({ scale: 1 });
                const pageWidth = viewport.width;

                const allItems = textContent.items.filter((item: any) => item.str?.trim());
            
                const leftItems: any[] = [];
                const rightItems: any[] = [];
                const midPoint = pageWidth / 2;

                allItems.forEach((item: any) => {
                    if (item.transform[4] < midPoint) {
                        leftItems.push(item);
                    } else {
                        rightItems.push(item);
                    }
                });

                const hasSignificantContent = (items: any[]) => {
                    const totalChars = items.reduce((sum, item) => sum + item.str.length, 0);
                    return items.length > 5 && totalChars > 50;
                };

                const isMultiColumn = hasSignificantContent(leftItems) && hasSignificantContent(rightItems);

                const processItems = (itemsToProcess: any[]) => {
                    itemsToProcess.sort((a: any, b: any) => {
                        const y1 = a.transform[5];
                        const y2 = b.transform[5];
                        const x1 = a.transform[4];
                        const x2 = b.transform[4];
                        if (Math.abs(y1 - y2) > 5) return y2 - y1;
                        return x1 - x2;
                    });

                    let text = '';
                    if (itemsToProcess.length > 0) {
                        let lastY = itemsToProcess[0].transform[5];
                        let lastHeight = itemsToProcess[0].height;
                        for (const item of itemsToProcess) {
                            const currentY = item.transform[5];
                            if (Math.abs(currentY - lastY) > lastHeight * 1.5) {
                                text += '\n';
                            }
                            text += item.str;
                            if (!item.str.endsWith(' ')) text += ' ';
                            lastY = currentY;
                            lastHeight = item.height;
                        }
                    }
                    return text;
                };

                let pageText = '';
                if (isMultiColumn) {
                    const leftText = processItems(leftItems);
                    const rightText = processItems(rightItems);
                    pageText = leftText.trim() + '\n\n' + rightText.trim();
                } else {
                    pageText = processItems(allItems);
                }

                const cleanedPageText = pageText.replace(/ +/g, ' ').replace(/ \n/g, '\n').trim();
                if (cleanedPageText) {
                    contextParts.push({ text: cleanedPageText });
                    hasContent = true;
                }
            } else {
                // If no text, render page as image for OCR
                const viewport = page.getViewport({ scale: 1.5 }); // Higher scale for better OCR
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                if (!context) continue;

                canvas.height = viewport.height;
                canvas.width = viewport.width;

                await page.render({ canvasContext: context, viewport }).promise;

                const dataUrl = canvas.toDataURL('image/jpeg');
                const base64Data = dataUrl.split(',')[1];
                
                contextParts.push({
                    inlineData: {
                        mimeType: 'image/jpeg',
                        data: base64Data,
                    }
                });
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


  const playAudio = async (base64Audio: string) => {
    const context = getAudioContext();
    
    try {
        const decoded = decode(base64Audio);
        const audioBuffer = await decodeAudioData(decoded, context, 24000, 1);

        if (audioSourceRef.current) {
            audioSourceRef.current.onended = null;
            audioSourceRef.current.stop();
        }

        const source = context.createBufferSource();
        audioSourceRef.current = source;
        source.buffer = audioBuffer;
        source.connect(context.destination);
        source.start();
        source.onended = () => {
            if (audioSourceRef.current === source) {
                setChatState('context_loaded');
                audioSourceRef.current = null;
            }
        };
    } catch (e) {
        console.error("Failed to play audio:", e);
        setError("Could not play the AI's response.");
        setChatState('context_loaded');
    }
  };

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
      
      const response = await chatSessionRef.current.sendMessage({ message: text });
      const aiText = response.text;
      
      setChatHistory(prev => [...prev, { role: 'model', text: aiText }]);
      setChatState('speaking');

      const audioData = await generateSpeech(aiText);
      if (audioData) {
        await playAudio(audioData);
      } else {
        // Fallback if speech generation fails
        setChatState('context_loaded');
      }

    } catch (e) {
      console.error("Chat processing error:", e);
      const message = e instanceof Error ? e.message : 'An unknown error occurred.';
      setError(`An error occurred while talking to the AI: ${message}`);
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
    // Closing the session will trigger the onClose callback, which handles processing.
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
        <button onClick={startListening} disabled={isMicDisabled} className="p-2 bg-blue-600 text-white rounded-full flex items-center justify-center shadow-lg disabled:bg-slate-400 disabled:cursor-not-allowed" aria-label="Start listening">
            <MicrophoneIcon className="w-5 h-5" />
        </button>
    );
  };

  return (
    <div 
        ref={modalRef}
        className="fixed inset-0 z-50 md:bottom-4 md:right-4 md:inset-auto md:w-full md:max-w-md md:h-[70vh] md:max-h-[600px] bg-white rounded-none md:rounded-2xl shadow-2xl border-slate-200/80 flex flex-col animate-fade-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-heading"
    >
        <header className="p-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
            <h2 id="chat-heading" className="text-lg font-bold text-slate-800">Chat with Page Content</h2>
            <button onClick={onClose} className="p-1 rounded-full hover:bg-slate-200" aria-label="Close chat">
                <XCircleIcon className="w-6 h-6 text-slate-500" />
            </button>
        </header>

        <div className="flex-shrink-0 border-b border-gray-200 bg-slate-50">
            <button 
                onClick={() => setIsContextSettingsOpen(prev => !prev)}
                className="w-full text-left p-2 text-xs text-slate-500 hover:bg-slate-100 flex justify-between items-center"
            >
                <span>Context: Pages {Math.min(startPage, endPage)}-{Math.max(startPage, endPage)}</span>
                <ChevronDownIcon className={`w-4 h-4 transition-transform ${isContextSettingsOpen ? 'rotate-180' : ''}`} />
            </button>
            {isContextSettingsOpen && (
                <div className="p-4">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-700">Pages:</span>
                        <input type="number" value={startPage} onChange={e => setStartPage(parseInt(e.target.value, 10))} min={1} max={numPages} className="w-16 p-1 border border-slate-300 rounded-md text-sm focus:ring-1 focus:ring-blue-500" />
                        <span className="text-sm font-medium text-slate-700">-</span>
                        <input type="number" value={endPage} onChange={e => setEndPage(parseInt(e.target.value, 10))} min={1} max={numPages} className="w-16 p-1 border border-slate-300 rounded-md text-sm focus:ring-1 focus:ring-blue-500" />
                        <button onClick={handleLoadContext} disabled={chatState === 'loading_context'} className="px-3 py-1 bg-blue-100 text-blue-700 text-sm font-semibold rounded-md hover:bg-blue-200 disabled:opacity-50">
                            {chatState === 'loading_context' ? 'Loading...' : 'Reload'}
                        </button>
                    </div>
                </div>
            )}
             {error && <p className="text-xs text-red-600 p-2">{error}</p>}
        </div>

        <div ref={chatContentRef} className="flex-1 p-4 overflow-y-auto space-y-4">
            {chatHistory.map((msg, index) => (
                <div key={index} className={`flex items-end gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                   {msg.role === 'model' && <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">AI</div>}
                   <div className={`max-w-xs md:max-w-sm px-3 py-2 rounded-xl ${
                       msg.role === 'user' ? 'bg-blue-600 text-white' : 
                       msg.role === 'model' ? 'bg-slate-100 text-slate-800' : 'bg-transparent text-slate-500 text-sm italic text-center w-full'
                   }`}>
                        {msg.role === 'model' 
                            ? <FormattedMessage text={msg.text} />
                            : <p className="text-sm break-words">{msg.text}</p>
                        }
                   </div>
                </div>
            ))}
            {['processing_model', 'processing_speech', 'stopping'].includes(chatState) && (
                <div className="flex items-end gap-2 justify-start">
                    <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">AI</div>
                    <div className="px-3 py-2 rounded-xl bg-slate-100 text-slate-800">
                        <span className="inline-block w-2 h-2 bg-blue-400 rounded-full animate-bounce delay-0"></span>
                        <span className="inline-block w-2 h-2 bg-blue-400 rounded-full animate-bounce delay-100 mx-1"></span>
                        <span className="inline-block w-2 h-2 bg-blue-400 rounded-full animate-bounce delay-200"></span>
                    </div>
                </div>
            )}
        </div>
        
        <footer className="p-4 border-t border-gray-200 flex-shrink-0">
             <form onSubmit={handleTextSubmit} className="flex items-center gap-2 w-full">
                <textarea
                    ref={textareaRef}
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleTextSubmit(e);
                        }
                    }}
                    placeholder="Type a question..."
                    className="flex-1 p-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow shadow-sm resize-none"
                    rows={1}
                    disabled={chatState !== 'context_loaded' || !chatSessionRef.current}
                />
                {renderMicButton()}
                <button type="submit" disabled={!textInput.trim() || chatState !== 'context_loaded' || !chatSessionRef.current} className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:bg-slate-400">
                    Send
                </button>
             </form>
             <p className="text-xs text-slate-500 mt-2 h-4 text-center">
                 {chatState === 'listening' && 'Listening...'}
                 {chatState === 'speaking' && 'AI is speaking...'}
                 {chatState === 'stopping' && 'Finishing up...'}
                 {chatState === 'processing_speech' && 'Processing your speech...'}
                 {chatState === 'processing_model' && 'Thinking...'}
             </p>
        </footer>
    </div>
  );
}