import React, { Component, ErrorInfo, ReactNode } from 'react';
import { XCircleIcon } from './Icons';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  // FIX: Switched from a constructor to a class property for state initialization. This is a more modern and concise syntax that achieves the same result and can resolve subtle typing issues with `this.state` and `this.props`.
  state: State = {
    hasError: false,
    error: null,
  };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 m-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg text-center">
            <XCircleIcon className="mx-auto h-12 w-12 text-red-400" />
            <h1 className="mt-4 text-xl font-bold text-red-800 dark:text-red-200">Something went wrong</h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-red-300">
                A part of the application has crashed. Please try refreshing the page.
            </p>
            {this.state.error && (
                <pre className="mt-4 text-xs text-left bg-red-100 dark:bg-red-900/30 p-2 rounded overflow-auto">
                    {this.state.error.toString()}
                </pre>
            )}
        </div>
      );
    }

    return this.props.children;
  }
}