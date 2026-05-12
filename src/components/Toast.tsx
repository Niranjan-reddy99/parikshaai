import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';
import { C } from '../lib/tokens';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({ showToast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

let _idCounter = 0;

const ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 style={{ width: 15, height: 15, flexShrink: 0 }} />,
  error:   <XCircle     style={{ width: 15, height: 15, flexShrink: 0 }} />,
  info:    <Info        style={{ width: 15, height: 15, flexShrink: 0 }} />,
};

const COLORS: Record<ToastType, { bg: string; border: string; color: string }> = {
  success: { bg: 'rgba(52,211,153,0.12)',  border: 'rgba(52,211,153,0.35)',  color: '#34d399' },
  error:   { bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.35)', color: '#f87171' },
  info:    { bg: 'rgba(96,165,250,0.12)',  border: 'rgba(96,165,250,0.35)',  color: '#60a5fa' },
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    // Animate in
    const raf = requestAnimationFrame(() => setVisible(true));
    // Auto-dismiss after 3s
    timerRef.current = window.setTimeout(() => {
      setVisible(false);
      setTimeout(() => onDismiss(toast.id), 250);
    }, 3000);
    return () => { cancelAnimationFrame(raf); clearTimeout(timerRef.current); };
  }, []);

  const c = COLORS[toast.type];
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '11px 14px', borderRadius: 10,
      background: C.surface, border: `1px solid ${c.border}`,
      boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
      color: c.color, fontSize: 13, fontWeight: 500,
      maxWidth: 360, minWidth: 220,
      transform: visible ? 'translateY(0)' : 'translateY(16px)',
      opacity: visible ? 1 : 0,
      transition: 'transform 0.22s cubic-bezier(0.16,1,0.3,1), opacity 0.22s ease',
      pointerEvents: 'all',
    }}>
      {ICONS[toast.type]}
      <span style={{ flex: 1, color: C.text, fontWeight: 400 }}>{toast.message}</span>
      <button onClick={() => { setVisible(false); setTimeout(() => onDismiss(toast.id), 250); }}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: C.textTert, display: 'flex', flexShrink: 0 }}>
        <X style={{ width: 12, height: 12 }} />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++_idCounter;
    setToasts(prev => [...prev.slice(-4), { id, message, type }]); // max 5 visible
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Toast container — bottom-right */}
      <div style={{
        position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
        display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end',
        pointerEvents: 'none',
      }}>
        {toasts.map(t => (
          <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
