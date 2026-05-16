import { useState, useMemo } from 'react';
import { type Question } from '../types';
import { C } from '../lib/tokens';

interface BookmarksViewProps {
  bookmarkMap: Record<string, Question>;
  onRemove: (id: string) => void;
  onClearAll: () => void;
  onPracticeAll: () => void;
}

const PAGE_SIZE = 20;

function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
    </svg>
  );
}

function ChevronDown() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function BookmarksView({ bookmarkMap, onRemove, onClearAll, onPracticeAll }: BookmarksViewProps) {
  const [confirmClear, setConfirmClear] = useState(false);
  const [filterSubject, setFilterSubject] = useState('All');
  const [page, setPage] = useState(1);

  const allQuestions = Object.values(bookmarkMap);

  const subjects = useMemo(() => {
    const s = new Set(allQuestions.map(q => q.subject).filter(Boolean));
    return ['All', ...Array.from(s).sort()];
  }, [allQuestions]);

  const filtered = useMemo(() => {
    if (filterSubject === 'All') return allQuestions;
    return allQuestions.filter(q => q.subject === filterSubject);
  }, [allQuestions, filterSubject]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const safePage = Math.min(page, Math.max(1, totalPages));
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const handleSubjectChange = (s: string) => {
    setFilterSubject(s);
    setPage(1);
  };

  return (
    <div className="bookmarks-shell" style={{ fontFamily: 'var(--font-sans)', maxWidth: 760, margin: '0 auto' }}>

      {/* Header */}
      <div className="bookmarks-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, color: 'var(--text)', letterSpacing: '-0.3px' }}>Bookmarks</h1>
            {allQuestions.length > 0 && (
              <span style={{ padding: '2px 9px', background: C.accentDim, color: C.accent, borderRadius: 99, fontSize: 12, fontWeight: 700 }}>
                {allQuestions.length}
              </span>
            )}
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-sec)', margin: 0 }}>
            Saved questions — skipped in regular practice sessions.
          </p>
        </div>
        {allQuestions.length > 0 && (
          <div className="bookmarks-actions" style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
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

      {/* Subject filter */}
      {allQuestions.length > 0 && subjects.length > 2 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text-tert)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Filter:</span>
          {subjects.map(s => (
            <button
              key={s}
              onClick={() => handleSubjectChange(s)}
              style={{
                padding: '5px 12px', borderRadius: 99,
                fontSize: 12, fontWeight: s === filterSubject ? 700 : 500,
                background: s === filterSubject ? C.accent : 'var(--bg-alt)',
                color: s === filterSubject ? 'white' : 'var(--text-sec)',
                border: s === filterSubject ? 'none' : '1px solid var(--border)',
                cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.12s',
              }}
            >
              {s}
              {s !== 'All' && (
                <span style={{ marginLeft: 5, opacity: 0.75, fontSize: 10.5 }}>
                  ({allQuestions.filter(q => q.subject === s).length})
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Empty state */}
      {allQuestions.length === 0 && (
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 14, padding: '72px 32px', textAlign: 'center' }}>
          <div style={{ fontSize: 44, marginBottom: 16 }}>🔖</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>No bookmarks yet</div>
          <div style={{ fontSize: 13, color: 'var(--text-sec)', maxWidth: 320, margin: '0 auto' }}>
            While practising, tap the bookmark icon on any question to save it here for focused review.
          </div>
        </div>
      )}

      {/* Filtered empty */}
      {allQuestions.length > 0 && filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-tert)', fontSize: 13 }}>
          No bookmarks in <strong>{filterSubject}</strong>.
        </div>
      )}

      {/* Question list */}
      {pageItems.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {pageItems.map((q) => (
            <BookmarkCard key={q.id} q={q} onRemove={() => onRemove(q.id)} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 24 }}>
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={safePage === 1}
            style={{
              padding: '7px 14px', borderRadius: 8,
              background: 'var(--bg)', border: '1px solid var(--border)',
              fontSize: 13, fontWeight: 600, color: safePage === 1 ? 'var(--text-tert)' : 'var(--text-sec)',
              cursor: safePage === 1 ? 'default' : 'pointer', fontFamily: 'inherit',
              opacity: safePage === 1 ? 0.5 : 1,
            }}
          >
            ← Prev
          </button>
          <span style={{ fontSize: 13, color: 'var(--text-tert)' }}>
            Page {safePage} of {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={safePage === totalPages}
            style={{
              padding: '7px 14px', borderRadius: 8,
              background: 'var(--bg)', border: '1px solid var(--border)',
              fontSize: 13, fontWeight: 600, color: safePage === totalPages ? 'var(--text-tert)' : 'var(--text-sec)',
              cursor: safePage === totalPages ? 'default' : 'pointer', fontFamily: 'inherit',
              opacity: safePage === totalPages ? 0.5 : 1,
            }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

function BookmarkCard({ q, onRemove }: { q: Question; onRemove: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const preview = q.question.length > 180 ? q.question.slice(0, 180) + '…' : q.question;
  const opts = Object.entries(q.options || {}).filter(([, v]) => v);

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
        transition: 'background 0.12s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        {/* Bookmark icon */}
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
          <div style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.55, fontWeight: 400, marginBottom: opts.length > 0 ? 10 : 0 }}>
            {preview}
          </div>

          {/* Options */}
          {opts.length > 0 && (
            <>
              {expanded ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 6 }}>
                  {opts.map(([key, val]) => (
                    <div key={key} style={{ display: 'flex', gap: 8, fontSize: 12.5, color: 'var(--text-sec)', lineHeight: 1.5 }}>
                      <span style={{
                        width: 20, height: 20, borderRadius: 5, flexShrink: 0,
                        background: 'var(--bg-canvas)', border: '1px solid var(--border)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 700, color: 'var(--text-tert)',
                      }}>
                        {key}
                      </span>
                      <span style={{ paddingTop: 1 }}>{val}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              <button
                onClick={() => setExpanded(v => !v)}
                style={{
                  background: 'none', border: 'none', padding: 0,
                  fontSize: 12, color: C.accent, cursor: 'pointer',
                  fontFamily: 'inherit', fontWeight: 600,
                  display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                {expanded ? 'Hide options' : 'Show options'}
                <span style={{ display: 'flex', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
                  <ChevronDown />
                </span>
              </button>
            </>
          )}
        </div>

        {/* Remove */}
        <button
          onClick={onRemove}
          title="Remove bookmark"
          style={{
            padding: 7, background: 'transparent', border: `1px solid ${hovered ? 'var(--border)' : 'transparent'}`,
            borderRadius: 6, cursor: 'pointer', color: 'var(--text-tert)', flexShrink: 0,
            display: 'flex', transition: 'all 0.15s', marginTop: 0,
          }}
          onMouseEnter={e => { e.currentTarget.style.color = C.danger; e.currentTarget.style.borderColor = C.danger; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-tert)'; e.currentTarget.style.borderColor = hovered ? 'var(--border)' : 'transparent'; }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
