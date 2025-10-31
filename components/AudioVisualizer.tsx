import React, { useRef, useEffect } from 'react';

interface AudioVisualizerProps {
  analyserNode: AnalyserNode | null;
}

export function AudioVisualizer({ analyserNode }: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!analyserNode || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const canvasCtx = canvas.getContext('2d');
    if (!canvasCtx) return;

    analyserNode.fftSize = 256;
    const bufferLength = analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    canvas.width = 300;
    canvas.height = 75;

    let animationFrameId: number;

    const draw = () => {
      animationFrameId = requestAnimationFrame(draw);

      analyserNode.getByteFrequencyData(dataArray);

      canvasCtx.fillStyle = '#f8fafc'; // slate-50, same as background
      canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 1.5;
      const barGutter = 1;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * canvas.height;
        
        const gradient = canvasCtx.createLinearGradient(0, canvas.height, 0, canvas.height - barHeight);
        gradient.addColorStop(0, '#818cf8'); // indigo-400
        gradient.addColorStop(1, '#6366f1'); // indigo-500
        canvasCtx.fillStyle = gradient;

        canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);

        x += barWidth + barGutter;
      }
    };

    draw();

    return () => {
      cancelAnimationFrame(animationFrameId);
      if(canvasCtx) {
        canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };
  }, [analyserNode]);

  return <canvas ref={canvasRef} className="w-full max-w-[300px]" height="75" />;
}