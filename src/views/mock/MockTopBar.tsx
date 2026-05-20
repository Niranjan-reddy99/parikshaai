import { Clock } from 'lucide-react';
import { C } from '../../lib/tokens';
import { formatTime } from '../../lib/utils';

interface MockTopBarProps {
  examTimer: number;
  timerColor: string;
  timerCritical: boolean;
  answered: number;
  total: number;
  currentIndex: number;
  hasMore: boolean;
  onSubmit: () => void;
}

export function MockTopBar({
  examTimer,
  timerColor,
  timerCritical,
  answered,
  total,
  currentIndex,
  hasMore,
  onSubmit,
}: MockTopBarProps) {
  return (
    <div className="glass-panel mock-topbar" style={{ borderRadius: 20, marginBottom: 20 }}>
      <div className="mock-topbar-stats" style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Clock style={{ width: 18, height: 18, color: timerColor }} />
          <span style={{ fontSize: 22, fontWeight: 800, fontFamily: "'DM Mono', monospace", color: timerColor, animation: timerCritical ? 'pulse 1s infinite' : 'none' }}>
            {formatTime(examTimer)}
          </span>
        </div>
        <div className="mock-topbar-divider" style={{ width: 1, height: 24, background: C.border }} />
        <span style={{ fontSize: 13, color: C.textSec }}>
          <span style={{ fontWeight: 700, color: C.text, fontFamily: "'DM Mono', monospace" }}>{answered}</span>/{total} answered
        </span>
        <div className="mock-topbar-divider" style={{ width: 1, height: 24, background: C.border }} />
        <span style={{ fontSize: 13, color: C.textSec }}>
          Q <span style={{ fontWeight: 700, color: C.text, fontFamily: "'DM Mono', monospace" }}>{currentIndex + 1}</span>/{total}
        </span>
        {hasMore && (
          <>
            <div className="mock-topbar-divider" style={{ width: 1, height: 24, background: C.border }} />
            <span style={{ fontSize: 12, color: C.blue }}>Loading next batch…</span>
          </>
        )}
      </div>

      <button
        className="mock-topbar-submit"
        onClick={onSubmit}
        style={{ padding: '10px 18px', background: C.dangerDim, border: `1px solid ${C.danger}40`, borderRadius: 12, fontSize: 13, fontWeight: 700, color: C.danger, cursor: 'pointer' }}
      >
        Submit Exam
      </button>
    </div>
  );
}
