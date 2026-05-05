import { Lock } from 'lucide-react';
import { C } from '../../lib/tokens';
import { type ExamPaperManifestItem } from '../../types';

interface ExamDetailControlsProps {
  availableYears: number[];
  selectedYear: number;
  examQuestionCount: number;
  yearCounts?: Record<string, number>;
  selectedCommission: string;
  selectedExamName: string;
  isLocked: (examName: string, year: number, commission?: string) => boolean;
  onLockedClick: () => void;
  setSelectedYear: (year: number) => void;
  examPaperLoading: boolean;
  availablePapers: ExamPaperManifestItem[];
  selectedPaperId: string | null;
  selectedShiftLabel: string | null;
  setSelectedPaperId: (value: string | null) => void;
  setSelectedShiftLabel: (value: string | null) => void;
}

export function ExamDetailControls({
  availableYears,
  selectedYear,
  examQuestionCount,
  yearCounts,
  selectedCommission,
  selectedExamName,
  isLocked,
  onLockedClick,
  setSelectedYear,
  examPaperLoading,
  availablePapers,
  selectedPaperId,
  selectedShiftLabel,
  setSelectedPaperId,
  setSelectedShiftLabel,
}: ExamDetailControlsProps) {
  return (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 28 }}>
        {availableYears.map((year) => {
          const count = selectedYear === year ? examQuestionCount : yearCounts?.[String(year)] || examQuestionCount;
          const isActive = selectedYear === year;
          const yearLocked = isLocked(selectedExamName, year, selectedCommission);

          return (
            <button
              key={year}
              onClick={() => (yearLocked ? onLockedClick() : setSelectedYear(year))}
              style={{
                padding: '8px 18px',
                borderRadius: 10,
                fontWeight: 700,
                fontSize: 13,
                cursor: 'pointer',
                transition: 'all 0.15s',
                background: isActive ? C.accent : C.surface,
                border: `1px solid ${isActive ? C.accent : C.border}`,
                color: isActive ? '#0a1a18' : yearLocked ? C.textTert : C.textSec,
                opacity: yearLocked ? 0.6 : 1,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {yearLocked && <Lock style={{ width: 11, height: 11 }} />}
              {year}
              {!yearLocked && <span style={{ fontSize: 10, opacity: 0.7, fontFamily: "'DM Mono', monospace" }}>({count}Q)</span>}
            </button>
          );
        })}
      </div>

      {(examPaperLoading || availablePapers.length > 1) && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.textTert, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
            Question Paper
          </div>
          {examPaperLoading ? (
            <div style={{ fontSize: 13, color: C.textSec }}>Loading available papers...</div>
          ) : (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {availablePapers.map((paper, index) => {
                const isActive = (paper.paper_id || null) === selectedPaperId && (paper.shift_label || null) === selectedShiftLabel;
                const label = paper.shift_label || paper.paper_id || `Paper ${index + 1}`;

                return (
                  <button
                    key={`${paper.paper_id || 'paper'}::${paper.shift_label || index}`}
                    onClick={() => {
                      setSelectedPaperId(paper.paper_id || null);
                      setSelectedShiftLabel(paper.shift_label || null);
                    }}
                    style={{
                      padding: '10px 14px',
                      borderRadius: 12,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      background: isActive ? C.accentDim : C.surface,
                      border: `1px solid ${isActive ? C.accent : C.border}`,
                      color: isActive ? C.accent : C.textSec,
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 700 }}>{label}</span>
                    <span style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", opacity: 0.8 }}>{paper.question_count}Q</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </>
  );
}
