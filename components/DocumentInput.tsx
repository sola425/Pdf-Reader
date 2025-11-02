import React, { useState, useCallback } from 'react';
import { UploadIcon } from './Icons';

interface DocumentInputProps {
  onSubmit: (data: string | File) => void;
}

export function DocumentInput({ onSubmit }: DocumentInputProps) {
  const [text, setText] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = useCallback((file: File) => {
    setError('');
    if (file.type === 'application/pdf') {
        setText(''); 
        setSelectedFile(file);
        setFileName(file.name);
    } else if (file.type === 'text/plain') {
        const reader = new FileReader();
        reader.onload = (event) => {
          const fileText = event.target?.result as string;
          setText(fileText);
          setSelectedFile(null);
          setFileName(file.name);
        };
        reader.onerror = () => {
             setError('Failed to read the text file.');
        }
        reader.readAsText(file);
    } else {
        setError('Unsupported file type. Please upload a .txt or .pdf file.');
        setSelectedFile(null);
        setFileName('');
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedFile) {
        onSubmit(selectedFile);
    } else if (text.trim()) {
      onSubmit(text);
    }
  };

  const isSubmitDisabled = !text.trim() && !selectedFile;

  return (
    <div className="bg-white p-8 rounded-2xl shadow-lg border border-slate-200/80 w-full max-w-3xl mx-auto animate-fade-in">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-extrabold tracking-tight text-slate-900">Start Your Review Session</h2>
        <p className="mt-2 text-lg text-slate-600">
          Analyze your study materials to improve comprehension and recall.
        </p>
      </div>
      <form onSubmit={handleSubmit}>
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
                Upload a file
              </label>
              {' '}or drag and drop
            </p>
            <p className="text-xs text-slate-500">PDF or TXT files supported</p>
            <input id="file-upload" type="file" accept=".txt,.pdf" onChange={handleFileChange} className="sr-only" />
          </div>
        </div>

        <div className="my-6 flex items-center">
            <div className="flex-grow border-t border-slate-300"></div>
            <span className="flex-shrink mx-4 text-slate-500 font-medium">Or</span>
            <div className="flex-grow border-t border-slate-300"></div>
        </div>
        
        <textarea
          value={text}
          onChange={(e) => {
              setText(e.target.value);
              setSelectedFile(null); 
              setFileName('');
          }}
          placeholder="Paste your chapter or page content here..."
          className="w-full h-40 p-4 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow shadow-sm disabled:bg-slate-100"
          disabled={!!selectedFile}
        />
        
        {fileName && (
            <div className="mt-4 p-3 bg-blue-50 text-blue-800 rounded-md border border-blue-200 text-sm font-medium">
                Selected file: <strong>{fileName}</strong>
            </div>
        )}
         {error && (
            <p className="mt-2 text-sm text-red-600">{error}</p>
        )}
        
        <div className="mt-8">
          <button
            type="submit"
            disabled={isSubmitDisabled}
            className="w-full px-6 py-4 bg-blue-600 text-white font-bold text-lg rounded-lg hover:bg-blue-700 transition-all shadow-lg focus:outline-none focus:ring-4 focus:ring-blue-300 disabled:bg-slate-400 disabled:cursor-not-allowed disabled:shadow-none"
          >
            Start Review
          </button>
        </div>
      </form>
    </div>
  );
}