import React, { useEffect, useState } from 'react';
import { X, Sparkles } from 'lucide-react';
import { C } from '../lib/tokens';

interface ComingSoonModalProps {
  onClose: () => void;
}

export function ComingSoonModal({ onClose }: ComingSoonModalProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(timer);
  }, []);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 250);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(4px)',
      opacity: visible ? 1 : 0, transition: 'opacity 0.25s ease',
      padding: 24,
    }}>
      <div style={{
        background: 'var(--bg)', borderRadius: 24, border: '1px solid var(--border)',
        boxShadow: '0 24px 48px -12px rgba(0,0,0,0.25)',
        width: '100%', maxWidth: 360, padding: 32, textAlign: 'center',
        transform: visible ? 'translateY(0) scale(1)' : 'translateY(16px) scale(0.95)',
        transition: 'transform 0.25s cubic-bezier(0.16,1,0.3,1)',
        position: 'relative'
      }}>
        <button onClick={handleClose} style={{
          position: 'absolute', top: 16, right: 16,
          background: 'var(--bg-alt)', border: 'none', cursor: 'pointer',
          width: 28, height: 28, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-tert)',
        }}>
          <X size={14} />
        </button>

        <div style={{
          width: 56, height: 56, borderRadius: '50%',
          background: 'rgba(37,99,235,0.1)', color: '#2563eb',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 20px',
        }}>
          <Sparkles size={28} />
        </div>

        <h3 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', margin: '0 0 10px', letterSpacing: '-0.02em' }}>
          Coming Soon!
        </h3>
        <p style={{ fontSize: 14, color: 'var(--text-tert)', margin: 0, lineHeight: 1.6 }}>
          We are working hard to bring this feature to you. Stay tuned for updates!
        </p>

        <button onClick={handleClose} style={{
          marginTop: 24, width: '100%', padding: '12px', borderRadius: 12,
          background: '#2563eb', color: '#fff', border: 'none',
          fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
        }}>
          Got it
        </button>
      </div>
    </div>
  );
}
