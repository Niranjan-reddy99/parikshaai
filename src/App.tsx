import { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { API_BASE, adminHeaders } from './lib/api';
import { motion, AnimatePresence } from 'motion/react';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, User } from 'firebase/auth';
import { LogIn, AlertCircle, Loader2, RotateCcw, X, Sun, Moon } from 'lucide-react';
import { auth } from './firebase';

import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { Navbar } from './components/Navbar';
import { OnboardingModal } from './components/OnboardingModal';
import { QuestionModal } from './components/QuestionModal';
import { CostModal } from './components/admin/CostModal';
import { DeleteExamModal } from './components/admin/DeleteExamModal';
import { RenameModal } from './components/admin/RenameModal';
import { EditQuestionModal } from './components/admin/EditQuestionModal';
import { UploadPaperModal } from './components/admin/UploadPaperModal';

import { DashboardView } from './views/DashboardView';
import { HomeView } from './views/HomeView';
import { CommissionView } from './views/CommissionView';
import { MockView } from './views/MockView';
import { ResultsView } from './views/ResultsView';

const FeedView = lazy(() => import('./views/FeedView').then(m => ({ default: m.FeedView })));
const BadgesView = lazy(() => import('./views/BadgesView').then(m => ({ default: m.BadgesView })));
const LeaderboardView = lazy(() => import('./views/LeaderboardView').then(m => ({ default: m.LeaderboardView })));
const ExamDetailView = lazy(() => import('./views/ExamDetailView').then(m => ({ default: m.ExamDetailView })));
const PracticeView = lazy(() => import('./views/PracticeView').then(m => ({ default: m.PracticeView })));
const BrowseView = lazy(() => import('./views/BrowseView').then(m => ({ default: m.BrowseView })));
const ReportView = lazy(() => import('./views/ReportView').then(m => ({ default: m.ReportView })));
const PatternDebugView = lazy(() => import('./views/PatternDebugView').then(m => ({ default: m.PatternDebugView })));
const PatternBookIngestionView = lazy(() => import('./views/PatternBookIngestionView').then(m => ({ default: m.PatternBookIngestionView })));
const PatternPracticeView = lazy(() => import('./views/PatternPracticeView').then(m => ({ default: m.PatternPracticeView })));

import { normalizeSubject } from './lib/utils';
import { parseExamName } from './lib/examUtils';
import { canonicalConceptFamily, canonicalSubjectFamily, cleanBucketLabel, normalizeLooseLabel } from './lib/topicTaxonomy';
import { getStats, updateStats, type UserStats } from './lib/stats';
import { C } from './lib/tokens';
import { type Question, type QuestionMeta, type View, type ExamSession, type WeightageItem } from './types/index';

export default function App() {
  return <ErrorBoundary><AppContent /></ErrorBoundary>;
}

function ViewLoadingFallback({ label = 'Loading view...' }: { label?: string }) {
  return (
    <div style={{ minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div
        className="glass-panel"
        style={{
          borderRadius: 18,
          padding: '22px 26px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          color: C.textSec,
        }}
      >
        <Loader2 style={{ width: 18, height: 18, color: C.accent, animation: 'spin 1s linear infinite' }} />
        <div>
          <div style={{ fontSize: 14, color: C.text }}>{label}</div>
          <div style={{ fontSize: 12, color: C.textTert }}>Preparing the screen without blocking the rest of the app.</div>
        </div>
      </div>
    </div>
  );
}

function AppContent() {
  // ── Auth & Data ─────────────────────────────────────────────────────────────
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  // Lightweight metadata for ALL questions — used by nav, commissionMap, feed, dashboard.
  // Fetched once on login via /questions/meta (~10% the size of full questions).
  const [questionsMeta, setQuestionsMeta] = useState<QuestionMeta[]>([]);
  const [reviewPapers, setReviewPapers] = useState<{ exam_name: string; exam_year: number; question_count: number; reasons: string[] }[]>([]);
  // Full question data per exam, loaded lazily when an exam is opened.
  // Key: "examName::year". Re-used on revisit — no redundant fetches.
  const [examCache, setExamCache] = useState<Record<string, Question[]>>({});
  const [examLoading, setExamLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // ── Onboarding ───────────────────────────────────────────────────────────────
  const [showOnboarding, setShowOnboarding] = useState(false);

  // ── User Stats (localStorage) ────────────────────────────────────────────────
  const [userStats, setUserStats] = useState<UserStats>(() => getStats('guest'));
  const practiceStartRef = useRef<number>(Date.now());

  // Reload stats when user changes; show onboarding for new users
  useEffect(() => {
    if (!user) {
      setUserStats(getStats('guest'));
      return;
    }

    const localStats = getStats(user.uid);
    setUserStats(localStats);
    const key = `pyq_onboarded_${user.uid}`;
    if (!localStorage.getItem(key)) setShowOnboarding(true);

    let cancelled = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch(`${API_BASE}/progress/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const serverStats = await res.json();
        if (!cancelled) {
          setUserStats(serverStats);
        }
      } catch {
        // Keep local fallback silently.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  // ── Navigation ──────────────────────────────────────────────────────────────
  const [view, setView] = useState<View>('dashboard');
  const [selectedCommission, setSelectedCommission] = useState('');
  const [selectedExamType, setSelectedExamType] = useState('');
  const [selectedExamName, setSelectedExamName] = useState('');
  const [selectedYear, setSelectedYear] = useState(0);

  // ── Navbar Dropdown ─────────────────────────────────────────────────────────
  const [examDropdownOpen, setExamDropdownOpen] = useState(false);
  const [dropdownHoveredCommission, setDropdownHoveredCommission] = useState('');

  // ── Browse ──────────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSubject, setFilterSubject] = useState('All');
  const [filterTopic, setFilterTopic] = useState('All');
  const [filterSubtopic, setFilterSubtopic] = useState('All');
  const [selectedQuestion, setSelectedQuestion] = useState<Question | null>(null);

  // ── Practice ────────────────────────────────────────────────────────────────
  const [practiceQueue, setPracticeQueue] = useState<Question[]>([]);
  const [practiceIndex, setPracticeIndex] = useState(0);
  const [practiceAnswered, setPracticeAnswered] = useState(false);
  const [practiceSelectedOption, setPracticeSelectedOption] = useState<string | null>(null);
  const [practiceAnswerLoading, setPracticeAnswerLoading] = useState(false);
  const [practiceExplanationLoading, setPracticeExplanationLoading] = useState(false);
  const [practiceSubject, setPracticeSubject] = useState('All');
  const [practiceTopic, setPracticeTopic] = useState('All');
  const [practiceSessionAnswers, setPracticeSessionAnswers] = useState<(null | { selected: string; correct: boolean })[]>([]);
  const [practiceBackView, setPracticeBackView] = useState<View>('dashboard');
  const [practiceInitLoading, setPracticeInitLoading] = useState(false);
  const [practiceInitMessage, setPracticeInitMessage] = useState('');
  const [practiceLoadProgress, setPracticeLoadProgress] = useState<{ loaded: number; total: number | null }>({ loaded: 0, total: null });
  const topicPracticeRequestRef = useRef(0);
  const explanationCacheRef = useRef<Record<string, string>>({});
  const explanationInFlightRef = useRef<Record<string, Promise<string | null>>>({});

  // ── Mock Exam ───────────────────────────────────────────────────────────────
  const [examSession, setExamSession] = useState<ExamSession | null>(null);
  const [examTimer, setExamTimer] = useState(0);

  // ── Dark Mode ───────────────────────────────────────────────────────────────
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('pyq_theme') === 'dark');
  const toggleDarkMode = () => setDarkMode(d => {
    const next = !d;
    document.documentElement.classList.toggle('dark', next);
    document.documentElement.classList.toggle('light', !next);
    localStorage.setItem('pyq_theme', next ? 'dark' : 'light');
    return next;
  });

  // ── Admin ───────────────────────────────────────────────────────────────────
  const [isAdmin, setIsAdmin] = useState(() => localStorage.getItem('pyq_admin') === '1');
  const [renameModal, setRenameModal] = useState<{ fullName: string; year: number } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  const [deleteExamTarget, setDeleteExamTarget] = useState<{ fullName: string; year: number } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [costModal, setCostModal] = useState(false);
  const [costLog, setCostLog] = useState<{ runs: any[]; total_inr: number } | null>(null);
  const [costExpanded, setCostExpanded] = useState<number | null>(null);
  const [editQuestion, setEditQuestion] = useState<Question | null>(null);
  const [uploadModal, setUploadModal] = useState(false);

  // ── Report / Chat ───────────────────────────────────────────────────────────
  const [reportData, setReportData] = useState<any | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'model'; text: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  // ── Effects ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => { setUser(u); setAuthLoading(false); });
    return unsub;
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    document.documentElement.classList.toggle('light', !darkMode);
  }, [darkMode]);

  useEffect(() => { fetchData(); }, [user]);

  useEffect(() => {
    if (!examSession || examSession.isFinished || examTimer <= 0) return;
    const iv = setInterval(() => setExamTimer(p => { if (p <= 1) { finishExam(); return 0; } return p - 1; }), 1000);
    return () => clearInterval(iv);
  }, [examSession, examTimer]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const toggleAdmin = () => {
    const next = !isAdmin;
    setIsAdmin(next);
    localStorage.setItem('pyq_admin', next ? '1' : '0');
  };

  const openCostModal = async () => {
    setCostModal(true);
    setCostLog(null);
    try {
      const res = await fetch(`${API_BASE}/admin/cost-log`, { headers: adminHeaders() });
      if (!res.ok) throw new Error(await res.text());
      setCostLog(await res.json());
    } catch {
      setCostLog({ runs: [], total_inr: 0 });
    }
  };

  const doRename = async () => {
    if (!renameModal || !renameValue.trim()) return;
    setRenameBusy(true);
    try {
      const params = new URLSearchParams({ old_name: renameModal.fullName, new_name: renameValue.trim(), exam_year: String(renameModal.year) });
      const res = await fetch(`${API_BASE}/admin/rename-exam?${params}`, { method: 'PATCH', headers: adminHeaders() });
      if (!res.ok) throw new Error(await res.text());
      await fetchData();
      setRenameModal(null);
    } catch (e: any) {
      alert('Rename failed: ' + e.message);
    } finally {
      setRenameBusy(false);
    }
  };

  const doDeleteExam = async () => {
    if (!deleteExamTarget) return;
    setDeleteBusy(true);
    try {
      const params = new URLSearchParams({ exam_name: deleteExamTarget.fullName, exam_year: String(deleteExamTarget.year) });
      const res = await fetch(`${API_BASE}/admin/delete-exam?${params}`, { method: 'DELETE', headers: adminHeaders() });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      alert(`Deleted ${data.removed} questions for ${deleteExamTarget.fullName} ${deleteExamTarget.year}`);
      setDeleteExamTarget(null);
      await fetchData();
    } catch (e: any) {
      alert('Delete failed: ' + e.message);
    } finally {
      setDeleteBusy(false);
    }
  };

  const doAddBlankQuestion = async (examName: string, year: number, forcedNum?: number) => {
    try {
      const existing = examCache[`${examName}::${year}`] ?? [];
      const nextNum = forcedNum ?? (existing.length ? Math.max(...existing.map((q: Question) => q.question_number || 0)) + 1 : 1);
      
      const newQ = {
        exam_name: examName,
        exam_year: year,
        question_number: nextNum,
        question_text: `[Placeholder for Question #${nextNum} - Missing Figure/Calculation]`,
        option_a: 'Option 1',
        option_b: 'Option 2',
        option_c: 'Option 3',
        option_d: 'Option 4',
        correct_answer: 'A',
        is_active: true,
        needs_review: true // Mark as needing review so it shows up in Audit
      };
      
      const res = await fetch(`${API_BASE}/admin/add-blank-question`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...adminHeaders() },
        body: JSON.stringify(newQ)
      });
      if (!res.ok) throw new Error(await res.text());
      
      fetchData();
    } catch (e: any) {
      alert("Failed to add question: " + e.message);
    }
  };

  const doDeleteQuestion = async (questionId: string) => {
    if (!window.confirm("Are you sure you want to delete this question? This cannot be undone.")) return;
    try {
      const res = await fetch(`${API_BASE}/admin/questions/${questionId}`, {
        method: 'DELETE',
        headers: adminHeaders()
      });
      if (!res.ok) throw new Error(await res.text());
      
      setExamCache(prev => {
        const key = `${selectedExamName}::${selectedYear}`;
        return key in prev ? { ...prev, [key]: prev[key].filter((q: Question) => q.id !== questionId) } : prev;
      });
      setQuestionsMeta(prev => prev.filter(m => m.id !== questionId));
    } catch (e: any) {
      alert("Failed to delete question: " + e.message);
    }
  };

  const handleLogin = async () => {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch (err: any) {
      if (['auth/unauthorized-domain', 'auth/popup-blocked', 'auth/popup-closed-by-user'].includes(err.code))
        if (window.confirm(`Google Sign-In failed.\n\nContinue as Guest?`))
          setUser({ uid: 'guest', displayName: 'Guest User', email: 'guest@localhost', photoURL: null } as any);
    }
  };

  const handleLogout = async () => { try { await signOut(auth); } catch { } setUser(null); };

  const mapQuestion = (q: any): Question => ({
    id: q.id,
    question: q.question_text ?? q.question ?? '',
    question_number: q.question_number,
    options: q.options ?? { A: q.option_a ?? '', B: q.option_b ?? '', C: q.option_c ?? '', D: q.option_d ?? '' },
    answer: q.correct_answer ?? q.answer ?? '',
    explanation: q.explanation ?? '',
    subject: normalizeSubject(q.subject ?? ''),
    topic: q.topic ?? '',
    subtopic: q.subtopic ?? '',
    difficulty: q.difficulty ?? 'Medium',
    concept: q.concept ?? '',
    type: q.question_type ?? q.type ?? '',
    year: q.exam_year ?? q.year ?? 0,
    exam: q.exam_name ?? q.exam ?? '',
    passage: q.passage ?? '',
    shift: q.shift_label ?? '',
    has_image: q.has_image ?? false,
    image_url: q.image_url ?? undefined,
  });

  const saveAttempt = async (attempt: {
    questionId: string;
    selectedAnswer: string;
    isCorrect: boolean;
    timeTakenSeconds?: number | null;
    examName?: string;
    subject?: string;
  }) => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;

    try {
      const token = await currentUser.getIdToken();
      await fetch(`${API_BASE}/attempt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          question_id: attempt.questionId,
          selected_answer: attempt.selectedAnswer,
          is_correct: attempt.isCorrect,
          time_taken_seconds: attempt.timeTakenSeconds ?? null,
          exam_name: attempt.examName ?? null,
          subject: attempt.subject ?? null,
        }),
      });
    } catch (error) {
      console.error('Attempt save failed:', error);
    }
  };

  const persistMockAttempts = async (session: ExamSession) => {
    if (!auth.currentUser) return;

    const entries = Object.entries(session.answers);
    if (!entries.length) return;

    await Promise.allSettled(
      entries.map(async ([index, selected]) => {
        const question = session.questions[Number(index)];
        if (!question?.id || !selected) return;
        const isCorrect = selected === question.answer;
        await saveAttempt({
          questionId: question.id,
          selectedAnswer: selected,
          isCorrect,
          timeTakenSeconds: null,
          examName: session.examName,
          subject: question.subject,
        });
      })
    );
  };

  const fetchData = async () => {
    if (!user) return;
    setDataLoading(true);
    try {
      const res = isAdmin
        ? await fetch(`${API_BASE}/admin/questions-meta?is_active=true`, { headers: adminHeaders() })
        : await fetch(`${API_BASE}/questions/meta`);
      if (res.ok) {
        const data = await res.json();
        const rows = data.questions || [];
        setQuestionsMeta(rows.map((q: any) => ({
          id: q.id,
          exam: q.exam_name ?? q.exam ?? '',
          year: q.exam_year ?? q.year ?? 0,
          subject: normalizeSubject(q.subject ?? ''),
          topic: q.topic ?? '',
          subtopic: q.subtopic ?? '',
          difficulty: q.difficulty ?? 'Medium',
        })));
        setGlobalError(null);
        setDataLoading(false);
        if (isAdmin) {
          void (async () => {
            try {
              const reviewRes = await fetch(`${API_BASE}/admin/publish-readiness`, { headers: adminHeaders() });
              if (reviewRes.ok) {
                const reviewData = await reviewRes.json();
                setReviewPapers(
                  (reviewData.reports || [])
                    .filter((r: any) => !r.publishable)
                    .map((r: any) => ({
                      exam_name: r.exam_name,
                      exam_year: r.exam_year,
                      question_count: r.question_count,
                      reasons: r.reasons || [],
                    }))
                );
              } else {
                setReviewPapers([]);
              }
            } catch {
              setReviewPapers([]);
            }
          })();
        } else {
          setReviewPapers([]);
        }
      } else {
        setGlobalError('Backend returned an error. Check that uvicorn is running on port 8000.');
      }
    } catch {
      setGlobalError('Cannot reach backend on port 8000. Start it: cd backend && uvicorn main:app --reload --port 8000');
    } finally {
      setDataLoading(false);
    }
  };

  const loadExamQuestions = async (examName: string, year: number): Promise<Question[]> => {
    const key = `${examName}::${year}`;
    if (key in examCache) return examCache[key];
    setExamLoading(true);
    try {
      const pageSize = isAdmin ? 200 : 500;
      let offset = 0;
      let allRows: any[] = [];

      while (true) {
        const params = new URLSearchParams({
          exam_name: examName,
          exam_year: String(year),
          limit: String(pageSize),
          offset: String(offset),
        });
        if (isAdmin) {
          params.set('is_active', 'true');
        }
        const res = await fetch(
          isAdmin ? `${API_BASE}/admin/questions?${params}` : `${API_BASE}/questions?${params}`,
          isAdmin ? { headers: adminHeaders() } : undefined
        );
        if (!res.ok) throw new Error(`Failed to load questions (${res.status})`);
        const data = await res.json();
        const batch = data.questions || [];
        allRows = allRows.concat(batch);
        if (batch.length < pageSize) break;
        offset += pageSize;
      }

      const qs: Question[] = allRows
        .map(mapQuestion)
        .sort((a, b) => (a.question_number ?? 9999) - (b.question_number ?? 9999));
      setExamCache(prev => ({ ...prev, [key]: qs }));
      setGlobalError(null);
      return qs;
    } catch (e: any) {
      setGlobalError(`Could not load "${examName}" ${year}: ${e?.message || 'unknown error'}`);
      return [];
    } finally {
      setExamLoading(false);
    }
  };

  const startPractice = async (examName: string, year: number, subject = 'All', topic = 'All') => {
    topicPracticeRequestRef.current += 1;
    setPracticeInitLoading(false);
    setPracticeInitMessage('');
    setPracticeLoadProgress({ loaded: 0, total: null });
    const loaded = await loadExamQuestions(examName, year);
    let q = loaded;
    if (subject !== 'All') q = q.filter(x => x.subject === subject);
    if (topic !== 'All') q = q.filter(x => x.topic === topic);

    // Sort by question_number to keep DI groups (bar graph Q142-146) together
    // and preserve the paper's original sequence. Shuffle only when no
    // question_number is available (cross-exam / legacy questions).
    const hasNums = q.some(x => x.question_number);
    const sorted = hasNums
      ? [...q].sort((a, b) => (a.question_number ?? 999) - (b.question_number ?? 999))
      : [...q].sort(() => Math.random() - 0.5);

    setPracticeQueue(sorted); setPracticeIndex(0);
    setPracticeAnswered(false); setPracticeSelectedOption(null);
    setPracticeAnswerLoading(false);
    setPracticeExplanationLoading(false);
    setPracticeSubject(subject); setPracticeTopic(topic);
    practiceStartRef.current = Date.now();
    setPracticeSessionAnswers(new Array(sorted.length).fill(null));
    // Ensure exam context is set so Back → exam-detail always works
    setSelectedExamName(examName);
    setSelectedYear(year);
    const { commission, examType } = parseExamName(examName);
    setSelectedCommission(commission);
    setSelectedExamType(examType);
    // Remember which view launched practice so Back can return there
    setPracticeBackView(view);
    setView('practice');
  };

  const startTopicPractice = async (subject: string, topic: string) => {
    const requestId = ++topicPracticeRequestRef.current;
    const queueLabel = `${subject} :: ${topic}`;
    setSelectedExamName(queueLabel);
    setSelectedYear(0);
    setPracticeSubject(subject);
    setPracticeTopic(topic);
    setPracticeBackView(view);
    setPracticeQueue([]);
    setPracticeIndex(0);
    setPracticeAnswered(false);
    setPracticeSelectedOption(null);
    setPracticeAnswerLoading(false);
    setPracticeExplanationLoading(false);
    setPracticeSessionAnswers([]);
    setPracticeInitLoading(true);
    setPracticeInitMessage(`Preparing ${subject} -> ${topic} practice set...`);
    setPracticeLoadProgress({ loaded: 0, total: null });
    setGlobalError(null);
    setView('practice');

    try {
      let loadedCount = 0;
      let totalCount: number | null = null;
      let offset = 0;
      const initialPageSize = 20;
      const followupPageSize = 200;

      const fetchPage = async (pageOffset: number, pageSize: number) => {
        const params = new URLSearchParams({
          subject,
          topic,
          limit: String(pageSize),
          offset: String(pageOffset),
        });
        const url = isAdmin ? `${API_BASE}/admin/topic-questions?${params}` : `${API_BASE}/topic-questions?${params}`;
        const res = await fetch(url, isAdmin ? { headers: adminHeaders() } : undefined);
        if (!res.ok) throw new Error(`Failed to load topic questions (${res.status})`);
        return res.json();
      };

      const slowLoadTimer = window.setTimeout(() => {
        if (topicPracticeRequestRef.current === requestId) {
          setPracticeInitMessage(`Still loading ${subject} -> ${topic}... opening the first questions as soon as they arrive.`);
        }
      }, 800);

      const firstPage = await fetchPage(0, initialPageSize);
      if (topicPracticeRequestRef.current !== requestId) return;
      window.clearTimeout(slowLoadTimer);

      totalCount = typeof firstPage.total === 'number' ? firstPage.total : null;
      const initialRows = (firstPage.questions || []).map(mapQuestion);
      loadedCount = initialRows.length;

      setPracticeQueue(initialRows);
      practiceStartRef.current = Date.now();
      setPracticeSessionAnswers(new Array(initialRows.length).fill(null));
      setPracticeLoadProgress({ loaded: loadedCount, total: totalCount });

      if (!initialRows.length) {
        setPracticeInitLoading(false);
        setGlobalError(`No questions found for ${subject} → ${topic}.`);
        return;
      }

      setPracticeInitMessage(`Loaded first ${loadedCount} questions. Loading the rest in the background...`);
      offset += initialPageSize;
      while (totalCount !== null && loadedCount < totalCount) {
        const page = await fetchPage(offset, followupPageSize);
        if (topicPracticeRequestRef.current !== requestId) return;
        const batch = (page.questions || []).map(mapQuestion);
        if (!batch.length) break;

        let appendedCount = 0;
        setPracticeQueue(prev => {
          const seen = new Set(prev.map(item => item.id));
          const fresh = batch.filter(item => !seen.has(item.id));
          appendedCount = fresh.length;
          return fresh.length ? [...prev, ...fresh] : prev;
        });
        loadedCount += appendedCount;
        if (appendedCount > 0) {
          setPracticeSessionAnswers(prev => [...prev, ...new Array(appendedCount).fill(null)]);
        }
        setPracticeLoadProgress({ loaded: Math.min(totalCount, loadedCount), total: totalCount });
        setPracticeInitMessage(`Loading the remaining ${Math.max(totalCount - loadedCount, 0)} questions in the background...`);

        offset += followupPageSize;
        if (!page.has_more) break;
      }

      if (topicPracticeRequestRef.current !== requestId) return;
      setPracticeInitLoading(false);
      setPracticeInitMessage('');
      setPracticeLoadProgress({ loaded: totalCount ?? loadedCount, total: totalCount ?? loadedCount });
    } catch (e: any) {
      if (topicPracticeRequestRef.current !== requestId) return;
      setPracticeInitLoading(false);
      setGlobalError(`Could not start practice for ${subject} → ${topic}: ${e?.message || 'unknown error'}`);
    }
  };

  const currentPracticeQ = practiceQueue[practiceIndex] ?? null;

  const updatePracticeQuestion = (questionId: string, patch: Partial<Question>) => {
    setPracticeQueue(prev => prev.map(item => (item.id === questionId ? { ...item, ...patch } : item)));
  };

  const fetchQuestionAnswer = async (questionId: string): Promise<string | null> => {
    const questionUrl = isAdmin ? `${API_BASE}/admin/questions/${questionId}` : `${API_BASE}/questions/${questionId}`;
    const res = await fetch(questionUrl, isAdmin ? { headers: adminHeaders() } : undefined);
    if (!res.ok) return null;
    const data = await res.json();
    const answer = (data.correct_answer ?? data.answer ?? '').toString().trim().toUpperCase();
    return ['A', 'B', 'C', 'D'].includes(answer) ? answer : null;
  };

  const fetchExplanationForQuestion = async (
    questionId: string,
    options?: { background?: boolean; revealedAnswer?: string }
  ): Promise<string | null> => {
    const existing = practiceQueue.find(item => item.id === questionId);
    if (existing?.explanation && existing.explanation.length > 5) {
      explanationCacheRef.current[questionId] = existing.explanation;
      return existing.explanation;
    }

    if (explanationCacheRef.current[questionId]) {
      const cachedExplanation = explanationCacheRef.current[questionId];
      updatePracticeQuestion(questionId, {
        explanation: cachedExplanation,
        ...(options?.revealedAnswer ? { answer: options.revealedAnswer } : {}),
      });
      return cachedExplanation;
    }

    if (explanationInFlightRef.current[questionId]) {
      return explanationInFlightRef.current[questionId];
    }

    const explanationUrl = isAdmin ? `${API_BASE}/admin/explanation/${questionId}` : `${API_BASE}/explanation/${questionId}`;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), options?.background ? 7000 : 12000);
    const promise = (async () => {
      try {
        const res = await fetch(explanationUrl, {
          ...(isAdmin ? { headers: adminHeaders() } : {}),
          signal: controller.signal,
        });
        if (!res.ok) return null;
        const data = await res.json();
        const explanation = typeof data.explanation === 'string' ? data.explanation.trim() : '';
        const verifiedAnswer = (data.verified_answer ?? options?.revealedAnswer ?? '').toString().trim().toUpperCase();
        const patch: Partial<Question> = {};
        if (['A', 'B', 'C', 'D'].includes(verifiedAnswer)) patch.answer = verifiedAnswer;
        if (explanation) {
          patch.explanation = explanation;
          explanationCacheRef.current[questionId] = explanation;
        }
        if (Object.keys(patch).length) {
          updatePracticeQuestion(questionId, patch);
        }
        return explanation || null;
      } catch {
        return null;
      } finally {
        window.clearTimeout(timeout);
        delete explanationInFlightRef.current[questionId];
      }
    })();

    explanationInFlightRef.current[questionId] = promise;
    return promise;
  };

  const handleAnswerSelect = async (key: string) => {
    if (!currentPracticeQ?.id || practiceAnswered || practiceAnswerLoading) return;
    const questionId = currentPracticeQ.id;
    const questionAtAnswerTime = currentPracticeQ;
    const answerIndex = practiceIndex;
    const startTime = practiceStartRef.current;
    const knownAnswer = (questionAtAnswerTime.answer || '').toString().trim().toUpperCase();
    const hasKnownAnswer = ['A', 'B', 'C', 'D'].includes(knownAnswer);
    setPracticeSelectedOption(key);
    setPracticeAnswerLoading(!hasKnownAnswer);
    setPracticeExplanationLoading(false);
    try {
      const answer = hasKnownAnswer ? knownAnswer : (await fetchQuestionAnswer(questionId)) || knownAnswer;
      if (answer) {
        updatePracticeQuestion(questionId, { answer });
      }
      setPracticeAnswered(true);
      // Track stats
      const correct = key === answer;
      setPracticeSessionAnswers(prev => {
        const n = [...prev];
        n[answerIndex] = { selected: key, correct };
        return n;
      });
      if (user) {
        const newStats = updateStats(user.uid, questionAtAnswerTime.subject, questionAtAnswerTime.topic, questionAtAnswerTime.question, correct, startTime);
        setUserStats(newStats);
      }
      await saveAttempt({
        questionId,
        selectedAnswer: key,
        isCorrect: correct,
        timeTakenSeconds: Math.max(1, Math.round((Date.now() - startTime) / 1000)),
        examName: questionAtAnswerTime.exam,
        subject: questionAtAnswerTime.subject,
      });
      const cachedExplanation = explanationCacheRef.current[questionId] || questionAtAnswerTime.explanation;
      if (!cachedExplanation || cachedExplanation.length <= 5) {
        setPracticeExplanationLoading(true);
        void fetchExplanationForQuestion(questionId, { revealedAnswer: answer }).finally(() => {
          setPracticeExplanationLoading(prev => (currentPracticeQ?.id === questionId ? false : prev));
        });
      }
    } catch {
      setPracticeAnswered(true);
    } finally {
      setPracticeAnswerLoading(false);
    }
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

  const jumpToPracticeQuestion = (i: number) => {
    setPracticeIndex(i);
    const ans = practiceSessionAnswers[i];
    if (ans) {
      setPracticeAnswered(true);
      setPracticeSelectedOption(ans.selected);
      const nextQuestion = practiceQueue[i];
      setPracticeExplanationLoading(Boolean(nextQuestion && (!nextQuestion.explanation || nextQuestion.explanation.length <= 5)));
    } else {
      setPracticeAnswered(false);
      setPracticeSelectedOption(null);
      setPracticeExplanationLoading(false);
    }
    practiceStartRef.current = Date.now();
  };

  useEffect(() => {
    if (view !== 'practice') return;
    const current = practiceQueue[practiceIndex];
    if (!current?.id) return;

    const timers: number[] = [];
    const queueForWarmup = [current, practiceQueue[practiceIndex + 1]].filter(Boolean) as Question[];
    queueForWarmup.forEach((item, idx) => {
      if (item.explanation && item.explanation.length > 5) return;
      if (explanationCacheRef.current[item.id]) return;
      timers.push(window.setTimeout(() => {
        void fetchExplanationForQuestion(item.id, { background: true });
      }, idx === 0 ? 250 : 1200));
    });

    return () => {
      timers.forEach(window.clearTimeout);
    };
  }, [view, practiceIndex, practiceQueue]);

  useEffect(() => {
    if (!practiceAnswered) {
      setPracticeExplanationLoading(false);
      return;
    }
    if (currentPracticeQ?.explanation && currentPracticeQ.explanation.length > 5) {
      setPracticeExplanationLoading(false);
    }
  }, [practiceAnswered, currentPracticeQ?.id, currentPracticeQ?.explanation]);

  const startMockExam = async (examName: string, year: number) => {
    const qs = await loadExamQuestions(examName, year);
    if (!qs.length) { setGlobalError('No questions found for this exam.'); return; }
    const duration = qs.length * 72;
    setExamSession({ questions: qs, currentIndex: 0, answers: {}, startTime: Date.now(), duration, isFinished: false, examName, year });
    setExamTimer(duration); setView('mock');
  };

  const finishExam = () => {
    if (examSession) {
      void persistMockAttempts(examSession);
      setExamSession({ ...examSession, isFinished: true });
      setView('results');
    }
  };

  const generateReport = async (examName: string, year: number) => {
    const targetQs = await loadExamQuestions(examName, year);
    if (!targetQs.length) { setReportError('No questions found.'); return; }
    setReportLoading(true); setReportError(null); setReportData(null); setChatMessages([]);
    try {
      const res = await fetch('/api/generate-report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions: targetQs.map(q => ({ question: q.question, options: q.options, answer: q.answer, subject: q.subject, topic: q.topic, subtopic: q.subtopic, difficulty: q.difficulty, concept: q.concept, type: q.type, year: q.year, exam: q.exam })), examName, year }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed'); }
      setReportData(await res.json());
    } catch (err: any) { setReportError(err.message); } finally { setReportLoading(false); }
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim() || !reportData || chatLoading) return;
    const userMsg = chatInput.trim(); setChatInput('');
    const msgs = [...chatMessages, { role: 'user' as const, text: userMsg }];
    setChatMessages(msgs); setChatLoading(true);
    try {
      const ctx = `Exam: ${reportData.examName} (${reportData.year}), ${reportData.totalQuestions} Qs. Subjects: ${reportData.subjectDistribution?.map((s: any) => `${s.subject}:${s.count}`).join(', ')}. Key Insights: ${reportData.keyInsights?.join('; ')}`;
      const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: msgs.map(m => ({ role: m.role, parts: [{ text: m.text }] })), reportContext: ctx }) });
      const data = await res.json();
      setChatMessages(prev => [...prev, { role: 'model', text: data.reply || 'No response.' }]);
    } catch (err: any) { setChatMessages(prev => [...prev, { role: 'model', text: `Error: ${err.message}` }]); }
    finally { setChatLoading(false); }
  };

  const browseWithFilters = (subject = 'All', topic = 'All', subtopic = 'All') => {
    setFilterSubject(subject); setFilterTopic(topic); setFilterSubtopic(subtopic); setSearchQuery('');
    setView('browse');
  };

  const openCommission = (commission: string) => { setSelectedCommission(commission); setView('commission'); };

  const openExam = (examName: string, commission: string, examType: string, preferredYear?: number) => {
    const { examType: et } = parseExamName(examName);
    const info = commissionMap[commission]?.[et] ?? commissionMap[commission]?.[examType];
    const latestYear = preferredYear ?? info?.years[0] ?? new Date().getFullYear();
    setSelectedCommission(commission);
    setSelectedExamName(examName);
    setSelectedExamType(examType);
    setSelectedYear(latestYear);
    setFilterSubject('All'); setSearchQuery('');
    setView('exam-detail');
  };

  // ── Computed ────────────────────────────────────────────────────────────────

  const commissionMap = useMemo(() => {
    type ExamInfo = { years: number[]; count: number; difficulty: Record<string, number>; fullName: string };
    const map: Record<string, Record<string, ExamInfo>> = {};
    questionsMeta.forEach(q => {
      const { commission, examType } = parseExamName(q.exam);
      if (!map[commission]) map[commission] = {};
      if (!map[commission][examType]) map[commission][examType] = { years: [], count: 0, difficulty: { Easy: 0, Medium: 0, Hard: 0 }, fullName: q.exam };
      const e = map[commission][examType];
      e.count++;
      if (!e.years.includes(q.year)) e.years.push(q.year);
      const d = q.difficulty as 'Easy' | 'Medium' | 'Hard';
      if (d in e.difficulty) e.difficulty[d]++;
    });
    Object.values(map).forEach(exams => Object.values(exams).forEach(e => e.years.sort((a, b) => b - a)));
    return map;
  }, [questionsMeta]);

  // Ensure fully loaded data for Browse / Detail views
  useEffect(() => {
    if (selectedExamName && selectedYear && (view === 'exam-detail' || view === 'browse')) {
      loadExamQuestions(selectedExamName, selectedYear);
    }
  }, [selectedExamName, selectedYear, view]);

  const examYearQs = useMemo(() =>
    examCache[`${selectedExamName}::${selectedYear}`] ?? [],
    [examCache, selectedExamName, selectedYear]
  );

  const weightage = useMemo((): WeightageItem[] => {
    const subMap: Record<string, { count: number; topics: Record<string, { count: number; subtopics: Record<string, number> }> }> = {};
    examYearQs.forEach(q => {
      const sub = q.subject || 'General';
      const top = q.topic || 'General';
      const sbt = q.subtopic || '';
      if (!subMap[sub]) subMap[sub] = { count: 0, topics: {} };
      subMap[sub].count++;
      if (!subMap[sub].topics[top]) subMap[sub].topics[top] = { count: 0, subtopics: {} };
      subMap[sub].topics[top].count++;
      if (sbt) subMap[sub].topics[top].subtopics[sbt] = (subMap[sub].topics[top].subtopics[sbt] || 0) + 1;
    });
    return Object.entries(subMap)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([subject, data]) => ({
        subject, count: data.count,
        pct: Math.round((data.count / examYearQs.length) * 100),
        topics: Object.entries(data.topics)
          .sort((a, b) => b[1].count - a[1].count)
          .map(([topic, td]) => ({
            topic, count: td.count,
            pct: Math.round((td.count / data.count) * 100),
            subtopics: Object.entries(td.subtopics)
              .sort((a, b) => b[1] - a[1])
              .map(([subtopic, count]) => ({ subtopic, count, pct: Math.round((count / td.count) * 100) })),
          })),
      }));
  }, [examYearQs]);

  const filteredQs = useMemo(() =>
    examYearQs.filter(q =>
      (q.question.toLowerCase().includes(searchQuery.toLowerCase()) || q.topic.toLowerCase().includes(searchQuery.toLowerCase())) &&
      (filterSubject === 'All' || q.subject === filterSubject) &&
      (filterTopic === 'All' || q.topic === filterTopic) &&
      (filterSubtopic === 'All' || q.subtopic === filterSubtopic)
    ),
    [examYearQs, searchQuery, filterSubject, filterTopic, filterSubtopic]
  );

  // ── Auth screens ────────────────────────────────────────────────────────────

  if (authLoading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--c-bg)' }}>
      <Loader2 style={{ width: 32, height: 32, color: '#2dd4bf' }} className="animate-spin" />
    </div>
  );

  if (!user) return (
    <div style={{ minHeight: '100vh', background: 'var(--c-bg)', fontFamily: "'DM Sans', system-ui, sans-serif", display: 'flex', flexDirection: 'column', color: 'var(--c-text)' }}>

      {/* Top nav */}
      <header style={{ borderBottom: `1px solid ${C.border}`, padding: '0 32px', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, background: C.surface2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 30, height: 30, border: `1.5px solid ${C.accent}40`, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.accentDim }}>
            <svg viewBox="0 0 14 14" fill="none" width="13" height="13">
              <path d="M7 1L12.5 4.25V10.75L7 14L1.5 10.75V4.25L7 1Z" stroke="#2dd4bf" strokeWidth="1.2" strokeLinejoin="round"/>
              <path d="M7 4L9.6 5.5V8.5L7 10L4.4 8.5V5.5L7 4Z" fill="#2dd4bf" opacity=".5"/>
            </svg>
          </div>
          <span style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 22, fontWeight: 600, color: C.text, letterSpacing: '-0.3px' }}>
            Pariksha
          </span>
        </div>
        <button
          onClick={toggleDarkMode}
          style={{ padding: '8px 12px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 13, color: C.textSec, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          {darkMode ? <Sun style={{ width: 13, height: 13 }} /> : <Moon style={{ width: 13, height: 13 }} />}
          {darkMode ? 'Light mode' : 'Dark mode'}
        </button>
      </header>

      {/* Hero */}
      <main style={{ flex: 1, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 420px', gap: 42, maxWidth: 1180, margin: '0 auto', padding: '42px 32px 32px', alignItems: 'start', width: '100%', boxSizing: 'border-box' }}>

        {/* Left: hero text */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <div style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", color: C.accent, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 28, height: 1, background: C.accent, display: 'inline-block' }} />
            India’s serious PYQ workspace
          </div>
          <h1 style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 56, fontWeight: 500, lineHeight: 1.02, letterSpacing: '-1.4px', color: C.text, marginBottom: 18, maxWidth: 640 }}>
            Previous year papers,
            structured for
            <span style={{ color: C.accent, display: 'block' }}>serious preparation.</span>
          </h1>
          <p style={{ fontSize: 17, color: C.textSec, lineHeight: 1.65, marginBottom: 22, maxWidth: 600 }}>
            Clean PYQ practice for UPSC, APPSC, and TSPSC with verified explanations, timed mocks, and revision-first structure.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 0.75fr', gap: 16, marginBottom: 26, maxWidth: 760 }}>
            <div className="surface-card" style={{ padding: '18px 18px', borderRadius: 18 }}>
              <div style={{ fontSize: 10, color: C.textTert, textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: "'DM Mono', monospace", marginBottom: 14 }}>
                Why serious aspirants stay
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                {[
                  { icon: 'PYQ', label: 'Verified question bank', detail: 'Structured papers from major commissions' },
                  { icon: 'AI', label: 'Answer-aligned explanations', detail: 'Generated only after answer checks' },
                  { icon: 'MOCK', label: 'Timed exam simulation', detail: 'Practice and mock workflows' },
                  { icon: 'DATA', label: 'Performance intelligence', detail: 'Track weak areas and progress' },
                ].map(({ icon, label, detail }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ minWidth: 40, height: 40, borderRadius: 11, background: C.accentDim, border: `1px solid ${C.accent}26`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', color: C.accent, fontFamily: "'DM Mono', monospace", flexShrink: 0 }}>{icon}</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{label}</div>
                      <div style={{ fontSize: 11, color: C.textTert, marginTop: 4, lineHeight: 1.5 }}>{detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="surface-card" style={{ padding: '18px 18px', borderRadius: 18 }}>
              <div style={{ fontSize: 10, color: C.textTert, textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: "'DM Mono', monospace", marginBottom: 14 }}>
                Platform edge
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[
                  ['Pattern-first', 'Designed for revision, not browsing PDFs'],
                  ['Topic intelligence', 'Move from subject to concept quickly'],
                  ['Clean delivery', 'Broken rows stay out of learner view'],
                ].map(([label, detail]) => (
                  <div key={label} style={{ paddingBottom: 12, borderBottom: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{label}</div>
                    <div style={{ fontSize: 11, color: C.textTert, marginTop: 4, lineHeight: 1.5 }}>{detail}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Stats strip */}
          <div style={{ display: 'flex', gap: 0, paddingTop: 18, borderTop: `1px solid ${C.border}`, flexWrap: 'wrap' }}>
            {[
              { num: '6,500+', label: 'Questions' },
              { num: '39', label: 'Papers' },
              { num: '6+', label: 'Years covered' },
              { num: '3', label: 'Core commissions' },
            ].map(({ num, label }) => (
              <div key={label} style={{ minWidth: 132, paddingRight: 18, marginRight: 18, borderRight: label !== 'Core commissions' ? `1px solid ${C.border}` : 'none' }}>
                <div style={{ fontSize: 24, fontFamily: "'Fraunces', Georgia, serif", fontWeight: 500, color: C.text, letterSpacing: '-0.5px' }}>{num}</div>
                <div style={{ fontSize: 10, color: C.textTert, fontFamily: "'DM Mono', monospace", marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Right: sign-in card */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 }}>
          <div className="surface-card" style={{ borderRadius: 24, padding: 28, boxShadow: 'var(--c-shadow-subtle)' }}>
            <div style={{ marginBottom: 26 }}>
              <div style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", color: C.accent, letterSpacing: '0.10em', textTransform: 'uppercase', marginBottom: 10 }}>
                Access your workspace
              </div>
              <div style={{ fontSize: 26, fontFamily: "'Fraunces', Georgia, serif", fontWeight: 500, color: C.text, marginBottom: 8, letterSpacing: '-0.4px' }}>
                Start your preparation hub
              </div>
              <div style={{ fontSize: 14, color: C.textSec, lineHeight: 1.6 }}>Sign in to save progress, resume mocks, and build a long-term preparation record across papers.</div>
            </div>

            <div style={{ padding: '14px 14px', borderRadius: 16, background: C.surface2, border: `1px solid ${C.border}`, marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 10, color: C.textTert, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: "'DM Mono', monospace" }}>Workspace preview</div>
                  <div style={{ fontSize: 15, color: C.text, fontWeight: 700, marginTop: 4 }}>Your preparation dashboard</div>
                </div>
                <div style={{ padding: '5px 8px', borderRadius: 999, background: C.accentDim, color: C.accent, fontSize: 10, fontWeight: 700 }}>Live after sign-in</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {[
                  ['Daily goal', '25Q'],
                  ['Accuracy', 'Tracked'],
                  ['Mocks', 'Resume'],
                  ['Reports', 'Ready'],
                ].map(([label, value]) => (
                  <div key={label} style={{ padding: '12px 12px', borderRadius: 12, background: C.surface, border: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: 10, color: C.textTert, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: "'DM Mono', monospace" }}>{label}</div>
                    <div style={{ fontSize: 16, color: C.text, fontWeight: 700, marginTop: 5 }}>{value}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  'Daily goals and streaks stay synced',
                  'Mock tests reopen from where you stopped',
                  'Reports and history stay attached to your account',
                ].map((item) => (
                  <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: C.textSec }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.accent, display: 'inline-block', flexShrink: 0 }} />
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={handleLogin}
              style={{ width: '100%', padding: '14px 0', background: C.accent, border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 700, color: '#0a1a18', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12, transition: 'opacity 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.opacity = '0.9'}
              onMouseLeave={e => e.currentTarget.style.opacity = '1'}
            >
              <LogIn style={{ width: 16, height: 16 }} /> Continue with Google
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0' }}>
              <div style={{ flex: 1, height: 1, background: C.border }} />
              <span style={{ fontSize: 11, color: C.textTert, fontFamily: "'DM Mono', monospace" }}>or</span>
              <div style={{ flex: 1, height: 1, background: C.border }} />
            </div>

            <button
              onClick={() => setUser({ uid: 'guest', displayName: 'Guest User', email: 'guest@localhost', photoURL: null } as any)}
              style={{ width: '100%', padding: '13px 0', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 12, fontSize: 14, fontWeight: 600, color: C.textSec, cursor: 'pointer', transition: 'all 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--c-border-l)'; e.currentTarget.style.color = C.text; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textSec; }}
            >
              Continue in Guest Mode
            </button>

            <p style={{ fontSize: 12, color: C.textTert, textAlign: 'center', marginTop: 18, lineHeight: 1.7 }}>
              Guest mode is fine for exploration, but it won’t save streaks, XP, reports, or long-term practice history.
            </p>

            <div style={{ marginTop: 18, paddingTop: 18, borderTop: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                'Structured by subject, topic, and concept family',
                'Designed for revision, not just browsing PDFs',
                'Built for UPSC and state PSC aspirants',
              ].map(item => (
                <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.textSec }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.accent, display: 'inline-block', flexShrink: 0 }} />
                  {item}
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </main>

      {/* Footer strip */}
      <footer style={{ borderTop: `1px solid ${C.border}`, padding: '14px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, background: C.surface2 }}>
        <span style={{ fontSize: 11, color: C.textTert, fontFamily: "'DM Mono', monospace" }}>
          Pariksha · PYQ intelligence for serious exam prep
        </span>
        <span style={{ fontSize: 11, color: C.textTert }}>
          Clean papers. Better revision. Stronger preparation.
        </span>
      </footer>
    </div>
  );

  // ── Main Render ─────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', height: '100vh', overflow: 'hidden', background: C.bg, color: C.text, fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      {showOnboarding && user && (
        <OnboardingModal
          userName={user.displayName ?? 'Aspirant'}
          onComplete={({ commissions, dailyGoal }) => {
            localStorage.setItem(`pyq_onboarded_${user.uid}`, '1');
            if (commissions.length > 0) localStorage.setItem(`pyq_commissions_${user.uid}`, JSON.stringify(commissions));
            if (dailyGoal) localStorage.setItem(`pyq_dailygoal_${user.uid}`, String(dailyGoal));
            setShowOnboarding(false);
          }}
        />
      )}
      <Navbar
        user={user}
        view={view}
        commissionMap={commissionMap}
        dataLoading={dataLoading}
        isAdmin={isAdmin}
        streak={userStats.streak}
        examDropdownOpen={examDropdownOpen}
        setExamDropdownOpen={setExamDropdownOpen}
        dropdownHoveredCommission={dropdownHoveredCommission}
        setDropdownHoveredCommission={setDropdownHoveredCommission}
        selectedCommission={selectedCommission}
        selectedExamType={selectedExamType}
        selectedYear={selectedYear}
        setView={setView}
        openCommission={openCommission}
        openExam={openExam}
        openCostModal={openCostModal}
        openUploadModal={() => setUploadModal(true)}
        openPatternDebug={() => setView('pattern-debug')}
        openPatternIngestion={() => setView('pattern-ingestion')}
        openPatternPractice={() => setView('pattern-practice')}
        toggleAdmin={toggleAdmin}
        handleLogout={handleLogout}
        darkMode={darkMode}
        toggleDarkMode={toggleDarkMode}
      />

      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Topbar */}
        <div style={{ height: 52, flexShrink: 0, background: C.bg, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 32px', gap: 20, zIndex: 10 }}>
          <div style={{ fontSize: 13, color: C.textSec, fontFamily: "'DM Mono', monospace" }}>
            {view === 'dashboard' || view === 'home'
              ? <span style={{ color: C.text, fontWeight: 500 }}>Dashboard</span>
              : <>
                  <span onClick={() => setView('dashboard')} style={{ cursor: 'pointer' }}>Dashboard</span>
                  <span style={{ margin: '0 6px', color: C.textTert }}>/</span>
                  <span style={{ color: C.text, fontWeight: 500, textTransform: 'capitalize' }}>{view.replace('-', ' ')}</span>
                </>
            }
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
            {dataLoading && <Loader2 style={{ width: 15, height: 15, color: C.accent }} className="animate-spin" />}
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>
      <AnimatePresence mode="wait">
        <motion.div key={view} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
          {(view === 'dashboard') && (
            <DashboardView
              user={user}
              questions={questionsMeta}
              commissionMap={commissionMap}
              stats={userStats}
              setView={setView}
              openCommission={openCommission}
              startPractice={startPractice}
            />
          )}
          {view === 'feed' && (
            <Suspense fallback={<ViewLoadingFallback label="Loading PYQ intelligence..." />}>
              <FeedView questions={questionsMeta} setView={setView} startPractice={startPractice} startTopicPractice={startTopicPractice} />
            </Suspense>
          )}
          {view === 'badges' && (
            <Suspense fallback={<ViewLoadingFallback label="Loading badges..." />}>
              <BadgesView stats={userStats} />
            </Suspense>
          )}
          {view === 'leaderboard' && (
            <Suspense fallback={<ViewLoadingFallback label="Loading leaderboard..." />}>
              <LeaderboardView stats={userStats} user={user} />
            </Suspense>
          )}
          {view === 'home' && (
            <HomeView
              questions={questionsMeta} commissionMap={commissionMap} dataLoading={dataLoading} isAdmin={isAdmin}
              reviewPapers={reviewPapers}
              openCommission={openCommission} openExam={openExam} startPractice={startPractice} startMockExam={startMockExam}
              setSelectedExamName={setSelectedExamName} setSelectedExamType={setSelectedExamType}
              setSelectedCommission={setSelectedCommission} setSelectedYear={setSelectedYear}
              setRenameModal={setRenameModal} setRenameValue={setRenameValue} setDeleteExamTarget={setDeleteExamTarget}
            />
          )}
          {view === 'commission' && (
            <CommissionView
              selectedCommission={selectedCommission} commissionMap={commissionMap} setView={setView}
              openExam={openExam} startPractice={startPractice} startMockExam={startMockExam}
              setSelectedExamName={setSelectedExamName} setSelectedExamType={setSelectedExamType} setSelectedYear={setSelectedYear}
            />
          )}
          {view === 'exam-detail' && (
            <Suspense fallback={<ViewLoadingFallback label="Loading exam details..." />}>
              <ExamDetailView
                selectedCommission={selectedCommission} selectedExamType={selectedExamType}
                selectedExamName={selectedExamName} selectedYear={selectedYear} setSelectedYear={setSelectedYear}
                commissionMap={commissionMap} examYearQs={examYearQs} weightage={weightage} questions={questionsMeta}
                examLoading={examLoading}
                startPractice={startPractice} startMockExam={startMockExam} browseWithFilters={browseWithFilters} setView={setView}
                isAdmin={isAdmin} setRenameModal={setRenameModal} setRenameValue={setRenameValue} setDeleteExamTarget={setDeleteExamTarget}
                doAddBlankQuestion={doAddBlankQuestion}
                doDeleteQuestion={doDeleteQuestion}
              />
            </Suspense>
          )}
          {view === 'practice' && (
            <Suspense fallback={<ViewLoadingFallback label="Loading practice workspace..." />}>
              <PracticeView
                practiceQueue={practiceQueue} practiceIndex={practiceIndex} practiceAnswered={practiceAnswered}
                practiceSelectedOption={practiceSelectedOption} practiceAnswerLoading={practiceAnswerLoading}
                practiceExplanationLoading={practiceExplanationLoading}
                practiceInitLoading={practiceInitLoading} practiceInitMessage={practiceInitMessage} practiceLoadProgress={practiceLoadProgress}
                practiceSubject={practiceSubject} practiceTopic={practiceTopic}
                selectedExamName={selectedExamName} selectedExamType={selectedExamType} selectedYear={selectedYear}
                questions={questionsMeta.filter(m => m.exam === selectedExamName && m.year === selectedYear)} currentPracticeQ={currentPracticeQ}
                isAdmin={isAdmin} setEditQuestion={setEditQuestion}
                handleAnswerSelect={handleAnswerSelect} nextPracticeQuestion={nextPracticeQuestion} prevPracticeQuestion={prevPracticeQuestion}
                jumpToPracticeQuestion={jumpToPracticeQuestion}
                startPractice={startPractice} setView={setView}
                sessionAnswers={practiceSessionAnswers}
                backView={practiceBackView}
              />
            </Suspense>
          )}
          {view === 'mock' && examSession && (
            <MockView examSession={examSession} setExamSession={setExamSession} examTimer={examTimer} finishExam={finishExam} />
          )}
          {view === 'results' && examSession && (
            <ResultsView
              examSession={examSession} examTimer={examTimer}
              startMockExam={startMockExam} setExamSession={setExamSession} setView={setView}
            />
          )}
          {view === 'browse' && (
            <Suspense fallback={<ViewLoadingFallback label="Loading question browser..." />}>
              <BrowseView
                examYearQs={examYearQs} filteredQs={filteredQs}
                selectedExamType={selectedExamType} selectedYear={selectedYear}
                filterSubject={filterSubject} filterTopic={filterTopic} filterSubtopic={filterSubtopic} searchQuery={searchQuery}
                setSearchQuery={setSearchQuery} setFilterSubject={setFilterSubject}
                setFilterTopic={setFilterTopic} setFilterSubtopic={setFilterSubtopic}
                setSelectedQuestion={setSelectedQuestion} setView={setView}
                isAdmin={isAdmin} setEditQuestion={setEditQuestion}
              />
            </Suspense>
          )}
          {view === 'report' && (
            <Suspense fallback={<ViewLoadingFallback label="Loading report..." />}>
              <ReportView
                selectedExamType={selectedExamType} selectedExamName={selectedExamName} selectedYear={selectedYear}
                examYearQs={examYearQs} reportData={reportData} reportLoading={reportLoading} reportError={reportError}
                chatMessages={chatMessages} chatInput={chatInput} setChatInput={setChatInput} chatLoading={chatLoading}
                generateReport={generateReport} sendChatMessage={sendChatMessage} setView={setView}
              />
            </Suspense>
          )}
          {view === 'pattern-debug' && isAdmin && (
            <Suspense fallback={<ViewLoadingFallback label="Loading pattern diagnostics..." />}>
              <PatternDebugView />
            </Suspense>
          )}
          {view === 'pattern-ingestion' && isAdmin && (
            <Suspense fallback={<ViewLoadingFallback label="Loading ingestion console..." />}>
              <PatternBookIngestionView />
            </Suspense>
          )}
          {view === 'pattern-practice' && (
            <Suspense fallback={<ViewLoadingFallback label="Loading pattern practice..." />}>
              <PatternPracticeView setView={setView} backView="dashboard" />
            </Suspense>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Global Error Toast */}
      <AnimatePresence>
        {globalError && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="fixed top-20 left-1/2 -translate-x-1/2 z-[100] w-full max-w-xl px-4">
            <div className="bg-rose-600 text-white p-4 rounded-2xl shadow-2xl flex items-center justify-between gap-4">
              <div className="flex items-center gap-3"><AlertCircle className="w-5 h-5 flex-shrink-0" /><p className="text-sm font-medium">{globalError}</p></div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={fetchData} disabled={dataLoading} className="px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 disabled:opacity-50">
                  {dataLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />} Retry
                </button>
                <button onClick={() => setGlobalError(null)} className="p-1 hover:bg-white/20 rounded-lg"><X className="w-4 h-4" /></button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Question Modal */}
      <AnimatePresence>
        {selectedQuestion && (
          <QuestionModal
            question={selectedQuestion}
            onClose={() => setSelectedQuestion(null)}
            onStartPractice={() => { setSelectedQuestion(null); startPractice(selectedExamName, selectedYear); }}
          />
        )}
      </AnimatePresence>
      </div>{/* end content scroll */}
      </div>{/* end column flex */}

      {/* Admin Modals */}
      {costModal && (
        <CostModal
          costLog={costLog}
          costExpanded={costExpanded}
          setCostExpanded={setCostExpanded}
          onClose={() => setCostModal(false)}
        />
      )}
      {deleteExamTarget && (
        <DeleteExamModal
          target={deleteExamTarget}
          busy={deleteBusy}
          onConfirm={doDeleteExam}
          onCancel={() => setDeleteExamTarget(null)}
        />
      )}
      {renameModal && (
        <RenameModal
          modal={renameModal}
          value={renameValue}
          onChange={setRenameValue}
          onConfirm={doRename}
          onCancel={() => setRenameModal(null)}
          busy={renameBusy}
        />
      )}
      {editQuestion && (
        <EditQuestionModal
          question={editQuestion}
          onClose={() => setEditQuestion(null)}
          onSaved={updated => {
            setExamCache(prev => {
              const key = `${updated.exam}::${updated.year}`;
              return key in prev ? { ...prev, [key]: prev[key].map((q: Question) => q.id === updated.id ? updated : q) } : prev;
            });
            setPracticeQueue(prev => prev.map(q => q.id === updated.id ? updated : q));
            setEditQuestion(null);
          }}
          onDeleted={deletedId => {
            setExamCache(prev => {
              const key = `${selectedExamName}::${selectedYear}`;
              return key in prev ? { ...prev, [key]: prev[key].filter((q: Question) => q.id !== deletedId) } : prev;
            });
            setQuestionsMeta(prev => prev.filter(m => m.id !== deletedId));
            setPracticeQueue(prev => prev.filter(q => q.id !== deletedId));
            setEditQuestion(null);
          }}
        />
      )}
      {uploadModal && (
        <UploadPaperModal
          onClose={() => setUploadModal(false)}
          onComplete={fetchData}
        />
      )}
    </div>
  );
}
