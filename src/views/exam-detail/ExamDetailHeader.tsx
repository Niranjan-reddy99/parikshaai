import { ArrowLeft } from 'lucide-react';
import { C } from '../../lib/tokens';

interface ExamDetailHeaderProps {
  selectedCommission: string;
  selectedExamType: string;
  selectedExamName: string;
  selectedYear: number;
  examLoading: boolean;
  examQuestionCount: number;
  selectedPaperLabel: string;
  availablePaperCount: number;
  onBack: () => void;
}

export function ExamDetailHeader({
  selectedCommission,
  selectedExamType,
  selectedExamName,
  selectedYear,
  examLoading,
  examQuestionCount,
  selectedPaperLabel,
  availablePaperCount,
  onBack,
}: ExamDetailHeaderProps) {
  return (
    <div className="glass-panel" style={{ borderRadius: 24, padding: '24px 26px', marginBottom: 24, border: `1px solid ${C.borderHover}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <button
          className="hover-lift"
          onClick={onBack}
          style={{ width: 38, height: 38, borderRadius: 12, background: C.surface2, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: C.textSec }}
        >
          <ArrowLeft style={{ width: 16, height: 16 }} />
        </button>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", color: C.textTert, textTransform: 'uppercase', letterSpacing: '0.10em', marginBottom: 8 }}>
            Exam Workspace
          </div>
          <h1 style={{ fontSize: 28, fontFamily: "'Fraunces', Georgia, serif", color: C.text, letterSpacing: '-0.5px', marginBottom: 4 }}>
            {selectedCommission} <span style={{ opacity: 0.35 }}>—</span> {selectedExamType}
          </h1>
          <p style={{ fontSize: 13, color: C.textSec, fontFamily: "'DM Mono', monospace" }}>
            {examLoading ? 'Loading questions...' : `${examQuestionCount} questions · ${selectedYear} · ${selectedExamName}`}
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            <span style={{ padding: '5px 10px', borderRadius: 999, background: C.surface, border: `1px solid ${C.border}`, color: C.textSec, fontSize: 11, fontWeight: 700 }}>
              {selectedPaperLabel}
            </span>
            {availablePaperCount > 1 && (
              <span style={{ padding: '5px 10px', borderRadius: 999, background: C.accentDim, border: `1px solid ${C.accent}20`, color: C.accent, fontSize: 11, fontWeight: 700 }}>
                {availablePaperCount} papers available
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
