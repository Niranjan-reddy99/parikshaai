import { useState } from 'react';

interface PremiumGateModalProps {
  freePaperLabel: string;
  onClose: () => void;
}

const FEATURES = [
  { icon: '📄', text: 'Access all previous year papers across every commission' },
  { icon: '📊', text: 'Advanced analytics — accuracy trends, weak area deep-dives' },
  { icon: '🔖', text: 'Unlimited bookmarks and custom practice sets' },
  { icon: '⚡', text: 'AI-generated explanations for every question instantly' },
  { icon: '🏆', text: 'Full leaderboard visibility and rank tracking' },
  { icon: '🔒', text: 'Unlock all years: 2015 → present for all exams' },
];

export function PremiumGateModal({ freePaperLabel, onClose }: PremiumGateModalProps) {
  const [hoverClose, setHoverClose] = useState(false);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg)',
          borderRadius: 20,
          padding: '36px 36px 28px',
          maxWidth: 440,
          width: '100%',
          boxShadow: '0 24px 64px rgba(0,0,0,0.28)',
          border: '1px solid var(--border)',
          position: 'relative',
        }}
      >
        {/* Close */}
        <button
          onClick={onClose}
          onMouseEnter={() => setHoverClose(true)}
          onMouseLeave={() => setHoverClose(false)}
          style={{
            position: 'absolute', top: 14, right: 14,
            width: 30, height: 30, borderRadius: '50%',
            background: hoverClose ? 'var(--bg-alt)' : 'transparent',
            border: '1px solid var(--border)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-tert)', transition: 'all 0.12s',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            background: 'linear-gradient(135deg, #f59e0b, #d97706)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px', fontSize: 28,
            boxShadow: '0 8px 24px rgba(245,158,11,0.3)',
          }}>
            👑
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', margin: '0 0 8px', letterSpacing: '-0.3px' }}>
            Unlock Premium Access
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-sec)', margin: 0, lineHeight: 1.6 }}>
            Free plan includes <strong style={{ color: 'var(--text)' }}>{freePaperLabel}</strong> only.
            Upgrade to access all {' '}
            <strong style={{ color: 'var(--text)' }}>2,500+ papers</strong> across every exam.
          </p>
        </div>

        {/* Feature list */}
        <div style={{ marginBottom: 24 }}>
          {FEATURES.map(({ icon, text }) => (
            <div key={text} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 15, flexShrink: 0, marginTop: 1 }}>{icon}</span>
              <span style={{ fontSize: 13, color: 'var(--text-sec)', lineHeight: 1.5 }}>{text}</span>
            </div>
          ))}
        </div>

        {/* CTA */}
        <button
          style={{
            width: '100%', padding: '13px 0',
            background: 'linear-gradient(135deg, #f59e0b, #d97706)',
            border: 'none', borderRadius: 10,
            fontSize: 15, fontWeight: 700, color: 'white',
            cursor: 'pointer', fontFamily: 'inherit',
            boxShadow: '0 4px 16px rgba(245,158,11,0.35)',
            marginBottom: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
          onClick={() => {
            // Payment gateway will be integrated here
            alert('Payment gateway coming soon! Contact us to upgrade.');
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/>
          </svg>
          Upgrade to Premium
        </button>

        <button
          onClick={onClose}
          style={{
            width: '100%', padding: '10px 0',
            background: 'none', border: 'none',
            fontSize: 13, color: 'var(--text-tert)',
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Continue with free plan
        </button>
      </div>
    </div>
  );
}
