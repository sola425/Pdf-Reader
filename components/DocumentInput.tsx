
import React, { useState } from 'react';
import { UploadIcon } from './Icons';

interface DocumentInputProps {
  onSubmit: (data: string | File) => void;
}

export function DocumentInput({ onSubmit }: DocumentInputProps) {
  const [text, setText] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedFile) {
        onSubmit(selectedFile);
    } else if (text.trim()) {
      onSubmit(text);
    }
  };
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError('');
    
    if (file.type === 'application/pdf') {
        setText(''); // Clear textarea if a file is selected
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
  };

  const isSubmitDisabled = !text.trim() && !selectedFile;

  return (
    <div className="bg-white p-8 rounded-xl shadow-lg border border-gray-200 w-full max-w-3xl mx-auto animate-fade-in">
      <div className="text-center mb-6">
        <UploadIcon className="mx-auto h-12 w-12 text-indigo-300" />
        <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">Upload Your Document</h2>
        <p className="mt-2 text-md text-slate-600">
          Paste your text below or upload a .txt or .pdf file to get started.
        </p>
      </div>
      <form onSubmit={handleSubmit}>
        <textarea
          value={text}
          onChange={(e) => {
              setText(e.target.value);
              setSelectedFile(null); // Clear file if user types
              setFileName('');
          }}
          placeholder="Paste your chapter or page content here, or upload a file..."
          className="w-full h-64 p-4 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-shadow shadow-sm"
          disabled={!!selectedFile}
        />
        {fileName && (
            <div className="mt-4 p-3 bg-indigo-50 text-indigo-800 rounded-md border border-indigo-200 text-sm">
                Selected file: <strong>{fileName}</strong>
            </div>
        )}
         {error && (
            <p className="mt-2 text-sm text-red-600">{error}</p>
        )}
        <div className="mt-6 flex flex-col sm:flex-row gap-4">
           <label className={`flex-1 w-full sm:w-auto text-center cursor-pointer px-6 py-3 bg-white border border-indigo-600 text-indigo-600 font-semibold rounded-lg hover:bg-indigo-50 transition-colors shadow-sm`}>
             {fileName ? 'Change File' : 'Upload .txt or .pdf file'}
            <input type="file" accept=".txt,.pdf" onChange={handleFileChange} className="hidden" />
          </label>
          <button
            type="submit"
            disabled={isSubmitDisabled}
            className="flex-1 w-full sm:w-auto px-6 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition-colors shadow-sm disabled:bg-slate-400 disabled:cursor-not-allowed"
          >
            Start Review
          </button>
        </div>
      </form>
    </div>
  );
}
