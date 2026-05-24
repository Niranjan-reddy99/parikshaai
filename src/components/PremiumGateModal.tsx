import { useState } from 'react';

interface PremiumGateModalProps {
  freePaperLabel: string;
  onClose: () => void;
  /** When provided, "Upgrade" button calls this instead of the "notify me" fallback.
   *  Hook in your Razorpay / Stripe flow here. */
  onUpgrade?: () => void;
}

const FEATURES = [
  'All previous year papers across every commission',
  'Advanced analytics — accuracy trends, weak-area deep-dives',
  'Unlimited bookmarks and custom practice sets',
  'AI explanations for every question, instantly',
  'Full leaderboard visibility and rank tracking',
  'Unlock all years: 2015 → present for all exams',
];

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function PremiumGateModal({ freePaperLabel, onClose, onUpgrade }: PremiumGateModalProps) {
  const [hoverClose, setHoverClose] = useState(false);
  const [notified, setNotified] = useState(false);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.52)',
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
          padding: '32px 32px 24px',
          maxWidth: 440,
          width: '100%',
          boxShadow: '0 24px 64px rgba(0,0,0,0.24)',
          border: '1px solid var(--border)',
          position: 'relative',
        }}
      >
        {/* Close */}
        <button
          onClick={onClose}
          onMouseEnter={() => setHoverClose(true)}
          onMouseLeave={() => setHoverClose(false)}
          aria-label="Close"
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
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'linear-gradient(135deg, #f59e0b, #d97706)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 14px',
            boxShadow: '0 8px 24px rgba(245,158,11,0.28)',
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="none" aria-hidden="true">
              <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
            </svg>
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', margin: '0 0 8px', letterSpacing: '-0.3px' }}>
            Unlock Premium Access
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-sec)', margin: 0, lineHeight: 1.6 }}>
            Free plan includes <strong style={{ color: 'var(--text)' }}>{freePaperLabel}</strong> only.
            Upgrade to access all{' '}
            <strong style={{ color: 'var(--text)' }}>2,500+ papers</strong> across every exam.
          </p>
        </div>

        {/* Feature list */}
        <div style={{ marginBottom: 22 }}>
          {FEATURES.map((text) => (
            <div key={text} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 9 }}>
              <span style={{ flexShrink: 0, marginTop: 1, color: '#16a34a', display: 'flex' }}>
                <CheckIcon />
              </span>
              <span style={{ fontSize: 13, color: 'var(--text-sec)', lineHeight: 1.5 }}>{text}</span>
            </div>
          ))}
        </div>

        {/* CTA */}
        {notified ? (
          <div style={{
            padding: '13px 0', borderRadius: 10,
            background: 'var(--green-soft)', border: '1px solid rgba(16,185,129,0.25)',
            textAlign: 'center', marginBottom: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            <span style={{ color: '#16a34a', display: 'flex' }}><CheckIcon /></span>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#15803d' }}>
              We'll notify you when payments go live!
            </span>
          </div>
        ) : (
          <button
            style={{
              width: '100%', padding: '13px 0',
              background: 'linear-gradient(135deg, #f59e0b, #d97706)',
              border: 'none', borderRadius: 10,
              fontSize: 15, fontWeight: 700, color: 'white',
              cursor: 'pointer', fontFamily: 'inherit',
              boxShadow: '0 4px 16px rgba(245,158,11,0.32)',
              marginBottom: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
            onClick={() => { if (onUpgrade) { onUpgrade(); } else { setNotified(true); } }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/>
            </svg>
            {onUpgrade ? 'Upgrade to Premium' : 'Get Early Access'}
          </button>
        )}

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
