import { useState, useEffect, useRef, useMemo, lazy, Suspense } from "react";
import { API_BASE, adminHeaders } from "./lib/adminApi";
import { motion, AnimatePresence } from "motion/react";
import {
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut,
  User,
} from "firebase/auth";
import {
  LogIn,
  AlertCircle,
  Loader2,
  RotateCcw,
  X,
} from "lucide-react";
import { auth } from "./firebase";

import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { Navbar } from "./components/Navbar";
import { OnboardingModal } from "./components/OnboardingModal";
import { QuestionModal } from "./components/QuestionModal";
import { CostModal } from "./components/admin/CostModal";
import { DeleteExamModal } from "./components/admin/DeleteExamModal";
import { RenameModal } from "./components/admin/RenameModal";
import { EditQuestionModal } from "./components/admin/EditQuestionModal";
import { UploadPaperModal } from "./components/admin/UploadPaperModal";
import { FlagQuestionModal } from "./components/FlagQuestionModal";
import { PremiumGateModal } from "./components/PremiumGateModal";
import { AdminFlagsModal } from "./components/admin/AdminFlagsModal";
import { ToastProvider } from "./components/Toast";

import { DashboardView } from "./views/DashboardView";
import { HomeView } from "./views/HomeView";
import { CommissionView } from "./views/CommissionView";
import { MockView } from "./views/MockView";
import { ResultsView } from "./views/ResultsView";

const FeedView = lazy(() =>
  import("./views/FeedView").then((m) => ({ default: m.FeedView }))
);
const BadgesView = lazy(() =>
  import("./views/BadgesView").then((m) => ({ default: m.BadgesView }))
);
const LeaderboardView = lazy(() =>
  import("./views/LeaderboardView").then((m) => ({
    default: m.LeaderboardView,
  }))
);
const ExamDetailView = lazy(() =>
  import("./views/ExamDetailView").then((m) => ({ default: m.ExamDetailView }))
);
const PracticeView = lazy(() =>
  import("./views/PracticeView").then((m) => ({ default: m.PracticeView }))
);
const BrowseView = lazy(() =>
  import("./views/BrowseView").then((m) => ({ default: m.BrowseView }))
);
const ReportView = lazy(() =>
  import("./views/ReportView").then((m) => ({ default: m.ReportView }))
);
const PatternDebugView = lazy(() =>
  import("./views/PatternDebugView").then((m) => ({
    default: m.PatternDebugView,
  }))
);
const PatternBookIngestionView = lazy(() =>
  import("./views/PatternBookIngestionView").then((m) => ({
    default: m.PatternBookIngestionView,
  }))
);
const PatternPracticeView = lazy(() =>
  import("./views/PatternPracticeView").then((m) => ({
    default: m.PatternPracticeView,
  }))
);
const ProfileView = lazy(() =>
  import("./views/ProfileView").then((m) => ({ default: m.ProfileView }))
);
const BookmarksView = lazy(() =>
  import("./views/BookmarksView").then((m) => ({ default: m.BookmarksView }))
);

import { normalizeSubject } from "./lib/utils";
import { loadBookmarkMap, toggleBookmark, removeBookmark, clearBookmarks } from "./lib/bookmarks";
import { parseExamName } from "./lib/examUtils";
import {
  BLOCKED_EXPLANATION,
  UNAVAILABLE_EXPLANATION,
} from "./views/practice/practiceUtils";
import {
  canonicalConceptFamily,
  canonicalSubjectFamily,
  cleanBucketLabel,
  normalizeLooseLabel,
} from "./lib/topicTaxonomy";
import {
  getStats,
  updateStats,
  syncStatsToApi,
  type UserStats,
} from "./lib/stats";
import { C } from "./lib/tokens";
import {
  type CatalogSummary,
  type FeedSummary,
  type ExamOutline,
  type ExamPaperManifest,
  type Question,
  type View,
  type ExamSession,
  type WeightageItem,
  type PaginatedQuestionsResponse,
} from "./types/index";

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function ViewLoadingFallback({
  label = "Loading view...",
}: {
  label?: string;
}) {
  return (
    <div
      style={{
        minHeight: 320,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        className="glass-panel"
        style={{
          borderRadius: 18,
          padding: "22px 26px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          color: C.textSec,
        }}
      >
        <Loader2
          style={{
            width: 18,
            height: 18,
            color: C.accent,
            animation: "spin 1s linear infinite",
          }}
        />
        <div>
          <div style={{ fontSize: 14, color: C.text }}>{label}</div>
          <div style={{ fontSize: 12, color: C.textTert }}>
            Preparing the screen without blocking the rest of the app.
          </div>
        </div>
      </div>
    </div>
  );
}

function AppContent() {
  // ── Bookmarks ───────────────────────────────────────────────────────────────
  const [bookmarkMap, setBookmarkMap] = useState<Record<string, Question>>({});
  const bookmarkIdsRef = useRef<Set<string>>(new Set());

  // ── Premium / paywall ───────────────────────────────────────────────────────
  const [isPremium, setIsPremium] = useState(() => localStorage.getItem('pyq_premium') === '1');
  const [showPremiumModal, setShowPremiumModal] = useState(false);

  // ── Auth & Data ─────────────────────────────────────────────────────────────
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [catalogSummary, setCatalogSummary] = useState<CatalogSummary | null>(() => {
    try {
      const isAdmin = localStorage.getItem("pyq_admin") === "1";
      const cached = localStorage.getItem(isAdmin ? "catalog_summary_v12_admin" : "catalog_summary_v12_public");
      if (cached) return JSON.parse(cached).data;
    } catch {}
    return null;
  });
  const [feedSummary, setFeedSummary] = useState<FeedSummary | null>(() => {
    try {
      const isAdmin = localStorage.getItem("pyq_admin") === "1";
      const cached = localStorage.getItem(isAdmin ? "feed_summary_v12_admin" : "feed_summary_v12_public");
      if (cached) return JSON.parse(cached).data;
    } catch {}
    return null;
  });
  // Full question data per exam, loaded lazily when an exam is opened.
  // Key: "examName::year". Re-used on revisit — no redundant fetches.
  const [examCache, setExamCache] = useState<Record<string, Question[]>>({});
  const [examOutlineCache, setExamOutlineCache] = useState<
    Record<string, ExamOutline>
  >({});
  const [examPageState, setExamPageState] = useState<
    Record<
      string,
      {
        totalCount: number;
        hasMore: boolean;
        nextCursor: string | null;
        loading: boolean;
        error: string | null;
      }
    >
  >({});
  const [examLoading, setExamLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // ── Onboarding ───────────────────────────────────────────────────────────────
  const [showOnboarding, setShowOnboarding] = useState(false);

  // ── User Stats (localStorage) ────────────────────────────────────────────────
  const [userStats, setUserStats] = useState<UserStats>(() =>
    getStats("guest")
  );
  const practiceStartRef = useRef<number>(Date.now());

  // Reload stats when user changes; show onboarding for new users
  useEffect(() => {
    if (!user) {
      setUserStats(getStats("guest"));
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
        // Push any locally-accumulated stats up to Supabase on login
        syncStatsToApi(user.uid, localStats, token).catch(() => {});
        const res = await fetch(`${API_BASE}/user/stats`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const serverStats = await res.json();
        if (
          !cancelled &&
          serverStats.totalAnswered > localStats.totalAnswered
        ) {
          // Prefer server stats only when they have more data (cross-device)
          setUserStats({ ...localStats, ...serverStats });
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
  const [view, setView] = useState<View>("home");
  const [selectedCommission, setSelectedCommission] = useState("");
  const [selectedExamType, setSelectedExamType] = useState("");
  const [selectedExamName, setSelectedExamName] = useState("");
  const [selectedYear, setSelectedYear] = useState(0);
  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(null);
  const [selectedShiftLabel, setSelectedShiftLabel] = useState<string | null>(
    null
  );
  const [examPaperManifestCache, setExamPaperManifestCache] = useState<
    Record<string, ExamPaperManifest>
  >({});
  const [examPaperLoading, setExamPaperLoading] = useState(false);

  // ── Navbar Dropdown ─────────────────────────────────────────────────────────
  const [examDropdownOpen, setExamDropdownOpen] = useState(false);
  const [dropdownHoveredCommission, setDropdownHoveredCommission] =
    useState("");

  // ── Browse ──────────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [filterSubject, setFilterSubject] = useState("All");
  const [filterTopic, setFilterTopic] = useState("All");
  const [filterSubtopic, setFilterSubtopic] = useState("All");
  const [selectedQuestion, setSelectedQuestion] = useState<Question | null>(
    null
  );

  // ── Practice ────────────────────────────────────────────────────────────────
  const [practiceQueue, setPracticeQueue] = useState<Question[]>([]);
  const [practiceIndex, setPracticeIndex] = useState(0);
  const [practiceAnswered, setPracticeAnswered] = useState(false);
  const [practiceSelectedOption, setPracticeSelectedOption] = useState<
    string | null
  >(null);
  const [practiceAnswerLoading, setPracticeAnswerLoading] = useState(false);
  const [practiceExplanationLoading, setPracticeExplanationLoading] =
    useState(false);
  const [practiceSubject, setPracticeSubject] = useState("All");
  const [practiceTopic, setPracticeTopic] = useState("All");
  const [practicePaperId, setPracticePaperId] = useState<string | null>(null);
  const [practiceShiftLabel, setPracticeShiftLabel] = useState<string | null>(
    null
  );
  const [practiceHasMore, setPracticeHasMore] = useState(false);
  const [practiceNextCursor, setPracticeNextCursor] = useState<string | null>(
    null
  );
  const [practiceLoadMoreError, setPracticeLoadMoreError] = useState<
    string | null
  >(null);
  const [practiceBatchLoading, setPracticeBatchLoading] = useState(false);
  const [practiceSessionAnswers, setPracticeSessionAnswers] = useState<
    (null | { selected: string; correct: boolean })[]
  >([]);
  const [practiceBackView, setPracticeBackView] = useState<View>("dashboard");
  const [practiceInitLoading, setPracticeInitLoading] = useState(false);
  const [practiceInitMessage, setPracticeInitMessage] = useState("");
  const [practiceLoadProgress, setPracticeLoadProgress] = useState<{
    loaded: number;
    total: number | null;
  }>({ loaded: 0, total: null });
  const topicPracticeRequestRef = useRef(0);
  const examPageStateRef = useRef<
    Record<
      string,
      {
        totalCount: number;
        hasMore: boolean;
        nextCursor: string | null;
        loading: boolean;
        error: string | null;
      }
    >
  >({});
  const explanationCacheRef = useRef<Record<string, string>>({});
  const explanationInFlightRef = useRef<Record<string, Promise<string | null>>>(
    {}
  );
  const isRenderableExplanation = (text?: string | null) => {
    const value = (text || "").trim();
    return (
      value.length > 5 &&
      value !== BLOCKED_EXPLANATION &&
      value !== UNAVAILABLE_EXPLANATION &&
      !value.includes("[FLAG: verify answer]")
    );
  };
  const prefetchSessionRef = useRef(0); // incremented on each new practice session to cancel stale prefetch loops
  const mockPrefetchSessionRef = useRef(0);

  // ── Mock Exam ───────────────────────────────────────────────────────────────
  const [examSession, setExamSession] = useState<ExamSession | null>(null);
  const [examTimer, setExamTimer] = useState(0);
  const [mockBatchLoading, setMockBatchLoading] = useState(false);


  // ── Admin ───────────────────────────────────────────────────────────────────
  const [isAdmin, setIsAdmin] = useState(
    () => localStorage.getItem("pyq_admin") === "1"
  );
  const [renameModal, setRenameModal] = useState<{
    fullName: string;
    year: number;
  } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [deleteExamTarget, setDeleteExamTarget] = useState<{
    fullName: string;
    year: number;
  } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [costModal, setCostModal] = useState(false);
  const [costLog, setCostLog] = useState<{
    runs: any[];
    total_inr: number;
  } | null>(null);
  const [costExpanded, setCostExpanded] = useState<number | null>(null);
  const [editQuestion, setEditQuestion] = useState<Question | null>(null);
  const [uploadModal, setUploadModal] = useState(false);
  const [flagQuestion, setFlagQuestion] = useState<Question | null>(null);
  const [flagsModal, setFlagsModal] = useState(false);

  // ── Report / Chat ───────────────────────────────────────────────────────────
  const [reportData, setReportData] = useState<any | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<
    { role: "user" | "model"; text: string }[]
  >([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

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
      filters?.subject && filters.subject !== "All" ? filters.subject : "All";
    const topic =
      filters?.topic && filters.topic !== "All" ? filters.topic : "All";
    const subtopic =
      filters?.subtopic && filters.subtopic !== "All"
        ? filters.subtopic
        : "All";
    const paperId = filters?.paperId?.trim() || "ALL_PAPERS";
    const shiftLabel = filters?.shiftLabel?.trim() || "ALL_SHIFTS";
    return `${examName}::${year}::${paperId}::${shiftLabel}::${subject}::${topic}::${subtopic}`;
  };

  // ── Effects ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
      // Load bookmarks for this user from localStorage
      const uid = u?.uid ?? "guest";
      const map = loadBookmarkMap(uid);
      setBookmarkMap(map);
      bookmarkIdsRef.current = new Set(Object.keys(map));
    });
    return unsub;
  }, []);

  useEffect(() => {
    examPageStateRef.current = examPageState;
  }, [examPageState]);

  useEffect(() => {
    if (!practiceQueue.length) {
      if (practiceIndex !== 0) setPracticeIndex(0);
      return;
    }
    if (practiceIndex >= practiceQueue.length) {
      setPracticeIndex(practiceQueue.length - 1);
    }
  }, [practiceQueue, practiceIndex]);

  useEffect(() => {
    fetchData();
  }, [user]);

  // If meta never loaded (e.g. backend was down at login), retry whenever user navigates to a view that needs it.
  useEffect(() => {
    if (user && (!catalogSummary || !feedSummary) && !dataLoading) fetchData();
  }, [view]);

  useEffect(() => {
    if (!examSession || examSession.isFinished || examTimer <= 0) return;
    const iv = setInterval(
      () =>
        setExamTimer((p) => {
          if (p <= 1) {
            finishExam();
            return 0;
          }
          return p - 1;
        }),
      1000
    );
    return () => clearInterval(iv);
  }, [examSession, examTimer]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const toggleAdmin = () => {
    const next = !isAdmin;
    setIsAdmin(next);
    localStorage.setItem("pyq_admin", next ? "1" : "0");
  };

  const openCostModal = async () => {
    setCostModal(true);
    setCostLog(null);
    try {
      const res = await fetch(`${API_BASE}/admin/cost-log`, {
        headers: adminHeaders(),
      });
      if (!res.ok) throw new Error(await res.text());
      setCostLog(await res.json());
    } catch {
      setCostLog({ runs: [], total_inr: 0 });
    }
  };

  const invalidateMetaCache = () => {
    try {
      localStorage.removeItem(`questions_meta_v1_admin`);
      localStorage.removeItem(`questions_meta_v1_public`);
    } catch {
      /* ignore */
    }
  };

  const doRename = async () => {
    if (!renameModal || !renameValue.trim()) return;
    setRenameBusy(true);
    try {
      const params = new URLSearchParams({
        old_name: renameModal.fullName,
        new_name: renameValue.trim(),
        exam_year: String(renameModal.year),
      });
      const res = await fetch(`${API_BASE}/admin/rename-exam?${params}`, {
        method: "PATCH",
        headers: adminHeaders(),
      });
      if (!res.ok) throw new Error(await res.text());
      invalidateMetaCache();
      await fetchData();
      setRenameModal(null);
    } catch (e: any) {
      alert("Rename failed: " + e.message);
    } finally {
      setRenameBusy(false);
    }
  };

  const doDeleteExam = async () => {
    if (!deleteExamTarget) return;
    setDeleteBusy(true);
    try {
      const params = new URLSearchParams({
        exam_name: deleteExamTarget.fullName,
        exam_year: String(deleteExamTarget.year),
      });
      const res = await fetch(`${API_BASE}/admin/delete-exam?${params}`, {
        method: "DELETE",
        headers: adminHeaders(),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      alert(
        `Deleted ${data.removed} questions for ${deleteExamTarget.fullName} ${deleteExamTarget.year}`
      );
      setDeleteExamTarget(null);
      invalidateMetaCache();
      await fetchData();
    } catch (e: any) {
      alert("Delete failed: " + e.message);
    } finally {
      setDeleteBusy(false);
    }
  };

  const doAddBlankQuestion = async (
    examName: string,
    year: number,
    forcedNum?: number
  ) => {
    try {
      const existing = examCache[`${examName}::${year}`] ?? [];
      const nextNum =
        forcedNum ??
        (existing.length
          ? Math.max(...existing.map((q: Question) => q.question_number || 0)) +
            1
          : 1);

      const newQ = {
        exam_name: examName,
        exam_year: year,
        question_number: nextNum,
        question_text: `[Placeholder for Question #${nextNum} - Missing Figure/Calculation]`,
        option_a: "Option 1",
        option_b: "Option 2",
        option_c: "Option 3",
        option_d: "Option 4",
        correct_answer: "A",
        is_active: true,
        needs_review: true, // Mark as needing review so it shows up in Audit
      };

      const res = await fetch(`${API_BASE}/admin/add-blank-question`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...adminHeaders() },
        body: JSON.stringify(newQ),
      });
      if (!res.ok) throw new Error(await res.text());

      fetchData();
    } catch (e: any) {
      alert("Failed to add question: " + e.message);
    }
  };

  const reloadExamAndMeta = async (examName: string, year: number) => {
    const key = `${examName}::${year}`;
    // Clear both in-memory and localStorage caches so fresh data is fetched.
    try {
      localStorage.removeItem(`exam_qs_v1_admin_${key}`);
      localStorage.removeItem(`exam_qs_v1_pub_${key}`);
    } catch {
      /* ignore */
    }
    setExamCache((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    invalidateMetaCache();
    await fetchData();
    await loadExamQuestions(examName, year, true);
  };

  const updateExamCacheQuestion = (updated: Question) => {
    const key = `${updated.exam}::${updated.year}`;
    setExamCache((prev) => {
      const existing = prev[key];
      if (!existing) return prev;
      return {
        ...prev,
        [key]: existing.map((q) =>
          q.id === updated.id ? { ...q, ...updated } : q
        ),
      };
    });
  };

  const doDeleteQuestion = async (questionId: string) => {
    if (
      !window.confirm(
        "Are you sure you want to delete this question? This cannot be undone."
      )
    )
      return;
    try {
      const res = await fetch(`${API_BASE}/admin/questions/${questionId}`, {
        method: "DELETE",
        headers: adminHeaders(),
      });
      if (!res.ok) throw new Error(await res.text());
      await reloadExamAndMeta(selectedExamName, selectedYear);
    } catch (e: any) {
      alert("Failed to delete question: " + e.message);
    }
  };

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (err: any) {
      if (
        [
          "auth/unauthorized-domain",
          "auth/popup-blocked",
          "auth/popup-closed-by-user",
        ].includes(err.code)
      )
        if (window.confirm(`Google Sign-In failed.\n\nContinue as Guest?`))
          setUser({
            uid: "guest",
            displayName: "Guest User",
            email: "guest@localhost",
            photoURL: null,
          } as any);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch {}
    setUser(null);
  };

  const mapQuestion = (q: any): Question => ({
    id: q.id,
    question: q.question_text ?? q.question ?? "",
    question_number: q.question_number,
    options: q.options ?? {
      A: q.option_a ?? "",
      B: q.option_b ?? "",
      C: q.option_c ?? "",
      D: q.option_d ?? "",
    },
    answer: q.correct_answer ?? q.answer ?? "",
    explanation: q.explanation ?? "",
    source: q.source ?? undefined,
    flag_count: q.flag_count ?? undefined,
    subject: normalizeSubject(q.subject ?? ""),
    topic: q.topic ?? "",
    subtopic: q.subtopic ?? "",
    difficulty: q.difficulty ?? "Medium",
    concept: q.concept ?? "",
    type: q.question_type ?? q.type ?? "",
    year: q.exam_year ?? q.year ?? 0,
    exam: q.exam_name ?? q.exam ?? "",
    passage: q.passage ?? "",
    shift: q.shift_label ?? "",
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
        method: "POST",
        headers: {
          "Content-Type": "application/json",
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
      console.error("Attempt save failed:", error);
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

  const CATALOG_CACHE_KEY = isAdmin
    ? "catalog_summary_v12_admin"
    : "catalog_summary_v12_public";
  const FEED_CACHE_KEY = isAdmin
    ? "feed_summary_v12_admin"
    : "feed_summary_v12_public";

  const fetchData = async () => {
    if (!user) return;

    setDataLoading(true);
    try {
      const catalogUrl = isAdmin
        ? `${API_BASE}/admin/meta/catalog`
        : `${API_BASE}/meta/catalog`;
      const feedUrl = isAdmin
        ? `${API_BASE}/admin/meta/feed`
        : `${API_BASE}/meta/feed`;
      const adminOpts = isAdmin ? { headers: adminHeaders() } : undefined;
      const [catalogRes, feedRes] = await Promise.all([
        fetch(catalogUrl, adminOpts),
        fetch(feedUrl, adminOpts),
      ]);
      if (catalogRes.ok && feedRes.ok) {
        const [catalogData, feedData] = await Promise.all([
          catalogRes.json(),
          feedRes.json(),
        ]);
        setCatalogSummary(catalogData);
        setFeedSummary(feedData);
        try {
          localStorage.setItem(
            CATALOG_CACHE_KEY,
            JSON.stringify({ data: catalogData, ts: Date.now() })
          );
        } catch {}
        try {
          localStorage.setItem(
            FEED_CACHE_KEY,
            JSON.stringify({ data: feedData, ts: Date.now() })
          );
        } catch {}
        setGlobalError(null);
        setDataLoading(false);
      } else {
        setGlobalError(
          "Backend returned an error. Check that uvicorn is running on port 8000."
        );
      }
    } catch {
      setGlobalError(
        "Cannot reach backend on port 8000. Start it: cd backend && uvicorn main:app --reload --port 8000"
      );
    } finally {
      setDataLoading(false);
    }
  };

  const loadExamPapers = async (
    examName: string,
    year: number,
    forceReload = false
  ): Promise<ExamPaperManifest | null> => {
    const key = `${examName}::${year}`;
    if (!forceReload && examPaperManifestCache[key]) {
      return examPaperManifestCache[key];
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
    try {
      const params = new URLSearchParams({
        exam_name: examName,
        exam_year: String(year),
      });
      if (selector?.paperId) params.set("paper_id", selector.paperId);
      if (selector?.shiftLabel) params.set("shift_label", selector.shiftLabel);
      const res = await fetch(`${API_BASE}/meta/exam-outline?${params}`);
      if (!res.ok)
        throw new Error(`Failed to load exam outline (${res.status})`);
      const data: ExamOutline = await res.json();
      setExamOutlineCache((prev) => ({ ...prev, [key]: data }));
      return data;
    } catch {
      return null;
    }
  };

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
    const pageSize = opts?.pageSize ?? (!isAdmin ? 10 : 250);
    const reset = opts?.reset ?? false;
    const currentPageState = examPageState[key];
    const nextCursor = reset ? null : currentPageState?.nextCursor || null;
    if (!reset && currentPageState?.loading) return examCache[key] || [];
    if (!reset && currentPageState && !currentPageState.hasMore)
      return examCache[key] || [];

    setExamPageState((prev) => ({
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
      if (opts?.subject && opts.subject !== "All")
        params.set("subject", opts.subject);
      if (opts?.topic && opts.topic !== "All") params.set("topic", opts.topic);
      if (opts?.subtopic && opts.subtopic !== "All")
        params.set("subtopic", opts.subtopic);
      if (resolvedPaperId) params.set("paper_id", resolvedPaperId);
      if (resolvedShiftLabel) params.set("shift_label", resolvedShiftLabel);
      params.set("limit", String(pageSize));
      if (nextCursor) params.set("cursor", nextCursor);

      const res = await fetch(
        `${API_BASE}/questions?${params}`
      );
      if (!res.ok) throw new Error(`Failed to load questions (${res.status})`);
      const data: any = await res.json();
      const batch = (data.questions || []).map(mapQuestion);
      const merged = mergeExamQuestions(key, batch, reset);
      setExamCache((prev) => ({ ...prev, [key]: merged }));
      setExamPageState((prev) => ({
        ...prev,
        [key]: {
          totalCount: data.total_count ?? data.total ?? merged.length,
          hasMore: Boolean(data.has_more),
          nextCursor: data.next_cursor ?? null,
          loading: false,
          error: null,
        },
      }));
      setGlobalError(null);
      return merged;
    } catch (e: any) {
      setExamPageState((prev) => ({
        ...prev,
        [key]: {
          totalCount: prev[key]?.totalCount || 0,
          hasMore: prev[key]?.hasMore ?? true,
          nextCursor: prev[key]?.nextCursor ?? null,
          loading: false,
          error: e?.message || "unknown error",
        },
      }));
      setGlobalError(
        `Could not load "${examName}" ${year}: ${e?.message || "unknown error"}`
      );
      return examCache[key] || [];
    }
  };

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
    if (opts?.subject && opts.subject !== "All") params.set("subject", opts.subject);
    if (opts?.topic && opts.topic !== "All") params.set("topic", opts.topic);
    if (opts?.subtopic && opts.subtopic !== "All") params.set("subtopic", opts.subtopic);
    if (opts?.paperId) params.set("paper_id", opts.paperId);
    if (opts?.shiftLabel) params.set("shift_label", opts.shiftLabel);
    if (opts?.cursor) params.set("cursor", opts.cursor);

    const res = await fetch(`${API_BASE}/questions?${params}`);
    if (!res.ok) throw new Error(`Failed to load questions (${res.status})`);
    const data: any = await res.json();
    return {
      rows: (data.questions || []).map(mapQuestion),
      totalCount: data.total_count ?? data.total ?? 0,
      hasMore: Boolean(data.has_more),
      nextCursor: data.next_cursor ?? null,
    };
  };

  const requestTopicPracticePage = async (
    subject: string,
    topic: string,
    opts?: {
      pageSize?: number;
      offset?: number;
    }
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
    const url = isAdmin
      ? `${API_BASE}/admin/topic-questions?${params}`
      : `${API_BASE}/topic-questions?${params}`;
    const res = await fetch(url, isAdmin ? { headers: adminHeaders() } : undefined);
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
      setExamCache((prev) => ({ ...prev, [key]: [] }));
      setExamPageState((prev) => ({
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
      await loadExamOutline(examName, year, forceReload, {
        paperId: resolvedPaperId,
        shiftLabel: resolvedShiftLabel,
      });
      return await fetchExamChunk(examName, year, {
        forceReload,
        pageSize: !isAdmin ? 20 : 250,
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
            pageSize: !isAdmin ? 20 : 250,
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
    const targetCount =
      examOutlineCache[key]?.total_count ||
      examPageStateRef.current[key]?.totalCount ||
      current.length;
    let guard = 0;
    while (
      current.length < targetCount &&
      examPageStateRef.current[key]?.hasMore &&
      guard < 100
    ) {
      current = await loadMoreExamQuestions(
        examName,
        year,
        !isAdmin ? 25 : 250,
        filters
      );
      guard += 1;
    }
    return current;
  };

  const refreshPracticeQueueFromExam = (
    rows: Question[],
    subject: string,
    topic: string
  ) => {
    let q = rows;
    if (subject !== "All") q = q.filter((x) => x.subject === subject);
    if (topic !== "All") q = q.filter((x) => x.topic === topic);
    const hasNums = q.some((x) => x.question_number);
    const sorted = hasNums
      ? [...q].sort(
          (a, b) => (a.question_number ?? 999) - (b.question_number ?? 999)
        )
      : [...q];
    setPracticeQueue(sorted);
    setPracticeLoadProgress({
      loaded: sorted.length,
      total:
        examPageStateRef.current[
          buildQuestionSetKey(selectedExamName, selectedYear, {
            subject,
            topic,
            paperId: practicePaperId,
            shiftLabel: practiceShiftLabel,
          })
        ]?.totalCount || sorted.length,
    });
  };

  const updateExamSessionQuestion = (
    questionId: string,
    patch: Partial<Question>
  ) => {
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

  const fetchBatchExplanations = async (
    questionIds: string[]
  ): Promise<Record<string, string>> => {
    const url = `${API_BASE}/explanations/batch`;
    const merged: Record<string, string> = {};
    for (let i = 0; i < questionIds.length; i += 50) {
      const chunk = questionIds.slice(i, i + 50);
      if (!chunk.length) continue;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
    const singleUrl = (id: string) =>
      `${API_BASE}/explanation/${id}`;
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

    const fetchSingle = async (id: string): Promise<string | null> => {
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
          });
          if (!res.ok) return null;
          const data = await res.json();
          const explanation = (
            typeof data.explanation === "string" ? data.explanation : ""
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
      try {
        const batch = await fetchBatchExplanations(work);
        if (!isActiveSession()) return;
        Object.entries(batch).forEach(([id, explanation]) =>
          hydrate(id, explanation)
        );
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
        await Promise.allSettled(group.map(fetchSingle));
        if (i + 8 < stillMissing.length) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    })();
  };

  // Prefetch strategy: batch-first.
  // Phase 1 — one request fetches ALL already-generated explanations for the queue.
  // Phase 2 — any gaps (not yet generated) are filled with parallel individual fetches in groups of 8.
  // Cancelled automatically when a new session starts (sessionId check).
  const prefetchExplanations = (queue: Question[], sessionId: number) => {
    warmQuestionExplanations(queue, {
      sessionId,
      onHydrate: (id, explanation) =>
        updatePracticeQuestion(id, { explanation }),
    });
  };

  const startPractice = async (
    examName: string,
    year: number,
    subject = "All",
    topic = "All"
  ) => {
    topicPracticeRequestRef.current += 1;
    setPracticeInitLoading(false);
    setPracticeInitMessage("");
    setPracticeLoadProgress({ loaded: 0, total: null });
    const selector = await resolvePaperSelector(examName, year);
    const outline = await loadExamOutline(examName, year, false, selector);
    const filters = { subject, topic };
    const firstPage = await requestExamPage(examName, year, {
      pageSize: 20,
      ...filters,
      ...selector,
    });
    let q = firstPage.rows;
    if (subject !== "All") q = q.filter((x) => x.subject === subject);
    if (topic !== "All") q = q.filter((x) => x.topic === topic);
    q = q.filter((x) => !bookmarkIdsRef.current.has(x.id));

    // Sort by question_number to keep DI groups (bar graph Q142-146) together
    // and preserve the paper's original sequence. Shuffle only when no
    // question_number is available (cross-exam / legacy questions).
    const hasNums = q.some((x) => x.question_number);
    const sorted = hasNums
      ? [...q].sort(
          (a, b) => (a.question_number ?? 999) - (b.question_number ?? 999)
        )
      : [...q].sort(() => Math.random() - 0.5);
    const initialBatch = sorted.slice(0, 20);

    setPracticeQueue(initialBatch);
    setPracticeIndex(0);
    setPracticeAnswered(false);
    setPracticeSelectedOption(null);
    setPracticeAnswerLoading(false);
    setPracticeExplanationLoading(false);
    setPracticeSubject(subject);
    setPracticeTopic(topic);
    setPracticePaperId(selector.paperId);
    setPracticeShiftLabel(selector.shiftLabel);
    setPracticeHasMore(firstPage.hasMore);
    setPracticeNextCursor(firstPage.nextCursor);
    setPracticeLoadMoreError(null);
    setPracticeBatchLoading(false);
    practiceStartRef.current = Date.now();
    setPracticeSessionAnswers(new Array(initialBatch.length).fill(null));
    // Ensure exam context is set so Back → exam-detail always works
    setSelectedExamName(examName);
    setSelectedYear(year);
    setSelectedPaperId(selector.paperId);
    setSelectedShiftLabel(selector.shiftLabel);
    const { commission, examType } = parseExamName(examName);
    setSelectedCommission(commission);
    setSelectedExamType(examType);
    // Remember which view launched practice so Back can return there
    setPracticeBackView(view);
    setPracticeLoadProgress({
      loaded: initialBatch.length,
      total: outline?.total_count || firstPage.totalCount || sorted.length,
    });
    setView("practice");

    // Start background explanation prefetch so they're ready before the student answers.
    const sessionId = ++prefetchSessionRef.current;
    prefetchExplanations(initialBatch, sessionId);
  };

  const startTopicPractice = async (subject: string, topic: string) => {
    const requestId = ++topicPracticeRequestRef.current;
    const queueLabel = `${subject} :: ${topic}`;
    const initialPageSize = 20;
    setSelectedExamName(queueLabel);
    setSelectedYear(0);
    setPracticeSubject(subject);
    setPracticeTopic(topic);
    setPracticePaperId(null);
    setPracticeShiftLabel(null);
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
      setPracticeHasMore(false);
      setPracticeNextCursor(null);
      setPracticeLoadMoreError(null);
      setPracticeBatchLoading(false);
      setGlobalError(null);
      setView("practice");

    try {
      const slowLoadTimer = window.setTimeout(() => {
        if (topicPracticeRequestRef.current === requestId) {
          setPracticeInitMessage(
            `Still loading ${subject} -> ${topic}... opening the first questions as soon as they arrive.`
          );
        }
      }, 800);

      const firstPage = await requestTopicPracticePage(subject, topic, {
        pageSize: initialPageSize,
        offset: 0,
      });
      if (topicPracticeRequestRef.current !== requestId) return;
      window.clearTimeout(slowLoadTimer);

      const totalCount =
        typeof firstPage.totalCount === "number" ? firstPage.totalCount : null;
      const initialRows = firstPage.rows
        .filter((q: Question) => !bookmarkIdsRef.current.has(q.id));
      const loadedCount = initialRows.length;

      setPracticeQueue(initialRows);
      practiceStartRef.current = Date.now();
      setPracticeSessionAnswers(new Array(initialRows.length).fill(null));
      setPracticeHasMore(firstPage.hasMore);
      setPracticeNextCursor(
        firstPage.nextOffset !== null ? String(firstPage.nextOffset) : null
      );
      setPracticeLoadProgress({ loaded: loadedCount, total: totalCount });

      if (!initialRows.length) {
        setPracticeInitLoading(false);
        setGlobalError(`No questions found for ${subject} → ${topic}.`);
        return;
      }

      if (topicPracticeRequestRef.current !== requestId) return;
      setPracticeInitLoading(false);
      setPracticeInitMessage("");
      setPracticeLoadProgress({
        loaded: loadedCount,
        total: totalCount ?? loadedCount,
      });
    } catch (e: any) {
      if (topicPracticeRequestRef.current !== requestId) return;
      setPracticeInitLoading(false);
      setGlobalError(
        `Could not start practice for ${subject} → ${topic}: ${
          e?.message || "unknown error"
        }`
      );
    }
  };

  const currentPracticeQ = practiceQueue[practiceIndex] ?? null;

  // ── Bookmark actions ────────────────────────────────────────────────────────
  const uid = () => user?.uid ?? "guest";

  const toggleBookmarkQ = (q: Question) => {
    const { map, added } = toggleBookmark(uid(), q);
    setBookmarkMap(map);
    bookmarkIdsRef.current = new Set(Object.keys(map));
    // Brief toast-style feedback via title attr — no extra UI needed
    void added; // consumed by the button's visual state
  };

  const removeBookmarkQ = (id: string) => {
    const map = removeBookmark(uid(), id);
    setBookmarkMap({ ...map });
    bookmarkIdsRef.current = new Set(Object.keys(map));
  };

  const clearAllBookmarks = () => {
    clearBookmarks(uid());
    setBookmarkMap({});
    bookmarkIdsRef.current = new Set();
  };

  const startBookmarksPractice = () => {
    const questions = Object.values(bookmarkMap);
    if (!questions.length) return;
    setPracticeQueue(questions);
    setPracticeIndex(0);
    setPracticeAnswered(false);
    setPracticeSelectedOption(null);
    setPracticeAnswerLoading(false);
    setPracticeExplanationLoading(false);
    setPracticeSessionAnswers(new Array(questions.length).fill(null));
    setPracticeSubject("All");
    setPracticeTopic("All");
    setPracticePaperId(null);
    setPracticeShiftLabel(null);
    setPracticeHasMore(false);
    setPracticeNextCursor(null);
    setPracticeLoadMoreError(null);
    setPracticeBatchLoading(false);
    setPracticeInitLoading(false);
    setPracticeInitMessage("");
    setPracticeLoadProgress({ loaded: questions.length, total: questions.length });
    setSelectedExamName("Bookmarks");
    setSelectedYear(0);
    setPracticeBackView(view);
    practiceStartRef.current = Date.now();
    setView("practice");
  };

  const updatePracticeQuestion = (
    questionId: string,
    patch: Partial<Question>
  ) => {
    setPracticeQueue((prev) =>
      prev.map((item) =>
        item.id === questionId ? { ...item, ...patch } : item
      )
    );
  };

  const fetchQuestionAnswer = async (
    questionId: string
  ): Promise<string | null> => {
    const questionUrl = isAdmin
      ? `${API_BASE}/questions/${questionId}`
      : `${API_BASE}/questions/${questionId}`;
    const res = await fetch(questionUrl);
    if (!res.ok) return null;
    const data = await res.json();
    const answer = (data.correct_answer ?? data.answer ?? "")
      .toString()
      .trim()
      .toUpperCase();
    return ["A", "B", "C", "D"].includes(answer) ? answer : null;
  };

  const fetchExplanationForQuestion = async (
    questionId: string,
    options?: { background?: boolean; revealedAnswer?: string }
  ): Promise<string | null> => {
    const existing = practiceQueue.find((item) => item.id === questionId);
    if (isRenderableExplanation(existing?.explanation)) {
      explanationCacheRef.current[questionId] = existing.explanation;
      return existing.explanation;
    }

    if (isRenderableExplanation(explanationCacheRef.current[questionId])) {
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

    const explanationUrl = `${API_BASE}/explanation/${questionId}`;
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      options?.background ? 12000 : 25000
    );
    const promise = (async () => {
      try {
        const res = await fetch(explanationUrl, {
          signal: controller.signal,
        });
        if (!res.ok) return null;
        const data = await res.json();
        const source = (data.source || "").toString();
        const explanation =
          typeof data.explanation === "string" ? data.explanation.trim() : "";
        const verifiedAnswer = (
          data.verified_answer ??
          options?.revealedAnswer ??
          ""
        )
          .toString()
          .trim()
          .toUpperCase();
        const patch: Partial<Question> = {};
        if (["A", "B", "C", "D"].includes(verifiedAnswer))
          patch.answer = verifiedAnswer;
        if (source === "blocked-unverified-answer") {
          patch.explanation = BLOCKED_EXPLANATION;
        } else if (
          source === "hidden-contradiction" ||
          source === "unavailable-error"
        ) {
          patch.explanation = UNAVAILABLE_EXPLANATION;
        } else if (isRenderableExplanation(explanation)) {
          patch.explanation = explanation;
          explanationCacheRef.current[questionId] = explanation;
        } else if (!explanation) {
          patch.explanation = UNAVAILABLE_EXPLANATION;
        }
        if (Object.keys(patch).length) {
          updatePracticeQuestion(questionId, patch);
        }
        return isRenderableExplanation(explanation) ? explanation : null;
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
    if (!currentPracticeQ?.id || practiceAnswered || practiceAnswerLoading)
      return;
    const questionId = currentPracticeQ.id;
    const questionAtAnswerTime = currentPracticeQ;
    const answerIndex = practiceIndex;
    const startTime = practiceStartRef.current;
    const knownAnswer = (questionAtAnswerTime.answer || "")
      .toString()
      .trim()
      .toUpperCase();
    const hasKnownAnswer = ["A", "B", "C", "D"].includes(knownAnswer);
    setPracticeSelectedOption(key);
    setPracticeAnswerLoading(!hasKnownAnswer);
    setPracticeExplanationLoading(false);
    try {
      const answer = hasKnownAnswer
        ? knownAnswer
        : (await fetchQuestionAnswer(questionId)) || knownAnswer;
      if (answer) {
        updatePracticeQuestion(questionId, { answer });
      }
      // Check explanation cache BEFORE revealing the answer so loading state is set atomically.
      const cachedExplanation =
        explanationCacheRef.current[questionId] ||
        questionAtAnswerTime.explanation;
      const needsExplanationFetch =
        !cachedExplanation || cachedExplanation.length <= 5;
      setPracticeAnswered(true);
      if (needsExplanationFetch) setPracticeExplanationLoading(true);

      // Track stats
      const correct = key === answer;
      setPracticeSessionAnswers((prev) => {
        const n = [...prev];
        n[answerIndex] = { selected: key, correct };
        return n;
      });
      if (user) {
        const newStats = updateStats(
          user.uid,
          questionAtAnswerTime.subject,
          questionAtAnswerTime.topic,
          questionAtAnswerTime.question,
          correct,
          startTime
        );
        setUserStats(newStats);
      }
      void saveAttempt({
        questionId,
        selectedAnswer: key,
        isCorrect: correct,
        timeTakenSeconds: Math.max(
          1,
          Math.round((Date.now() - startTime) / 1000)
        ),
        examName: questionAtAnswerTime.exam,
        subject: questionAtAnswerTime.subject,
      });
      if (needsExplanationFetch) {
        void fetchExplanationForQuestion(questionId, {
          revealedAnswer: answer,
        }).finally(() => {
          setPracticeExplanationLoading((prev) =>
            currentPracticeQ?.id === questionId ? false : prev
          );
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
      setPracticeExplanationLoading(
        Boolean(
          nextQuestion &&
            (!nextQuestion.explanation || nextQuestion.explanation.length <= 5)
        )
      );
    } else {
      setPracticeAnswered(false);
      setPracticeSelectedOption(null);
      setPracticeExplanationLoading(false);
    }
    practiceStartRef.current = Date.now();
  };

  useEffect(() => {
    if (view !== "practice") return;
    const current = practiceQueue[practiceIndex];
    if (!current?.id) return;

    const timers: number[] = [];
    const queueForWarmup = [current, practiceQueue[practiceIndex + 1]].filter(
      Boolean
    ) as Question[];
    queueForWarmup.forEach((item, idx) => {
      if (item.explanation && item.explanation.length > 5) return;
      if (explanationCacheRef.current[item.id]) return;
      timers.push(
        window.setTimeout(
          () => {
            void fetchExplanationForQuestion(item.id, { background: true });
          },
          idx === 0 ? 250 : 1200
        )
      );
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
    if (
      currentPracticeQ?.explanation &&
      currentPracticeQ.explanation.length > 5
    ) {
      setPracticeExplanationLoading(false);
    }
  }, [practiceAnswered, currentPracticeQ?.id, currentPracticeQ?.explanation]);

  useEffect(() => {
    const hasExamPracticeContext = Boolean(selectedExamName && selectedYear);
    const hasTopicPracticeContext =
      !selectedYear &&
      practiceSubject !== "All" &&
      practiceTopic !== "All";
    if (
      view !== "practice" ||
      (!hasExamPracticeContext && !hasTopicPracticeContext)
    ) {
      return;
    }
    if (!practiceHasMore || practiceBatchLoading || practiceQueue.length < 10)
      return;
    if (practiceQueue.length - (practiceIndex + 1) > 6) return;
    void loadMorePracticeQuestions();
  }, [
    view,
    practiceIndex,
    practiceQueue.length,
    selectedExamName,
    selectedYear,
    practiceSubject,
    practiceTopic,
    practicePaperId,
    practiceShiftLabel,
    practiceHasMore,
    practiceNextCursor,
    practiceBatchLoading,
  ]);

  useEffect(() => {
    if (!examSession || view !== "mock") return;
    if (!examSession.hasMore || mockBatchLoading || examSession.questions.length < 10)
      return;
    if (examSession.questions.length - (examSession.currentIndex + 1) > 6)
      return;
    void loadMoreMockQuestions();
  }, [
    view,
    examSession?.currentIndex,
    examSession?.questions.length,
    examSession?.hasMore,
    mockBatchLoading,
  ]);

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

  const loadMorePracticeQuestions = async () => {
    if (!practiceHasMore || practiceBatchLoading) {
      return;
    }
    setPracticeBatchLoading(true);
    setPracticeLoadMoreError(null);
    try {
      let sortedBatch: Question[] = [];
      let nextHasMore = false;
      let nextCursor: string | null = null;
      let totalCount = 0;

      if (selectedYear) {
        if (!selectedExamName) {
          return;
        }
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
        if (practiceSubject === "All" || practiceTopic === "All") {
          return;
        }
        const page = await requestTopicPracticePage(
          practiceSubject,
          practiceTopic,
          {
            pageSize: 20,
            offset: Number(practiceNextCursor || "0"),
          }
        );
        sortedBatch = page.rows;
        nextHasMore = page.hasMore;
        nextCursor =
          page.nextOffset !== null ? String(page.nextOffset) : null;
        totalCount = page.totalCount;
      }

      let freshCount = 0;
      setPracticeQueue((prev) => {
        const seen = new Set(prev.map((item) => item.id));
        const fresh = sortedBatch.filter((item) => !seen.has(item.id) && !bookmarkIdsRef.current.has(item.id));
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
      setPracticeInitMessage("Loading the next batch...");
    } catch (e: any) {
      setPracticeLoadMoreError(e?.message || "Failed to load more questions");
    } finally {
      setPracticeBatchLoading(false);
    }
  };

  useEffect(() => {
    if (!examSession) return;
    try {
      localStorage.setItem(
        `mock_autosave_${examSession.examName}::${examSession.year}`,
        JSON.stringify({
          answers: examSession.answers,
          currentIndex: examSession.currentIndex,
          ts: Date.now(),
        })
      );
    } catch {}
  }, [examSession?.answers, examSession?.currentIndex]);

  useEffect(() => {
    if (!selectedExamName || !selectedYear || view !== "practice") return;
    try {
      localStorage.setItem(
        `practice_autosave_${selectedExamName}::${selectedYear}`,
        JSON.stringify({
          index: practiceIndex,
          answers: practiceSessionAnswers,
          paperId: practicePaperId,
          shiftLabel: practiceShiftLabel,
          ts: Date.now(),
        })
      );
    } catch {}
  }, [
    view,
    selectedExamName,
    selectedYear,
    practiceIndex,
    practiceSessionAnswers,
    practicePaperId,
    practiceShiftLabel,
  ]);

  const startMockExam = async (examName: string, year: number) => {
    const selector = await resolvePaperSelector(examName, year);
    const outline = await loadExamOutline(examName, year, false, selector);
    const firstPage = await requestExamPage(examName, year, {
      pageSize: 20,
      paperId: selector.paperId,
      shiftLabel: selector.shiftLabel,
    });
    if (!firstPage.rows.length) {
      setGlobalError("No questions found for this exam.");
      return;
    }
    const initialBatch = firstPage.rows.slice(0, 20);
    setSelectedExamName(examName);
    setSelectedYear(year);
    setSelectedPaperId(selector.paperId);
    setSelectedShiftLabel(selector.shiftLabel);
    const { commission, examType } = parseExamName(examName);
    setSelectedCommission(commission);
    setSelectedExamType(examType);
    const totalCount =
      outline?.total_count ||
      firstPage.totalCount ||
      initialBatch.length;
    const duration = totalCount * 72;
    setExamSession({
      questions: initialBatch,
      currentIndex: 0,
      answers: {},
      startTime: Date.now(),
      duration,
      isFinished: false,
      examName,
      year,
      paperId: selector.paperId,
      shiftLabel: selector.shiftLabel,
      totalCount,
      hasMore: firstPage.hasMore,
      nextCursor: firstPage.nextCursor,
    });
    setExamTimer(duration);
    setView("mock");
    const sessionId = ++mockPrefetchSessionRef.current;
    warmQuestionExplanations(initialBatch, {
      sessionId,
      onHydrate: (questionId, explanation) =>
        updateExamSessionQuestion(questionId, { explanation }),
    });
  };

  const finishExam = async () => {
    if (examSession) {
      const finalSession = {
        ...examSession,
        isFinished: true,
      };
      void persistMockAttempts(finalSession);
      setExamSession(finalSession);
      setView("results");
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
            hasMore: examPageStateRef.current[key]?.hasMore,
            nextCursor: examPageStateRef.current[key]?.nextCursor,
            totalCount:
              examPageStateRef.current[key]?.totalCount || prev.totalCount,
          }
        : prev
    );
  };

  const generateReport = async (examName: string, year: number) => {
    const targetQs = await loadAllExamQuestions(examName, year);
    if (!targetQs.length) {
      setReportError("No questions found.");
      return;
    }
    setReportLoading(true);
    setReportError(null);
    setReportData(null);
    setChatMessages([]);
    try {
      const res = await fetch("/api/generate-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questions: targetQs.map((q) => ({
            question: q.question,
            options: q.options,
            answer: q.answer,
            subject: q.subject,
            topic: q.topic,
            subtopic: q.subtopic,
            difficulty: q.difficulty,
            concept: q.concept,
            type: q.type,
            year: q.year,
            exam: q.exam,
          })),
          examName,
          year,
        }),
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.error || "Failed");
      }
      setReportData(await res.json());
    } catch (err: any) {
      setReportError(err.message);
    } finally {
      setReportLoading(false);
    }
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim() || !reportData || chatLoading) return;
    const userMsg = chatInput.trim();
    setChatInput("");
    const msgs = [...chatMessages, { role: "user" as const, text: userMsg }];
    setChatMessages(msgs);
    setChatLoading(true);
    try {
      const ctx = `Exam: ${reportData.examName} (${reportData.year}), ${
        reportData.totalQuestions
      } Qs. Subjects: ${reportData.subjectDistribution
        ?.map((s: any) => `${s.subject}:${s.count}`)
        .join(", ")}. Key Insights: ${reportData.keyInsights?.join("; ")}`;
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: msgs.map((m) => ({
            role: m.role,
            parts: [{ text: m.text }],
          })),
          reportContext: ctx,
        }),
      });
      const data = await res.json();
      setChatMessages((prev) => [
        ...prev,
        { role: "model", text: data.reply || "No response." },
      ]);
    } catch (err: any) {
      setChatMessages((prev) => [
        ...prev,
        { role: "model", text: `Error: ${err.message}` },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const browseWithFilters = (
    subject = "All",
    topic = "All",
    subtopic = "All"
  ) => {
    setFilterSubject(subject);
    setFilterTopic(topic);
    setFilterSubtopic(subtopic);
    setSearchQuery("");
    setView("browse");
  };

  const openCommission = (commission: string) => {
    setSelectedCommission(commission);
    setView("commission");
  };

  const openExam = (
    examName: string,
    commission: string,
    examType: string,
    preferredYear?: number
  ) => {
    const { examType: et } = parseExamName(examName);
    const info =
      commissionMap[commission]?.[et] ?? commissionMap[commission]?.[examType];
    const latestYear =
      preferredYear ?? info?.years[0] ?? new Date().getFullYear();
    setSelectedCommission(commission);
    setSelectedExamName(examName);
    setSelectedExamType(examType);
    setSelectedYear(latestYear);
    setSelectedPaperId(null);
    setSelectedShiftLabel(null);
    setFilterSubject("All");
    setSearchQuery("");
    setView("exam-detail");
  };

  // ── Computed ────────────────────────────────────────────────────────────────

  const commissionMap = useMemo(
    () => catalogSummary?.commission_map || {},
    [catalogSummary]
  );

  const ORDERED_COMMISSIONS = ['UPSC','APPSC','TSPSC','TSLPRB','APSLPRB','APHC','TSHC','AP','TS','SSC','IBPS','RRB'];
  const freePaperByCommission = useMemo(() => {
    const unlockedByCommission: Record<string, { examName: string; year: number }> = {};
    const orderedKeys = [
      ...ORDERED_COMMISSIONS,
      ...Object.keys(commissionMap).filter((commission) => !ORDERED_COMMISSIONS.includes(commission)),
    ];

    for (const commission of orderedKeys) {
      const exams = commissionMap[commission];
      if (!exams) continue;
      const firstKey = Object.keys(exams)[0];
      if (!firstKey) continue;
      const info = exams[firstKey];
      if (!info?.years?.length) continue;
      unlockedByCommission[commission] = {
        examName: info.fullName,
        year: Math.max(...info.years),
      };
    }

    return unlockedByCommission;
  }, [commissionMap]);

  const isLocked = (examName: string, year: number, commission?: string) => {
    if (isPremium || isAdmin) return false;
    if (!commission) return false;
    const freePaper = freePaperByCommission[commission];
    if (!freePaper) return false;
    return !(examName === freePaper.examName && year === freePaper.year);
  };

  useEffect(() => {
    if (!selectedExamName || !selectedYear) return;
    void loadExamPapers(selectedExamName, selectedYear).then((manifest) => {
      if (!manifest) return;
      const selectedStillExists = manifest.papers.some(
        (paper) =>
          (paper.paper_id || null) === selectedPaperId &&
          (paper.shift_label || null) === selectedShiftLabel
      );
      if (selectedStillExists) return;
      const firstPaper = manifest.papers[0];
      if (firstPaper) {
        setSelectedPaperId(firstPaper.paper_id || null);
        setSelectedShiftLabel(firstPaper.shift_label || null);
      } else {
        setSelectedPaperId(null);
        setSelectedShiftLabel(null);
      }
    });
  }, [selectedExamName, selectedYear]);

  // Ensure fully loaded data for Browse / Detail views
  useEffect(() => {
    if (
      selectedExamName &&
      selectedYear &&
      (view === "exam-detail" || view === "browse")
    ) {
      const manifest = examPaperManifestCache[`${selectedExamName}::${selectedYear}`];
      if (manifest?.papers?.length && !selectedPaperId && !selectedShiftLabel) {
        return;
      }
      loadExamQuestions(selectedExamName, selectedYear, false, {
        paperId: selectedPaperId,
        shiftLabel: selectedShiftLabel,
      });
    }
  }, [selectedExamName, selectedYear, view, selectedPaperId, selectedShiftLabel, examPaperManifestCache]);

  const selectedExamCacheKey = buildQuestionSetKey(selectedExamName, selectedYear, {
    paperId: selectedPaperId,
    shiftLabel: selectedShiftLabel,
  });
  const examYearQs = useMemo(
    () => examCache[selectedExamCacheKey] ?? [],
    [examCache, selectedExamCacheKey]
  );
  const examOutline = examOutlineCache[selectedExamCacheKey] || null;
  const examPaperManifest =
    examPaperManifestCache[`${selectedExamName}::${selectedYear}`] || null;
  const examQuestionCount =
    examOutline?.total_count ||
    examPageState[selectedExamCacheKey]
      ?.totalCount ||
    examYearQs.length;
  const availableSubjects = useMemo(
    () => (feedSummary?.subjects || []).map((item) => item.subject),
    [feedSummary]
  );

  const weightage = useMemo((): WeightageItem[] => {
    if (!examOutline?.subjects?.length || !examOutline.total_count) return [];
    return examOutline.subjects.map((subject) => ({
      subject: subject.subject,
      count: subject.count,
      pct: Math.round((subject.count / examOutline.total_count) * 100),
      topics: subject.topics.map((topic) => ({
        topic: topic.topic,
        count: topic.count,
        pct: Math.round((topic.count / subject.count) * 100),
        subtopics: topic.subtopics.map((subtopic) => ({
          subtopic: subtopic.subtopic,
          count: subtopic.count,
          pct: Math.round((subtopic.count / topic.count) * 100),
        })),
      })),
    }));
  }, [examOutline]);

  const filteredQs = useMemo(
    () =>
      examYearQs.filter(
        (q) =>
          (q.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
            q.topic.toLowerCase().includes(searchQuery.toLowerCase())) &&
          (filterSubject === "All" || q.subject === filterSubject) &&
          (filterTopic === "All" || q.topic === filterTopic) &&
          (filterSubtopic === "All" || q.subtopic === filterSubtopic)
      ),
    [examYearQs, searchQuery, filterSubject, filterTopic, filterSubtopic]
  );

  // ── Auth screens ────────────────────────────────────────────────────────────

  if (authLoading)
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--c-bg)",
        }}
      >
        <Loader2
          style={{ width: 32, height: 32, color: "#2563eb" }}
          className="animate-spin"
        />
      </div>
    );

  if (!user)
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "var(--c-bg)",
          fontFamily: "'Inter', sans-serif",
          display: "flex",
          flexDirection: "column",
          color: "var(--c-text)",
        }}
      >
        {/* Top nav */}
        <header
          style={{
            borderBottom: `1px solid ${C.border}`,
            padding: "0 32px",
            height: 60,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
            background: C.surface2,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 30, height: 30, borderRadius: 7,
              background: "linear-gradient(135deg, #1e3a8a, #2563eb)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "white", fontWeight: 800, fontSize: 14,
            }}>P</div>
            <span style={{ fontSize: 18, fontWeight: 700, color: C.text, letterSpacing: "-0.2px" }}>
              Pariksha
            </span>
          </div>
        </header>

        {/* Hero */}
        <main
          style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 420px",
            gap: 42,
            maxWidth: 1180,
            margin: "0 auto",
            padding: "42px 32px 32px",
            alignItems: "start",
            width: "100%",
            boxSizing: "border-box",
          }}
        >
          {/* Left: hero text */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <div
              style={{
                fontSize: 11,
                fontFamily: "'DM Mono', monospace",
                color: C.accent,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                marginBottom: 18,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span
                style={{
                  width: 28,
                  height: 1,
                  background: C.accent,
                  display: "inline-block",
                }}
              />
              India’s serious PYQ workspace
            </div>
            <h1
              style={{
                fontFamily: "'Inter', sans-serif",
                fontSize: 56,
                fontWeight: 500,
                lineHeight: 1.02,
                letterSpacing: "-1.4px",
                color: C.text,
                marginBottom: 18,
                maxWidth: 640,
              }}
            >
              Previous year papers, structured for
              <span style={{ color: C.accent, display: "block" }}>
                serious preparation.
              </span>
            </h1>
            <p
              style={{
                fontSize: 17,
                color: C.textSec,
                lineHeight: 1.65,
                marginBottom: 22,
                maxWidth: 600,
              }}
            >
              Clean PYQ practice for UPSC, APPSC, and TSPSC with verified
              explanations, timed mocks, and revision-first structure.
            </p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.25fr 0.75fr",
                gap: 16,
                marginBottom: 26,
                maxWidth: 760,
              }}
            >
              <div
                className="surface-card"
                style={{ padding: "18px 18px", borderRadius: 18 }}
              >
                <div
                  style={{
                    fontSize: 10,
                    color: C.textTert,
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    fontFamily: "'DM Mono', monospace",
                    marginBottom: 14,
                  }}
                >
                  Why serious aspirants stay
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: 12,
                  }}
                >
                  {[
                    {
                      icon: "PYQ",
                      label: "Verified question bank",
                      detail: "Structured papers from major commissions",
                    },
                    {
                      icon: "AI",
                      label: "Answer-aligned explanations",
                      detail: "Generated only after answer checks",
                    },
                    {
                      icon: "MOCK",
                      label: "Timed exam simulation",
                      detail: "Practice and mock workflows",
                    },
                    {
                      icon: "DATA",
                      label: "Performance intelligence",
                      detail: "Track weak areas and progress",
                    },
                  ].map(({ icon, label, detail }) => (
                    <div
                      key={label}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 12,
                      }}
                    >
                      <div
                        style={{
                          minWidth: 40,
                          height: 40,
                          borderRadius: 11,
                          background: C.accentDim,
                          border: `1px solid ${C.accent}26`,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 10,
                          fontWeight: 800,
                          letterSpacing: "0.08em",
                          color: C.accent,
                          fontFamily: "'DM Mono', monospace",
                          flexShrink: 0,
                        }}
                      >
                        {icon}
                      </div>
                      <div>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            color: C.text,
                          }}
                        >
                          {label}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: C.textTert,
                            marginTop: 4,
                            lineHeight: 1.5,
                          }}
                        >
                          {detail}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div
                className="surface-card"
                style={{ padding: "18px 18px", borderRadius: 18 }}
              >
                <div
                  style={{
                    fontSize: 10,
                    color: C.textTert,
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    fontFamily: "'DM Mono', monospace",
                    marginBottom: 14,
                  }}
                >
                  Platform edge
                </div>
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 12 }}
                >
                  {[
                    [
                      "Pattern-first",
                      "Designed for revision, not browsing PDFs",
                    ],
                    [
                      "Topic intelligence",
                      "Move from subject to concept quickly",
                    ],
                    ["Clean delivery", "Broken rows stay out of learner view"],
                  ].map(([label, detail]) => (
                    <div
                      key={label}
                      style={{
                        paddingBottom: 12,
                        borderBottom: `1px solid ${C.border}`,
                      }}
                    >
                      <div
                        style={{ fontSize: 13, fontWeight: 700, color: C.text }}
                      >
                        {label}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: C.textTert,
                          marginTop: 4,
                          lineHeight: 1.5,
                        }}
                      >
                        {detail}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Stats strip */}
            <div
              style={{
                display: "flex",
                gap: 0,
                paddingTop: 18,
                borderTop: `1px solid ${C.border}`,
                flexWrap: "wrap",
              }}
            >
              {[
                { num: "6,500+", label: "Questions" },
                { num: "39", label: "Papers" },
                { num: "6+", label: "Years covered" },
                { num: "3", label: "Core commissions" },
              ].map(({ num, label }) => (
                <div
                  key={label}
                  style={{
                    minWidth: 132,
                    paddingRight: 18,
                    marginRight: 18,
                    borderRight:
                      label !== "Core commissions"
                        ? `1px solid ${C.border}`
                        : "none",
                  }}
                >
                  <div
                    style={{
                      fontSize: 24,
                      fontFamily: "'Inter', sans-serif",
                      fontWeight: 500,
                      color: C.text,
                      letterSpacing: "-0.5px",
                    }}
                  >
                    {num}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: C.textTert,
                      fontFamily: "'DM Mono', monospace",
                      marginTop: 4,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                    }}
                  >
                    {label}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Right: sign-in card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
          >
            <div
              className="surface-card"
              style={{
                borderRadius: 24,
                padding: 28,
                boxShadow: "var(--c-shadow-subtle)",
              }}
            >
              <div style={{ marginBottom: 26 }}>
                <div
                  style={{
                    fontSize: 11,
                    fontFamily: "'DM Mono', monospace",
                    color: C.accent,
                    letterSpacing: "0.10em",
                    textTransform: "uppercase",
                    marginBottom: 10,
                  }}
                >
                  Access your workspace
                </div>
                <div
                  style={{
                    fontSize: 26,
                    fontFamily: "'Inter', sans-serif",
                    fontWeight: 500,
                    color: C.text,
                    marginBottom: 8,
                    letterSpacing: "-0.4px",
                  }}
                >
                  Start your preparation hub
                </div>
                <div
                  style={{ fontSize: 14, color: C.textSec, lineHeight: 1.6 }}
                >
                  Sign in to save progress, resume mocks, and build a long-term
                  preparation record across papers.
                </div>
              </div>

              <div
                style={{
                  padding: "14px 14px",
                  borderRadius: 16,
                  background: C.surface2,
                  border: `1px solid ${C.border}`,
                  marginBottom: 18,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 12,
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: 10,
                        color: C.textTert,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        fontFamily: "'DM Mono', monospace",
                      }}
                    >
                      Workspace preview
                    </div>
                    <div
                      style={{
                        fontSize: 15,
                        color: C.text,
                        fontWeight: 700,
                        marginTop: 4,
                      }}
                    >
                      Your preparation dashboard
                    </div>
                  </div>
                  <div
                    style={{
                      padding: "5px 8px",
                      borderRadius: 999,
                      background: C.accentDim,
                      color: C.accent,
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  >
                    Live after sign-in
                  </div>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 10,
                  }}
                >
                  {[
                    ["Daily goal", "25Q"],
                    ["Accuracy", "Tracked"],
                    ["Mocks", "Resume"],
                    ["Reports", "Ready"],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      style={{
                        padding: "12px 12px",
                        borderRadius: 12,
                        background: C.surface,
                        border: `1px solid ${C.border}`,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 10,
                          color: C.textTert,
                          textTransform: "uppercase",
                          letterSpacing: "0.08em",
                          fontFamily: "'DM Mono', monospace",
                        }}
                      >
                        {label}
                      </div>
                      <div
                        style={{
                          fontSize: 16,
                          color: C.text,
                          fontWeight: 700,
                          marginTop: 5,
                        }}
                      >
                        {value}
                      </div>
                    </div>
                  ))}
                </div>
                <div
                  style={{
                    marginTop: 12,
                    paddingTop: 12,
                    borderTop: `1px solid ${C.border}`,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  {[
                    "Daily goals and streaks stay synced",
                    "Mock tests reopen from where you stopped",
                    "Reports and history stay attached to your account",
                  ].map((item) => (
                    <div
                      key={item}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 11,
                        color: C.textSec,
                      }}
                    >
                      <span
                        style={{
                          width: 5,
                          height: 5,
                          borderRadius: "50%",
                          background: C.accent,
                          display: "inline-block",
                          flexShrink: 0,
                        }}
                      />
                      {item}
                    </div>
                  ))}
                </div>
              </div>

              <button
                onClick={handleLogin}
                style={{
                  width: "100%",
                  padding: "14px 0",
                  background: C.accent,
                  border: "none",
                  borderRadius: 12,
                  fontSize: 15,
                  fontWeight: 700,
                  color: "#0a1a18",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  marginBottom: 12,
                  transition: "opacity 0.15s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.9")}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
              >
                <LogIn style={{ width: 16, height: 16 }} /> Continue with Google
              </button>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  margin: "16px 0",
                }}
              >
                <div style={{ flex: 1, height: 1, background: C.border }} />
                <span
                  style={{
                    fontSize: 11,
                    color: C.textTert,
                    fontFamily: "'DM Mono', monospace",
                  }}
                >
                  or
                </span>
                <div style={{ flex: 1, height: 1, background: C.border }} />
              </div>

              <button
                onClick={() =>
                  setUser({
                    uid: "guest",
                    displayName: "Guest User",
                    email: "guest@localhost",
                    photoURL: null,
                  } as any)
                }
                style={{
                  width: "100%",
                  padding: "13px 0",
                  background: "transparent",
                  border: `1px solid ${C.border}`,
                  borderRadius: 12,
                  fontSize: 14,
                  fontWeight: 600,
                  color: C.textSec,
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--c-border-l)";
                  e.currentTarget.style.color = C.text;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = C.border;
                  e.currentTarget.style.color = C.textSec;
                }}
              >
                Continue in Guest Mode
              </button>

              <p
                style={{
                  fontSize: 12,
                  color: C.textTert,
                  textAlign: "center",
                  marginTop: 18,
                  lineHeight: 1.7,
                }}
              >
                Guest mode is fine for exploration, but it won’t save streaks,
                XP, reports, or long-term practice history.
              </p>

              <div
                style={{
                  marginTop: 18,
                  paddingTop: 18,
                  borderTop: `1px solid ${C.border}`,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                {[
                  "Structured by subject, topic, and concept family",
                  "Designed for revision, not just browsing PDFs",
                  "Built for UPSC and state PSC aspirants",
                ].map((item) => (
                  <div
                    key={item}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 12,
                      color: C.textSec,
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: C.accent,
                        display: "inline-block",
                        flexShrink: 0,
                      }}
                    />
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </main>

        {/* Footer strip */}
        <footer
          style={{
            borderTop: `1px solid ${C.border}`,
            padding: "14px 32px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
            background: C.surface2,
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: C.textTert,
              fontFamily: "'DM Mono', monospace",
            }}
          >
            Pariksha · PYQ intelligence for serious exam prep
          </span>
          <span style={{ fontSize: 11, color: C.textTert }}>
            Clean papers. Better revision. Stronger preparation.
          </span>
        </footer>
      </div>
    );

  // ── Main Render ─────────────────────────────────────────────────────────────

  // Avatar initials
  const avatarInitials = user.displayName
    ? user.displayName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
    : "U";

  return (
    <ToastProvider>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100vh",
          overflow: "hidden",
          background: "var(--bg-canvas)",
          color: "var(--text)",
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        }}
      >
        {showOnboarding && user && (
          <OnboardingModal
            userName={user.displayName ?? "Aspirant"}
            onComplete={({ commissions, dailyGoal }) => {
              localStorage.setItem(`pyq_onboarded_${user.uid}`, "1");
              if (commissions.length > 0)
                localStorage.setItem(
                  `pyq_commissions_${user.uid}`,
                  JSON.stringify(commissions)
                );
              if (dailyGoal)
                localStorage.setItem(
                  `pyq_dailygoal_${user.uid}`,
                  String(dailyGoal)
                );
              setShowOnboarding(false);
            }}
          />
        )}

        {/* ── Top Bar ────────────────────────────────────────────────────────── */}
        <div style={{
          background: "var(--bg)",
          borderBottom: "1px solid var(--border)",
          height: 50,
          display: "flex",
          alignItems: "center",
          padding: "0 22px",
          gap: 32,
          flexShrink: 0,
          zIndex: 30,
        }}>
          {/* Brand */}
          <div
            onClick={() => setView("home")}
            style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 15, color: "var(--text)", cursor: "pointer", userSelect: "none", flexShrink: 0 }}
          >
            <div style={{
              width: 26, height: 26, borderRadius: 6,
              background: "linear-gradient(135deg, #1e3a8a, #2563eb)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "white", fontWeight: 800, fontSize: 13,
            }}>P</div>
            Pariksha
          </div>

          {/* Right side */}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
            {/* Search */}
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "6px 12px", background: "var(--bg-alt)",
              borderRadius: 6, width: 220, color: "var(--text-tert)", fontSize: 13, cursor: "text",
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
              Search questions
            </div>

            {/* Streak */}
            {userStats.streak > 0 && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "4px 10px", background: "var(--warn-soft)",
                color: "#b45309", borderRadius: 6, fontSize: 12, fontWeight: 600,
              }}>
                🔥 {userStats.streak}
              </span>
            )}

            {/* Loading indicator */}
            {dataLoading && (
              <Loader2 style={{ width: 15, height: 15, color: C.accent }} className="animate-spin" />
            )}

            {/* Admin flagged button */}
            {isAdmin && (
              <button
                onClick={() => setFlagsModal(true)}
                style={{
                  padding: "5px 11px", fontSize: 11, fontWeight: 600,
                  background: "var(--warn-soft)", border: "1px solid #fbbf2440",
                  borderRadius: 6, color: "#b45309", cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 4, fontFamily: "inherit",
                }}
              >
                🚩 Flagged
              </button>
            )}

            {/* Premium pill */}
            <span style={{ padding: "6px 14px", background: "#fff7e6", color: "#d97706", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              Premium
            </span>

            {/* Profile */}
            <div
              onClick={() => setView("profile")}
              style={{
                width: 28, height: 28, borderRadius: "50%",
                background: "linear-gradient(135deg, #6366f1, #2563eb)",
                color: "white", display: "flex", alignItems: "center",
                justifyContent: "center", fontWeight: 700, fontSize: 12,
                overflow: "hidden", flexShrink: 0, cursor: "pointer",
              }}
            >
              {user.photoURL
                ? <img src={user.photoURL} style={{ width: 28, height: 28, borderRadius: "50%" }} alt="" />
                : avatarInitials}
            </div>

          </div>
        </div>
        {/* ── End Top Bar ─────────────────────────────────────────────────────── */}

        {/* ── Body: sidebar + content ─────────────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", flex: 1, overflow: "hidden" }}>
          <Navbar
            user={user}
            view={view}
            commissionMap={commissionMap}
            dataLoading={dataLoading}
            isAdmin={isAdmin}
            streak={userStats.streak}
            xp={userStats.xp}
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
            openPatternDebug={() => setView("pattern-debug")}
            openPatternIngestion={() => setView("pattern-ingestion")}
            openPatternPractice={() => setView("pattern-practice")}
            toggleAdmin={toggleAdmin}
            handleLogout={handleLogout}
          />

          {/* Content column */}
          <div style={{ overflowY: "auto", background: "var(--bg-canvas)" }}>
            <div style={{ padding: "32px 40px 60px", maxWidth: 1400, margin: "0 auto" }}>
            <AnimatePresence mode="wait">
              <motion.div
                key={view}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                {view === "dashboard" && (
                  <DashboardView
                    user={user}
                    availableSubjects={availableSubjects}
                    commissionMap={commissionMap}
                    stats={userStats}
                    setView={setView}
                    openCommission={openCommission}
                    startPractice={startPractice}
                  />
                )}
                {view === "feed" && (
                  <Suspense
                    fallback={
                      <ViewLoadingFallback label="Loading PYQ intelligence..." />
                    }
                  >
                    <FeedView
                      subjects={feedSummary?.subjects || []}
                      setView={setView}
                      startPractice={startPractice}
                      startTopicPractice={startTopicPractice}
                    />
                  </Suspense>
                )}
                {view === "badges" && (
                  <Suspense
                    fallback={<ViewLoadingFallback label="Loading badges..." />}
                  >
                    <BadgesView stats={userStats} />
                  </Suspense>
                )}
                {view === "leaderboard" && (
                  <Suspense
                    fallback={
                      <ViewLoadingFallback label="Loading leaderboard..." />
                    }
                  >
                    <LeaderboardView stats={userStats} user={user} />
                  </Suspense>
                )}
                {view === "home" && (
                  <HomeView
                    commissionMap={commissionMap}
                    openCommission={openCommission}
                    openExam={openExam}
                    startPractice={startPractice}
                    startMockExam={startMockExam}
                    setView={setView}
                    stats={userStats}
                    userDisplayName={user?.displayName ?? null}
                    userId={user?.uid ?? "guest"}
                  />
                )}
                {view === "commission" && (
                  <CommissionView
                    selectedCommission={selectedCommission}
                    commissionMap={commissionMap}
                    setView={setView}
                    openExam={openExam}
                    startPractice={startPractice}
                    startMockExam={startMockExam}
                    setSelectedExamName={setSelectedExamName}
                    setSelectedExamType={setSelectedExamType}
                    setSelectedYear={setSelectedYear}
                    isLocked={isLocked}
                    onLockedClick={() => setShowPremiumModal(true)}
                  />
                )}
                {view === "exam-detail" && (
                  <Suspense
                    fallback={
                      <ViewLoadingFallback label="Loading exam details..." />
                    }
                  >
                    <ExamDetailView
                      selectedCommission={selectedCommission}
                      selectedExamType={selectedExamType}
                      selectedExamName={selectedExamName}
                      selectedYear={selectedYear}
                      setSelectedYear={setSelectedYear}
                      commissionMap={commissionMap}
                      examYearQs={examYearQs}
                      examPaperManifest={examPaperManifest}
                      examPaperLoading={examPaperLoading}
                      selectedPaperId={selectedPaperId}
                      selectedShiftLabel={selectedShiftLabel}
                      setSelectedPaperId={setSelectedPaperId}
                      setSelectedShiftLabel={setSelectedShiftLabel}
                      weightage={weightage}
                      examQuestionCount={examQuestionCount}
                      examLoading={examLoading}
                      startPractice={startPractice}
                      startMockExam={startMockExam}
                      browseWithFilters={browseWithFilters}
                      setView={setView}
                      isAdmin={isAdmin}
                      setRenameModal={setRenameModal}
                      setRenameValue={setRenameValue}
                      setDeleteExamTarget={setDeleteExamTarget}
                      doAddBlankQuestion={doAddBlankQuestion}
                      doDeleteQuestion={doDeleteQuestion}
                      setEditQuestion={setEditQuestion}
                      isLocked={isLocked}
                      onLockedClick={() => setShowPremiumModal(true)}
                    />
                  </Suspense>
                )}
                {view === "practice" && (
                  <Suspense
                    fallback={
                      <ViewLoadingFallback label="Loading practice workspace..." />
                    }
                  >
                    <PracticeView
                      practiceQueue={practiceQueue}
                      practiceIndex={practiceIndex}
                      practiceAnswered={practiceAnswered}
                      practiceSelectedOption={practiceSelectedOption}
                      practiceAnswerLoading={practiceAnswerLoading}
                      practiceExplanationLoading={practiceExplanationLoading}
                      practiceInitLoading={practiceInitLoading}
                      practiceInitMessage={practiceInitMessage}
                      practiceLoadProgress={practiceLoadProgress}
                      practiceSubject={practiceSubject}
                      practiceTopic={practiceTopic}
                      selectedExamName={selectedExamName}
                      selectedExamType={selectedExamType}
                      selectedYear={selectedYear}
                      examOutline={examOutline}
                      currentPracticeQ={currentPracticeQ}
                      isAdmin={isAdmin}
                      setEditQuestion={setEditQuestion}
                      onFlagQuestion={setFlagQuestion}
                      handleAnswerSelect={handleAnswerSelect}
                      nextPracticeQuestion={nextPracticeQuestion}
                      prevPracticeQuestion={prevPracticeQuestion}
                      jumpToPracticeQuestion={jumpToPracticeQuestion}
                      retryLoadMore={() => {
                        void loadMorePracticeQuestions();
                      }}
                      hasMoreQuestions={practiceHasMore}
                      loadingMoreQuestions={practiceBatchLoading}
                      loadMoreError={practiceLoadMoreError}
                      startPractice={startPractice}
                      setView={setView}
                      sessionAnswers={practiceSessionAnswers}
                      backView={practiceBackView}
                      bookmarkedIds={bookmarkIdsRef.current}
                      onToggleBookmark={toggleBookmarkQ}
                    />
                  </Suspense>
                )}
                {view === "mock" && examSession && (
                  <MockView
                    examSession={examSession}
                    setExamSession={setExamSession}
                    examTimer={examTimer}
                    finishExam={finishExam}
                    loadMoreQuestions={() => {
                      void loadMoreMockQuestions();
                    }}
                    loadingMoreQuestions={mockBatchLoading}
                  />
                )}
                {view === "results" && examSession && (
                  <ResultsView
                    examSession={examSession}
                    examTimer={examTimer}
                    startMockExam={startMockExam}
                    setExamSession={setExamSession}
                    loadMoreResults={loadMoreResultQuestions}
                    setView={setView}
                  />
                )}
                {view === "browse" && (
                  <Suspense
                    fallback={
                      <ViewLoadingFallback label="Loading question browser..." />
                    }
                  >
                    <BrowseView
                      examYearQs={examYearQs}
                      filteredQs={filteredQs}
                      totalCount={examQuestionCount}
                      hasMore={Boolean(
                        examPageState[selectedExamCacheKey]?.hasMore
                      )}
                      loadingMore={Boolean(
                        examPageState[selectedExamCacheKey]?.loading
                      )}
                      loadError={examPageState[selectedExamCacheKey]?.error || null}
                      selectedExamName={selectedExamName}
                      selectedExamType={selectedExamType}
                      selectedYear={selectedYear}
                      filterSubject={filterSubject}
                      filterTopic={filterTopic}
                      filterSubtopic={filterSubtopic}
                      searchQuery={searchQuery}
                      setSearchQuery={setSearchQuery}
                      setFilterSubject={setFilterSubject}
                      setFilterTopic={setFilterTopic}
                      setFilterSubtopic={setFilterSubtopic}
                      setSelectedQuestion={setSelectedQuestion}
                      setView={setView}
                      isAdmin={isAdmin}
                      commissionMap={commissionMap}
                      examLoading={examLoading}
                      setEditQuestion={setEditQuestion}
                      onPickCommission={openCommission}
                      loadMoreQuestions={() => {
                        void loadMoreExamQuestions(
                          selectedExamName,
                          selectedYear,
                          20,
                          {
                            paperId: selectedPaperId,
                            shiftLabel: selectedShiftLabel,
                          }
                        );
                      }}
                    />
                  </Suspense>
                )}
                {view === "report" && (
                  <Suspense
                    fallback={<ViewLoadingFallback label="Loading report..." />}
                  >
                    <ReportView
                      selectedExamType={selectedExamType}
                      selectedExamName={selectedExamName}
                      selectedYear={selectedYear}
                      examYearQs={examYearQs}
                      reportData={reportData}
                      reportLoading={reportLoading}
                      reportError={reportError}
                      chatMessages={chatMessages}
                      chatInput={chatInput}
                      setChatInput={setChatInput}
                      chatLoading={chatLoading}
                      generateReport={generateReport}
                      sendChatMessage={sendChatMessage}
                      setView={setView}
                    />
                  </Suspense>
                )}
                {view === "pattern-debug" && isAdmin && (
                  <Suspense
                    fallback={
                      <ViewLoadingFallback label="Loading pattern diagnostics..." />
                    }
                  >
                    <PatternDebugView />
                  </Suspense>
                )}
                {view === "pattern-ingestion" && isAdmin && (
                  <Suspense
                    fallback={
                      <ViewLoadingFallback label="Loading ingestion console..." />
                    }
                  >
                    <PatternBookIngestionView />
                  </Suspense>
                )}
                {view === "pattern-practice" && (
                  <Suspense
                    fallback={
                      <ViewLoadingFallback label="Loading pattern practice..." />
                    }
                  >
                    <PatternPracticeView
                      setView={setView}
                      backView="dashboard"
                    />
                  </Suspense>
                )}
                {view === "profile" && (
                  <Suspense
                    fallback={<ViewLoadingFallback label="Loading profile..." />}
                  >
                    <ProfileView
                      user={user}
                      stats={userStats}
                      commissionMap={commissionMap}
                      handleLogout={handleLogout}
                    />
                  </Suspense>
                )}
                {view === "bookmarks" && (
                  <Suspense
                    fallback={<ViewLoadingFallback label="Loading bookmarks..." />}
                  >
                    <BookmarksView
                      bookmarkMap={bookmarkMap}
                      onRemove={removeBookmarkQ}
                      onClearAll={clearAllBookmarks}
                      onPracticeAll={startBookmarksPractice}
                    />
                  </Suspense>
                )}
              </motion.div>
            </AnimatePresence>

            {/* Global Error Toast */}
            <AnimatePresence>
              {globalError && (
                <motion.div
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="fixed top-20 left-1/2 -translate-x-1/2 z-[100] w-full max-w-xl px-4"
                >
                  <div className="bg-rose-600 text-white p-4 rounded-2xl shadow-2xl flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <AlertCircle className="w-5 h-5 flex-shrink-0" />
                      <p className="text-sm font-medium">{globalError}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={fetchData}
                        disabled={dataLoading}
                        className="px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 disabled:opacity-50"
                      >
                        {dataLoading ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <RotateCcw className="w-3 h-3" />
                        )}{" "}
                        Retry
                      </button>
                      <button
                        onClick={() => setGlobalError(null)}
                        className="p-1 hover:bg-white/20 rounded-lg"
                      >
                        <X className="w-4 h-4" />
                      </button>
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
                  onStartPractice={() => {
                    setSelectedQuestion(null);
                    startPractice(selectedExamName, selectedYear);
                  }}
                />
              )}
            </AnimatePresence>
            </div>
            {/* end inner padding */}
          </div>
          {/* end content column */}
        </div>
        {/* end body grid */}

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
            onSaved={async (updated) => {
              updateExamCacheQuestion(updated);
              await reloadExamAndMeta(updated.exam, updated.year);
              setPracticeQueue((prev) =>
                prev.map((q) => (q.id === updated.id ? updated : q))
              );
            }}
            onDeleted={async (deletedQuestion) => {
              await reloadExamAndMeta(
                deletedQuestion.exam,
                deletedQuestion.year
              );
              setPracticeQueue((prev) =>
                prev.filter((q) => q.id !== deletedQuestion.id)
              );
              setEditQuestion(null);
            }}
          />
        )}
        {uploadModal && (
          <UploadPaperModal
            onClose={() => setUploadModal(false)}
            onComplete={() => {
              invalidateMetaCache();
              fetchData();
            }}
          />
        )}
        {flagQuestion && (
          <FlagQuestionModal
            question={flagQuestion}
            userId={user?.uid}
            onClose={() => setFlagQuestion(null)}
          />
        )}
        {flagsModal && isAdmin && (
          <AdminFlagsModal onClose={() => setFlagsModal(false)} />
        )}
        {showPremiumModal && (
          <PremiumGateModal
            freePaperLabel="one free paper in each commission"
            onClose={() => setShowPremiumModal(false)}
          />
        )}
      </div>
    </ToastProvider>
  );
}
