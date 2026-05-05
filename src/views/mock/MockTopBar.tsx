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
    <div className="glass-panel" style={{ borderRadius: 16, padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Clock style={{ width: 18, height: 18, color: timerColor }} />
          <span style={{ fontSize: 22, fontWeight: 800, fontFamily: "'DM Mono', monospace", color: timerColor, animation: timerCritical ? 'pulse 1s infinite' : 'none' }}>
            {formatTime(examTimer)}
          </span>
        </div>
        <div style={{ width: 1, height: 24, background: C.border }} />
        <span style={{ fontSize: 13, color: C.textSec }}>
          <span style={{ fontWeight: 700, color: C.text, fontFamily: "'DM Mono', monospace" }}>{answered}</span>/{total} answered
        </span>
        <div style={{ width: 1, height: 24, background: C.border }} />
        <span style={{ fontSize: 13, color: C.textSec }}>
          Q <span style={{ fontWeight: 700, color: C.text, fontFamily: "'DM Mono', monospace" }}>{currentIndex + 1}</span>/{total}
        </span>
        {hasMore && (
          <>
            <div style={{ width: 1, height: 24, background: C.border }} />
            <span style={{ fontSize: 12, color: C.blue }}>Loading next batch…</span>
          </>
        )}
      </div>

      <button
        onClick={onSubmit}
        style={{ padding: '9px 20px', background: C.dangerDim, border: `1px solid ${C.danger}40`, borderRadius: 10, fontSize: 13, fontWeight: 700, color: C.danger, cursor: 'pointer' }}
      >
        Submit Exam
      </button>
    </div>
  );
}
