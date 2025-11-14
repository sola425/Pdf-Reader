
import React, { useState, useCallback } from 'react';
import { UploadIcon } from './Icons';

interface DocumentInputProps {
  onFileSelect: (data: File) => void;
}

export function DocumentInput({ onFileSelect }: DocumentInputProps) {
  const [error, setError] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = useCallback((file: File) => {
    setError('');
    if (file.type === 'application/pdf' || file.type.startsWith('image/')) {
        onFileSelect(file);
    } else {
        setError('Unsupported file type. Please upload a PDF or an image file.');
    }
  }, [onFileSelect]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Reset the input so the same file can be selected again
    e.target.value = '';
  };
  
  const handleDragEvents = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e: React.DragEvent) => {
    handleDragEvents(e);
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    handleDragEvents(e);
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    handleDragEvents(e);
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <>
      <div 
        onDragEnter={handleDragEnter}
        onDragOver={handleDragEvents}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative border-2 border-dashed rounded-xl p-6 transition-colors duration-200 ${isDragging ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-slate-50'}`}
      >
        <div className="flex flex-col items-center justify-center space-y-4 text-center">
          <UploadIcon className="mx-auto h-12 w-12 text-slate-400" />
          <p className="text-slate-600">
            <label htmlFor="file-upload" className="font-semibold text-blue-600 hover:text-blue-700 cursor-pointer focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-blue-500">
              Upload a Document
            </label>
            {' '}or drag and drop
          </p>
          <p className="text-xs text-slate-500">PDF or Image files up to 100MB</p>
          <input id="file-upload" type="file" accept=".pdf,application/pdf,image/*" onChange={handleFileChange} className="sr-only" />
        </div>
      </div>
       {error && (
          <p className="mt-2 text-sm text-red-600">{error}</p>
      )}
    </>
  );
}
