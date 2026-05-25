import { C } from '../../lib/tokens';

export function ExplanationSkeleton() {
  return (
    <div style={{
      background: 'var(--blue-soft)',
      border: '1px solid rgba(37,99,235,0.18)',
      borderRadius: 12,
      padding: '16px 20px',
      marginBottom: 20,
      display: 'flex',
      alignItems: 'flex-start',
      gap: 14,
    }}>
      {/* Spinner */}
      <div style={{ flexShrink: 0, marginTop: 2 }}>
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ animation: 'spin 1s linear infinite' }}
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#2563eb', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 5 }}>
          Generating explanation
        </div>
        <div style={{ fontSize: 13, color: C.textSec, lineHeight: 1.6 }}>
          AI is writing the explanation for this question. This takes a few seconds the first time — it will be instant on your next visit.
        </div>
      </div>
    </div>
  );
}
