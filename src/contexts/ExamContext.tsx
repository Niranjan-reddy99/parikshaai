import { createContext, useContext, useState, useRef, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { useCatalog } from './CatalogContext';
import { API_BASE } from '../lib/api';
import { auth } from '../firebase';
import { normalizeSubject } from '../lib/utils';
import {
  getCachedExamManifest,
  getCachedExamOutline,
  getCachedFirstPage,
  setCachedFirstPage,
  invalidateCachedExam,
  getCachedTopicPage,
  setCachedTopicPage,
  setCachedExamManifest,
  setCachedExamOutline,
} from '../lib/questionCache';
import {
  type ExamOutline,
  type ExamPaperManifest,
  type Question,
} from '../types/index';

// ── Shared types ──────────────────────────────────────────────────────────────

export type ExamPageEntry = {
  totalCount: number;
  hasMore: boolean;
  nextCursor: string | null;
  loading: boolean;
  error: string | null;
};

// ── Context type ──────────────────────────────────────────────────────────────

interface ExamContextValue {
  // Exam selection (used by nav + loading functions)
  selectedExamName: string;
  setSelectedExamName: (v: string) => void;
  selectedYear: number;
  setSelectedYear: (v: number) => void;
  selectedPaperId: string | null;
  setSelectedPaperId: (v: string | null) => void;
  selectedShiftLabel: string | null;
  setSelectedShiftLabel: (v: string | null) => void;

  // Cache state (read by views for display)
  examCache: Record<string, Question[]>;
  examOutlineCache: Record<string, ExamOutline>;
  examPageState: Record<string, ExamPageEntry>;
  examPaperManifestCache: Record<string, ExamPaperManifest>;

  // Loading
  examLoading: boolean;
  examPaperLoading: boolean;

  // Utilities (needed by AppContent consumers)
  buildQuestionSetKey: (
    examName: string,
    year: number,
    filters?: {
      subject?: string;
      topic?: string;
      subtopic?: string;
      paperId?: string | null;
      shiftLabel?: string | null;
    }
  ) => string;
  mapQuestion: (q: any) => Question;
  getExamPageEntry: (key: string) => ExamPageEntry | null;

  // Async loaders
  loadExamPapers: (
    examName: string,
    year: number,
    forceReload?: boolean
  ) => Promise<ExamPaperManifest | null>;
  resolvePaperSelector: (
    examName: string,
    year: number,
    preferred?: { paperId?: string | null; shiftLabel?: string | null }
  ) => Promise<{ paperId: string | null; shiftLabel: string | null }>;
  loadExamOutline: (
    examName: string,
    year: number,
    forceReload?: boolean,
    selector?: { paperId?: string | null; shiftLabel?: string | null }
  ) => Promise<ExamOutline | null>;
  fetchExamChunk: (
    examName: string,
    year: number,
    opts?: {
      forceReload?: boolean;
      pageSize?: number;
      reset?: boolean;
      subject?: string;
      topic?: string;
      subtopic?: string;
      paperId?: string | null;
      shiftLabel?: string | null;
    }
  ) => Promise<Question[]>;
  loadExamQuestions: (
    examName: string,
    year: number,
    forceReload?: boolean,
    selector?: { paperId?: string | null; shiftLabel?: string | null }
  ) => Promise<Question[]>;
  loadMoreExamQuestions: (
    examName: string,
    year: number,
    pageSize?: number,
    filters?: {
      subject?: string;
      topic?: string;
      subtopic?: string;
      paperId?: string | null;
      shiftLabel?: string | null;
    }
  ) => Promise<Question[]>;
  loadAllExamQuestions: (
    examName: string,
    year: number,
    filters?: {
      subject?: string;
      topic?: string;
      subtopic?: string;
      paperId?: string | null;
      shiftLabel?: string | null;
    }
  ) => Promise<Question[]>;
  requestExamPage: (
    examName: string,
    year: number,
    opts?: {
      pageSize?: number;
      cursor?: string | null;
      subject?: string;
      topic?: string;
      subtopic?: string;
      paperId?: string | null;
      shiftLabel?: string | null;
    }
  ) => Promise<{
    rows: Question[];
    totalCount: number;
    hasMore: boolean;
    nextCursor: string | null;
  }>;
  requestTopicPracticePage: (
    subject: string,
    topic: string,
    opts?: { pageSize?: number; offset?: number }
  ) => Promise<{
    rows: Question[];
    totalCount: number;
    hasMore: boolean;
    nextOffset: number | null;
  }>;
  prefetchTopicPractice: (subject: string, topic: string) => void;
}

const ExamContext = createContext<ExamContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export function ExamProvider({ children }: { children: ReactNode }) {
  const { getApiToken } = useAuth();
  const { setGlobalError } = useCatalog();

  // ── Exam selection ────────────────────────────────────────────────────────
  const [selectedExamName, setSelectedExamName] = useState('');
  const [selectedYear, setSelectedYear] = useState(0);
  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(null);
  const [selectedShiftLabel, setSelectedShiftLabel] = useState<string | null>(null);

  // ── Cache state ───────────────────────────────────────────────────────────
  const [examCache, setExamCache] = useState<Record<string, Question[]>>({});
  const [examOutlineCache, setExamOutlineCache] = useState<Record<string, ExamOutline>>({});
  const [examPageState, setExamPageState] = useState<Record<string, ExamPageEntry>>({});
  const [examPaperManifestCache, setExamPaperManifestCache] = useState<Record<string, ExamPaperManifest>>({});

  // ── Loading ───────────────────────────────────────────────────────────────
  const [examLoading, setExamLoading] = useState(false);
  const [examPaperLoading, setExamPaperLoading] = useState(false);

  // ── Internal refs ─────────────────────────────────────────────────────────
  // examPageStateRef is kept in sync via updateExamPageState to allow async
  // loops in loadAllExamQuestions to read the latest value without stale closures.
  const examPageStateRef = useRef<Record<string, ExamPageEntry>>({});
  const topicPrefetchInFlightRef = useRef<
    Record<string, Promise<{ rows: Question[]; totalCount: number; hasMore: boolean; nextOffset: number | null } | void> | undefined>
  >({});

  const updateExamPageState = (
    updater: (prev: Record<string, ExamPageEntry>) => Record<string, ExamPageEntry>
  ) => {
    setExamPageState((prev) => {
      const next = updater(prev);
      examPageStateRef.current = next;
      return next;
    });
  };

  const getExamPageEntry = (key: string): ExamPageEntry | null =>
    examPageStateRef.current[key] ?? null;

  // ── Utilities ─────────────────────────────────────────────────────────────

  const buildQuestionSetKey = (
    examName: string,
    year: number,
    filters?: {
      subject?: string;
      topic?: string;
      subtopic?: string;
      paperId?: string | null;
      shiftLabel?: string | null;
    }
  ) => {
    const subject =
      filters?.subject && filters.subject !== 'All' ? filters.subject : 'All';
    const topic =
      filters?.topic && filters.topic !== 'All' ? filters.topic : 'All';
    const subtopic =
      filters?.subtopic && filters.subtopic !== 'All' ? filters.subtopic : 'All';
    const paperId = filters?.paperId?.trim() || 'ALL_PAPERS';
    const shiftLabel = filters?.shiftLabel?.trim() || 'ALL_SHIFTS';
    return `${examName}::${year}::${paperId}::${shiftLabel}::${subject}::${topic}::${subtopic}`;
  };

  const mapQuestion = (q: any): Question => {
    const rawAnswers = Array.isArray(q.correct_answers)
      ? q.correct_answers
      : Array.isArray(q.answers)
      ? q.answers
      : [];
    const answers: string[] = Array.from(
      new Set(
        rawAnswers
          .map((item: unknown) => String(item || '').trim().toUpperCase())
          .filter((item: string) => ['A', 'B', 'C', 'D'].includes(item))
      )
    );
    const singleAnswer = String(q.correct_answer ?? q.answer ?? '').trim().toUpperCase();
    const primaryAnswer =
      answers[0] || (['A', 'B', 'C', 'D'].includes(singleAnswer) ? singleAnswer : '');
    const examName = q.exam_name ?? q.exam ?? '';
    const examYear = q.exam_year ?? q.year ?? 0;
    const shiftLabel = q.shift_label ?? q.shift ?? '';
    const fallbackSource = examName
      ? `${examName}${examYear ? ` · ${examYear}` : ''}${shiftLabel ? ` · ${shiftLabel}` : ''}`
      : undefined;

    return {
      id: q.id,
      question: q.question_text ?? q.question ?? '',
      question_number: q.question_number,
      options: q.options ?? {
        A: q.option_a ?? '',
        B: q.option_b ?? '',
        C: q.option_c ?? '',
        D: q.option_d ?? '',
      },
      answer: primaryAnswer,
      answers: answers.length ? answers : primaryAnswer ? [primaryAnswer] : [],
      answerStatus: q.answer_status ?? q.answerStatus ?? undefined,
      explanation: q.explanation ?? '',
      source: q.source ?? fallbackSource,
      flag_count: q.flag_count ?? undefined,
      subject: normalizeSubject(q.subject ?? ''),
      topic: q.topic ?? '',
      subtopic: q.subtopic ?? '',
      difficulty: q.difficulty ?? 'Medium',
      concept: q.concept ?? '',
      type: q.question_type ?? q.type ?? '',
      year: examYear,
      exam: examName,
      passage: q.passage ?? '',
      shift: shiftLabel,
      has_image: q.has_image ?? false,
      image_url: q.image_url ?? undefined,
      pattern_tag: q.pattern_tag ?? undefined,
      trap_tag: q.trap_tag ?? undefined,
      skill_tag: q.skill_tag ?? undefined,
      question_style: q.question_style ?? undefined,
      pattern_confidence: q.pattern_confidence ?? undefined,
      pattern_reason: q.pattern_reason ?? undefined,
      solve_hint: q.solve_hint ?? undefined,
    };
  };

  // ── Exam paper manifest ───────────────────────────────────────────────────

  const loadExamPapers = async (
    examName: string,
    year: number,
    forceReload = false
  ): Promise<ExamPaperManifest | null> => {
    const key = `${examName}::${year}`;
    if (!forceReload && examPaperManifestCache[key]) {
      return examPaperManifestCache[key];
    }
    if (!forceReload) {
      const cached = getCachedExamManifest(examName, year);
      if (cached) {
        setExamPaperManifestCache((prev) => ({ ...prev, [key]: cached }));
        void (async () => {
          try {
            const params = new URLSearchParams({
              exam_name: examName,
              exam_year: String(year),
            });
            const res = await fetch(`${API_BASE}/meta/exam-papers?${params}`);
            if (!res.ok) return;
            const fresh: ExamPaperManifest = await res.json();
            setExamPaperManifestCache((prev) => ({ ...prev, [key]: fresh }));
            setCachedExamManifest(examName, year, fresh);
          } catch {
            /* keep cached manifest */
          }
        })();
        return cached;
      }
    }
    setExamPaperLoading(true);
    try {
      const params = new URLSearchParams({
        exam_name: examName,
        exam_year: String(year),
      });
      const res = await fetch(`${API_BASE}/meta/exam-papers?${params}`);
      if (res.status === 404) {
        const fallback: ExamPaperManifest = {
          exam_name: examName,
          exam_year: year,
          total_count: 0,
          papers: [
            {
              paper_id: null,
              shift_label: null,
              question_count: 0,
              first_question_number: null,
              last_question_number: null,
            },
          ],
        };
        setExamPaperManifestCache((prev) => ({ ...prev, [key]: fallback }));
        return fallback;
      }
      if (!res.ok) {
        throw new Error(`Failed to load exam papers (${res.status})`);
      }
      const data: ExamPaperManifest = await res.json();
      setExamPaperManifestCache((prev) => ({ ...prev, [key]: data }));
      setCachedExamManifest(examName, year, data);
      return data;
    } catch {
      return null;
    } finally {
      setExamPaperLoading(false);
    }
  };

  const resolvePaperSelector = async (
    examName: string,
    year: number,
    preferred?: { paperId?: string | null; shiftLabel?: string | null }
  ): Promise<{ paperId: string | null; shiftLabel: string | null }> => {
    let paperId =
      preferred?.paperId !== undefined
        ? preferred.paperId
        : examName === selectedExamName && year === selectedYear
        ? selectedPaperId
        : null;
    let shiftLabel =
      preferred?.shiftLabel !== undefined
        ? preferred.shiftLabel
        : examName === selectedExamName && year === selectedYear
        ? selectedShiftLabel
        : null;

    const hasExplicitSelector = paperId !== null || shiftLabel !== null;
    if (!hasExplicitSelector) {
      const manifest = await loadExamPapers(examName, year);
      const firstPaper = manifest?.papers?.[0] || null;
      if (firstPaper) {
        paperId = firstPaper.paper_id || null;
        shiftLabel = firstPaper.shift_label || null;
      }
    }

    if (examName === selectedExamName && year === selectedYear) {
      if (selectedPaperId !== paperId) setSelectedPaperId(paperId);
      if (selectedShiftLabel !== shiftLabel) setSelectedShiftLabel(shiftLabel);
    }

    return { paperId, shiftLabel };
  };

  // ── Exam outline ──────────────────────────────────────────────────────────

  const loadExamOutline = async (
    examName: string,
    year: number,
    forceReload = false,
    selector?: { paperId?: string | null; shiftLabel?: string | null }
  ): Promise<ExamOutline | null> => {
    const key = buildQuestionSetKey(examName, year, {
      paperId: selector?.paperId,
      shiftLabel: selector?.shiftLabel,
    });
    if (!forceReload && examOutlineCache[key]) return examOutlineCache[key];
    if (!forceReload) {
      const cached = getCachedExamOutline(key);
      if (cached) {
        setExamOutlineCache((prev) => ({ ...prev, [key]: cached }));
        void (async () => {
          try {
            const params = new URLSearchParams({
              exam_name: examName,
              exam_year: String(year),
            });
            if (selector?.paperId) params.set('paper_id', selector.paperId);
            if (selector?.shiftLabel) params.set('shift_label', selector.shiftLabel);
            const res = await fetch(`${API_BASE}/meta/exam-outline?${params}`);
            if (!res.ok) return;
            const fresh: ExamOutline = await res.json();
            setExamOutlineCache((prev) => ({ ...prev, [key]: fresh }));
            setCachedExamOutline(key, fresh);
          } catch {
            /* keep cached outline */
          }
        })();
        return cached;
      }
    }
    try {
      const params = new URLSearchParams({
        exam_name: examName,
        exam_year: String(year),
      });
      if (selector?.paperId) params.set('paper_id', selector.paperId);
      if (selector?.shiftLabel) params.set('shift_label', selector.shiftLabel);
      const res = await fetch(`${API_BASE}/meta/exam-outline?${params}`);
      if (!res.ok) throw new Error(`Failed to load exam outline (${res.status})`);
      const data: ExamOutline = await res.json();
      setExamOutlineCache((prev) => ({ ...prev, [key]: data }));
      setCachedExamOutline(key, data);
      return data;
    } catch {
      return null;
    }
  };

  // ── Question chunk fetching ───────────────────────────────────────────────

  const mergeExamQuestions = (
    examKey: string,
    batch: Question[],
    replace = false
  ): Question[] => {
    const current = replace ? [] : examCache[examKey] || [];
    const seen = new Set(current.map((q) => q.id));
    const merged = replace
      ? batch
      : [...current, ...batch.filter((q) => !seen.has(q.id))];
    return merged.sort(
      (a, b) => (a.question_number ?? 9999) - (b.question_number ?? 9999)
    );
  };

  const fetchExamChunk = async (
    examName: string,
    year: number,
    opts?: {
      forceReload?: boolean;
      pageSize?: number;
      reset?: boolean;
      subject?: string;
      topic?: string;
      subtopic?: string;
      paperId?: string | null;
      shiftLabel?: string | null;
    }
  ): Promise<Question[]> => {
    const resolvedPaperId =
      opts?.paperId !== undefined
        ? opts.paperId
        : examName === selectedExamName && year === selectedYear
        ? selectedPaperId
        : null;
    const resolvedShiftLabel =
      opts?.shiftLabel !== undefined
        ? opts.shiftLabel
        : examName === selectedExamName && year === selectedYear
        ? selectedShiftLabel
        : null;
    const key = buildQuestionSetKey(examName, year, {
      ...opts,
      paperId: resolvedPaperId,
      shiftLabel: resolvedShiftLabel,
    });
    const pageSize = opts?.pageSize ?? 50;
    const reset = opts?.reset ?? false;
    const currentPageState = examPageStateRef.current[key];
    const nextCursor = reset ? null : currentPageState?.nextCursor || null;
    if (!reset && currentPageState?.loading) return examCache[key] || [];
    if (!reset && currentPageState && !currentPageState.hasMore)
      return examCache[key] || [];

    // SWR: on first load, immediately show cached data while fetching fresh
    if (reset && !opts?.forceReload) {
      const cached = getCachedFirstPage(key);
      if (cached) {
        setExamCache((prev) => ({ ...prev, [key]: cached.questions }));
        updateExamPageState((prev) => ({
          ...prev,
          [key]: {
            totalCount: cached.totalCount,
            hasMore: cached.hasMore,
            nextCursor: cached.nextCursor,
            loading: true,
            error: null,
          },
        }));
      }
    }

    updateExamPageState((prev) => ({
      ...prev,
      [key]: {
        totalCount: prev[key]?.totalCount || 0,
        hasMore: prev[key]?.hasMore ?? true,
        nextCursor,
        loading: true,
        error: null,
      },
    }));

    try {
      const params = new URLSearchParams({
        exam_name: examName,
        exam_year: String(year),
      });
      if (opts?.subject && opts.subject !== 'All') params.set('subject', opts.subject);
      if (opts?.topic && opts.topic !== 'All') params.set('topic', opts.topic);
      if (opts?.subtopic && opts.subtopic !== 'All') params.set('subtopic', opts.subtopic);
      if (resolvedPaperId) params.set('paper_id', resolvedPaperId);
      if (resolvedShiftLabel) params.set('shift_label', resolvedShiftLabel);
      params.set('limit', String(pageSize));
      if (nextCursor) params.set('cursor', nextCursor);

      let token = await getApiToken();
      let res = await fetch(`${API_BASE}/questions?${params}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.status === 401) {
        try { token = await auth.currentUser?.getIdToken(true) ?? null; } catch { token = null; }
        res = await fetch(`${API_BASE}/questions?${params}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
      }
      if (!res.ok) throw new Error(`Failed to load questions (${res.status})`);
      const data: any = await res.json();
      const batch = (data.questions || []).map(mapQuestion);
      const merged = mergeExamQuestions(key, batch, reset);
      setExamCache((prev) => ({ ...prev, [key]: merged }));
      updateExamPageState((prev) => ({
        ...prev,
        [key]: {
          totalCount: data.total_count ?? data.total ?? merged.length,
          hasMore: Boolean(data.has_more),
          nextCursor: data.next_cursor ?? null,
          loading: false,
          error: null,
        },
      }));
      if (reset) {
        setCachedFirstPage(key, {
          questions: batch,
          totalCount: data.total_count ?? data.total ?? batch.length,
          hasMore: Boolean(data.has_more),
          nextCursor: data.next_cursor ?? null,
        });
      }
      setGlobalError(null);
      return merged;
    } catch (e: any) {
      updateExamPageState((prev) => ({
        ...prev,
        [key]: {
          totalCount: prev[key]?.totalCount || 0,
          hasMore: prev[key]?.hasMore ?? true,
          nextCursor: prev[key]?.nextCursor ?? null,
          loading: false,
          error: e?.message || 'unknown error',
        },
      }));
      setGlobalError(
        `Could not load "${examName}" ${year}: ${e?.message || 'unknown error'}`
      );
      return examCache[key] || [];
    }
  };

  const loadExamQuestions = async (
    examName: string,
    year: number,
    forceReload = false,
    selector?: { paperId?: string | null; shiftLabel?: string | null }
  ): Promise<Question[]> => {
    const resolvedPaperId =
      selector?.paperId !== undefined
        ? selector.paperId
        : examName === selectedExamName && year === selectedYear
        ? selectedPaperId
        : null;
    const resolvedShiftLabel =
      selector?.shiftLabel !== undefined
        ? selector.shiftLabel
        : examName === selectedExamName && year === selectedYear
        ? selectedShiftLabel
        : null;
    const key = buildQuestionSetKey(examName, year, {
      paperId: resolvedPaperId,
      shiftLabel: resolvedShiftLabel,
    });
    if (forceReload) {
      invalidateCachedExam(examName, year);
      setExamCache((prev) => ({ ...prev, [key]: [] }));
      updateExamPageState((prev) => ({
        ...prev,
        [key]: {
          totalCount: 0,
          hasMore: true,
          nextCursor: null,
          loading: false,
          error: null,
        },
      }));
    }
    setExamLoading(true);
    try {
      void loadExamOutline(examName, year, forceReload, {
        paperId: resolvedPaperId,
        shiftLabel: resolvedShiftLabel,
      });
      return await fetchExamChunk(examName, year, {
        forceReload,
        pageSize: 20,
        reset: true,
        paperId: resolvedPaperId,
        shiftLabel: resolvedShiftLabel,
      });
    } finally {
      setExamLoading(false);
    }
  };

  const loadMoreExamQuestions = async (
    examName: string,
    year: number,
    pageSize = 20,
    filters?: {
      subject?: string;
      topic?: string;
      subtopic?: string;
      paperId?: string | null;
      shiftLabel?: string | null;
    }
  ): Promise<Question[]> => {
    return fetchExamChunk(examName, year, {
      pageSize,
      reset: false,
      ...filters,
    });
  };

  const loadAllExamQuestions = async (
    examName: string,
    year: number,
    filters?: {
      subject?: string;
      topic?: string;
      subtopic?: string;
      paperId?: string | null;
      shiftLabel?: string | null;
    }
  ): Promise<Question[]> => {
    let current =
      filters?.subject || filters?.topic || filters?.subtopic
        ? await fetchExamChunk(examName, year, {
            pageSize: 20,
            reset: true,
            ...filters,
          })
        : await loadExamQuestions(examName, year, false, filters);
    const key = buildQuestionSetKey(examName, year, {
      ...filters,
      paperId:
        filters?.paperId !== undefined
          ? filters.paperId
          : examName === selectedExamName && year === selectedYear
          ? selectedPaperId
          : null,
      shiftLabel:
        filters?.shiftLabel !== undefined
          ? filters.shiftLabel
          : examName === selectedExamName && year === selectedYear
          ? selectedShiftLabel
          : null,
    });

    let guard = 0;
    while (
      examPageStateRef.current[key]?.hasMore &&
      guard < 100
    ) {
      current = await loadMoreExamQuestions(examName, year, 25, filters);
      guard += 1;
    }
    return current;
  };

  // ── Paginated fetch (used by BrowseView) ──────────────────────────────────

  const requestExamPage = async (
    examName: string,
    year: number,
    opts?: {
      pageSize?: number;
      cursor?: string | null;
      subject?: string;
      topic?: string;
      subtopic?: string;
      paperId?: string | null;
      shiftLabel?: string | null;
    }
  ): Promise<{
    rows: Question[];
    totalCount: number;
    hasMore: boolean;
    nextCursor: string | null;
  }> => {
    const params = new URLSearchParams({
      exam_name: examName,
      exam_year: String(year),
      limit: String(opts?.pageSize ?? 20),
    });
    if (opts?.subject && opts.subject !== 'All') params.set('subject', opts.subject);
    if (opts?.topic && opts.topic !== 'All') params.set('topic', opts.topic);
    if (opts?.subtopic && opts.subtopic !== 'All') params.set('subtopic', opts.subtopic);
    if (opts?.paperId) params.set('paper_id', opts.paperId);
    if (opts?.shiftLabel) params.set('shift_label', opts.shiftLabel);
    if (opts?.cursor) params.set('cursor', opts.cursor);

    let token = await getApiToken();
    let res = await fetch(`${API_BASE}/questions?${params}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.status === 401) {
      try { token = await auth.currentUser?.getIdToken(true) ?? null; } catch { token = null; }
      res = await fetch(`${API_BASE}/questions?${params}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    }
    if (!res.ok) throw new Error(`Failed to load questions (${res.status})`);
    const data: any = await res.json();
    return {
      rows: (data.questions || []).map(mapQuestion),
      totalCount: data.total_count ?? data.total ?? 0,
      hasMore: Boolean(data.has_more),
      nextCursor: data.next_cursor ?? null,
    };
  };

  // ── Topic practice page (used by PracticeView + feed prefetch) ────────────

  const requestTopicPracticePage = async (
    subject: string,
    topic: string,
    opts?: { pageSize?: number; offset?: number }
  ): Promise<{
    rows: Question[];
    totalCount: number;
    hasMore: boolean;
    nextOffset: number | null;
  }> => {
    const pageSize = opts?.pageSize ?? 20;
    const pageOffset = opts?.offset ?? 0;
    const params = new URLSearchParams({
      subject,
      topic,
      limit: String(pageSize),
      offset: String(pageOffset),
    });
    let token = await getApiToken();
    const ac = new AbortController();
    const abortTimer = setTimeout(() => ac.abort(), 15000);
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/topic-questions?${params}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: ac.signal,
      });
    } finally {
      clearTimeout(abortTimer);
    }
    if (res.status === 401) {
      try { token = await auth.currentUser?.getIdToken(true) ?? null; } catch { token = null; }
      res = await fetch(`${API_BASE}/topic-questions?${params}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    }
    if (!res.ok) {
      throw new Error(`Failed to load topic questions (${res.status})`);
    }
    const data: any = await res.json();
    return {
      rows: (data.questions || []).map(mapQuestion),
      totalCount: data.total ?? 0,
      hasMore: Boolean(data.has_more),
      nextOffset: data.has_more ? pageOffset + pageSize : null,
    };
  };

  const prefetchTopicPractice = (subject: string, topic: string) => {
    const cacheKey = `${subject}::${topic}`;
    if (getCachedTopicPage(subject, topic)) {
      return;
    }
    if (topicPrefetchInFlightRef.current[cacheKey]) {
      return;
    }
    const promise = requestTopicPracticePage(subject, topic, {
      pageSize: 20,
      offset: 0,
    })
      .then((page) => {
        setCachedTopicPage(subject, topic, {
          questions: page.rows,
          total: page.totalCount,
          hasMore: page.hasMore,
          nextOffset: page.nextOffset,
        });
        return page;
      })
      .catch(() => {
        // Silent prefetch miss — click path will still do the real request.
      })
      .finally(() => {
        delete topicPrefetchInFlightRef.current[cacheKey];
      });
    topicPrefetchInFlightRef.current[cacheKey] = promise;
  };

  return (
    <ExamContext.Provider
      value={{
        selectedExamName,
        setSelectedExamName,
        selectedYear,
        setSelectedYear,
        selectedPaperId,
        setSelectedPaperId,
        selectedShiftLabel,
        setSelectedShiftLabel,
        examCache,
        examOutlineCache,
        examPageState,
        examPaperManifestCache,
        examLoading,
        examPaperLoading,
        buildQuestionSetKey,
        mapQuestion,
        getExamPageEntry,
        loadExamPapers,
        resolvePaperSelector,
        loadExamOutline,
        fetchExamChunk,
        loadExamQuestions,
        loadMoreExamQuestions,
        loadAllExamQuestions,
        requestExamPage,
        requestTopicPracticePage,
        prefetchTopicPractice,
      }}
    >
      {children}
    </ExamContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useExam(): ExamContextValue {
  const ctx = useContext(ExamContext);
  if (!ctx) throw new Error('useExam must be used within ExamProvider');
  return ctx;
}
