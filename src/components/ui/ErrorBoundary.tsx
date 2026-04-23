import React, { Component } from 'react';
import { AlertCircle } from 'lucide-react';
import { C } from '../../lib/tokens';

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
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: C.bg }}>
        <div className="max-w-md w-full glass-panel rounded-3xl p-8 text-center">
          <AlertCircle className="w-12 h-12 text-rose-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold mb-2" style={{ color: C.text }}>Something went wrong</h1>
          <p className="mb-6 text-sm" style={{ color: C.textSec }}>{this.state.error?.message}</p>
          <button onClick={() => window.location.reload()} className="w-full py-3 text-white rounded-xl font-medium" style={{ background: C.accent }}>Reload</button>
        </div>
      </div>
    );
    return this.props.children;
  }
}
