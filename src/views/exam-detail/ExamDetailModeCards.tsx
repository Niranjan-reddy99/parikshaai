import { BookOpen, Clock, Lock, Play, ShieldCheck } from 'lucide-react';
import { C } from '../../lib/tokens';

interface ExamDetailModeCardsProps {
  selectedExamName: string;
  selectedYear: number;
  examQuestionCount: number;
  examDuration: string;
  yearLocked: boolean;
  onLockedClick: () => void;
  startPractice: (examName: string, year: number, subject?: string, topic?: string) => void;
  startMockExam: (examName: string, year: number) => void;
}

function LockedOverlay() {
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)', borderRadius: 22, zIndex: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
      <Lock style={{ width: 24, height: 24, color: '#fff' }} />
      <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Premium Only</span>
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>Upgrade to unlock</span>
    </div>
  );
}

export function ExamDetailModeCards({
  selectedExamName,
  selectedYear,
  examQuestionCount,
  examDuration,
  yearLocked,
  onLockedClick,
  startPractice,
  startMockExam,
}: ExamDetailModeCardsProps) {
  return (
    <div className="exam-mode-grid">
      <button
        onClick={() => (yearLocked ? onLockedClick() : startPractice(selectedExamName, selectedYear))}
        className="glass-panel hover-lift"
        style={{ padding: '30px 28px', borderRadius: 22, cursor: 'pointer', textAlign: 'left', position: 'relative', overflow: 'hidden', minHeight: 220 }}
      >
        {yearLocked && <LockedOverlay />}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${C.accentDim}, ${C.accent})` }} />
        <div style={{ position: 'absolute', top: -20, right: -20, opacity: 0.05, transform: 'scale(3)' }}>
          <BookOpen size={100} color={C.accent} />
        </div>
        <div style={{ width: 48, height: 48, borderRadius: 14, background: C.accentDim, border: `1px solid ${C.accent}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
          <BookOpen style={{ width: 22, height: 22, color: C.accentText }} />
        </div>
        <div style={{ fontSize: 18, fontFamily: "'Fraunces', Georgia, serif", color: C.text, marginBottom: 6 }}>Practice Mode</div>
        <div style={{ fontSize: 13, color: C.textSec, lineHeight: 1.6, marginBottom: 20, maxWidth: '85%' }}>
          Learn at your own pace. Instant answer feedback with explanations after every question.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ padding: '6px 14px', background: C.accentDim, border: `1px solid ${C.accent}40`, borderRadius: 99, fontSize: 11, fontWeight: 700, color: C.accentText, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <Play style={{ width: 10, height: 10 }} /> Start Practice
          </span>
          <span style={{ fontSize: 11, color: C.textTert, fontFamily: "'DM Mono', monospace" }}>{examQuestionCount}Qs</span>
        </div>
      </button>

      <button
        onClick={() => (yearLocked ? onLockedClick() : startMockExam(selectedExamName, selectedYear))}
        className="glass-panel hover-lift"
        style={{ padding: '30px 28px', borderRadius: 22, cursor: 'pointer', textAlign: 'left', position: 'relative', overflow: 'hidden', minHeight: 220 }}
      >
        {yearLocked && <LockedOverlay />}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${C.blueDim}, ${C.blue})` }} />
        <div style={{ position: 'absolute', top: -20, right: -20, opacity: 0.05, transform: 'scale(3)' }}>
          <ShieldCheck size={100} color={C.blue} />
        </div>
        <div style={{ width: 48, height: 48, borderRadius: 14, background: C.blueDim, border: `1px solid ${C.blue}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
          <ShieldCheck style={{ width: 22, height: 22, color: C.blue }} />
        </div>
        <div style={{ fontSize: 18, fontFamily: "'Fraunces', Georgia, serif", color: C.text, marginBottom: 6 }}>Exam Mode</div>
        <div style={{ fontSize: 13, color: C.textSec, lineHeight: 1.6, marginBottom: 20, maxWidth: '85%' }}>
          Real exam simulation with a countdown timer. No hints. Submit to see results and explanations.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ padding: '6px 14px', background: C.blueDim, border: `1px solid ${C.blue}40`, borderRadius: 99, fontSize: 11, fontWeight: 700, color: C.blue, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <Clock style={{ width: 10, height: 10 }} /> {examDuration} Timer
          </span>
          <span style={{ fontSize: 11, color: C.textTert, fontFamily: "'DM Mono', monospace" }}>{examQuestionCount}Qs</span>
        </div>
      </button>
    </div>
  );
}
