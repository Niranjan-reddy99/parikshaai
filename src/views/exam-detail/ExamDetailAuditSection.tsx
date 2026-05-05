import { ShieldCheck } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { AdminAuditPanel } from '../../components/admin/AdminAuditPanel';
import { C } from '../../lib/tokens';
import { type Question } from '../../types';

interface ExamDetailAuditSectionProps {
  isAdmin: boolean;
  showAudit: boolean;
  setShowAudit: (show: boolean) => void;
  questions: Question[];
  selectedExamName: string;
  selectedYear: number;
  selectedCommission: string;
  doAddBlankQuestion?: (examName: string, year: number, forcedNum?: number) => void;
  setEditQuestion?: (question: Question | null) => void;
  doDeleteQuestion?: (id: string) => void;
}

export function ExamDetailAuditSection({
  isAdmin,
  showAudit,
  setShowAudit,
  questions,
  selectedExamName,
  selectedYear,
  selectedCommission,
  doAddBlankQuestion,
  setEditQuestion,
  doDeleteQuestion,
}: ExamDetailAuditSectionProps) {
  if (!isAdmin) return null;

  return (
    <div style={{ marginBottom: 24 }}>
      <button
        onClick={() => setShowAudit(!showAudit)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 16px',
          background: showAudit ? C.accentDim : 'transparent',
          border: `1px solid ${showAudit ? C.accent : C.border}`,
          borderRadius: 12,
          fontSize: 13,
          fontWeight: 700,
          color: showAudit ? C.accent : C.textSec,
          cursor: 'pointer',
          transition: 'all 0.2s',
        }}
        className="hover-lift"
      >
        <ShieldCheck size={16} />
        {showAudit ? 'Hide Audit Dashboard' : 'Show Content Audit'}
      </button>

      <AnimatePresence>
        {showAudit && (
          <div style={{ marginTop: 16 }}>
            <AdminAuditPanel
              questions={questions}
              examName={selectedExamName}
              year={selectedYear}
              expectedCount={selectedCommission === 'UPSC' ? 100 : 150}
              onAddPlaceholder={(questionNumber) => doAddBlankQuestion?.(selectedExamName, selectedYear, questionNumber)}
              onEditQuestion={(question) => setEditQuestion?.(question)}
              onDeleteQuestion={(questionId) => doDeleteQuestion?.(questionId)}
            />
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
