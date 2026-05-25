import { createPortal } from 'react-dom';

interface OnboardingModalProps {
  userName: string;
  onComplete: () => void;
}

export function OnboardingModal({ userName, onComplete }: OnboardingModalProps) {
  const firstName = (userName ?? 'Aspirant').split(' ')[0];

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        style={{
          width: '100%', maxWidth: 440,
          background: 'var(--bg)',
          borderRadius: 20, padding: '32px 28px 24px',
          boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
          border: '1px solid var(--border)',
        }}
      >
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14,
            background: 'var(--blue-soft)', border: '1.5px solid rgba(37,99,235,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px',
          }}>
            <svg viewBox="0 0 14 14" fill="none" width="24" height="24">
              <path d="M7 1L12.5 4.25V10.75L7 14L1.5 10.75V4.25L7 1Z" stroke="#2dd4bf" strokeWidth="1.2" strokeLinejoin="round"/>
              <path d="M7 4L9.6 5.5V8.5L7 10L4.4 8.5V5.5L7 4Z" fill="#2dd4bf" opacity=".5"/>
            </svg>
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
            Welcome, {firstName}!
          </div>
          <div style={{ fontSize: 13.5, color: 'var(--text-sec)', lineHeight: 1.55 }}>
            ParikshaGPT helps you master PYQs with AI-powered insights.
          </div>
        </div>

        {/* Features */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
          {[
            ['📚', 'Real PYQ Papers', 'UPSC, APPSC & TSPSC question banks'],
            ['🤖', 'AI Explanations', 'Gemini-powered, generated on demand'],
            ['📊', 'Analytics & Streaks', 'Track accuracy and weak areas'],
          ].map(([icon, title, desc]) => (
            <div key={title} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '9px 12px', background: 'var(--bg-alt)',
              border: '1px solid var(--border)', borderRadius: 10,
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: 'var(--blue-soft)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: 16, flexShrink: 0,
              }}>{icon}</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{title}</div>
                <div style={{ fontSize: 11, color: 'var(--text-tert)', marginTop: 1 }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <button
          type="button"
          onClick={onComplete}
          style={{
            display: 'block', width: '100%', padding: '13px 0',
            background: '#2563eb', border: 'none', borderRadius: 10,
            fontSize: 15, fontWeight: 700, color: '#fff',
            cursor: 'pointer',
          }}
        >
          Let's go →
        </button>
      </div>
    </div>,
    document.body
  );
}
