import React, { useState, useRef, useCallback, useEffect } from 'react';
import type { MissedPoint, ReviewResult } from '../types';
import { getReview, createLiveSession, generateSpeech } from '../services/geminiService';
import { decode, decodeAudioData } from '../utils/audio';
import { MicrophoneIcon, StopIcon, CheckCircleIcon, XCircleIcon, LightbulbIcon, AcademicCapIcon, SpeakerWaveIcon } from './Icons';
import { Loader } from './Loader';
import { AudioVisualizer } from './AudioVisualizer';

interface VoiceReviewerProps {
  documentText: string;
  setHighlightAndNavigate: (text: string | null, page: number | null) => void;
}

type RecordingState = 'idle' | 'recording' | 'processing' | 'complete' | 'error';

export function VoiceReviewer({ documentText, setHighlightAndNavigate }: VoiceReviewerProps) {
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [transcription, setTranscription] = useState<string>('');
  const [reviewResult, setReviewResult] = useState<ReviewResult | null>(null);
  const [error, setError] = useState<string>('');
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  
  const liveSessionRef = useRef<any>(null); // Use any for session as type is complex
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletNodeRef = useRef<any | null>(null); // Using any because it's a ScriptProcessorNode
  const finalTranscriptRef = useRef<string>('');
  const interimTranscriptRef = useRef<string>('');

  const cleanupRecording = useCallback(() => {
    if (liveSessionRef.current) {
        liveSessionRef.current.close();
        liveSessionRef.current = null;
    }
    if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
    }
    if (workletNodeRef.current) {
        // Fix: ScriptProcessorNode uses 'onaudioprocess', not 'port.onmessage'.
        workletNodeRef.current.onaudioprocess = null;
        workletNodeRef.current.disconnect();
        workletNodeRef.current = null;
    }
    if (mediaStreamSourceRef.current) {
        mediaStreamSourceRef.current.disconnect();
        mediaStreamSourceRef.current = null;
    }
    setAnalyserNode(null);

    if(audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
        audioContextRef.current = null;
    }
  }, []);

  const stopRecordingAndProcess = useCallback(async () => {
    cleanupRecording();
    
    const finalTranscription = finalTranscriptRef.current + interimTranscriptRef.current;

    if (finalTranscription.trim().length < 10) {
        setError("Your summary seems too short. Please try recording a more detailed review.");
        setRecordingState('error');
        return;
    }

    setRecordingState('processing');
    try {
      const result = await getReview(documentText, finalTranscription);
      setReviewResult(result);
      setRecordingState('complete');
    } catch (err) {
      console.error('Error getting review:', err);
      setError('Failed to get review from AI. Please try again.');
      setRecordingState('error');
    }
  }, [documentText, cleanupRecording]);

  const startRecording = async () => {
    setTranscription('');
    setReviewResult(null);
    setError('');
    finalTranscriptRef.current = '';
    interimTranscriptRef.current = '';
    setHighlightAndNavigate(null, null);
    setRecordingState('recording');

    try {
      const { session, stream, context, workletNode, source } = await createLiveSession({
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
          cleanupRecording();
        }
      });

      const analyser = context.createAnalyser();
      source.connect(analyser);
      setAnalyserNode(analyser);

      liveSessionRef.current = session;
      mediaStreamRef.current = stream;
      audioContextRef.current = context;
      workletNodeRef.current = workletNode;
      mediaStreamSourceRef.current = source;
    } catch (err) {
      console.error('Failed to start recording:', err);
      setError('Could not start recording. Please ensure microphone access is allowed.');
      setRecordingState('error');
    }
  };
  
  const handleStopClick = () => {
      if (recordingState === 'recording') {
         stopRecordingAndProcess();
      }
  };

  useEffect(() => {
    return cleanupRecording;
  }, [cleanupRecording]);

  const renderContent = () => {
    switch (recordingState) {
      case 'processing':
        return <div className="text-center p-8"><Loader /><p className="mt-4 text-slate-600 font-semibold">Analyzing your review...</p></div>;
      case 'complete':
        return reviewResult && <ReviewDisplay result={reviewResult} setHighlightAndNavigate={setHighlightAndNavigate} />;
      case 'error':
        return <div className="text-center p-4 bg-red-50 border border-red-200 rounded-lg"><p className="text-red-700 font-semibold">Error</p><p className="text-red-600 mt-1">{error}</p></div>;
      case 'idle':
        return <div className="text-center text-slate-500 py-8 px-4">Click the microphone to record your summary and get AI-powered feedback.</div>
      case 'recording':
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
    <div className="bg-white h-full rounded-2xl shadow-lg border border-slate-200/80 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 flex-shrink-0">
            <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-slate-800">Comprehension Review</h2>
            </div>
        </div>

        {/* Controls */}
        <div className="p-4 border-b border-gray-200 flex-shrink-0 flex flex-col items-center">
             {recordingState !== 'recording' ? (
                <button
                    onClick={startRecording}
                    disabled={recordingState === 'processing'}
                    className="w-full flex items-center justify-center gap-3 px-6 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-all shadow-lg focus:outline-none focus:ring-4 focus:ring-blue-300 disabled:bg-slate-400 disabled:shadow-none"
                >
                    <MicrophoneIcon className="h-6 w-6" />
                    <span>Start Recording Review</span>
                </button>
                ) : (
                <button
                    onClick={handleStopClick}
                    className="w-full flex items-center justify-center gap-3 px-6 py-3 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition-all shadow-lg focus:outline-none focus:ring-4 focus:ring-red-300 animate-pulse"
                >
                    <StopIcon className="h-6 w-6" />
                    <span>Stop Recording</span>
                </button>
            )}
        </div>

        {/* Scrolling Content */}
        <div className="flex-1 p-4 overflow-y-auto space-y-4">
            {recordingState === 'recording' && (
                <div className="flex flex-col items-center justify-center p-4 bg-slate-50 rounded-lg">
                    <AudioVisualizer analyserNode={analyserNode} />
                    <p className="mt-3 text-sm text-slate-500 animate-pulse">Recording in progress...</p>
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
}

const ReviewDisplay = ({ result, setHighlightAndNavigate }: ReviewDisplayProps) => {
    const [audioState, setAudioState] = useState<{ loadingIndex: number | null; playingIndex: number | null }>({ loadingIndex: null, playingIndex: null });
    const audioContextRef = useRef<AudioContext | null>(null);
    const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

    useEffect(() => {
        return () => {
            if (audioSourceRef.current) {
                try { audioSourceRef.current.stop(); } catch (e) { /* ignore */ }
            }
            if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
                audioContextRef.current.close();
            }
        };
    }, []);

    const playAudio = async (base64Audio: string, onEnded: () => void) => {
        if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        }
        const context = audioContextRef.current;
        
        try {
            const decoded = decode(base64Audio);
            const audioBuffer = await decodeAudioData(decoded, context, 24000, 1);
            const source = context.createBufferSource();
            audioSourceRef.current = source;
            source.buffer = audioBuffer;
            source.connect(context.destination);
            source.start();
            source.onended = onEnded;
        } catch (e) {
            console.error("Failed to play audio:", e);
            onEnded();
        }
    };

    const stopAudio = () => {
        if (audioSourceRef.current) {
            try { audioSourceRef.current.stop(); } catch (e) { /* ignore */ }
            audioSourceRef.current.onended = null;
            audioSourceRef.current = null;
        }
        setAudioState({ loadingIndex: null, playingIndex: null });
    };

    const handlePointClick = async (item: MissedPoint, index: number) => {
        if (audioState.loadingIndex === index || audioState.playingIndex === index) {
            stopAudio();
            return;
        }
        stopAudio(); 

        setHighlightAndNavigate(item.example, item.pageNumber);
        setAudioState(prev => ({ ...prev, loadingIndex: index }));
        
        const textToSpeak = `Here's more on the missed point: "${item.point}". The document says, "${item.example}". To improve, you could try this: ${item.suggestion}`;
        const audioData = await generateSpeech(textToSpeak);

        if (audioData) {
            setAudioState({ loadingIndex: null, playingIndex: index });
            await playAudio(audioData, () => {
                setAudioState({ loadingIndex: null, playingIndex: null });
            });
        } else {
            console.error("Failed to generate audio for the explanation.");
            setAudioState({ loadingIndex: null, playingIndex: null });
        }
    };


    return (
      <div className="space-y-6 animate-fade-in">
        <div className="flex flex-col items-center text-center">
            <ScoreCircle score={result.score} />
            <p className="text-sm font-medium text-slate-600 mt-3 max-w-xs">{result.scoreRationale}</p>
        </div>
        <div>
          <h4 className="font-semibold text-slate-800 flex items-center gap-2 mb-2"><CheckCircleIcon className="h-5 w-5 text-green-500" /> What you mentioned:</h4>
          <p className="text-slate-700 text-sm bg-green-50 p-3 rounded-md border border-green-200">{result.summaryOfMentionedPoints}</p>
        </div>
        <div>
          <h4 className="font-semibold text-slate-800 flex items-center gap-2"><XCircleIcon className="h-5 w-5 text-red-500" /> Areas to review:</h4>
          <p className="text-xs text-slate-500 italic mt-1">Click a card to hear an explanation and jump to the relevant section.</p>
          <ul className="mt-2 text-slate-600 text-sm space-y-3">
            {result.reviewOfMissedPoints.map((item, index) => (
                <li 
                    key={index} 
                    onClick={() => handlePointClick(item, index)}
                    className="p-4 bg-white border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50 hover:border-slate-300 transition-colors shadow-sm"
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handlePointClick(item, index) }}
                >
                    <div className="flex justify-between items-start gap-3">
                        <p className="font-semibold text-slate-800 flex-1">{item.point}</p>
                        <div className="flex-shrink-0 flex items-center gap-2">
                            <span className="text-xs font-semibold text-blue-600 bg-blue-100 px-2 py-1 rounded-full">
                                Page {item.pageNumber}
                            </span>
                            <div className="w-5 h-5 flex items-center justify-center">
                                {audioState.loadingIndex === index && <div className="w-4 h-4 border-2 border-t-blue-500 border-slate-200 rounded-full animate-spin"></div>}
                                {audioState.playingIndex === index && <SpeakerWaveIcon className="w-5 h-5 text-blue-600 animate-pulse" />}
                            </div>
                        </div>
                    </div>
                    <blockquote className="mt-2 pl-3 border-l-4 border-slate-300 text-slate-600 italic">
                        "{item.example}"
                    </blockquote>
                    
                    {item.suggestion && (
                        <div className="mt-3 pt-3 border-t border-slate-200 flex items-start gap-2.5">
                            <LightbulbIcon className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                            <div>
                                <h5 className="font-semibold text-sm text-slate-700">Suggestion</h5>
                                <p className="text-sm text-slate-600">{item.suggestion}</p>
                            </div>
                        </div>
                    )}
                    {item.relatedConcepts && item.relatedConcepts.length > 0 && (
                         <div className="mt-3 pt-3 border-t border-slate-200">
                            <div className="flex items-start gap-2.5">
                                <AcademicCapIcon className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
                                <div>
                                    <h5 className="font-semibold text-sm text-slate-700">Related Concepts</h5>
                                    <div className="flex flex-wrap gap-2 mt-2">
                                        {item.relatedConcepts.map((concept, i) => (
                                            <span key={i} className="px-2 py-1 text-xs font-medium text-blue-800 bg-blue-100 rounded-full">
                                                {concept}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </li>
            ))}
          </ul>
        </div>
      </div>
    );
};