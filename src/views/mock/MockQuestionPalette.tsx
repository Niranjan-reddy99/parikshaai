import { C } from '../../lib/tokens';

interface MockQuestionPaletteProps {
  loadedCount: number;
  currentIndex: number;
  answered: number;
  total: number;
  answers: Record<number, string>;
  onGoTo: (index: number) => void;
}

export function MockQuestionPalette({
  loadedCount,
  currentIndex,
  answered,
  total,
  answers,
  onGoTo,
}: MockQuestionPaletteProps) {
  return (
    <div className="glass-panel" style={{ borderRadius: 18, padding: '22px 18px' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.textSec, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Navigator</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 5, marginBottom: 14 }}>
        {Array.from({ length: loadedCount }).map((_, index) => {
          const isCurrent = currentIndex === index;
          const isAnswered = !!answers[index];

          return (
            <button
              key={index}
              onClick={() => onGoTo(index)}
              style={{
                aspectRatio: '1',
                borderRadius: 8,
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                border: isCurrent ? `2px solid ${C.blue}` : '1px solid transparent',
                transition: 'all 0.1s',
                background: isCurrent ? C.blueDim : isAnswered ? 'rgba(52,211,153,0.12)' : C.surface3,
                color: isCurrent ? C.blue : isAnswered ? '#34D399' : C.textTert,
                fontFamily: "'DM Mono', monospace",
              }}
            >
              {index + 1}
            </button>
          );
        })}
      </div>

      <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[
          { color: '#34d399', bg: 'rgba(52,211,153,0.12)', label: `Answered (${answered})` },
          { color: C.textTert, bg: 'var(--c-surface3)', label: `Skipped (${total - answered})` },
        ].map(({ color, bg, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, fontWeight: 600, color: C.textTert }}>
            <div style={{ width: 12, height: 12, borderRadius: 3, background: bg, border: `1px solid ${color}40` }} />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}
