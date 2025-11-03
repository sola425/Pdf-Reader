import React, { useState, useRef, useCallback, useEffect } from 'react';
import type { MissedPoint, ReviewResult } from '../types';
import { getReview, createLiveSession, generateSpeech } from '../services/geminiService';
import { decode, decodeAudioData } from '../utils/audio';
import { getAudioContext } from '../utils/audioContext';
import { MicrophoneIcon, StopIcon, CheckCircleIcon, XCircleIcon, LightbulbIcon, AcademicCapIcon, SpeakerWaveIcon, XIcon } from './Icons';
import { Loader } from './Loader';
import { AudioVisualizer } from './AudioVisualizer';

interface VoiceReviewerProps {
  documentText: string;
  setHighlightAndNavigate: (text: string | null, page: number | null) => void;
  onReviewComplete: (result: ReviewResult) => void;
  initialReviewResult: ReviewResult | null;
  onClose?: () => void;
}

type RecordingState = 'idle' | 'recording' | 'stopping' | 'processing' | 'complete' | 'error';

export function VoiceReviewer({ documentText, setHighlightAndNavigate, onReviewComplete, initialReviewResult, onClose }: VoiceReviewerProps) {
  const [recordingState, setRecordingState] = useState<RecordingState>(initialReviewResult ? 'complete' : 'idle');
  const [transcription, setTranscription] = useState<string>('');
  const [reviewResult, setReviewResult] = useState<ReviewResult | null>(initialReviewResult);
  const [error, setError] = useState<string>('');
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  
  const liveSessionRef = useRef<any>(null);
  const finalTranscriptRef = useRef<string>('');
  const interimTranscriptRef = useRef<string>('');

  useEffect(() => {
    setReviewResult(initialReviewResult);
    setRecordingState(initialReviewResult ? 'complete' : 'idle');
  }, [initialReviewResult]);

  const processTranscription = useCallback(async () => {
    const finalTranscription = (finalTranscriptRef.current + interimTranscriptRef.current).trim();
    finalTranscriptRef.current = '';
    interimTranscriptRef.current = '';

    if (finalTranscription.length < 10) {
        setError("Your summary seems too short. Please try recording a more detailed review.");
        setRecordingState('error');
        return;
    }

    setRecordingState('processing');
    try {
      const result = await getReview(documentText, finalTranscription);
      setReviewResult(result);
      onReviewComplete(result);
      setRecordingState('complete');
    } catch (err) {
      console.error('Error getting review:', err);
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
      setError(`Failed to get review from AI. ${errorMessage}`);
      setRecordingState('error');
    }
  }, [documentText, onReviewComplete]);

  const processTranscriptionRef = useRef(processTranscription);
  useEffect(() => {
    processTranscriptionRef.current = processTranscription;
  }, [processTranscription]);

  const cleanupLiveSession = useCallback(() => {
    if (liveSessionRef.current) {
        liveSessionRef.current.session?.close();
        liveSessionRef.current.stream?.getTracks().forEach((track: MediaStreamTrack) => track.stop());
        if (liveSessionRef.current.workletNode) {
            liveSessionRef.current.workletNode.port.onmessage = null;
            liveSessionRef.current.workletNode.disconnect();
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
    setHighlightAndNavigate(null, null);

    if (recordingState !== 'idle' && recordingState !== 'error' && recordingState !== 'complete') return;

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
      case 'processing':
        return <div className="text-center p-8"><Loader /><p className="mt-4 text-slate-600 font-semibold">Analyzing your review...</p></div>;
      case 'complete':
        return reviewResult && <ReviewDisplay result={reviewResult} setHighlightAndNavigate={setHighlightAndNavigate} onRecordAgain={startRecording} />;
      case 'error':
        return <div className="text-center p-4 bg-red-50 border border-red-200 rounded-lg"><p className="text-red-700 font-semibold">Error</p><p className="text-red-600 mt-1">{error}</p></div>;
      case 'idle':
        return <div className="text-center text-slate-500 py-8 px-4">Click the microphone to record your summary and get AI-powered feedback.</div>;
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

  return (
    <div className="bg-white h-full flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 flex-shrink-0">
            <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-slate-800">Comprehension Review</h2>
                {onClose && (
                    <button onClick={onClose} className="p-1 rounded-full hover:bg-slate-200" aria-label="Close review panel">
                        <XIcon className="w-6 h-6 text-slate-500" />
                    </button>
                )}
            </div>
        </div>

        {/* Controls */}
        <div className="p-4 border-b border-gray-200 flex-shrink-0 flex flex-col items-center">
             {recordingState !== 'recording' ? (
                <button
                    onClick={startRecording}
                    disabled={recordingState === 'processing' || recordingState === 'stopping'}
                    className="w-full flex items-center justify-center gap-3 px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-500 text-white font-bold rounded-lg hover:from-blue-700 hover:to-blue-600 transition-all shadow-lg focus:outline-none focus:ring-4 focus:ring-blue-300 disabled:bg-slate-400 disabled:shadow-none disabled:bg-gradient-to-none"
                >
                    <MicrophoneIcon className="h-6 w-6" />
                    <span>Start Recording Review</span>
                </button>
                ) : (
                <button
                    onClick={handleStopClick}
                    className="w-full flex items-center justify-center gap-3 px-6 py-3 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition-all shadow-lg focus:outline-none focus:ring-4 focus:ring-red-300"
                >
                    <StopIcon className="h-6 w-6" />
                    <span>Stop Recording</span>
                </button>
            )}
        </div>

        {/* Scrolling Content */}
        <div className="flex-1 p-4 overflow-y-auto space-y-4">
            {(recordingState === 'recording' || recordingState === 'stopping') && (
                <div className="flex flex-col items-center justify-center p-4 bg-slate-50 rounded-lg">
                    <AudioVisualizer analyserNode={analyserNode} />
                    <p className="mt-3 text-sm text-slate-500">
                        {recordingState === 'recording' ? 'Recording in progress...' : 'Finishing up...'}
                    </p>
                </div>
            )}
            {renderContent()}
        </div>
    </div>
  );
}

const ScoreCircle = ({ score }: { score: number }) => {
    const size = 160;
    const strokeWidth = 12;
    const center = size / 2;
    const radius = center - strokeWidth;
    const circumference = 2 * Math.PI * radius;
  
    const [offset, setOffset] = useState(circumference);
  
    useEffect(() => {
        const progressOffset = ((100 - score) / 100) * circumference;
        // Delay start of animation slightly for visual effect
        const timer = setTimeout(() => setOffset(progressOffset), 100);
        return () => clearTimeout(timer);
    }, [score, circumference]);
    
    const scoreColorClass = score >= 80 ? 'text-green-500' : score >= 50 ? 'text-yellow-500' : 'text-red-500';

    return (
        <div className="relative" style={{ width: size, height: size }}>
            <svg className="w-full h-full" viewBox={`0 0 ${size} ${size}`}>
                <circle
                    className="text-slate-200"
                    stroke="currentColor"
                    strokeWidth={strokeWidth}
                    fill="transparent"
                    r={radius}
                    cx={center}
                    cy={center}
                />
                <circle
                    className={`${scoreColorClass} transition-all duration-1000 ease-out`}
                    stroke="currentColor"
                    strokeWidth={strokeWidth}
                    strokeLinecap="round"
                    fill="transparent"
                    r={radius}
                    cx={center}
                    cy={center}
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                    transform={`rotate(-90 ${center} ${center})`}
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                 <span className={`text-5xl font-bold ${scoreColorClass}`}>{score}</span>
                 <span className="text-sm font-medium text-slate-500">/ 100</span>
            </div>
        </div>
    );
};

interface ReviewDisplayProps {
    result: ReviewResult;
    setHighlightAndNavigate: (text: string | null, page: number | null) => void;
    onRecordAgain: () => void;
}

const ReviewDisplay = ({ result, setHighlightAndNavigate, onRecordAgain }: ReviewDisplayProps) => {
    const [audioState, setAudioState] = useState<{ loadingIndex: number | null; playingIndex: number | null }>({ loadingIndex: null, playingIndex: null });
    const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

    const stopAudio = useCallback(() => {
        if (audioSourceRef.current) {
            try { 
                audioSourceRef.current.onended = null;
                audioSourceRef.current.stop(); 
            } catch (e) { /* ignore */ }
            audioSourceRef.current = null;
        }
        setAudioState({ loadingIndex: null, playingIndex: null });
    }, []);

    // Cleanup audio on component unmount
    useEffect(() => {
      return () => {
        stopAudio();
      };
    }, [stopAudio]);

    const playAudio = async (base64Audio: string, onEnded: () => void) => {
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
                    audioSourceRef.current = null;
                    onEnded();
                }
            };
        } catch (e) {
            console.error("Failed to play audio:", e);
            onEnded(); // Ensure state is reset even on error
        }
    };

    const handlePlaySuggestion = async (text: string, index: number) => {
        if (audioState.playingIndex === index) {
            stopAudio();
            return;
        }
        stopAudio();
        setAudioState({ loadingIndex: index, playingIndex: null });
        try {
            const audioData = await generateSpeech(text);
            if (audioData) {
                setAudioState({ loadingIndex: null, playingIndex: index });
                await playAudio(audioData, () => {
                    setAudioState({ loadingIndex: null, playingIndex: null });
                });
            } else {
                throw new Error("Audio data was null.");
            }
        } catch (e) {
            console.error("Error generating or playing speech:", e);
            setAudioState({ loadingIndex: null, playingIndex: null });
        }
    };

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Score Section */}
            <div className="flex flex-col items-center p-6 bg-slate-50 rounded-2xl border border-slate-200">
                <ScoreCircle score={result.score} />
                <p className="mt-4 text-center text-slate-600 font-medium max-w-md">{result.scoreRationale}</p>
            </div>

            {/* Mentioned Points Section */}
            <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                <div className="flex items-center gap-3">
                    <CheckCircleIcon className="w-7 h-7 text-green-500 flex-shrink-0" />
                    <h3 className="text-lg font-bold text-green-800">What You Nailed</h3>
                </div>
                <p className="mt-2 text-green-900/90 pl-10">{result.summaryOfMentionedPoints}</p>
            </div>

            {/* Missed Points Section */}
            <div>
                <div className="flex items-center gap-3 mb-4">
                    <XCircleIcon className="w-7 h-7 text-red-500 flex-shrink-0" />
                    <h3 className="text-lg font-bold text-red-800">Areas for Improvement</h3>
                </div>
                {result.reviewOfMissedPoints.length > 0 ? (
                    <div className="space-y-4">
                        {result.reviewOfMissedPoints.map((point, index) => (
                            <div key={index} className="bg-white border border-slate-200 p-4 rounded-lg shadow-sm">
                                <p className="font-bold text-slate-800">{index + 1}. {point.point}</p>
                                
                                <button 
                                    onClick={() => setHighlightAndNavigate(point.example, point.pageNumber)}
                                    className="my-2 block w-full text-left p-3 bg-slate-50 border-l-4 border-slate-300 rounded-r-md hover:bg-slate-100 hover:border-slate-400 transition-colors"
                                >
                                    <span className="font-semibold text-slate-600">From the text (Page {point.pageNumber}):</span>
                                    <blockquote className="mt-1 text-slate-700 italic">"{point.example}"</blockquote>
                                </button>

                                <div className="mt-3 p-3 bg-blue-50/70 border-l-4 border-blue-400 rounded-r-md">
                                    <div className="flex items-start gap-3">
                                        <LightbulbIcon className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                                        <div className="flex-grow">
                                            <h4 className="font-semibold text-blue-800">Suggestion</h4>
                                            <p className="text-blue-900/90">{point.suggestion}</p>
                                        </div>
                                        <button
                                            onClick={() => handlePlaySuggestion(point.suggestion, index)}
                                            className="p-2 rounded-full hover:bg-blue-200 text-slate-500 hover:text-blue-600 transition-colors flex-shrink-0"
                                            aria-label={`Listen to suggestion for ${point.point}`}
                                        >
                                            {audioState.loadingIndex === index ? (
                                                <div className="w-5 h-5 border-2 border-t-blue-500 border-slate-200 rounded-full animate-spin"></div>
                                            ) : audioState.playingIndex === index ? (
                                                <SpeakerWaveIcon className="w-5 h-5 text-blue-600 animate-pulse" />
                                            ) : (
                                                <SpeakerWaveIcon className="w-5 h-5" />
                                            )}
                                        </button>
                                    </div>
                                </div>
                                
                                <div className="mt-3">
                                    <div className="flex items-center gap-2">
                                        <AcademicCapIcon className="w-5 h-5 text-slate-500" />
                                        <h4 className="font-semibold text-slate-600">Related Concepts</h4>
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        {point.relatedConcepts.map(concept => (
                                            <span key={concept} className="px-2.5 py-1 bg-slate-200 text-slate-700 text-xs font-medium rounded-full">
                                                {concept}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-slate-600 p-4 bg-slate-50 rounded-md">No specific missed points found. Great job!</p>
                )}
            </div>

             {/* Record Again Button */}
            <div className="pt-4 border-t border-slate-200">
                <button
                    onClick={onRecordAgain}
                    className="w-full flex items-center justify-center gap-3 px-6 py-3 bg-slate-700 text-white font-bold rounded-lg hover:bg-slate-800 transition-all shadow-lg focus:outline-none focus:ring-4 focus:ring-slate-300"
                >
                    <MicrophoneIcon className="h-6 w-6" />
                    <span>Record a New Review</span>
                </button>
            </div>
        </div>
    );
};