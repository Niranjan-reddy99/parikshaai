import { useState, useEffect, useRef, useMemo } from 'react';
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
import { ExamDetailView } from './views/ExamDetailView';
import { PracticeView } from './views/PracticeView';
import { MockView } from './views/MockView';
import { ResultsView } from './views/ResultsView';
import { BrowseView } from './views/BrowseView';
import { ReportView } from './views/ReportView';
import { FeedView } from './views/FeedView';
import { BadgesView } from './views/BadgesView';
import { LeaderboardView } from './views/LeaderboardView';

import { normalizeSubject } from './lib/utils';
import { parseExamName } from './lib/examUtils';
import { getStats, updateStats, type UserStats } from './lib/stats';
import { C } from './lib/tokens';
import { type Question, type View, type ExamSession, type WeightageItem } from './types/index';

export default function App() {
  return <ErrorBoundary><AppContent /></ErrorBoundary>;
}

function AppContent() {
  // ── Auth & Data ─────────────────────────────────────────────────────────────
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // ── Onboarding ───────────────────────────────────────────────────────────────
  const [showOnboarding, setShowOnboarding] = useState(false);

  // ── User Stats (localStorage) ────────────────────────────────────────────────
  const [userStats, setUserStats] = useState<UserStats>(() => getStats('guest'));
  const practiceStartRef = useRef<number>(Date.now());

  // Reload stats when user changes; show onboarding for new users
  useEffect(() => {
    if (user) {
      setUserStats(getStats(user.uid));
      const key = `pyq_onboarded_${user.uid}`;
      if (!localStorage.getItem(key)) setShowOnboarding(true);
    }
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
  const [practiceSubject, setPracticeSubject] = useState('All');
  const [practiceTopic, setPracticeTopic] = useState('All');
  const [practiceSessionAnswers, setPracticeSessionAnswers] = useState<(null | { selected: string; correct: boolean })[]>([]);

  // ── Mock Exam ───────────────────────────────────────────────────────────────
  const [examSession, setExamSession] = useState<ExamSession | null>(null);
  const [examTimer, setExamTimer] = useState(0);

  // ── Dark Mode ───────────────────────────────────────────────────────────────
  const [darkMode, setDarkMode] = useState(true);
  const toggleDarkMode = () => setDarkMode(d => {
    const next = !d;
    document.documentElement.classList.toggle('light', !next);
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
      const key = import.meta.env.VITE_ADMIN_KEY || 'upsc-admin-secret-key-change-me';
      const res = await fetch('http://localhost:8000/admin/cost-log', { headers: { 'x-admin-key': key } });
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
      const key = import.meta.env.VITE_ADMIN_KEY || 'upsc-admin-secret-key-change-me';
      const params = new URLSearchParams({ old_name: renameModal.fullName, new_name: renameValue.trim(), exam_year: String(renameModal.year) });
      const res = await fetch(`http://localhost:8000/admin/rename-exam?${params}`, { method: 'PATCH', headers: { 'x-admin-key': key } });
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
      const key = import.meta.env.VITE_ADMIN_KEY || 'upsc-admin-secret-key-change-me';
      const params = new URLSearchParams({ exam_name: deleteExamTarget.fullName, exam_year: String(deleteExamTarget.year) });
      const res = await fetch(`http://localhost:8000/admin/delete-exam?${params}`, { method: 'DELETE', headers: { 'x-admin-key': key } });
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

  const doAddBlankQuestion = async (examName: string, year: number) => {
    try {
      const existing = questions.filter(q => q.exam === examName && q.year === year);
      const nextNum = existing.length ? Math.max(...existing.map(q => q.question_number || 0)) + 1 : 1;
      
      const newQ = {
        exam_name: examName,
        exam_year: year,
        question_number: nextNum
      };
      
      const key = import.meta.env.VITE_ADMIN_KEY || 'upsc-admin-secret-key-change-me';
      const res = await fetch('http://localhost:8000/admin/add-blank-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': key },
        body: JSON.stringify(newQ)
      });
      if (!res.ok) throw new Error(await res.text());
      
      alert(`Successfully added Question ${nextNum}! Please refresh the page to edit it in the feed.`);
      fetchData();
    } catch (e: any) {
      alert("Failed to add question: " + e.message);
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

  const fetchData = async () => {
    if (!user) return;
    setDataLoading(true);
    try {
      const res = await fetch('http://localhost:8000/questions?limit=10000');
      if (res.ok) {
        const data = await res.json();
        setQuestions((data.questions || []).map((q: any) => ({
          id: q.id,
          question: q.question_text ?? q.question ?? '',
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
        })));
        setGlobalError(null);
      } else {
        setGlobalError('Backend returned an error. Check that uvicorn is running on port 8000.');
      }
    } catch {
      setGlobalError('Cannot reach backend on port 8000. Start it: cd backend && uvicorn main:app --reload --port 8000');
    } finally {
      setDataLoading(false);
    }
  };

  const startPractice = (examName: string, year: number, subject = 'All', topic = 'All') => {
    let q = questions.filter(x => x.exam === examName && x.year === year);
    if (subject !== 'All') q = q.filter(x => x.subject === subject);
    if (topic !== 'All') q = q.filter(x => x.topic === topic);
    const shuffled = [...q].sort(() => Math.random() - 0.5);
    setPracticeQueue(shuffled); setPracticeIndex(0);
    setPracticeAnswered(false); setPracticeSelectedOption(null);
    setPracticeSubject(subject); setPracticeTopic(topic);
    practiceStartRef.current = Date.now();
    setPracticeSessionAnswers(new Array(shuffled.length).fill(null));
    setView('practice');
  };

  const currentPracticeQ = practiceQueue[practiceIndex] ?? null;

  const handleAnswerSelect = async (key: string) => {
    if (!currentPracticeQ?.id || practiceAnswered || practiceAnswerLoading) return;
    const startTime = practiceStartRef.current;
    setPracticeSelectedOption(key); setPracticeAnswerLoading(true);
    try {
      const [qRes, eRes] = await Promise.allSettled([
        fetch(`http://localhost:8000/questions/${currentPracticeQ.id}`),
        fetch(`http://localhost:8000/explanation/${currentPracticeQ.id}`),
      ]);
      let answer = currentPracticeQ.answer || '';
      let explanation = 'No explanation available.';
      if (qRes.status === 'fulfilled' && qRes.value.ok) { const d = await qRes.value.json(); answer = d.correct_answer ?? d.answer ?? answer; }
      if (eRes.status === 'fulfilled' && eRes.value.ok) { const d = await eRes.value.json(); explanation = d.explanation ?? explanation; }
      setPracticeQueue(prev => prev.map((q, i) => i === practiceIndex ? { ...q, answer, explanation } : q));
      // Track stats
      const correct = key === answer;
      setPracticeSessionAnswers(prev => { const n = [...prev]; n[practiceIndex] = { selected: key, correct }; return n; });
      if (user) {
        const newStats = updateStats(user.uid, currentPracticeQ.subject, currentPracticeQ.topic, currentPracticeQ.question, correct, startTime);
        setUserStats(newStats);
      }
    } catch { } finally { setPracticeAnswerLoading(false); setPracticeAnswered(true); }
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
    } else {
      setPracticeAnswered(false);
      setPracticeSelectedOption(null);
    }
    practiceStartRef.current = Date.now();
  };

  const startMockExam = (examName: string, year: number) => {
    const qs = questions.filter(q => q.exam === examName && q.year === year);
    if (!qs.length) { setGlobalError('No questions found for this exam.'); return; }
    const duration = qs.length * 72;
    setExamSession({ questions: qs, currentIndex: 0, answers: {}, startTime: Date.now(), duration, isFinished: false, examName, year });
    setExamTimer(duration); setView('mock');
  };

  const finishExam = () => {
    if (examSession) { setExamSession({ ...examSession, isFinished: true }); setView('results'); }
  };

  const generateReport = async (examName: string, year: number) => {
    const targetQs = questions.filter(q => q.exam === examName && q.year === year);
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

  const openExam = (examName: string, commission: string, examType: string) => {
    const { examType: et } = parseExamName(examName);
    const info = commissionMap[commission]?.[et] ?? commissionMap[commission]?.[examType];
    const latestYear = info?.years[0] ?? new Date().getFullYear();
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
    questions.forEach(q => {
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
  }, [questions]);

  const examYearQs = useMemo(() =>
    questions.filter(q => q.exam === selectedExamName && q.year === selectedYear),
    [questions, selectedExamName, selectedYear]
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
      <header style={{ borderBottom: `1px solid ${C.border}`, padding: '0 40px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 26, height: 26, border: `1.5px solid ${C.accent}40`, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.accentDim }}>
            <svg viewBox="0 0 14 14" fill="none" width="13" height="13">
              <path d="M7 1L12.5 4.25V10.75L7 14L1.5 10.75V4.25L7 1Z" stroke="#2dd4bf" strokeWidth="1.2" strokeLinejoin="round"/>
              <path d="M7 4L9.6 5.5V8.5L7 10L4.4 8.5V5.5L7 4Z" fill="#2dd4bf" opacity=".5"/>
            </svg>
          </div>
          <span style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 17, fontWeight: 600, color: C.text, letterSpacing: '-0.2px' }}>
            Parik<em style={{ fontStyle: 'italic', color: 'var(--c-heading-em)' }}>sha</em>
          </span>
        </div>
        <button
          onClick={toggleDarkMode}
          style={{ padding: '6px 12px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, color: C.textSec, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          {darkMode ? <Sun style={{ width: 13, height: 13 }} /> : <Moon style={{ width: 13, height: 13 }} />}
          {darkMode ? 'Light mode' : 'Dark mode'}
        </button>
      </header>

      {/* Hero */}
      <main style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 380px', gap: 64, maxWidth: 1080, margin: '0 auto', padding: '72px 40px 64px', alignItems: 'center', width: '100%', boxSizing: 'border-box' }}>

        {/* Left: hero text */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <div style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", color: C.accent, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 20, height: 1, background: C.accent, display: 'inline-block' }} />
            UPSC · APPSC · TSPSC
          </div>
          <h1 style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 48, fontWeight: 400, lineHeight: 1.12, letterSpacing: '-0.8px', color: C.text, marginBottom: 24 }}>
            Practice smarter.<br />
            <em style={{ fontStyle: 'italic', color: 'var(--c-heading-em)' }}>Score higher.</em>
          </h1>
          <p style={{ fontSize: 16, color: C.textSec, lineHeight: 1.65, marginBottom: 36, maxWidth: 480 }}>
            Real PYQ papers from UPSC, APPSC, and TSPSC — with AI-powered explanations, timed mock tests, and subject-wise performance insights to help you crack your exam.
          </p>

          {/* Features */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 40 }}>
            {[
              { icon: '📚', label: 'Previous Year Questions', detail: 'Curated PYQs from major commissions' },
              { icon: '⏱', label: 'Timed Mock Tests', detail: 'Simulate real exam conditions' },
              { icon: '📊', label: 'AI Performance Reports', detail: 'Deep insights on your strengths & gaps' },
              { icon: '🏆', label: 'Progress Tracking', detail: 'XP, streaks, badges and leaderboard' },
            ].map(({ icon, label, detail }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: C.accentDim, border: `1px solid ${C.accent}26`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>{icon}</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: C.text }}>{label}</div>
                  <div style={{ fontSize: 12, color: C.textTert, marginTop: 1 }}>{detail}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Stats strip */}
          <div style={{ display: 'flex', gap: 28, paddingTop: 24, borderTop: `1px solid ${C.border}` }}>
            {[
              { num: '10,000+', label: 'Questions' },
              { num: '50+', label: 'Papers' },
              { num: '15+', label: 'Subjects' },
              { num: 'Free', label: 'Always' },
            ].map(({ num, label }) => (
              <div key={label}>
                <div style={{ fontSize: 18, fontFamily: "'Fraunces', Georgia, serif", fontWeight: 400, color: C.text, letterSpacing: '-0.3px' }}>{num}</div>
                <div style={{ fontSize: 11, color: C.textTert, fontFamily: "'DM Mono', monospace", marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Right: sign-in card */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 }}>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 20, padding: 32, boxShadow: '0 8px 40px rgba(0,0,0,0.18)' }}>
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 18, fontFamily: "'Fraunces', Georgia, serif", fontWeight: 400, color: C.text, marginBottom: 6, letterSpacing: '-0.2px' }}>
                Get started for free
              </div>
              <div style={{ fontSize: 13, color: C.textTert }}>Sign in to save your progress and access all features.</div>
            </div>

            <button
              onClick={handleLogin}
              style={{ width: '100%', padding: '13px 0', background: C.accent, border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, color: '#0a1a18', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 10, transition: 'opacity 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.opacity = '0.9'}
              onMouseLeave={e => e.currentTarget.style.opacity = '1'}
            >
              <LogIn style={{ width: 16, height: 16 }} /> Sign in with Google
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0' }}>
              <div style={{ flex: 1, height: 1, background: C.border }} />
              <span style={{ fontSize: 11, color: C.textTert, fontFamily: "'DM Mono', monospace" }}>or</span>
              <div style={{ flex: 1, height: 1, background: C.border }} />
            </div>

            <button
              onClick={() => setUser({ uid: 'guest', displayName: 'Guest User', email: 'guest@localhost', photoURL: null } as any)}
              style={{ width: '100%', padding: '12px 0', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 13, fontWeight: 500, color: C.textSec, cursor: 'pointer', transition: 'all 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--c-border-l)'; e.currentTarget.style.color = C.text; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textSec; }}
            >
              Continue as Guest
            </button>

            <p style={{ fontSize: 11, color: C.textTert, textAlign: 'center', marginTop: 20, lineHeight: 1.6 }}>
              Guest mode doesn't save progress.<br />Sign in with Google to keep your streak and XP.
            </p>

            {/* Feature tags */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 20, paddingTop: 20, borderTop: `1px solid ${C.border}` }}>
              {['No ads', 'No paywall', 'Free forever', 'Open source'].map(tag => (
                <span key={tag} style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", color: C.textTert, background: 'var(--c-surface2)', border: `1px solid ${C.border}`, borderRadius: 99, padding: '3px 10px' }}>{tag}</span>
              ))}
            </div>
          </div>
        </motion.div>
      </main>

      {/* Footer strip */}
      <footer style={{ borderTop: `1px solid ${C.border}`, padding: '16px 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: C.textTert, fontFamily: "'DM Mono', monospace" }}>
          Pariksha · UPSC Preparation Platform
        </span>
        <span style={{ fontSize: 11, color: C.textTert }}>
          Practice with real PYQs. Track your progress. Crack your exam.
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
              questions={questions}
              commissionMap={commissionMap}
              stats={userStats}
              setView={setView}
              openCommission={openCommission}
              startPractice={startPractice}
            />
          )}
          {view === 'feed' && (
            <FeedView questions={questions} setView={setView} startPractice={startPractice} />
          )}
          {view === 'badges' && (
            <BadgesView stats={userStats} questions={questions} />
          )}
          {view === 'leaderboard' && (
            <LeaderboardView stats={userStats} user={user} />
          )}
          {view === 'home' && (
            <HomeView
              questions={questions} commissionMap={commissionMap} dataLoading={dataLoading} isAdmin={isAdmin}
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
            <ExamDetailView
              selectedCommission={selectedCommission} selectedExamType={selectedExamType}
              selectedExamName={selectedExamName} selectedYear={selectedYear} setSelectedYear={setSelectedYear}
              commissionMap={commissionMap} examYearQs={examYearQs} weightage={weightage} questions={questions}
              startPractice={startPractice} startMockExam={startMockExam} browseWithFilters={browseWithFilters} setView={setView}
              isAdmin={isAdmin} setRenameModal={setRenameModal} setRenameValue={setRenameValue} setDeleteExamTarget={setDeleteExamTarget}
              doAddBlankQuestion={doAddBlankQuestion}
            />
          )}
          {view === 'practice' && (
            <PracticeView
              practiceQueue={practiceQueue} practiceIndex={practiceIndex} practiceAnswered={practiceAnswered}
              practiceSelectedOption={practiceSelectedOption} practiceAnswerLoading={practiceAnswerLoading}
              practiceSubject={practiceSubject} practiceTopic={practiceTopic}
              selectedExamName={selectedExamName} selectedExamType={selectedExamType} selectedYear={selectedYear}
              questions={questions} currentPracticeQ={currentPracticeQ}
              isAdmin={isAdmin} setEditQuestion={setEditQuestion}
              handleAnswerSelect={handleAnswerSelect} nextPracticeQuestion={nextPracticeQuestion} prevPracticeQuestion={prevPracticeQuestion}
              jumpToPracticeQuestion={jumpToPracticeQuestion}
              startPractice={startPractice} setView={setView}
              sessionAnswers={practiceSessionAnswers}
            />
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
            <BrowseView
              examYearQs={examYearQs} filteredQs={filteredQs}
              selectedExamType={selectedExamType} selectedYear={selectedYear}
              filterSubject={filterSubject} filterTopic={filterTopic} filterSubtopic={filterSubtopic} searchQuery={searchQuery}
              setSearchQuery={setSearchQuery} setFilterSubject={setFilterSubject}
              setFilterTopic={setFilterTopic} setFilterSubtopic={setFilterSubtopic}
              setSelectedQuestion={setSelectedQuestion} setView={setView}
              isAdmin={isAdmin} setEditQuestion={setEditQuestion}
            />
          )}
          {view === 'report' && (
            <ReportView
              selectedExamType={selectedExamType} selectedExamName={selectedExamName} selectedYear={selectedYear}
              examYearQs={examYearQs} reportData={reportData} reportLoading={reportLoading} reportError={reportError}
              chatMessages={chatMessages} chatInput={chatInput} setChatInput={setChatInput} chatLoading={chatLoading}
              generateReport={generateReport} sendChatMessage={sendChatMessage} setView={setView}
            />
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
            setQuestions(prev => prev.map(q => q.id === updated.id ? updated : q));
            setPracticeQueue(prev => prev.map(q => q.id === updated.id ? updated : q));
            setEditQuestion(null);
          }}
          onDeleted={deletedId => {
            setQuestions(prev => prev.filter(q => q.id !== deletedId));
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
