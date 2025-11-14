
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { CameraIcon, XCircleIcon } from './Icons';

interface ScanDocumentProps {
  onFileScan: (file: File) => void;
}

export function ScanDocument({ onFileScan }: ScanDocumentProps) {
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [error, setError] = useState<string>('');
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const cleanupCamera = useCallback(() => {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            setStream(null);
        }
    }, [stream]);

    useEffect(() => {
        const startCamera = async () => {
            try {
                const mediaStream = await navigator.mediaDevices.getUserMedia({ 
                    video: { facingMode: 'environment' } 
                });
                setStream(mediaStream);
                if (videoRef.current) {
                    videoRef.current.srcObject = mediaStream;
                }
            } catch (err: any) {
                console.error("Camera access error:", err);
                if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                    setError('Camera access denied. Please enable it in your browser settings.');
                } else {
                    setError('Could not access the camera. Please ensure it is connected and not in use by another app.');
                }
            }
        };

        startCamera();
        return () => cleanupCamera();
    }, [cleanupCamera]);

    const handleCapture = () => {
        if (!videoRef.current || !canvasRef.current) return;
        const video = videoRef.current;
        const canvas = canvasRef.current;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext('2d');
        if (!context) return;

        context.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
        
        canvas.toBlob(blob => {
            if (blob) {
                const fileName = `scan-${new Date().toISOString()}.jpeg`;
                const file = new File([blob], fileName, { type: 'image/jpeg' });
                onFileScan(file);
                cleanupCamera();
            }
        }, 'image/jpeg', 0.95);
    };

    if (error) {
        return (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-center">
                <XCircleIcon className="mx-auto h-10 w-10 text-red-400" />
                <h3 className="mt-2 font-semibold text-red-800">Camera Error</h3>
                <p className="text-sm text-red-700 mt-1">{error}</p>
            </div>
        );
    }

    if (!stream) {
        return <div className="p-4 text-center">Loading Camera...</div>;
    }

    return (
        <div className="bg-white p-4 rounded-lg shadow-md border border-slate-200">
            <div className="relative w-full aspect-[4/3] bg-black rounded-md overflow-hidden">
                <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover"></video>
            </div>
            <canvas ref={canvasRef} className="hidden"></canvas>
            <div className="mt-4">
                <button
                    onClick={handleCapture}
                    className="w-full px-6 py-4 bg-gradient-to-r from-blue-600 to-blue-500 text-white font-bold text-lg rounded-lg hover:from-blue-700 hover:to-blue-600 transition-all shadow-lg flex items-center justify-center gap-2"
                    aria-label="Capture image"
                >
                    <CameraIcon className="w-6 h-6"/>
                    Capture
                </button>
            </div>
        </div>
    );
}
