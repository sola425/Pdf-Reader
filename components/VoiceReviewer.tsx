import React, { useState, useRef, useCallback, useEffect } from 'react';
import type { ReviewResult } from '../types';
import { getReview, createLiveSession } from '../services/geminiService';
import { MicrophoneIcon, StopIcon, CheckCircleIcon, XCircleIcon, LightbulbIcon, ChevronUpIcon, ChevronDownIcon, AcademicCapIcon } from './Icons';
import { Loader } from './Loader';
import { AudioVisualizer } from './AudioVisualizer';

interface VoiceReviewerProps {
  documentText: string;
  setHighlightText: (text: string | null) => void;
}

type RecordingState = 'idle' | 'recording' | 'processing' | 'complete' | 'error';

export function VoiceReviewer({ documentText, setHighlightText }: VoiceReviewerProps) {
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [transcription, setTranscription] = useState<string>('');
  const [reviewResult, setReviewResult] = useState<ReviewResult | null>(null);
  const [error, setError] = useState<string>('');
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  const liveSessionRef = useRef<any>(null); // Use any for session as type is complex
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const finalTranscriptRef = useRef<string>('');
  const interimTranscriptRef = useRef<string>('');

  useEffect(() => {
    if (['recording', 'processing', 'complete', 'error'].includes(recordingState)) {
      setIsExpanded(true);
    }
  }, [recordingState]);

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
        workletNodeRef.current.port.onmessage = null;
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
    setHighlightText(null);
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
        return <div className="text-center"><Loader /><p className="mt-4 text-slate-600">Analyzing your review...</p></div>;
      case 'complete':
        return reviewResult && <ReviewDisplay result={reviewResult} setHighlightText={setHighlightText} />;
      case 'error':
        return <div className="text-center p-4 bg-red-50 border border-red-200 rounded-lg"><p className="text-red-700 font-semibold">Error</p><p className="text-red-600 mt-1">{error}</p></div>;
      case 'idle':
        return <div className="text-center text-slate-500 py-4">Click "Start Recording Review" to begin.</div>
      case 'recording':
        return (
          <div className="text-slate-600">
            <h3 className="font-semibold text-lg text-slate-800 mb-2">Your spoken summary:</h3>
            <p className="min-h-[60px] p-2 border border-dashed border-slate-300 rounded-md bg-slate-50">{transcription || "..."}</p>
          </div>
        );
      default:
        return null;
    }
  };

  const scoreColor = reviewResult ? (reviewResult.score >= 80 ? 'text-green-600' : reviewResult.score >= 50 ? 'text-yellow-600' : 'text-red-600') : '';

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50">
        <div className="bg-white shadow-[0_-4px_12px_rgba(0,0,0,0.1)] border-t border-gray-200">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                {/* Header bar */}
                <div className="h-24 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <h2 className="text-xl font-bold text-slate-800">Voice Review</h2>
                        {reviewResult && recordingState === 'complete' && !isExpanded && (
                            <p className={`text-lg font-bold ${scoreColor}`}>
                                Score: {reviewResult.score}/100
                            </p>
                        )}
                    </div>
                    <div className="flex items-center gap-4">
                        {recordingState !== 'recording' ? (
                          <button
                            onClick={startRecording}
                            disabled={recordingState === 'processing'}
                            className="w-full max-w-xs flex items-center justify-center gap-2 px-6 py-3 bg-indigo-600 text-white font-bold rounded-full hover:bg-indigo-700 transition-all shadow-lg focus:outline-none focus:ring-4 focus:ring-indigo-300 disabled:bg-slate-400"
                          >
                            <MicrophoneIcon className="h-6 w-6" />
                            <span>Start Recording Review</span>
                          </button>
                        ) : (
                          <button
                            onClick={handleStopClick}
                            className="w-full max-w-xs flex items-center justify-center gap-2 px-6 py-3 bg-red-600 text-white font-bold rounded-full hover:bg-red-700 transition-all shadow-lg focus:outline-none focus:ring-4 focus:ring-red-300 animate-pulse"
                          >
                            <StopIcon className="h-6 w-6" />
                            <span>Stop Recording</span>
                          </button>
                        )}
                        <button onClick={() => setIsExpanded(!isExpanded)} className="p-2 rounded-full hover:bg-slate-100">
                           {isExpanded ? <ChevronDownIcon className="h-6 w-6 text-slate-600" /> : <ChevronUpIcon className="h-6 w-6 text-slate-600" />}
                        </button>
                    </div>
                </div>

                {/* Collapsible content */}
                <div className={`transition-all duration-500 ease-in-out overflow-y-auto ${isExpanded ? 'max-h-[40vh] visible' : 'max-h-0 invisible'}`}>
                    <div className="pb-6">
                      {recordingState === 'recording' && (
                          <div className="flex flex-col items-center justify-center mb-4 p-4 bg-slate-50 rounded-lg">
                              <AudioVisualizer analyserNode={analyserNode} />
                              <p className="mt-3 text-sm text-slate-500 animate-pulse">Recording in progress...</p>
                          </div>
                      )}
                      {renderContent()}
                    </div>
                </div>
            </div>
        </div>
    </div>
  );
}

interface ReviewDisplayProps {
    result: ReviewResult;
    setHighlightText: (text: string | null) => void;
}

const ReviewDisplay = ({ result, setHighlightText }: ReviewDisplayProps) => {
    const scoreColor = result.score >= 80 ? 'text-green-600' : result.score >= 50 ? 'text-yellow-600' : 'text-red-600';

    return (
      <div className="space-y-4 animate-fade-in">
        <div className="text-center">
          <p className="text-sm font-medium text-slate-600">Comprehension Score</p>
          <p className={`text-6xl font-bold ${scoreColor}`}>{result.score}<span className="text-3xl text-slate-400">/100</span></p>
        </div>
        <div>
          <h4 className="font-semibold text-slate-800 flex items-center gap-2"><CheckCircleIcon className="h-5 w-5 text-green-500" /> What you mentioned:</h4>
          <p className="mt-1 text-slate-600 text-sm bg-green-50 p-3 rounded-md border border-green-200">{result.summaryOfMentionedPoints}</p>
        </div>
        <div>
          <h4 className="font-semibold text-slate-800 flex items-center gap-2"><XCircleIcon className="h-5 w-5 text-red-500" /> Areas to review:</h4>
          <p className="text-xs text-slate-500 italic mt-1">Click on a card to highlight the corresponding text in the document.</p>
          <ul className="mt-1 text-slate-600 text-sm space-y-3">
            {result.reviewOfMissedPoints.map((item, index) => (
                <li 
                    key={index} 
                    onClick={() => setHighlightText(item.example)}
                    className="p-3 bg-red-50 border border-red-200 rounded-md cursor-pointer hover:bg-red-100 hover:border-red-300 transition-colors"
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setHighlightText(item.example) }}
                >
                    <div>
                        <p className="font-semibold text-slate-700">{item.point}</p>
                        <blockquote className="mt-1 pl-3 border-l-4 border-red-300 text-red-900/80 italic">
                            "{item.example}"
                        </blockquote>
                    </div>
                    {item.suggestion && (
                        <div className="mt-3 pt-3 border-t border-red-200 flex items-start gap-2.5">
                            <LightbulbIcon className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                            <div>
                                <h5 className="font-semibold text-sm text-gray-700">Suggestion</h5>
                                <p className="text-sm text-slate-600">{item.suggestion}</p>
                            </div>
                        </div>
                    )}
                    {item.relatedConcepts && item.relatedConcepts.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-red-200 flex items-start gap-2.5">
                            <AcademicCapIcon className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
                            <div>
                                <h5 className="font-semibold text-sm text-gray-700">Related Concepts for Further Study</h5>
                                <div className="flex flex-wrap gap-2 mt-1">
                                    {item.relatedConcepts.map((concept, i) => (
                                        <span key={i} className="px-2 py-1 text-xs font-medium text-blue-800 bg-blue-100 rounded-full">
                                            {concept}
                                        </span>
                                    ))}
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