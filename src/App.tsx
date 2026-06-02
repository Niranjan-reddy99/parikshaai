import { useState, useEffect, useRef, useMemo, lazy, Suspense } from "react";
import { API_BASE } from "./lib/api";
import {
  getAcceptedAnswers,
  getPrimaryAcceptedAnswer,
  isAcceptedAnswer,
  isDeletedQuestion,
} from "./lib/questionAnswers";
import { motion, AnimatePresence } from "motion/react";
import { AuthModal } from "./components/AuthModal";
import { EditQuestionModal } from "./components/admin/EditQuestionModal";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { CatalogProvider, useCatalog } from "./contexts/CatalogContext";
import { ExamProvider, useExam } from "./contexts/ExamContext";
import { PracticeProvider, usePractice } from "./contexts/PracticeContext";
import { MockProvider, useMock } from "./contexts/MockContext";
import {
  LogIn,
  AlertCircle,
  Loader2,
  RotateCcw,
  X,
  Menu,
} from "lucide-react";
import { auth } from "./firebase";

import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { Navbar } from "./components/Navbar";
import { OnboardingModal } from "./components/OnboardingModal";
import { QuestionModal } from "./components/QuestionModal";
import { FlagQuestionModal } from "./components/FlagQuestionModal";
import { PremiumGateModal } from "./components/PremiumGateModal";
import { ToastProvider } from "./components/Toast";
import { ComingSoonModal } from "./components/ComingSoonModal";

import { DashboardView } from "./views/DashboardView";
import { HomeView } from "./views/HomeView";
import { CommissionView } from "./views/CommissionView";
import { MockView } from "./views/MockView";
import { ResultsView } from "./views/ResultsView";
import { BrowseView } from "./views/BrowseView";
import { LeaderboardView } from "./views/LeaderboardView";
import { LandingPage } from "./views/LandingPage";

const FeedView = lazy(() =>
  import("./views/FeedView").then((m) => ({ default: m.FeedView }))
);
const BadgesView = lazy(() =>
  import("./views/BadgesView").then((m) => ({ default: m.BadgesView }))
);
const ExamDetailView = lazy(() =>
  import("./views/ExamDetailView").then((m) => ({ default: m.ExamDetailView }))
);
const PracticeView = lazy(() =>
  import("./views/PracticeView").then((m) => ({ default: m.PracticeView }))
);
const ReportView = lazy(() =>
  import("./views/ReportView").then((m) => ({ default: m.ReportView }))
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
const ReferralView = lazy(() =>
  import("./views/ReferralView").then((m) => ({ default: m.ReferralView }))
);
const LegalView = lazy(() =>
  import("./views/LegalView").then((m) => ({ default: m.LegalView }))
);

import { loadBookmarkMap, toggleBookmark, removeBookmark, clearBookmarks } from "./lib/bookmarks";
import { parseExamName } from "./lib/examUtils";
import {
  BLOCKED_EXPLANATION,
  UNAVAILABLE_EXPLANATION,
  DELETED_QUESTION_NOTE,
  MULTIPLE_ANSWERS_NOTE,
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
  getCachedExamManifest,
  getCachedExamOutline,
  getCachedFirstPage,
  setCachedFirstPage,
  invalidateCachedExam,
  getCachedTopicPage,
  setCachedTopicPage,
  setCachedExamManifest,
  setCachedExamOutline,
} from "./lib/questionCache";
import {
  type ExamOutline,
  type ExamPaperManifest,
  type Question,
  type View,
  type ExamSession,
  type WeightageItem,
  type PaginatedQuestionsResponse,
  type ReportData,
} from "./types/index";


export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <CatalogProvider>
          <ExamProvider>
            <PracticeProvider>
              <MockProvider>
                <AppContent />
              </MockProvider>
            </PracticeProvider>
          </ExamProvider>
        </CatalogProvider>
      </AuthProvider>
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

function AppNavIcon({ name }: { name: "explore" | "bank" | "feed" | "progress" | "saved" }) {
  const icons: Record<string, React.ReactNode> = {
    explore: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3 4 7v6c0 5 3.4 7.8 8 8 4.6-.2 8-3 8-8V7l-8-4Z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
    bank: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6h18" />
        <path d="M7 6v12" />
        <path d="M17 6v12" />
        <path d="M4 18h16" />
        <path d="M12 10h.01" />
      </svg>
    ),
    feed: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 11a9 9 0 0 1 9 9" />
        <path d="M4 4a16 16 0 0 1 16 16" />
        <circle cx="5" cy="19" r="1" />
      </svg>
    ),
    progress: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18" />
        <path d="m7 14 4-4 4 3 6-6" />
      </svg>
    ),
    saved: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
      </svg>
    ),
  };

  return <>{icons[name]}</>;
}

function AppContent() {
  const [bookmarkMap, setBookmarkMap] = useState<Record<string, Question>>({});
  const bookmarkIdsRef = useRef<Set<string>>(new Set());
  const [isMobileLayout, setIsMobileLayout] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 1024 : false
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [showComingSoon, setShowComingSoon] = useState(false);

  // ── Theme State ──────────────────────────────────────────────────────────────
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return (localStorage.getItem('app-theme') || localStorage.getItem('lp-theme') || 'light') as 'light' | 'dark';
    } catch {
      return 'light';
    }
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('app-theme', theme);
      localStorage.setItem('lp-theme', theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  // ── Auth (from context) ──────────────────────────────────────────────────────
  const {
    user, authLoading, isPremium: realIsPremium, subscriptionLoaded,
    showPremiumModal, setShowPremiumModal,
    showAuthModal, setShowAuthModal,
    handleLogin, handleGoogleSignIn, handleEmailSignIn,
    handleEmailSignUp, handleForgotPassword, handleLogout,
    getApiToken,
  } = useAuth();

  const isPremium = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? true : realIsPremium;

  // ── Catalog (from context) ────────────────────────────────────────────────────
  const { catalogSummary, feedSummary, dataLoading, globalError, setGlobalError, fetchData } = useCatalog();

  // ── Exam (from context) ───────────────────────────────────────────────────────
  const {
    selectedExamName, setSelectedExamName,
    selectedYear, setSelectedYear,
    selectedPaperId, setSelectedPaperId,
    selectedShiftLabel, setSelectedShiftLabel,
    examCache, examOutlineCache, examPageState, examPaperManifestCache,
    examLoading, examPaperLoading,
    buildQuestionSetKey, mapQuestion, getExamPageEntry,
    loadExamPapers, resolvePaperSelector, loadExamOutline,
    fetchExamChunk, loadExamQuestions, loadMoreExamQuestions, loadAllExamQuestions,
    requestExamPage, requestTopicPracticePage, prefetchTopicPractice,
  } = useExam();

  // ── Practice (from context) ───────────────────────────────────────────────────
  const {
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
    practiceStartRef, prefetchSessionRef, mockPrefetchSessionRef,
    practiceQueueRef, explanationCacheRef,
    isRenderableExplanation, getSafePracticeBackView, currentPracticeQ,
    updatePracticeQuestion, fetchBatchExplanations, warmQuestionExplanations,
    prefetchExplanations, fetchExplanationForQuestion, fetchFreshExplanationAfterAnswer,
    nextPracticeQuestion, prevPracticeQuestion, jumpToPracticeQuestion,
    loadMorePracticeQuestions, fetchQuestionAnswerMeta,
  } = usePractice();

  // ── Mock Exam (from context) ──────────────────────────────────────────────────
  const {
    examSession, setExamSession,
    examTimer, setExamTimer,
    mockBatchLoading,
    updateExamSessionQuestion,
    loadMoreMockQuestions,
    loadMoreResultQuestions,
  } = useMock();

  // ── Admin ────────────────────────────────────────────────────────────────────
  const [editQuestion, setEditQuestion] = useState<Question | null>(null);

  // ── Onboarding ───────────────────────────────────────────────────────────────
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(max-width: 1023px)");
    const sync = (matches: boolean) => setIsMobileLayout(matches);
    sync(media.matches);
    const listener = (event: MediaQueryListEvent) => sync(event.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  useEffect(() => {
    if (!isMobileLayout) setMobileNavOpen(false);
  }, [isMobileLayout]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileNavOpen]);

  // ── User Stats (localStorage) ────────────────────────────────────────────────
  const [userStats, setUserStats] = useState<UserStats>(() =>
    getStats("")
  );

  // Open upgrade modal if user clicked a pricing CTA on the landing page before logging in
  useEffect(() => {
    if (user && sessionStorage.getItem('pendingUpgrade') === '1') {
      sessionStorage.removeItem('pendingUpgrade');
      setShowPremiumModal(true);
    }
  }, [user, setShowPremiumModal]);

  // Reload stats + bookmarks when user changes; show onboarding for new users
  useEffect(() => {
    if (!user) {
      setUserStats(getStats(""));
      setBookmarkMap({});
      bookmarkIdsRef.current = new Set();
      return;
    }

    // Load bookmarks (was previously in onAuthStateChanged)
    const map = loadBookmarkMap(user.uid);
    setBookmarkMap(map);
    bookmarkIdsRef.current = new Set(Object.keys(map));

    const localStats = getStats(user.uid);
    setUserStats(localStats);
    const key = `pyq_onboarded_${user.uid}`;
    if (!localStorage.getItem(key)) {
      // Auto-dismiss for existing users who have prior activity (old users who
      // never saw the working onboarding modal due to the button being broken)
      const hasActivity = localStats.totalAnswered > 0 ||
        !!localStorage.getItem(`pyq_bookmarks_${user.uid}`);
      if (hasActivity) {
        localStorage.setItem(key, "1");
      } else {
        setShowOnboarding(true);
      }
    }

    let cancelled = false;
    (async () => {
      try {
        // Force-refresh: token from IndexedDB cache may be stale right after auth init
        const token = await Promise.race([
          user.getIdToken(true),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("token timeout")), 8000)
          ),
        ]);
        // Push any locally-accumulated stats up to Supabase on login
        syncStatsToApi(user.uid, localStats, token).catch(() => {});
        const ac = new AbortController();
        setTimeout(() => ac.abort(), 10000);
        const res = await fetch(`${API_BASE}/user/stats`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: ac.signal,
        });
        if (!res.ok) return;
        const serverStats = await res.json();
        if (!cancelled) {
          const serverHasMoreData = serverStats.totalAnswered > localStats.totalAnswered;
          const serverHasMoreHistory = (serverStats.recentAttempts?.length || 0) > (localStats.recentAttempts?.length || 0);
          
          if (serverHasMoreData || serverHasMoreHistory) {
            // Prefer server stats only when they have more data (cross-device)
            const merged = { ...localStats, ...serverStats };
            setUserStats(merged);
            try { localStorage.setItem(`pyq_stats_${user.uid}`, JSON.stringify(merged)); } catch {}
          }
        }
        // If server confirms prior activity, mark onboarded and dismiss any
        // lingering modal (handles users whose local stats were cleared).
        if (!cancelled && serverStats.totalAnswered > 0) {
          const onboardKey = `pyq_onboarded_${user.uid}`;
          if (!localStorage.getItem(onboardKey)) {
            try { localStorage.setItem(onboardKey, "1"); } catch { /* ignore */ }
            setShowOnboarding(false);
          }
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
  const [feedInitialSubject, setFeedInitialSubject] = useState('All');
  const [selectedCommission, setSelectedCommission] = useState("");
  const [selectedExamType, setSelectedExamType] = useState("");
  useEffect(() => {
    setMobileNavOpen(false);
  }, [view]);

  // ── History Router ───────────────────────────────────────────────────────────
  const prevViewRef = useRef<View>(view);

  const buildViewPath = (
    v: View, comm: string, examName: string, year: number, examType: string
  ): string => {
    if (v === "home") return "/";
    if (v === "commission" && comm)
      return `/commission/${encodeURIComponent(comm)}`;
    if (v === "exam-detail" && comm && examName && year)
      return `/exam-detail/${encodeURIComponent(comm)}/${encodeURIComponent(examName)}/${year}/${encodeURIComponent(examType)}`;
    return `/${v}`;
  };

  // Sync URL on view / param changes.
  // While unauthenticated on "home", keep URL as "/" (the clean landing page URL).
  // When user logs in, this effect re-runs (user is in deps) and transitions to /home.
  useEffect(() => {
    if (!user && view === "home") {
      if (window.location.pathname !== "/") {
        window.history.replaceState({ view }, "", "/");
      }
      return;
    }
    const path = buildViewPath(view, selectedCommission, selectedExamName, selectedYear, selectedExamType);
    const current = window.location.pathname;
    if (current === path) { prevViewRef.current = view; return; }
    const viewChanged = prevViewRef.current !== view;
    prevViewRef.current = view;
    if (viewChanged) {
      window.history.pushState({ view }, "", path);
    } else {
      window.history.replaceState({ view }, "", path);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selectedCommission, selectedExamName, selectedYear, selectedExamType, user]);

  // Restore view on browser back/forward
  useEffect(() => {
    const SIMPLE_VIEWS = new Set([
      "home", "browse", "dashboard", "feed", "bookmarks",
      "badges", "leaderboard", "profile", "pattern-practice", "referral",
    ]);
    const restoreFromPath = (pathname: string) => {
      const parts = pathname.replace(/^\//, "").split("/").map(s => {
        try { return decodeURIComponent(s); } catch { return s; }
      });
      const vName = parts[0] || "home";
      if (vName === "commission" && parts[1]) {
        setSelectedCommission(parts[1]);
        setView("commission");
      } else if (vName === "exam-detail" && parts[1] && parts[2] && parts[3]) {
        setSelectedCommission(parts[1]);
        setSelectedExamName(parts[2]);
        setSelectedYear(parseInt(parts[3]) || 0);
        if (parts[4]) setSelectedExamType(parts[4]);
        setView("exam-detail");
      } else if (SIMPLE_VIEWS.has(vName)) {
        setView(vName as View);
      } else {
        setView("home");
      }
    };
    const handlePopState = () => restoreFromPath(window.location.pathname);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On mount: restore view from URL path if navigated directly to a deep link.
  // Root path "/" is left untouched — landing page renders there for unauthenticated users.
  useEffect(() => {
    const pathname = window.location.pathname;
    if (pathname === "/" || pathname === "") return;
    const SIMPLE_VIEWS = new Set([
      "home", "browse", "dashboard", "feed", "bookmarks",
      "badges", "leaderboard", "profile", "pattern-practice", "referral",
    ]);
    const parts = pathname.replace(/^\//, "").split("/").map(s => {
      try { return decodeURIComponent(s); } catch { return s; }
    });
    const vName = parts[0] || "home";
    if (vName === "commission" && parts[1]) {
      setSelectedCommission(parts[1]);
      setView("commission");
    } else if (vName === "exam-detail" && parts[1] && parts[2] && parts[3]) {
      setSelectedCommission(parts[1]);
      setSelectedExamName(parts[2]);
      setSelectedYear(parseInt(parts[3]) || 0);
      if (parts[4]) setSelectedExamType(parts[4]);
      setView("exam-detail");
    } else if (SIMPLE_VIEWS.has(vName)) {
      setView(vName as View);
    }
    // practice/mock/results/report: not restorable — stay on default 'home'
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Navbar Dropdown ─────────────────────────────────────────────────────────
  const [examDropdownOpen, setExamDropdownOpen] = useState(false);
  const [dropdownHoveredCommission, setDropdownHoveredCommission] =
    useState("");

  // ── Browse ──────────────────────────────────────────────────────────────────
  const [catalogSearchQuery, setCatalogSearchQuery] = useState("");
  const [browsePickerOpen, setBrowsePickerOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterSubject, setFilterSubject] = useState("All");
  const [filterTopic, setFilterTopic] = useState("All");
  const [filterSubtopic, setFilterSubtopic] = useState("All");
  const [selectedQuestion, setSelectedQuestion] = useState<Question | null>(
    null
  );

  // ── Practice ────────────────────────────────────────────────────────────────
  const topicPracticeRequestRef = useRef(0);
  const feedTopicPrefetchedRef = useRef<Set<string>>(new Set());

  const [flagQuestion, setFlagQuestion] = useState<Question | null>(null);

  // ── Report / Chat ───────────────────────────────────────────────────────────
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<
    { role: "user" | "model"; text: string }[]
  >([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  // ── Effects ─────────────────────────────────────────────────────────────────

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
    if (!user) return;
    void fetchData({ background: Boolean(catalogSummary && feedSummary) });
  }, [user]);

  // Guard: if mock or results view is reached without an active session, redirect to home.
  useEffect(() => {
    if ((view === 'mock' || view === 'results') && !examSession) {
      setView('home');
    }
  }, [view, examSession]);

  // If meta never loaded (e.g. backend was down at login), retry whenever user navigates to a view that needs it.
  useEffect(() => {
    if (user && (!catalogSummary || !feedSummary) && !dataLoading) {
      void fetchData();
    }
  }, [view]);

  useEffect(() => {
    if (view !== "feed" || !feedSummary?.subjects?.length) return;

    const candidates = feedSummary.subjects
      .flatMap((subjectBucket) =>
        (subjectBucket.topics || []).map((topicBucket) => ({
          subject: subjectBucket.subject,
          topic: topicBucket.topic,
          count: topicBucket.count || 0,
        }))
      )
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    candidates.forEach(({ subject, topic }) => {
      const key = `${subject}::${topic}`;
      if (feedTopicPrefetchedRef.current.has(key)) return;
      feedTopicPrefetchedRef.current.add(key);
      prefetchTopicPractice(subject, topic);
    });
  }, [view, feedSummary]);

  useEffect(() => {
    if (!examSession || examSession.isFinished || examTimer <= 0) return;
    const iv = setInterval(() => setExamTimer((p) => (p > 0 ? p - 1 : 0)), 1000);
    return () => clearInterval(iv);
  }, [examSession, examTimer]);

  // Auto-submit when the timer reaches zero
  useEffect(() => {
    if (examTimer === 0 && examSession && !examSession.isFinished) {
      void finishExam();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examTimer]);

  const saveAttempt = async (attempt: {
    questionId: string;
    selectedAnswer: string;
    isCorrect: boolean;
    timeTakenSeconds?: number | null;
    examName?: string;
    subject?: string;
    topic?: string;
    subtopic?: string;
    pattern_tag?: string;
    mode?: string;
  }) => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;

    try {
      const token = await currentUser.getIdToken(true);
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
          topic: attempt.topic ?? null,
          subtopic: attempt.subtopic ?? null,
          pattern_tag: attempt.pattern_tag ?? null,
          mode: attempt.mode ?? "practice",
        }),
      });
    } catch {
      // Attempt save failed silently — non-critical, user can continue
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
        if (isDeletedQuestion(question)) return;
        const isCorrect = isAcceptedAnswer(question, selected);
        await saveAttempt({
          questionId: question.id,
          selectedAnswer: selected,
          isCorrect,
          timeTakenSeconds: null,
          examName: session.examName,
          subject: question.subject,
          topic: question.topic,
          subtopic: question.subtopic,
          pattern_tag: question.pattern_tag,
          mode: "mock",
        });
      })
    );
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
        getExamPageEntry(
          buildQuestionSetKey(selectedExamName, selectedYear, {
            subject,
            topic,
            paperId: practicePaperId,
            shiftLabel: practiceShiftLabel,
          })
        )?.totalCount || sorted.length,
    });
  };



  const startPractice = async (
    examName: string,
    year: number,
    subject = "All",
    topic = "All"
  ) => {
    const requestId = ++topicPracticeRequestRef.current;
    setPracticeInitLoading(false);
    setPracticeInitMessage("");
    setPracticeLoadProgress({ loaded: 0, total: null });
    const selector = await resolvePaperSelector(examName, year);
    const outlinePromise = loadExamOutline(examName, year, false, selector);
    const filters = { subject, topic };
    const key = buildQuestionSetKey(examName, year, {
      ...filters,
      paperId: selector.paperId,
      shiftLabel: selector.shiftLabel,
    });

    const primePracticeSession = (
      rows: Question[],
      pageInfo: { hasMore: boolean; nextCursor: string | null; totalCount: number },
      outlineTotal?: number | null
    ) => {
      setPracticeInitLoading(false);
      let q = rows;
      if (subject !== "All") q = q.filter((x) => x.subject === subject);
      if (topic !== "All") q = q.filter((x) => x.topic === topic);
      q = q.filter((x) => !bookmarkIdsRef.current.has(x.id));

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
      setPracticeHasMore(pageInfo.hasMore);
      setPracticeNextCursor(pageInfo.nextCursor);
      setPracticeLoadMoreError(null);
      setPracticeBatchLoading(false);
      practiceStartRef.current = Date.now();
      setPracticeSessionAnswers(new Array(initialBatch.length).fill(null));
      setSelectedExamName(examName);
      setSelectedYear(year);
      setSelectedPaperId(selector.paperId);
      setSelectedShiftLabel(selector.shiftLabel);
      const { commission, examType } = parseExamName(examName);
      setSelectedCommission(commission);
      setSelectedExamType(examType);
      setPracticeBackView(getSafePracticeBackView(view));
      setPracticeLoadProgress({
        loaded: initialBatch.length,
        total: outlineTotal || pageInfo.totalCount || sorted.length,
      });
      setView("practice");

      const sessionId = ++prefetchSessionRef.current;
      prefetchExplanations(initialBatch, sessionId);
    };

    const cached = getCachedFirstPage(key);
    if (cached?.questions?.length) {
      primePracticeSession(
        cached.questions,
        {
          hasMore: cached.hasMore,
          nextCursor: cached.nextCursor,
          totalCount: cached.totalCount,
        },
        null
      );

      void requestExamPage(examName, year, {
        pageSize: 20,
        ...filters,
        ...selector,
      })
        .then((fresh) => {
          if (topicPracticeRequestRef.current !== requestId) return;
          setCachedFirstPage(key, {
            questions: fresh.rows,
            totalCount: fresh.totalCount,
            hasMore: fresh.hasMore,
            nextCursor: fresh.nextCursor,
          });
        })
        .catch(() => {
          /* keep cached practice start silently */
        });

      void outlinePromise.then((outline) => {
        if (topicPracticeRequestRef.current !== requestId || !outline) return;
        setPracticeLoadProgress((prev) => ({
          loaded: prev.loaded,
          total: outline.total_count || prev.total,
        }));
      });
      return;
    }

    // No cache — show loading state immediately then fetch
    const backViewSnapshot = getSafePracticeBackView(view);
    setPracticeQueue([]);
    setPracticeInitLoading(true);
    setPracticeInitMessage("Loading questions...");
    setPracticeBackView(backViewSnapshot);
    setView("practice");

    try {
      const firstPage = await requestExamPage(examName, year, {
        pageSize: 20,
        ...filters,
        ...selector,
      });
      const outline = await outlinePromise;
      primePracticeSession(
        firstPage.rows,
        {
          hasMore: firstPage.hasMore,
          nextCursor: firstPage.nextCursor,
          totalCount: firstPage.totalCount,
        },
        outline?.total_count || null
      );
    } catch (e: any) {
      setPracticeInitLoading(false);
      setGlobalError(e?.message || "Failed to load questions");
      setView(backViewSnapshot);
    }
  };

  const startTopicPractice = async (subject: string, topic: string) => {
    const requestId = ++topicPracticeRequestRef.current;
    const queueLabel = `${subject} :: ${topic}`;
    const initialPageSize = 20;
    const prefetchKey = `${subject}::${topic}`;

    // ── Shared state reset ──────────────────────────────────────────────────
    setSelectedExamName(queueLabel);
    setSelectedYear(0);
    setPracticeSubject(subject);
    setPracticeTopic(topic);
    setPracticePaperId(null);
    setPracticeShiftLabel(null);
    setPracticeBackView(getSafePracticeBackView(view));
    setPracticeQueue([]);
    setPracticeIndex(0);
    setPracticeAnswered(false);
    setPracticeSelectedOption(null);
    setPracticeAnswerLoading(false);
    setPracticeExplanationLoading(false);
    setPracticeSessionAnswers([]);
    setPracticeLoadMoreError(null);
    setPracticeBatchLoading(false);
    setGlobalError(null);
    setView("practice");

    // ── SWR: show cached questions immediately ──────────────────────────────
    const cached = getCachedTopicPage(subject, topic);
    if (cached && cached.questions.length > 0) {
      const cachedRows = cached.questions.filter(
        (q: Question) => !bookmarkIdsRef.current.has(q.id)
      );
      setPracticeQueue(cachedRows);
      practiceStartRef.current = Date.now();
      setPracticeSessionAnswers(new Array(cachedRows.length).fill(null));
      setPracticeHasMore(cached.hasMore);
      setPracticeNextCursor(cached.nextOffset !== null ? String(cached.nextOffset) : null);
      setPracticeLoadProgress({ loaded: cachedRows.length, total: cached.total });
      setPracticeInitLoading(false);
      setPracticeInitMessage("");
      // Revalidate in background — don't await, don't block UI
      requestTopicPracticePage(subject, topic, { pageSize: initialPageSize, offset: 0 })
        .then((fresh) => {
          if (topicPracticeRequestRef.current !== requestId) return;
          const freshRows = fresh.rows.filter(
            (q: Question) => !bookmarkIdsRef.current.has(q.id)
          );
          setCachedTopicPage(subject, topic, {
            questions: fresh.rows,
            total: fresh.totalCount,
            hasMore: fresh.hasMore,
            nextOffset: fresh.nextOffset,
          });
          if (practiceIndex === 0 && !practiceAnswered) {
            setPracticeQueue(freshRows);
            setPracticeSessionAnswers(new Array(freshRows.length).fill(null));
            setPracticeHasMore(fresh.hasMore);
            setPracticeNextCursor(fresh.nextOffset !== null ? String(fresh.nextOffset) : null);
            setPracticeLoadProgress({ loaded: freshRows.length, total: fresh.totalCount });
          }
        })
        .catch(() => {/* silent — user already has cached data */});
      return;
    }

    // ── Cold load (no cache) ────────────────────────────────────────────────
    setPracticeInitLoading(true);
    setPracticeInitMessage(`Loading ${subject} — ${topic}...`);
    setPracticeLoadProgress({ loaded: 0, total: null });
    setPracticeHasMore(false);
    setPracticeNextCursor(null);

    try {
      const slowTimer = window.setTimeout(() => {
        if (topicPracticeRequestRef.current === requestId) {
          setPracticeInitMessage(`Building topic session from the server...`);
        }
      }, 1800);

      const fetchWithTimeout = Promise.race([
        (async () =>
          (await requestTopicPracticePage(subject, topic, {
            pageSize: initialPageSize,
            offset: 0,
          })))(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Request timed out. Check your connection and try again.")), 40000)
        ),
      ]);
      const firstPage = await fetchWithTimeout;
      if (topicPracticeRequestRef.current !== requestId) return;
      window.clearTimeout(slowTimer);

      const totalCount =
        typeof firstPage.totalCount === "number" ? firstPage.totalCount : null;
      const initialRows = firstPage.rows.filter(
        (q: Question) => !bookmarkIdsRef.current.has(q.id)
      );

      // Write to cache for instant repeat opens
      setCachedTopicPage(subject, topic, {
        questions: firstPage.rows,
        total: firstPage.totalCount,
        hasMore: firstPage.hasMore,
        nextOffset: firstPage.nextOffset,
      });

      setPracticeQueue(initialRows);
      practiceStartRef.current = Date.now();
      setPracticeSessionAnswers(new Array(initialRows.length).fill(null));
      setPracticeHasMore(firstPage.hasMore);
      setPracticeNextCursor(
        firstPage.nextOffset !== null ? String(firstPage.nextOffset) : null
      );
      setPracticeLoadProgress({ loaded: initialRows.length, total: totalCount });

      if (!initialRows.length) {
        setPracticeInitLoading(false);
        setGlobalError(`No questions found for ${subject} → ${topic}.`);
        return;
      }

      if (topicPracticeRequestRef.current !== requestId) return;
      setPracticeInitLoading(false);
      setPracticeInitMessage("");
      setPracticeLoadProgress({
        loaded: initialRows.length,
        total: totalCount ?? initialRows.length,
      });
    } catch (e: any) {
      if (topicPracticeRequestRef.current !== requestId) return;
      setPracticeInitLoading(false);
      setGlobalError(
        `Could not start practice for ${subject} → ${topic}: ${e?.message || "unknown error"}`
      );
    }
  };


  // ── Bookmark actions ────────────────────────────────────────────────────────
  const uid = () => user?.uid ?? "";

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
    setPracticeBackView(getSafePracticeBackView(view));
    practiceStartRef.current = Date.now();
    setView("practice");
  };

  useEffect(() => {
    practiceQueueRef.current = practiceQueue;
  }, [practiceQueue]);

  const handleAnswerSelect = async (key: string) => {
    if (!currentPracticeQ?.id || practiceAnswered || practiceAnswerLoading)
      return;
    const questionId = currentPracticeQ.id;
    const questionAtAnswerTime = currentPracticeQ;
    const answerIndex = practiceIndex;
    const startTime = practiceStartRef.current;
    const knownAnswers = getAcceptedAnswers(questionAtAnswerTime);
    const hasKnownAnswer = isDeletedQuestion(questionAtAnswerTime) || knownAnswers.length > 0;
    setPracticeSelectedOption(key);
    setPracticeAnswerLoading(!hasKnownAnswer);
    setPracticeExplanationLoading(false);
    try {
      const answerMeta =
        hasKnownAnswer
          ? {
              answer: getPrimaryAcceptedAnswer(questionAtAnswerTime),
              answers: knownAnswers,
              answerStatus: questionAtAnswerTime.answerStatus,
            }
          : (await fetchQuestionAnswerMeta(questionId)) || null;

      if (!hasKnownAnswer && !answerMeta) {
        setPracticeSelectedOption(null);
        setPracticeAnswerLoading(false);
        setGlobalError("Network timeout. Please check your connection and try again.");
        return;
      }

      const cachedExplanation =
        explanationCacheRef.current[questionId] ||
        questionAtAnswerTime.explanation;
      const isRenderable = isRenderableExplanation(cachedExplanation);
      const needsExplanationFetch = !isRenderable;

      if (answerMeta || isRenderable) {
        updatePracticeQuestion(questionId, {
          ...(answerMeta || {}),
          ...(isRenderable ? { explanation: cachedExplanation } : {})
        });
      }
      
      const resolvedQuestion: Question = {
        ...questionAtAnswerTime,
        ...(answerMeta || {}),
        ...(isRenderable ? { explanation: cachedExplanation } : {})
      };
      
      setPracticeAnswered(true);
      if (needsExplanationFetch) setPracticeExplanationLoading(true);

      // Track stats
      const deleted = isDeletedQuestion(resolvedQuestion);
      const correct = !deleted && isAcceptedAnswer(resolvedQuestion, key);
      setPracticeSessionAnswers((prev) => {
        const n = [...prev];
        n[answerIndex] = { selected: key, correct, ignored: deleted };
        return n;
      });
      if (user && !deleted) {
        const newStats = updateStats(
          user.uid,
          questionAtAnswerTime.subject,
          questionAtAnswerTime.topic,
          questionAtAnswerTime.question,
          correct,
          startTime,
          questionAtAnswerTime.subtopic,
          questionAtAnswerTime.pattern_tag,
        );
        setUserStats(newStats);
      }
      if (!deleted) {
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
          topic: questionAtAnswerTime.topic,
          subtopic: questionAtAnswerTime.subtopic,
          pattern_tag: questionAtAnswerTime.pattern_tag,
          mode: "practice",
        });
      }
      if (needsExplanationFetch) {
        void fetchFreshExplanationAfterAnswer(
          questionId,
          answerMeta?.answer
        ).finally(() => {
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


  useEffect(() => {
    if (!practiceAnswered) {
      setPracticeExplanationLoading(false);
      return;
    }
    if (
      isRenderableExplanation(currentPracticeQ?.explanation)
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

  const startMockExam = async (examName: string, year: number) => {
    const selector = await resolvePaperSelector(examName, year);
    const outlinePromise = loadExamOutline(examName, year, false, selector);
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
    const outline = await outlinePromise;
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
    if (!examSession) return;

    let finalQs = examSession.questions;
    if (examSession.hasMore || finalQs.length < examSession.totalCount) {
      const allQs = await loadAllExamQuestions(examSession.examName, examSession.year, {
        paperId: examSession.paperId,
        shiftLabel: examSession.shiftLabel,
      });
      if (allQs.length > 0) finalQs = allQs;
    }

    let finalSession = { ...examSession, questions: finalQs, isFinished: true, hasMore: false };

    // Batch-fetch correct answers (stripped from bulk load for security)
    const ids = finalSession.questions.map(q => q.id).filter(Boolean);
    if (ids.length > 0) {
      try {
        const revealToken = await getApiToken();
        const res = await fetch(`${API_BASE}/reveal-answers`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(revealToken ? { Authorization: `Bearer ${revealToken}` } : {}),
          },
          body: JSON.stringify({ question_ids: ids }),
        });
        if (res.ok) {
          const data = await res.json();
          const answerMap: Record<string, { correct_answer: string | null; correct_answers: string[]; answer_status: string; needs_review: boolean }> = data.answers || {};
          finalSession = {
            ...finalSession,
            questions: finalSession.questions.map(q => {
              const ans = answerMap[q.id];
              if (!ans) return q;
              const primary = ans.correct_answer ?? "";
              return {
                ...q,
                answer: primary,
                answers: ans.correct_answers?.length ? ans.correct_answers : (primary ? [primary] : []),
                answerStatus: ans.answer_status as any,
              };
            }),
          };
        }
      } catch {
        // Keep session without answers — ResultsView handles missing answers gracefully
      }
    }

    void persistMockAttempts(finalSession);
    const sessionId = ++mockPrefetchSessionRef.current;
    warmQuestionExplanations(finalSession.questions, {
      sessionId,
      onHydrate: (questionId, explanation) =>
        updateExamSessionQuestion(questionId, { explanation }),
    });
    setExamSession(finalSession);
    setView("results");
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
      const idToken = await auth.currentUser?.getIdToken() ?? "";
      const res = await fetch("/api/generate-report", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` },
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
      const chatToken = await auth.currentUser?.getIdToken() ?? "";
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${chatToken}` },
        body: JSON.stringify({
          messages: msgs.map((m) => ({
            role: m.role,
            parts: [{ text: m.text }],
          })),
          reportContext: ctx,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Chat request failed");
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
    setBrowsePickerOpen(false);
    setFilterSubject(subject);
    setFilterTopic(topic);
    setFilterSubtopic(subtopic);
    setSearchQuery("");
    setView("browse");
  };

  const openQuestionBankHome = () => {
    setCatalogSearchQuery("");
    setBrowsePickerOpen(true);
    setSelectedExamName("");
    setSelectedExamType("");
    setSelectedYear(0);
    setSelectedPaperId(null);
    setSelectedShiftLabel(null);
    setFilterSubject("All");
    setFilterTopic("All");
    setFilterSubtopic("All");
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

    // Use cached manifest to set paperId synchronously — avoids the async
    // cache-key flip that causes a double loading flash on revisits.
    const cachedManifest = examPaperManifestCache[`${examName}::${latestYear}`];
    const firstPaper = cachedManifest?.papers?.[0];

    setSelectedCommission(commission);
    setSelectedExamName(examName);
    setSelectedExamType(examType);
    setSelectedYear(latestYear);
    setSelectedPaperId(firstPaper?.paper_id ?? null);
    setSelectedShiftLabel(firstPaper?.shift_label ?? null);
    setBrowsePickerOpen(false);
    setFilterSubject("All");
    setSearchQuery("");
    setView("exam-detail");
    void loadExamPapers(examName, latestYear);
    void loadExamOutline(examName, latestYear);
  };

  const topSearchConfig = useMemo(() => {
    if (view === "browse" && (browsePickerOpen || !selectedYear)) {
      return {
        placeholder: "Search exams, commissions, or papers...",
        value: catalogSearchQuery,
        onChange: setCatalogSearchQuery,
      };
    }
    if (view === "commission") {
      return {
        placeholder: selectedCommission
          ? `Search papers in ${selectedCommission}...`
          : "Search papers...",
        value: catalogSearchQuery,
        onChange: setCatalogSearchQuery,
      };
    }
    return null;
  }, [
    browsePickerOpen,
    catalogSearchQuery,
    selectedCommission,
    selectedYear,
    view,
  ]);

  // ── Computed ────────────────────────────────────────────────────────────────

  const commissionMap = useMemo(
    () => catalogSummary?.commission_map || {},
    [catalogSummary]
  );

  const isLocked = (examName: string, year: number, commission?: string): boolean => {
    if (isPremium) return false;
    if (!year) return false; // topic practice uses year=0, never locked
    
    // Only UPSC CSE Prelims GS Paper 1 2026 is free
    const isFreePaper = examName.toLowerCase().includes("prelims gs paper 1") && year === 2026;
    return !isFreePaper;
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
      // Do not load questions for locked (premium) exams
      if (isLocked(selectedExamName, selectedYear, selectedCommission)) return;
      const manifest = examPaperManifestCache[`${selectedExamName}::${selectedYear}`];
      // Wait for the paper manifest to load before fetching questions.
      // This prevents a double-load: without this guard the effect fires once with
      // paperId=null, then fires again after loadExamPapers resolves and sets the
      // real paperId — causing the loading spinner to blink twice.
      if (!manifest) return;
      // If papers need explicit selection (multi-paper / shifted exams), wait.
      const needsPaperSelection = manifest.papers?.some(
        (p) => p.paper_id !== null || p.shift_label !== null
      );
      if (needsPaperSelection && !selectedPaperId && !selectedShiftLabel) return;
      loadExamQuestions(selectedExamName, selectedYear, false, {
        paperId: selectedPaperId,
        shiftLabel: selectedShiftLabel,
      });
    }
  }, [selectedExamName, selectedYear, view, selectedPaperId, selectedShiftLabel, examPaperManifestCache, isPremium]);

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

  if (authLoading || (user && !subscriptionLoaded))
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
      <>
        <LandingPage
          onLogin={handleLogin}
          onUpgrade={() => { sessionStorage.setItem('pendingUpgrade', '1'); handleLogin(); }}
          catalogSummary={catalogSummary}
          feedSummary={feedSummary}
        />
        <AnimatePresence>
          {showAuthModal && (
            <AuthModal
              onClose={() => setShowAuthModal(false)}
              onGoogleSignIn={handleGoogleSignIn}
              onEmailSignIn={handleEmailSignIn}
              onEmailSignUp={handleEmailSignUp}
              onForgotPassword={handleForgotPassword}
            />
          )}
        </AnimatePresence>
      </>
    );

  // ── Main Render ─────────────────────────────────────────────────────────────

  // Avatar initials
  const avatarInitials = user.displayName
    ? user.displayName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
    : "U";

  const mobilePrimaryNav = [
    {
      id: "explore",
      label: "Explore",
      icon: "explore" as const,
      active: ["home", "commission", "exam-detail"].includes(view),
      onClick: () => setView("home"),
    },
    {
      id: "bank",
      label: "Bank",
      icon: "bank" as const,
      active: view === "browse",
      onClick: () => setShowComingSoon(true),
    },
    {
      id: "feed",
      label: "Feed",
      icon: "feed" as const,
      active: view === "feed" || view === "pattern-practice",
      onClick: () => setShowComingSoon(true),
    },
    {
      id: "progress",
      label: "Progress",
      icon: "progress" as const,
      active: ["dashboard", "leaderboard", "badges"].includes(view),
      onClick: () => setView("dashboard"),
    },
    {
      id: "saved",
      label: "Saved",
      icon: "saved" as const,
      active: view === "bookmarks" || view === "profile",
      onClick: () => setView("bookmarks"),
    },
  ];

  return (
    <ToastProvider>
      <div className="app-shell" style={{ display: "flex", flexDirection: "column", height: "100vh", minHeight: "100vh", overflow: "hidden", color: "var(--text)" }}>
        {showComingSoon && <ComingSoonModal onClose={() => setShowComingSoon(false)} />}
        {editQuestion && (
          <EditQuestionModal
            question={editQuestion}
            onClose={() => setEditQuestion(null)}
            onSaved={async () => { setEditQuestion(null); await fetchData(); }}
            onDeleted={() => { setEditQuestion(null); void fetchData(); }}
          />
        )}

        {showOnboarding && user && (
          <OnboardingModal
            userName={user.displayName ?? "Aspirant"}
            onComplete={() => {
              try {
                if (user?.uid) {
                  localStorage.setItem(`pyq_onboarded_${user.uid}`, "1");
                }
              } catch { /* ignore quota errors */ }
              setShowOnboarding(false);
            }}
          />
        )}

        {/* ── Mobile Top Bar ─────────────────────────────────────────────────── */}
        {isMobileLayout && (
        <div className="app-topbar">
          <div
            style={{
              minHeight: 64,
              display: "flex",
              alignItems: "center",
              gap: 18,
              padding: "12px 16px",
            }}
          >
            <div
              onClick={() => setView("home")}
              style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 800, fontSize: 14, color: "var(--text)", cursor: "pointer", userSelect: "none", flexShrink: 0 }}
            >
              <img src="/pwa-192x192.png" alt="" width="30" height="30" aria-hidden="true" />
              <div>
                <div style={{ lineHeight: 1, letterSpacing: 0 }}>
                  Pariksha<span style={{ color: "#14b8a6" }}>GPT</span>
                </div>
              </div>
            </div>

            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>

              {dataLoading && (
                <Loader2 style={{ width: 15, height: 15, color: C.accent }} className="animate-spin" />
              )}

              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 14,
                  border: "1px solid var(--border)",
                  background: "var(--bg-alt)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--text)",
                  cursor: "pointer",
                }}
                aria-label="Open navigation"
              >
                <Menu style={{ width: 18, height: 18 }} />
              </button>

              <div
                onClick={() => setView("profile")}
                style={{
                  width: 34, height: 34, borderRadius: "50%",
                  background: "linear-gradient(135deg, #0f6cbd, #3b82f6)",
                  color: "white", display: "flex", alignItems: "center",
                  justifyContent: "center", fontWeight: 700, fontSize: 12,
                  overflow: "hidden", flexShrink: 0, cursor: "pointer",
                  boxShadow: "0 10px 24px -16px rgba(15,108,189,0.6)",
                }}
              >
                {user.photoURL
                  ? <img src={user.photoURL} style={{ width: "100%", height: "100%", borderRadius: "50%" }} alt="" />
                  : avatarInitials}
              </div>
            </div>
          </div>

          {topSearchConfig && (
            <div className="mobile-search-row">
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "0 12px",
                background: "var(--bg-alt)",
                borderRadius: 16,
                width: "100%",
                height: 44,
                color: "var(--text-tert)",
                border: "1px solid var(--border)",
              }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                  <circle cx="11" cy="11" r="7"/>
                  <path d="m21 21-4.3-4.3"/>
                </svg>
                <input
                  type="text"
                  value={topSearchConfig.value}
                  onChange={(event) => topSearchConfig.onChange(event.target.value)}
                  placeholder={topSearchConfig.placeholder}
                  style={{
                    flex: 1,
                    border: "none",
                    background: "transparent",
                    outline: "none",
                    color: "var(--text)",
                    fontSize: 14,
                    fontFamily: "inherit",
                  }}
                />
              </div>
            </div>
          )}
        </div>
        )}
        {/* ── End Top Bar ─────────────────────────────────────────────────────── */}

        {isMobileLayout && mobileNavOpen && (
          <div className="mobile-drawer-backdrop" onClick={() => setMobileNavOpen(false)}>
            <div className="nav-drawer-surface" onClick={(event) => event.stopPropagation()}>
              <Navbar
                user={user}
                view={view}
                commissionMap={commissionMap}
                dataLoading={dataLoading}
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
                openQuestionBankHome={openQuestionBankHome}
                openCommission={openCommission}
                openExam={openExam}
                openPatternPractice={() => setView("pattern-practice")}
                handleLogout={handleLogout}
                onComingSoon={() => setShowComingSoon(true)}
                mode="drawer"
                onNavigate={() => setMobileNavOpen(false)}
                theme={theme}
                toggleTheme={toggleTheme}
              />
            </div>
          </div>
        )}

        {/* ── Body: sidebar + content ─────────────────────────────────────────── */}
        <div className="app-frame" style={{ flex: 1, overflow: "hidden" }}>
          <div className="nav-sidebar">
            <Navbar
              user={user}
              view={view}
              commissionMap={commissionMap}
              dataLoading={dataLoading}
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
              openQuestionBankHome={openQuestionBankHome}
              openCommission={openCommission}
              openExam={openExam}
              openPatternPractice={() => setView("pattern-practice")}
              handleLogout={handleLogout}
              onComingSoon={() => setShowComingSoon(true)}
              theme={theme}
              toggleTheme={toggleTheme}
            />
          </div>

          {/* Content column */}
          <div className="app-content-scroll">
            <div className="app-content-inner">
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
                    onOpenFeed={() => setShowComingSoon(true)}
                  />
                )}
                {view === "feed" && (
                  <Suspense
                    fallback={
                      <ViewLoadingFallback label="Loading PYQ intelligence..." />
                    }
                  >
                  <FeedView
                    key={feedInitialSubject}
                    subjects={feedSummary?.subjects || []}
                    exams={feedSummary?.exams || []}
                    setView={setView}
                    startPractice={startPractice}
                    startTopicPractice={startTopicPractice}
                    prefetchTopicPractice={prefetchTopicPractice}
                    initialSubject={feedInitialSubject}
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
                {view === "referral" && (
                  <Suspense
                    fallback={
                      <ViewLoadingFallback label="Loading referrals..." />
                    }
                  >
                    <ReferralView
                      userId={user.uid}
                      displayName={user.displayName}
                      email={user.email}
                    />
                  </Suspense>
                )}
                {view === "legal" && (
                  <Suspense fallback={<ViewLoadingFallback label="Loading..." />}>
                    <LegalView setView={setView} />
                  </Suspense>
                )}
                {view === "home" && (
                  <HomeView
                    commissionMap={commissionMap}
                    openCommission={openCommission}
                    openExam={openExam}
                    startPractice={startPractice}
                    setView={setView}
                    openQuestionBankHome={openQuestionBankHome}
                    openFeedWithSubject={(subject) => {
                      setFeedInitialSubject(subject);
                      setView('feed');
                    }}
                    stats={userStats}
                    userDisplayName={user?.displayName ?? null}
                    userId={user?.uid ?? ""}
                  />
                )}
                {view === "commission" && (
                  <CommissionView
                    selectedCommission={selectedCommission}
                    commissionMap={commissionMap}
                    searchQuery={catalogSearchQuery}
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
                      examIsLocked={isLocked(selectedExamName, selectedYear, selectedCommission)}
                      onLockedClick={() => setShowPremiumModal(true)}
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
                      showPicker={browsePickerOpen}
                      setShowPicker={setBrowsePickerOpen}
                      catalogSearchQuery={catalogSearchQuery}
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
                      commissionMap={commissionMap}
                      examLoading={examLoading}
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
                      isPremium={isPremium}
                      onUpgrade={() => setShowPremiumModal(true)}
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

            {/* Global Error Toast — only show when logged in */}
            <AnimatePresence>
              {globalError && user && (
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
                        onClick={() => {
                          void fetchData();
                        }}
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

        {isMobileLayout && (
          <div className="mobile-bottom-nav">
            <div className="mobile-bottom-nav-grid">
              {mobilePrimaryNav.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="mobile-nav-item"
                  data-active={item.active}
                  onClick={item.onClick}
                  style={{
                    border: "none",
                    background: "transparent",
                    fontFamily: "inherit",
                    cursor: "pointer",
                  }}
                >
                  <AppNavIcon name={item.icon} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {flagQuestion && (
          <FlagQuestionModal
            question={flagQuestion}
            userId={user?.uid}
            onClose={() => setFlagQuestion(null)}
          />
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
