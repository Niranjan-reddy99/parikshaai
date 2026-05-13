import { useState } from 'react';
import { type Question } from '../types';
import { C } from '../lib/tokens';

interface BookmarksViewProps {
  bookmarkMap: Record<string, Question>;
  onRemove: (id: string) => void;
  onClearAll: () => void;
  onPracticeAll: () => void;
}

function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
    </svg>
  );
}

export function BookmarksView({ bookmarkMap, onRemove, onClearAll, onPracticeAll }: BookmarksViewProps) {
  const [confirmClear, setConfirmClear] = useState(false);
  const questions = Object.values(bookmarkMap);

  return (
    <div className="bookmarks-shell" style={{ fontFamily: "'Inter', sans-serif", maxWidth: 760, margin: '0 auto' }}>

      {/* Header */}
      <div className="bookmarks-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, color: 'var(--text)', letterSpacing: '-0.3px' }}>Bookmarks</h1>
            {questions.length > 0 && (
              <span style={{ padding: '2px 9px', background: C.accentDim, color: C.accent, borderRadius: 99, fontSize: 12, fontWeight: 700 }}>
                {questions.length}
              </span>
            )}
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-sec)', margin: 0 }}>
            Saved questions — these are skipped in regular practice sessions.
          </p>
        </div>
        {questions.length > 0 && (
          <div className="bookmarks-actions" style={{ display: 'flex', gap: 8 }}>
            {confirmClear ? (
              <>
                <button
                  onClick={() => setConfirmClear(false)}
                  style={{ padding: '8px 14px', fontSize: 12, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 7, cursor: 'pointer', color: 'var(--text-sec)', fontFamily: 'inherit' }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => { onClearAll(); setConfirmClear(false); }}
                  style={{ padding: '8px 14px', fontSize: 12, background: C.dangerDim, border: `1px solid ${C.danger}`, borderRadius: 7, cursor: 'pointer', color: C.danger, fontFamily: 'inherit', fontWeight: 600 }}
                >
                  Confirm Clear
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setConfirmClear(true)}
                  style={{ padding: '8px 14px', fontSize: 12, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 7, cursor: 'pointer', color: 'var(--text-tert)', fontFamily: 'inherit' }}
                >
                  Clear All
                </button>
                <button
                  onClick={onPracticeAll}
                  style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, background: C.accent, border: 'none', borderRadius: 7, cursor: 'pointer', color: 'white', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  Practice All
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Empty state */}
      {questions.length === 0 && (
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 14, padding: '72px 32px', textAlign: 'center' }}>
          <div style={{ fontSize: 44, marginBottom: 16 }}>🔖</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>No bookmarks yet</div>
          <div style={{ fontSize: 13, color: 'var(--text-sec)', maxWidth: 320, margin: '0 auto' }}>
            While practising, tap the bookmark icon on any question to save it here for focused review.
          </div>
        </div>
      )}

      {/* Question list */}
      {questions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {questions.map((q) => (
            <BookmarkCard key={q.id} q={q} onRemove={() => onRemove(q.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function BookmarkCard({ q, onRemove }: { q: Question; onRemove: () => void }) {
  const [hovered, setHovered] = useState(false);
  const preview = q.question.length > 160 ? q.question.slice(0, 160) + '…' : q.question;

  return (
    <div
      className="bookmark-card"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? 'var(--bg-alt)' : 'var(--bg)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '16px 18px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 14,
        transition: 'background 0.12s',
      }}
    >
      {/* Bookmark fill icon */}
      <div style={{ paddingTop: 2, color: C.accent, flexShrink: 0 }}>
        <BookmarkIcon filled />
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: C.accent, background: C.accentDim, padding: '2px 8px', borderRadius: 99 }}>{q.subject}</span>
          <span style={{ fontSize: 10.5, color: 'var(--text-tert)' }}>{q.topic}</span>
          <span style={{ fontSize: 10.5, color: 'var(--text-tert)' }}>·</span>
          <span style={{ fontSize: 10.5, color: 'var(--text-tert)' }}>{q.exam} {q.year}</span>
        </div>
        <div style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.5, fontWeight: 400 }}>
          {preview}
        </div>
      </div>

      {/* Remove */}
      <button
        onClick={onRemove}
        title="Remove bookmark"
        style={{
          padding: 7, background: 'transparent', border: `1px solid ${hovered ? 'var(--border)' : 'transparent'}`,
          borderRadius: 6, cursor: 'pointer', color: 'var(--text-tert)', flexShrink: 0,
          display: 'flex', transition: 'all 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = C.danger; e.currentTarget.style.borderColor = C.danger; }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-tert)'; e.currentTarget.style.borderColor = hovered ? 'var(--border)' : 'transparent'; }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
