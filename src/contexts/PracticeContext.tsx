import { createContext, useContext, useRef, useState, useEffect, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { useExam } from './ExamContext';
import { API_BASE } from '../lib/api';
import {
  BLOCKED_EXPLANATION,
  UNAVAILABLE_EXPLANATION,
  DELETED_QUESTION_NOTE,
  MULTIPLE_ANSWERS_NOTE,
} from '../views/practice/practiceUtils';
import { type Question, type View } from '../types/index';

// ── Context type ──────────────────────────────────────────────────────────────

interface PracticeContextValue {
  // ── State ─────────────────────────────────────────────────────────────────
  practiceQueue: Question[];
  setPracticeQueue: React.Dispatch<React.SetStateAction<Question[]>>;
  practiceIndex: number;
  setPracticeIndex: React.Dispatch<React.SetStateAction<number>>;
  practiceAnswered: boolean;
  setPracticeAnswered: React.Dispatch<React.SetStateAction<boolean>>;
  practiceSelectedOption: string | null;
  setPracticeSelectedOption: React.Dispatch<React.SetStateAction<string | null>>;
  practiceAnswerLoading: boolean;
  setPracticeAnswerLoading: React.Dispatch<React.SetStateAction<boolean>>;
  practiceExplanationLoading: boolean;
  setPracticeExplanationLoading: React.Dispatch<React.SetStateAction<boolean>>;
  practiceSubject: string;
  setPracticeSubject: React.Dispatch<React.SetStateAction<string>>;
  practiceTopic: string;
  setPracticeTopic: React.Dispatch<React.SetStateAction<string>>;
  practicePaperId: string | null;
  setPracticePaperId: React.Dispatch<React.SetStateAction<string | null>>;
  practiceShiftLabel: string | null;
  setPracticeShiftLabel: React.Dispatch<React.SetStateAction<string | null>>;
  practiceHasMore: boolean;
  setPracticeHasMore: React.Dispatch<React.SetStateAction<boolean>>;
  practiceNextCursor: string | null;
  setPracticeNextCursor: React.Dispatch<React.SetStateAction<string | null>>;
  practiceLoadMoreError: string | null;
  setPracticeLoadMoreError: React.Dispatch<React.SetStateAction<string | null>>;
  practiceBatchLoading: boolean;
  setPracticeBatchLoading: React.Dispatch<React.SetStateAction<boolean>>;
  practiceSessionAnswers: (null | { selected: string; correct: boolean; ignored?: boolean })[];
  setPracticeSessionAnswers: React.Dispatch<React.SetStateAction<(null | { selected: string; correct: boolean; ignored?: boolean })[]>>;
  practiceBackView: View;
  setPracticeBackView: React.Dispatch<React.SetStateAction<View>>;
  practiceInitLoading: boolean;
  setPracticeInitLoading: React.Dispatch<React.SetStateAction<boolean>>;
  practiceInitMessage: string;
  setPracticeInitMessage: React.Dispatch<React.SetStateAction<string>>;
  practiceLoadProgress: { loaded: number; total: number | null };
  setPracticeLoadProgress: React.Dispatch<React.SetStateAction<{ loaded: number; total: number | null }>>;

  // ── Refs (exposed for AppContent consumers) ────────────────────────────────
  practiceStartRef: React.RefObject<number>;
  prefetchSessionRef: React.RefObject<number>;
  mockPrefetchSessionRef: React.RefObject<number>;
  practiceQueueRef: React.RefObject<Question[]>;
  explanationCacheRef: React.RefObject<Record<string, string>>;

  // ── Utilities ─────────────────────────────────────────────────────────────
  isRenderableExplanation: (text?: string | null) => boolean;
  getSafePracticeBackView: (candidate: View) => View;
  currentPracticeQ: Question | null;

  // ── Functions ─────────────────────────────────────────────────────────────
  updatePracticeQuestion: (questionId: string, patch: Partial<Question>) => void;
  fetchBatchExplanations: (questionIds: string[]) => Promise<Record<string, string>>;
  warmQuestionExplanations: (
    queue: Question[],
    opts?: { sessionId?: number; onHydrate?: (questionId: string, explanation: string) => void }
  ) => void;
  prefetchExplanations: (queue: Question[], sessionId: number) => void;
  fetchExplanationForQuestion: (
    questionId: string,
    options?: { background?: boolean; deferUnavailable?: boolean; revealedAnswer?: string }
  ) => Promise<string | null>;
  fetchFreshExplanationAfterAnswer: (questionId: string, revealedAnswer?: string) => Promise<boolean>;
  nextPracticeQuestion: () => void;
  prevPracticeQuestion: () => void;
  jumpToPracticeQuestion: (i: number) => void;
  loadMorePracticeQuestions: () => Promise<void>;
  fetchQuestionAnswerMeta: (questionId: string) => Promise<{ answer: string; answers: string[]; answerStatus?: string } | null>;
}

const PracticeContext = createContext<PracticeContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export function PracticeProvider({ children }: { children: ReactNode }) {
  const { getApiToken } = useAuth();
  const {
    selectedExamName, selectedYear,
    requestExamPage, requestTopicPracticePage,
  } = useExam();

  // ── State ──────────────────────────────────────────────────────────────────
  const [practiceQueue, setPracticeQueue] = useState<Question[]>([]);
  const [practiceIndex, setPracticeIndex] = useState(0);
  const [practiceAnswered, setPracticeAnswered] = useState(false);
  const [practiceSelectedOption, setPracticeSelectedOption] = useState<string | null>(null);
  const [practiceAnswerLoading, setPracticeAnswerLoading] = useState(false);
  const [practiceExplanationLoading, setPracticeExplanationLoading] = useState(false);
  const [practiceSubject, setPracticeSubject] = useState('All');
  const [practiceTopic, setPracticeTopic] = useState('All');
  const [practicePaperId, setPracticePaperId] = useState<string | null>(null);
  const [practiceShiftLabel, setPracticeShiftLabel] = useState<string | null>(null);
  const [practiceHasMore, setPracticeHasMore] = useState(false);
  const [practiceNextCursor, setPracticeNextCursor] = useState<string | null>(null);
  const [practiceLoadMoreError, setPracticeLoadMoreError] = useState<string | null>(null);
  const [practiceBatchLoading, setPracticeBatchLoading] = useState(false);
  const [practiceSessionAnswers, setPracticeSessionAnswers] = useState<
    (null | { selected: string; correct: boolean; ignored?: boolean })[]
  >([]);
  const [practiceBackView, setPracticeBackView] = useState<View>('dashboard');
  const [practiceInitLoading, setPracticeInitLoading] = useState(false);
  const [practiceInitMessage, setPracticeInitMessage] = useState('');
  const [practiceLoadProgress, setPracticeLoadProgress] = useState<{
    loaded: number;
    total: number | null;
  }>({ loaded: 0, total: null });

  // ── Refs ───────────────────────────────────────────────────────────────────
  const practiceStartRef = useRef<number>(Date.now());
  const prefetchSessionRef = useRef(0);
  const mockPrefetchSessionRef = useRef(0);
  const practiceQueueRef = useRef<Question[]>([]);
  const explanationCacheRef = useRef<Record<string, string>>({});
  const explanationInFlightRef = useRef<Record<string, Promise<string | null>>>({});

  // Keep practiceQueueRef in sync with practiceQueue state
  useEffect(() => {
    practiceQueueRef.current = practiceQueue;
  }, [practiceQueue]);

  const practiceIndexRef = useRef(0);
  useEffect(() => {
    practiceIndexRef.current = practiceIndex;
  }, [practiceIndex]);

  // Clamp practiceIndex to queue bounds
  useEffect(() => {
    if (!practiceQueue.length) {
      if (practiceIndex !== 0) setPracticeIndex(0);
      return;
    }
    if (practiceIndex >= practiceQueue.length) {
      setPracticeIndex(practiceQueue.length - 1);
    }
  }, [practiceQueue, practiceIndex]);

  // ── Computed ───────────────────────────────────────────────────────────────
  const currentPracticeQ = practiceQueue[practiceIndex] ?? null;

  // ── Utilities ──────────────────────────────────────────────────────────────

  const isRenderableExplanation = (text?: string | null): boolean => {
    const value = (text || '').trim();
    return (
      value.length > 5 &&
      value !== BLOCKED_EXPLANATION &&
      value !== UNAVAILABLE_EXPLANATION &&
      value !== DELETED_QUESTION_NOTE &&
      value !== MULTIPLE_ANSWERS_NOTE &&
      !value.includes('[FLAG: verify answer]')
    );
  };

  const getSafePracticeBackView = (candidate: View): View => {
    if (candidate !== 'practice' && candidate !== 'mock') return candidate;
    if (practiceBackView !== 'practice' && practiceBackView !== 'mock') {
      return practiceBackView;
    }
    return 'home';
  };

  // ── Practice queue mutations ───────────────────────────────────────────────

  const updatePracticeQuestion = (questionId: string, patch: Partial<Question>) => {
    setPracticeQueue((prev) =>
      prev.map((item) => (item.id === questionId ? { ...item, ...patch } : item))
    );
  };

  // ── Answer meta ───────────────────────────────────────────────────────────

  const fetchQuestionAnswerMeta = async (
    questionId: string
  ): Promise<{ answer: string; answers: string[]; answerStatus?: string } | null> => {
    const token = await getApiToken();
    try {
      const res = await fetch(`${API_BASE}/questions/${questionId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const rawAnswers = Array.isArray(data.correct_answers)
        ? data.correct_answers
        : Array.isArray(data.answers)
        ? data.answers
        : [];
      const answers: string[] = Array.from(
        new Set(
          rawAnswers
            .map((item: unknown) => String(item || '').trim().toUpperCase())
            .filter((item: string) => ['A', 'B', 'C', 'D'].includes(item))
        )
      );
      const singleAnswer = String(data.correct_answer ?? data.answer ?? '').trim().toUpperCase();
      const answer = answers[0] || (['A', 'B', 'C', 'D'].includes(singleAnswer) ? singleAnswer : '');
      return {
        answer,
        answers: answers.length ? answers : answer ? [answer] : [],
        answerStatus: data.answer_status ?? undefined,
      };
    } catch {
      return null;
    }
  };

  // ── Explanation fetching ───────────────────────────────────────────────────

  const fetchBatchExplanations = async (
    questionIds: string[]
  ): Promise<Record<string, string>> => {
    const url = `${API_BASE}/explanations/batch`;
    const token = await getApiToken();
    const merged: Record<string, string> = {};
    for (let i = 0; i < questionIds.length; i += 50) {
      const chunk = questionIds.slice(i, i + 50);
      if (!chunk.length) continue;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ question_ids: chunk }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const batch: Record<string, string> = await res.json();
      Object.assign(merged, batch || {});
    }
    return merged;
  };

  const warmQuestionExplanations = (
    queue: Question[],
    opts?: {
      sessionId?: number;
      onHydrate?: (questionId: string, explanation: string) => void;
    }
  ) => {
    const singleUrl = (id: string) => `${API_BASE}/explanation/${id}`;
    const isActiveSession = () =>
      opts?.sessionId === undefined ||
      mockPrefetchSessionRef.current === opts.sessionId ||
      prefetchSessionRef.current === opts.sessionId;

    const work = queue
      .filter(
        (q) =>
          q.id &&
          !isRenderableExplanation(q.explanation) &&
          !isRenderableExplanation(explanationCacheRef.current[q.id])
      )
      .map((q) => q.id!);

    if (!work.length) return;

    const hydrate = (id: string, explanation: string) => {
      if (!isRenderableExplanation(explanation)) return;
      explanationCacheRef.current[id] = explanation;
      opts?.onHydrate?.(id, explanation);
    };

    const fetchSingle = async (id: string, token: string | null): Promise<string | null> => {
      if (!isActiveSession()) return null;
      if (
        isRenderableExplanation(explanationCacheRef.current[id]) ||
        id in explanationInFlightRef.current
      ) {
        return explanationCacheRef.current[id] || null;
      }
      const promise: Promise<string | null> = (async () => {
        try {
          const res = await fetch(singleUrl(id), {
            signal: AbortSignal.timeout(12000),
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (!res.ok) return null;
          const data = await res.json();
          const explanation = (
            typeof data.explanation === 'string' ? data.explanation : ''
          ).trim();
          hydrate(id, explanation);
          return isRenderableExplanation(explanation) ? explanation : null;
        } catch {
          return null;
        } finally {
          delete explanationInFlightRef.current[id];
        }
      })();
      explanationInFlightRef.current[id] = promise;
      return promise;
    };

    void (async () => {
      const token = await getApiToken();
      try {
        const batch = await fetchBatchExplanations(work);
        if (!isActiveSession()) return;
        Object.entries(batch).forEach(([id, explanation]) => hydrate(id, explanation));
      } catch {
        /* continue with single-generation pass */
      }

      if (!isActiveSession()) return;
      const stillMissing = work.filter(
        (id) => !isRenderableExplanation(explanationCacheRef.current[id])
      );
      for (let i = 0; i < stillMissing.length; i += 8) {
        if (!isActiveSession()) return;
        const group = stillMissing.slice(i, i + 8);
        await Promise.allSettled(group.map((id) => fetchSingle(id, token)));
        if (i + 8 < stillMissing.length) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    })();
  };

  const prefetchExplanations = (queue: Question[], sessionId: number) => {
    warmQuestionExplanations(queue, {
      sessionId,
      onHydrate: (id, explanation) => updatePracticeQuestion(id, { explanation }),
    });
  };

  const fetchExplanationForQuestion = async (
    questionId: string,
    options?: {
      background?: boolean;
      deferUnavailable?: boolean;
      revealedAnswer?: string;
    }
  ): Promise<string | null> => {
    const existing = practiceQueueRef.current.find((item) => item.id === questionId);
    if (isRenderableExplanation(existing?.explanation)) {
      explanationCacheRef.current[questionId] = existing!.explanation!;
      return existing!.explanation!;
    }

    if (isRenderableExplanation(explanationCacheRef.current[questionId])) {
      const cachedExplanation = explanationCacheRef.current[questionId];
      updatePracticeQuestion(questionId, {
        explanation: cachedExplanation,
        ...(options?.revealedAnswer ? { answer: options.revealedAnswer } : {}),
      });
      return cachedExplanation;
    }

    if (questionId in explanationInFlightRef.current) {
      return explanationInFlightRef.current[questionId];
    }

    const explanationUrl = `${API_BASE}/explanation/${questionId}`;
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      options?.background ? 12000 : 25000
    );
    const explanationToken = await getApiToken();
    const promise = (async () => {
      try {
        const res = await fetch(explanationUrl, {
          signal: controller.signal,
          headers: explanationToken ? { Authorization: `Bearer ${explanationToken}` } : {},
        });
        if (!res.ok) {
          if (!options?.background && !options?.deferUnavailable) {
            updatePracticeQuestion(questionId, {
              explanation: UNAVAILABLE_EXPLANATION,
              ...(options?.revealedAnswer ? { answer: options.revealedAnswer } : {}),
            });
          }
          return null;
        }
        const data = await res.json();
        const source = (data.source || '').toString();
        const explanation =
          typeof data.explanation === 'string' ? data.explanation.trim() : '';
        const verifiedAnswers = Array.isArray(data.verified_answers)
          ? data.verified_answers
              .map((item: unknown) => String(item || '').trim().toUpperCase())
              .filter((item: string) => ['A', 'B', 'C', 'D'].includes(item))
          : [];
        const verifiedAnswer = (
          data.verified_answer ?? options?.revealedAnswer ?? ''
        )
          .toString()
          .trim()
          .toUpperCase();
        const patch: Partial<Question> = {};
        if (verifiedAnswers.length) patch.answers = verifiedAnswers;
        if (data.answer_status) patch.answerStatus = String(data.answer_status);
        if (['A', 'B', 'C', 'D'].includes(verifiedAnswer)) patch.answer = verifiedAnswer;
        if (source === 'blocked-unverified-answer') {
          patch.explanation = BLOCKED_EXPLANATION;
        } else if (source === 'deleted-question') {
          patch.explanation = 'This question was deleted in the official final key.';
        } else if (source === 'multiple-correct-answers') {
          patch.explanation =
            'The official key accepts more than one answer for this question.';
        } else if (source === 'hidden-contradiction') {
          patch.explanation = UNAVAILABLE_EXPLANATION;
        } else if (source === 'unavailable-error') {
          if (!options?.background && !options?.deferUnavailable) {
            patch.explanation = UNAVAILABLE_EXPLANATION;
          }
        } else if (isRenderableExplanation(explanation)) {
          patch.explanation = explanation;
          explanationCacheRef.current[questionId] = explanation;
        } else if (!explanation && !options?.deferUnavailable) {
          patch.explanation = UNAVAILABLE_EXPLANATION;
        }
        if (Object.keys(patch).length) {
          updatePracticeQuestion(questionId, patch);
        }
        return isRenderableExplanation(explanation) ? explanation : null;
      } catch {
        if (!options?.background && !options?.deferUnavailable) {
          updatePracticeQuestion(questionId, {
            explanation: UNAVAILABLE_EXPLANATION,
            ...(options?.revealedAnswer ? { answer: options.revealedAnswer } : {}),
          });
        }
        return null;
      } finally {
        window.clearTimeout(timeout);
        delete explanationInFlightRef.current[questionId];
      }
    })();

    explanationInFlightRef.current[questionId] = promise;
    return promise;
  };

  const fetchFreshExplanationAfterAnswer = async (
    questionId: string,
    revealedAnswer?: string
  ): Promise<boolean> => {
    const retryDelaysMs = [0, 1200, 2200];
    for (const delayMs of retryDelaysMs) {
      if (delayMs > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, delayMs));
      }

      const explanation = await fetchExplanationForQuestion(questionId, {
        deferUnavailable: true,
        revealedAnswer,
      });
      if (isRenderableExplanation(explanation)) {
        return true;
      }

      const latestQuestion = practiceQueueRef.current.find((item) => item.id === questionId);
      const latestExplanation = latestQuestion?.explanation;
      if (
        latestExplanation === BLOCKED_EXPLANATION ||
        latestExplanation === UNAVAILABLE_EXPLANATION ||
        latestExplanation === DELETED_QUESTION_NOTE ||
        latestExplanation === MULTIPLE_ANSWERS_NOTE
      ) {
        return latestExplanation !== UNAVAILABLE_EXPLANATION;
      }
    }

    updatePracticeQuestion(questionId, {
      explanation: UNAVAILABLE_EXPLANATION,
      ...(revealedAnswer ? { answer: revealedAnswer } : {}),
    });
    return false;
  };

  // ── Navigation ─────────────────────────────────────────────────────────────

  const jumpToPracticeQuestion = (i: number) => {
    setPracticeIndex(i);
    const ans = practiceSessionAnswers[i];
    if (ans) {
      setPracticeAnswered(true);
      setPracticeSelectedOption(ans.selected);
      const nextQuestion = practiceQueue[i];
      const hasExplanation = Boolean(nextQuestion?.explanation);
      setPracticeExplanationLoading(!hasExplanation);
      if (nextQuestion?.id && !hasExplanation) {
        void fetchExplanationForQuestion(nextQuestion.id).finally(() => {
          if (practiceIndexRef.current === i) {
            setPracticeExplanationLoading(false);
          }
        });
      }
    } else {
      setPracticeAnswered(false);
      setPracticeSelectedOption(null);
      setPracticeExplanationLoading(false);
    }
    practiceStartRef.current = Date.now();
  };

  const nextPracticeQuestion = () => {
    if (practiceIndex < practiceQueue.length - 1) {
      jumpToPracticeQuestion(practiceIndex + 1);
    }
  };

  const prevPracticeQuestion = () => {
    if (practiceIndex > 0) {
      jumpToPracticeQuestion(practiceIndex - 1);
    }
  };

  // ── Load more ──────────────────────────────────────────────────────────────

  const loadMorePracticeQuestions = async () => {
    if (!practiceHasMore || practiceBatchLoading) return;
    setPracticeBatchLoading(true);
    setPracticeLoadMoreError(null);
    try {
      let sortedBatch: Question[] = [];
      let nextHasMore = false;
      let nextCursor: string | null = null;
      let totalCount = 0;

      if (selectedYear) {
        if (!selectedExamName) return;
        const page = await requestExamPage(selectedExamName, selectedYear, {
          pageSize: 20,
          cursor: practiceNextCursor,
          subject: practiceSubject,
          topic: practiceTopic,
          paperId: practicePaperId,
          shiftLabel: practiceShiftLabel,
        });
        const hasNums = page.rows.some((x) => x.question_number);
        sortedBatch = hasNums
          ? [...page.rows].sort(
              (a, b) => (a.question_number ?? 999) - (b.question_number ?? 999)
            )
          : [...page.rows];
        nextHasMore = page.hasMore;
        nextCursor = page.nextCursor;
        totalCount = page.totalCount;
      } else {
        if (practiceSubject === 'All' || practiceTopic === 'All') return;
        const page = await requestTopicPracticePage(practiceSubject, practiceTopic, {
          pageSize: 20,
          offset: Number(practiceNextCursor || '0'),
        });
        sortedBatch = page.rows;
        nextHasMore = page.hasMore;
        nextCursor = page.nextOffset !== null ? String(page.nextOffset) : null;
        totalCount = page.totalCount;
      }

      let freshCount = 0;
      setPracticeQueue((prev) => {
        const seen = new Set(prev.map((item) => item.id));
        const fresh = sortedBatch.filter((item) => !seen.has(item.id));
        freshCount = fresh.length;
        return fresh.length ? [...prev, ...fresh] : prev;
      });
      if (freshCount > 0) {
        setPracticeSessionAnswers((prev) => [
          ...prev,
          ...new Array(freshCount).fill(null),
        ]);
      }
      setPracticeHasMore(nextHasMore);
      setPracticeNextCursor(nextCursor);
      setPracticeLoadProgress((prev) => ({
        loaded: prev.loaded + freshCount,
        total: totalCount || prev.total,
      }));
    } catch (e: any) {
      setPracticeLoadMoreError(e?.message || 'Failed to load more questions');
    } finally {
      setPracticeBatchLoading(false);
    }
  };

  return (
    <PracticeContext.Provider
      value={{
        practiceQueue, setPracticeQueue,
        practiceIndex, setPracticeIndex,
        practiceAnswered, setPracticeAnswered,
        practiceSelectedOption, setPracticeSelectedOption,
        practiceAnswerLoading, setPracticeAnswerLoading,
        practiceExplanationLoading, setPracticeExplanationLoading,
        practiceSubject, setPracticeSubject,
        practiceTopic, setPracticeTopic,
        practicePaperId, setPracticePaperId,
        practiceShiftLabel, setPracticeShiftLabel,
        practiceHasMore, setPracticeHasMore,
        practiceNextCursor, setPracticeNextCursor,
        practiceLoadMoreError, setPracticeLoadMoreError,
        practiceBatchLoading, setPracticeBatchLoading,
        practiceSessionAnswers, setPracticeSessionAnswers,
        practiceBackView, setPracticeBackView,
        practiceInitLoading, setPracticeInitLoading,
        practiceInitMessage, setPracticeInitMessage,
        practiceLoadProgress, setPracticeLoadProgress,
        practiceStartRef,
        prefetchSessionRef,
        mockPrefetchSessionRef,
        practiceQueueRef,
        explanationCacheRef,
        isRenderableExplanation,
        getSafePracticeBackView,
        currentPracticeQ,
        updatePracticeQuestion,
        fetchBatchExplanations,
        warmQuestionExplanations,
        prefetchExplanations,
        fetchExplanationForQuestion,
        fetchFreshExplanationAfterAnswer,
        nextPracticeQuestion,
        prevPracticeQuestion,
        jumpToPracticeQuestion,
        loadMorePracticeQuestions,
        fetchQuestionAnswerMeta,
      }}
    >
      {children}
    </PracticeContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function usePractice(): PracticeContextValue {
  const ctx = useContext(PracticeContext);
  if (!ctx) throw new Error('usePractice must be used within PracticeProvider');
  return ctx;
}
