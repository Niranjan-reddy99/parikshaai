import React, { Component } from 'react';
import { AlertCircle } from 'lucide-react';

export class ErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean; error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-xl text-center">
          <AlertCircle className="w-12 h-12 text-rose-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-slate-900 mb-2">Something went wrong</h1>
          <p className="text-slate-500 mb-6 text-sm">{this.state.error?.message}</p>
          <button onClick={() => window.location.reload()} className="w-full py-3 bg-slate-900 text-white rounded-xl font-medium">Reload</button>
        </div>
      </div>
    );
    return this.props.children;
  }
}
