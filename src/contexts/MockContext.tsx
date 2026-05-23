import { createContext, useContext, useState, type ReactNode } from 'react';
import { type ExamSession, type Question } from '../types/index';
import { useExam } from './ExamContext';

// ── Context type ──────────────────────────────────────────────────────────────

interface MockContextValue {
  examSession: ExamSession | null;
  setExamSession: React.Dispatch<React.SetStateAction<ExamSession | null>>;
  examTimer: number;
  setExamTimer: React.Dispatch<React.SetStateAction<number>>;
  mockBatchLoading: boolean;
  setMockBatchLoading: React.Dispatch<React.SetStateAction<boolean>>;
  updateExamSessionQuestion: (questionId: string, patch: Partial<Question>) => void;
  loadMoreMockQuestions: () => Promise<void>;
  loadMoreResultQuestions: () => Promise<void>;
}

const MockContext = createContext<MockContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export function MockProvider({ children }: { children: ReactNode }) {
  const { requestExamPage, loadMoreExamQuestions, buildQuestionSetKey, getExamPageEntry } = useExam();

  const [examSession, setExamSession] = useState<ExamSession | null>(null);
  const [examTimer, setExamTimer] = useState(0);
  const [mockBatchLoading, setMockBatchLoading] = useState(false);

  const updateExamSessionQuestion = (questionId: string, patch: Partial<Question>) => {
    setExamSession((prev) =>
      prev
        ? {
            ...prev,
            questions: prev.questions.map((item) =>
              item.id === questionId ? { ...item, ...patch } : item
            ),
          }
        : prev
    );
  };

  const loadMoreMockQuestions = async () => {
    if (!examSession || mockBatchLoading) return;
    setMockBatchLoading(true);
    try {
      const page = await requestExamPage(examSession.examName, examSession.year, {
        pageSize: 20,
        cursor: examSession.nextCursor,
        paperId: examSession.paperId,
        shiftLabel: examSession.shiftLabel,
      });
      setExamSession((prev) =>
        prev
          ? {
              ...prev,
              questions: (() => {
                const seen = new Set(prev.questions.map((q) => q.id));
                const fresh = page.rows.filter((q) => !seen.has(q.id));
                return fresh.length ? [...prev.questions, ...fresh] : prev.questions;
              })(),
              hasMore: page.hasMore,
              nextCursor: page.nextCursor,
              totalCount: page.totalCount || prev.totalCount,
            }
          : prev
      );
    } finally {
      setMockBatchLoading(false);
    }
  };

  const loadMoreResultQuestions = async () => {
    if (!examSession) return;
    const rows = await loadMoreExamQuestions(examSession.examName, examSession.year, 20, {
      paperId: examSession.paperId,
      shiftLabel: examSession.shiftLabel,
    });
    const key = buildQuestionSetKey(examSession.examName, examSession.year, {
      paperId: examSession.paperId,
      shiftLabel: examSession.shiftLabel,
    });
    setExamSession((prev) =>
      prev
        ? {
            ...prev,
            questions: rows,
            hasMore: getExamPageEntry(key)?.hasMore,
            nextCursor: getExamPageEntry(key)?.nextCursor,
            totalCount: getExamPageEntry(key)?.totalCount || prev.totalCount,
          }
        : prev
    );
  };

  return (
    <MockContext.Provider value={{
      examSession, setExamSession,
      examTimer, setExamTimer,
      mockBatchLoading, setMockBatchLoading,
      updateExamSessionQuestion,
      loadMoreMockQuestions,
      loadMoreResultQuestions,
    }}>
      {children}
    </MockContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useMock(): MockContextValue {
  const ctx = useContext(MockContext);
  if (!ctx) throw new Error('useMock must be used within MockProvider');
  return ctx;
}
