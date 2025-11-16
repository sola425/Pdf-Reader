import React from 'react';
import { XIcon, KeyboardIcon } from './Icons';

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const shortcuts = [
  { keys: ['→', '↓', 'J'], description: 'Next Page' },
  { keys: ['←', '↑', 'K'], description: 'Previous Page' },
  { keys: ['+'], description: 'Zoom In' },
  { keys: ['-'], description: 'Zoom Out' },
  { keys: ['Cmd/Ctrl', 'F'], description: 'Open Search' },
  { keys: ['Esc'], description: 'Close Modals/Panels, Exit Fullscreen' },
];

const panelShortcuts = [
  { keys: ['Cmd/Ctrl', '1'], description: 'Toggle Thumbnails' },
  { keys: ['Cmd/Ctrl', '2'], description: 'Toggle Annotations' },
  { keys: ['Cmd/Ctrl', '3'], description: 'Toggle AI Chat' },
  { keys: ['Cmd/Ctrl', '4'], description: 'Toggle Study Panel' },
  { keys: ['Cmd/Ctrl', '5'], description: 'Toggle AI Coach' },
];

interface ShortcutRowProps {
  keys: string[];
  description: string;
}

// FIX: Explicitly type ShortcutRow as a React.FC to allow it to accept the special `key` prop without type errors.
const ShortcutRow: React.FC<ShortcutRowProps> = ({ keys, description }) => (
    <tr className="border-b border-slate-200 dark:border-slate-700">
        <td className="py-3 pr-4 text-slate-600 dark:text-slate-300">{description}</td>
        <td className="py-3 pl-4 text-right">
            <div className="flex items-center justify-end gap-1">
                {keys.map((key, i) => (
                    <kbd key={i} className="px-2 py-1 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md">
                        {key}
                    </kbd>
                ))}
            </div>
        </td>
    </tr>
);


export function KeyboardShortcutsModal({ isOpen, onClose }: KeyboardShortcutsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-fade-in" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md h-auto max-h-[80vh] flex flex-col animate-pop-in">
            <header className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2">
                    <KeyboardIcon className="w-6 h-6 text-indigo-500" />
                    <h2 id="shortcuts-title" className="text-lg font-bold text-slate-800 dark:text-slate-100">
                        Keyboard Shortcuts
                    </h2>
                </div>
                <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700" aria-label="Close shortcuts modal">
                    <XIcon className="w-6 h-6 text-slate-600 dark:text-slate-300" />
                </button>
            </header>
            <div className="flex-1 p-6 overflow-y-auto">
                <table className="w-full text-sm">
                    <thead>
                         <tr><th colSpan={2} className="text-left font-semibold pb-2 text-slate-800 dark:text-slate-100">Navigation & View</th></tr>
                    </thead>
                    <tbody>
                        {shortcuts.map(s => <ShortcutRow {...s} key={s.description} />)}
                    </tbody>
                </table>
                 <table className="w-full text-sm mt-6">
                    <thead>
                         <tr><th colSpan={2} className="text-left font-semibold pb-2 text-slate-800 dark:text-slate-100">Panels</th></tr>
                    </thead>
                    <tbody>
                        {panelShortcuts.map(s => <ShortcutRow {...s} key={s.description} />)}
                    </tbody>
                </table>
            </div>
        </div>
    </div>
  );
}
