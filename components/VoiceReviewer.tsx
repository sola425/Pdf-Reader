import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { MissedPoint, ReviewResult } from '../types';
import { Part } from '@google/genai';
import { getReview, createLiveSession, generateSpeech } from '../services/geminiService';
import { decode, decodeAudioData } from '../utils/audio';
import { getAudioContext } from '../utils/audioContext';
import { MicrophoneIcon, StopIcon, CheckCircleIcon, XCircleIcon, LightbulbIcon, AcademicCapIcon, SpeakerWaveIcon, XIcon, ChevronDownIcon } from './Icons';
import { Loader } from './Loader';
import { AudioVisualizer } from './AudioVisualizer';

interface VoiceReviewerProps {
  pdfDoc: any;
  numPages: number;
  currentPage: number;
  setHighlightAndNavigate: (text: string | null, page: number | null) => void;
  onReviewComplete: (result: ReviewResult) => void;
  initialReviewResult: ReviewResult | null;
  onClose?: () => void;
}

type RecordingState = 'idle' | 'preparing' | 'recording' | 'stopping' | 'processing' | 'complete' | 'error';

export function VoiceReviewer({ pdfDoc, numPages, currentPage, setHighlightAndNavigate, onReviewComplete, initialReviewResult, onClose }: VoiceReviewerProps) {
  const [recordingState, setRecordingState] = useState<RecordingState>(initialReviewResult ? 'complete' : 'idle');
  const [transcription, setTranscription] = useState<string>('');
  const [reviewResult, setReviewResult] = useState<ReviewResult | null>(initialReviewResult);
  const [error, setError] = useState<string>('');
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  
  const [startPage, setStartPage] = useState(currentPage);
  const [endPage, setEndPage] = useState(currentPage);
  const [isContextSettingsOpen, setIsContextSettingsOpen] = useState(true);

  const liveSessionRef = useRef<any>(null);
  const finalTranscriptRef = useRef<string>('');
  const interimTranscriptRef = useRef<string>('');
  const reviewContextPartsRef = useRef<Part[]>([]);

  useEffect(() => {
    setReviewResult(initialReviewResult);
    setRecordingState(initialReviewResult ? 'complete' : 'idle');
  }, [initialReviewResult]);

  useEffect(() => {
    if (recordingState === 'idle' || recordingState === 'complete' || recordingState === 'error') {
        setStartPage(currentPage);
        setEndPage(currentPage);
    }
  }, [currentPage, recordingState]);

  const processTranscription = useCallback(async () => {
    const finalTranscription = (finalTranscriptRef.current + interimTranscriptRef.current).trim();
    finalTranscriptRef.current = '';
    interimTranscriptRef.current = '';

    if (finalTranscription.length < 10) {
        setError("Your summary seems too short. Please try recording a more detailed review.");
        setRecordingState('error');
        return;
    }
    
    if (reviewContextPartsRef.current.length === 0) {
        setError("The document context for the review was not loaded. Please try again.");
        setRecordingState('error');
        return;
    }

    setRecordingState('processing');
    try {
      const result = await getReview(reviewContextPartsRef.current, finalTranscription);
      setReviewResult(result);
      onReviewComplete(result);
      setRecordingState('complete');
    } catch (err) {
      console.error('Error getting review:', err);
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
      setError(`Failed to get review from AI. ${errorMessage}`);
      setRecordingState('error');
    }
  }, [onReviewComplete]);

  const processTranscriptionRef = useRef(processTranscription);
  useEffect(() => {
    processTranscriptionRef.current = processTranscription;
  }, [processTranscription]);

  const cleanupLiveSession = useCallback(() => {
    if (liveSessionRef.current) {
        liveSessionRef.current.session?.close();
        liveSessionRef.current.stream?.getTracks().forEach((track: MediaStreamTrack) => track.stop());
        if (liveSessionRef.current.scriptProcessor) {
            liveSessionRef.current.scriptProcessor.onaudioprocess = null;
            liveSessionRef.current.scriptProcessor.disconnect();
        }
        liveSessionRef.current.source?.disconnect();
        liveSessionRef.current.context?.close();
        liveSessionRef.current = null;
    }
    setAnalyserNode(null);
  }, []);

  const stopRecordingAndProcess = useCallback(() => {
    if (recordingState !== 'recording' || !liveSessionRef.current?.session) {
      return;
    }
    setRecordingState('stopping');
    // Closing the session will trigger the `onClose` callback passed to `createLiveSession`
    // which will then handle cleanup and processing.
    liveSessionRef.current.session.close();
  }, [recordingState]);

  const startRecording = async () => {
    setTranscription('');
    setReviewResult(null);
    setError('');
    finalTranscriptRef.current = '';
    interimTranscriptRef.current = '';
    reviewContextPartsRef.current = [];
    setHighlightAndNavigate(null, null);

    if (recordingState !== 'idle' && recordingState !== 'error' && recordingState !== 'complete') return;

    setRecordingState('preparing');
    
    if (!pdfDoc) {
        setError('Document not loaded.');
        setRecordingState('error');
        return;
    }

    try {
        const parts: Part[] = [];
        let hasContent = false;
        const start = Math.max(1, Math.min(startPage, endPage));
        const end = Math.min(numPages, Math.max(startPage, endPage));

        for (let i = start; i <= end; i++) {
            const page = await pdfDoc.getPage(i);
            const textContent = await page.getTextContent();
            
            parts.push({ text: `--- PAGE ${i} ---\n` });

            if (textContent.items && textContent.items.length > 0) {
                hasContent = true;
                const viewport = page.getViewport({ scale: 1 });
                const pageWidth = viewport.width;

                const allItems = textContent.items.filter((item: any) => item.str?.trim());
                
                const leftItems: any[] = [];
                const rightItems: any[] = [];
                const midPoint = pageWidth / 2;

                allItems.forEach((item: any) => {
                    const x = item.transform[4];
                    if (x < midPoint) leftItems.push(item);
                    else rightItems.push(item);
                });

                const hasSignificantContent = (items: any[]) => items.reduce((sum, item) => sum + item.str.length, 0) > 50;

                const isMultiColumn = hasSignificantContent(leftItems) && hasSignificantContent(rightItems);

                const processItems = (itemsToProcess: any[]) => {
                    itemsToProcess.sort((a: any, b: any) => {
                        const y1 = a.transform[5], y2 = b.transform[5];
                        const x1 = a.transform[4], x2 = b.transform[4];
                        if (Math.abs(y1 - y2) > 5) return y2 - y1;
                        return x1 - x2;
                    });

                    let text = '';
                    if (itemsToProcess.length > 0) {
                        let lastY = itemsToProcess[0].transform[5];
                        let lastHeight = itemsToProcess[0].height;
                        for (const item of itemsToProcess) {
                            if (Math.abs(item.transform[5] - lastY) > lastHeight * 1.5) text += '\n';
                            text += item.str;
                            if (!item.str.endsWith(' ')) text += ' ';
                            lastY = item.transform[5];
                            lastHeight = item.height;
                        }
                    }
                    return text;
                };

                let pageText = isMultiColumn
                    ? processItems(leftItems).trim() + '\n\n' + processItems(rightItems).trim()
                    : processItems(allItems);

                const cleanedPageText = pageText.replace(/ +/g, ' ').replace(/ \n/g, '\n').trim();
                parts.push({ text: cleanedPageText + '\n\n' });
            } else {
                // Render page as image for OCR
                hasContent = true;
                const viewport = page.getViewport({ scale: 1.5 }); // Higher scale for better OCR
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                if (!context) continue;

                canvas.height = viewport.height;
                canvas.width = viewport.width;
                await page.render({ canvasContext: context, viewport }).promise;

                const dataUrl = canvas.toDataURL('image/jpeg', 0.9); // Use JPEG with quality for compression
                const base64Data = dataUrl.split(',')[1];
                
                parts.push({ inlineData: { mimeType: 'image/jpeg', data: base64Data }});
                parts.push({ text: '\n\n' });
            }
        }

        if (!hasContent) {
            const pageRange = start === end ? `page ${start}` : `pages ${start}-${end}`;
            setError(`It looks like ${pageRange} is empty. Please select a different page or range with content.`);
            setRecordingState('error');
            return;
        }

        reviewContextPartsRef.current = parts;

    } catch (e) {
        console.error("Failed to load context for review:", e);
        setError('Could not extract content from the specified pages.');
        setRecordingState('error');
        return;
    }


    try {
      const permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      if (permissionStatus.state === 'denied') {
        setError('Microphone access has been denied. Please enable it in your browser settings to record a review.');
        setRecordingState('error');
        return;
      }
    } catch (err) {
      console.warn("Permissions API not supported, proceeding with recording attempt.", err);
    }

    setRecordingState('recording');

    try {
      const sessionData = await createLiveSession({
        onTranscriptionUpdate: (textChunk) => {
            interimTranscriptRef.current = textChunk;
            setTranscription(finalTranscriptRef.current + interimTranscriptRef.current);
        },
        onTurnComplete: () => {
            finalTranscriptRef.current += interimTranscriptRef.current + ' ';
            interimTranscriptRef.current = '';
            setTranscription(finalTranscriptRef.current);
        },
        onError: (err) => {
          console.error('Live session error:', err);
          setError('A recording error occurred. Please check your microphone permissions and try again.');
          setRecordingState('error');
          cleanupLiveSession();
        },
        onClose: () => {
            setAnalyserNode(null);
            processTranscriptionRef.current();
        }
      });

      const analyser = sessionData.context.createAnalyser();
      sessionData.source.connect(analyser);
      setAnalyserNode(analyser);

      liveSessionRef.current = sessionData;

    } catch (err) {
      console.error('Failed to start recording:', err);
      let message = 'Could not start recording. Please ensure microphone access is allowed.';
      if (err instanceof Error && (err.name === 'NotAllowedError' || err.message.includes('permission denied'))) {
        message = 'Microphone access was denied. Please enable it in your browser settings and try again.';
      }
      setError(message);
      setRecordingState('error');
    }
  };
  
  const handleStopClick = () => {
      if (recordingState === 'recording') {
         stopRecordingAndProcess();
      }
  };

  useEffect(() => {
    return cleanupLiveSession;
  }, [cleanupLiveSession]);

  const renderContent = () => {
    switch (recordingState) {
      case 'preparing':
        return <div className="text-center p-8"><Loader /><p className="mt-4 text-slate-600 font-semibold">Preparing review context...</p></div>;
      case 'processing':
        return <div className="text-center p-8"><Loader /><p className="mt-4 text-slate-600 font-semibold">Analyzing your review...</p></div>;
      case 'complete':
        return reviewResult && <ReviewDisplay result={reviewResult} setHighlightAndNavigate={setHighlightAndNavigate} onRecordAgain={startRecording} />;
      case 'error':
        return <div className="text-center p-4 bg-red-50 border border-red-200 rounded-lg"><p className="text-red-700 font-semibold">Error</p><p className="text-red-600 mt-1">{error}</p></div>;
      case 'idle':
        return <div className="text-center text-slate-500 py-8 px-4">Select a page range and click the microphone to record your summary.</div>;
      case 'recording':
      case 'stopping':
        return (
          <div className="text-slate-600">
            <h3 className="font-semibold text-lg text-slate-800 mb-2">Your spoken summary:</h3>
            <p className="min-h-[60px] p-3 border border-dashed border-slate-300 rounded-md bg-slate-50 text-slate-800">{transcription || "..."}</p>
          </div>
        );
      default:
        return null;
    }
  };
  
  const isStartButtonDisabled = recordingState === 'processing' || recordingState === 'stopping' || recordingState === 'preparing' || recordingState === 'recording';

  return (
    <div className="bg-white h-full flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 flex-shrink-0">
            <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-slate-800">Comprehension Review</h2>
                {onClose && (
                    <button onClick={onClose} className="p-1 rounded-full hover:bg-slate-200 lg:hidden" aria-label="Close review panel">
                        <XIcon className="w-6 h-6 text-slate-500" />
                    </button>
                )}
            </div>
        </div>
        
        <div className="flex-1 p-4 overflow-y-auto space-y-4">
            {/* Context Settings */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg">
                <button 
                    onClick={() => setIsContextSettingsOpen(p => !p)}
                    className="w-full text-left p-3 flex justify-between items-center hover:bg-slate-100"
                    aria-expanded={isContextSettingsOpen}
                    aria-controls="context-settings"
                >
                    <div className="flex items-center gap-3">
                        <span className="p-1.5 bg-blue-100 text-blue-600 rounded-md"><AcademicCapIcon className="w-5 h-5" /></span>
                        <div>
                           <h3 className="font-semibold text-slate-800">Review Context</h3>
                           <p className="text-xs text-slate-500">Pages {Math.min(startPage, endPage)} to {Math.max(startPage, endPage)}</p>
                        </div>
                    </div>
                    <ChevronDownIcon className={`w-5 h-5 text-slate-500 transition-transform ${isContextSettingsOpen ? 'rotate-180' : ''}`} />
                </button>
                {isContextSettingsOpen && (
                    <div id="context-settings" className="p-3 border-t border-slate-200">
                        <label className="block text-sm font-medium text-slate-700 mb-2">Select page range for review:</label>
                        <div className="flex items-center justify-center gap-2">
                            <input type="number" value={startPage} onChange={e => setStartPage(parseInt(e.target.value, 10))} min={1} max={numPages} disabled={isStartButtonDisabled} className="w-16 p-1 border border-slate-300 rounded-md text-sm focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100" aria-label="Start page" />
                            <span className="text-sm font-medium text-slate-700">-</span>
                            <input type="number" value={endPage} onChange={e => setEndPage(parseInt(e.target.value, 10))} min={1} max={numPages} disabled={isStartButtonDisabled} className="w-16 p-1 border border-slate-300 rounded-md text-sm focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100" aria-label="End page" />
                        </div>
                    </div>
                )}
            </div>

            <div className="min-h-[150px]">
                {renderContent()}
            </div>
        </div>
        
        <div className="p-4 border-t border-gray-200 flex-shrink-0">
            <div className="flex flex-col items-center justify-center gap-4">
                {analyserNode && <AudioVisualizer analyserNode={analyserNode} />}

                {recordingState === 'recording' ? (
                     <button onClick={handleStopClick} className="w-16 h-16 bg-red-600 text-white rounded-full flex items-center justify-center shadow-lg animate-pulse" aria-label="Stop recording">
                        <StopIcon className="w-8 h-8" />
                    </button>
                ) : (
                    <button onClick={startRecording} disabled={isStartButtonDisabled} className="w-16 h-16 bg-blue-600 text-white rounded-full flex items-center justify-center shadow-lg disabled:bg-slate-400 disabled:cursor-not-allowed" aria-label={reviewResult ? 'Record again' : 'Start recording'}>
                        <MicrophoneIcon className="w-8 h-8" />
                    </button>
                )}
                 <p className="text-sm text-slate-500 h-5 text-center">
                    {recordingState === 'recording' && 'Recording...'}
                    {recordingState === 'stopping' && 'Stopping...'}
                 </p>
            </div>
        </div>
    </div>
  );
}

function ReviewDisplay({ result, setHighlightAndNavigate, onRecordAgain }: { result: ReviewResult; setHighlightAndNavigate: (text: string, page: number) => void; onRecordAgain: () => void; }) {
    const [playingPoint, setPlayingPoint] = useState<MissedPoint | null>(null);
    const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

    const playSuggestion = async (point: MissedPoint) => {
        if (playingPoint === point) {
            if (audioSourceRef.current) {
                audioSourceRef.current.stop();
                audioSourceRef.current = null;
            }
            setPlayingPoint(null);
            return;
        }

        setPlayingPoint(point);
        const textToSpeak = `Here is a point you missed: ${point.point}. For example, the text says, "${point.example}". To improve, you could try this: ${point.suggestion}`;
        const audioData = await generateSpeech(textToSpeak);
        if (audioData) {
            const context = getAudioContext();
            const decoded = decode(audioData);
            const audioBuffer = await decodeAudioData(decoded, context, 24000, 1);
            
            if (audioSourceRef.current) audioSourceRef.current.stop();

            const source = context.createBufferSource();
            audioSourceRef.current = source;
            source.buffer = audioBuffer;
            source.connect(context.destination);
            source.start();
            source.onended = () => {
                if(audioSourceRef.current === source) {
                   setPlayingPoint(null);
                   audioSourceRef.current = null;
                }
            };
        } else {
            setPlayingPoint(null); // Failed to generate audio
        }
    };

    const scoreColor = result.score >= 80 ? 'text-green-600' : result.score >= 50 ? 'text-yellow-600' : 'text-red-600';
    const scoreBg = result.score >= 80 ? 'bg-green-100' : result.score >= 50 ? 'bg-yellow-100' : 'bg-red-100';

    return (
        <div className="space-y-4">
            <div className={`p-3 rounded-lg ${scoreBg}`}>
                <p className="text-sm font-semibold text-slate-800">Comprehension Score</p>
                <p className={`text-4xl font-extrabold ${scoreColor}`}>{result.score}<span className="text-xl">%</span></p>
                <p className="text-sm text-slate-600 mt-1">{result.scoreRationale}</p>
            </div>

            <div>
                <h3 className="font-semibold text-slate-800 flex items-center gap-2 mb-2"><CheckCircleIcon className="w-5 h-5 text-green-500" />What you got right</h3>
                <p className="text-sm text-slate-600 bg-slate-50 p-2 rounded-md">{result.summaryOfMentionedPoints}</p>
            </div>

            <div>
                <h3 className="font-semibold text-slate-800 flex items-center gap-2 mb-2"><LightbulbIcon className="w-5 h-5 text-yellow-500" />Areas for improvement</h3>
                <div className="space-y-3">
                    {result.reviewOfMissedPoints.map((point, index) => (
                        <div key={index} className="bg-slate-50 border border-slate-200 p-3 rounded-lg">
                            <div className="flex justify-between items-start">
                                <p className="font-semibold text-slate-800 text-sm flex-1">{point.point}</p>
                                <button onClick={() => playSuggestion(point)} className="ml-2 p-1 text-slate-500 hover:bg-slate-200 rounded-full" aria-label="Read suggestion aloud">
                                    <SpeakerWaveIcon className={`w-5 h-5 ${playingPoint === point ? 'text-blue-500 animate-pulse' : ''}`} />
                                </button>
                            </div>
                            <blockquote className="text-xs text-slate-600 mt-1 border-l-2 border-blue-300 pl-2 italic">"{point.example}"</blockquote>
                            <button onClick={() => setHighlightAndNavigate(point.example, point.pageNumber)} className="text-xs text-blue-600 hover:underline mt-1">
                                (p. {point.pageNumber}) Go to text
                            </button>
                            <p className="text-sm text-slate-700 mt-2"><span className="font-semibold">Suggestion:</span> {point.suggestion}</p>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}