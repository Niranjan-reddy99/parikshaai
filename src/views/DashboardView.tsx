import { useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, BarChart, Bar,
} from 'recharts';
import { type View, type CommissionMap } from '../types/index';
import { type UserStats } from '../lib/stats';

interface DashboardViewProps {
  user: { displayName: string | null; uid: string };
  availableSubjects: string[];
  commissionMap: CommissionMap;
  stats: UserStats;
  setView: (v: View) => void;
  openCommission?: (c: string) => void;
  startPractice: (examName: string, year: number, subject?: string, topic?: string) => void;
}

const BENCHMARK = 70;
const PIE_COLORS = ['#2563eb', '#7c3aed', '#f59e0b', '#16a34a', '#ef4444', '#0891b2'];

type Tab = 'overview' | 'strengths' | 'topic' | 'test-analysis';

function parseAttemptTimeToSeconds(value: string): number {
  const raw = (value || '').trim().toLowerCase();
  if (!raw) return 0;
  const minuteMatch = raw.match(/(\d+)m/);
  const secondMatch = raw.match(/(\d+)s/);
  const minutes = minuteMatch ? Number(minuteMatch[1]) : 0;
  const seconds = secondMatch ? Number(secondMatch[1]) : 0;
  return minutes * 60 + seconds;
}

function formatAttemptSeconds(totalSeconds: number): string {
  const safe = Math.max(Math.round(totalSeconds || 0), 0);
  if (safe >= 60) return `${Math.floor(safe / 60)}m ${safe % 60}s`;
  return `${safe}s`;
}

function paceLabel(seconds: number): string {
  if (seconds <= 30) return 'Fast';
  if (seconds <= 60) return 'Balanced';
  return 'Slow';
}

function daysUntil(dateStr: string): number {
  const target = new Date(dateStr).getTime();
  const now = new Date().getTime();
  return Math.max(0, Math.ceil((target - now) / (1000 * 60 * 60 * 24)));
}

function CircularProgress({ pct }: { pct: number }) {
  const size = 72;
  const sw = 6;
  const r = (size - sw * 2) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  const c = size / 2;
  const color = pct >= BENCHMARK ? '#16a34a' : pct >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={c} cy={c} r={r} fill="none" stroke="var(--bg-canvas)" strokeWidth={sw} />
      <circle
        cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={sw}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${c} ${c})`}
        style={{ transition: 'stroke-dasharray 0.5s ease' }}
      />
      <text x={c} y={c} textAnchor="middle" dominantBaseline="middle"
        fontSize="13" fontWeight="700" fill="var(--text)">{pct}%</text>
    </svg>
  );
}

function SectionCard({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: 'var(--bg)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '18px 20px', ...style,
    }}>
      {children}
    </div>
  );
}

function SectionHeader({
  title, action, onAction,
}: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{title}</span>
      {action && (
        <button
          onClick={onAction}
          style={{
            background: 'none', border: 'none', fontSize: 12, color: '#2563eb',
            fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          {action}
        </button>
      )}
    </div>
  );
}

export function DashboardView({
  stats, setView, startPractice, commissionMap,
}: DashboardViewProps) {
  const [tab, setTab] = useState<Tab>('overview');

  const overallAccuracy = useMemo(() => {
    const vals = Object.values(stats.bySubject || {});
    const total = vals.reduce((a, s) => a + s.total, 0);
    const correct = vals.reduce((a, s) => a + s.correct, 0);
    return total > 0 ? Math.round((correct / total) * 100) : 0;
  }, [stats.bySubject]);

  const totalAnswered = stats.totalAnswered || 0;
  const hasData = totalAnswered > 0;

  const subjects = useMemo(() =>
    Object.entries(stats.bySubject || {}).sort((a, b) => b[1].total - a[1].total),
    [stats.bySubject]
  );

  const weakSubjects = useMemo(() =>
    Object.entries(stats.bySubject || {})
      .filter(([, s]) => s.total >= 5)
      .map(([subject, s]) => ({ subject, pct: Math.round((s.correct / s.total) * 100) }))
      .sort((a, b) => a.pct - b.pct)
      .slice(0, 5),
    [stats.bySubject]
  );

  const strengthRows = useMemo(() =>
    Object.entries(stats.bySubject || {})
      .filter(([, s]) => s.total >= 5)
      .map(([subject, s]) => ({
        subject,
        correct: s.correct,
        total: s.total,
        pct: s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0,
        gapToBenchmark: (s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0) - BENCHMARK,
      }))
      .sort((a, b) => b.pct - a.pct),
    [stats.bySubject]
  );

  const strongSubjects = useMemo(() => strengthRows.slice(0, 4), [strengthRows]);

  const topicRows = useMemo(() => {
    const map = new Map<string, {
      topic: string;
      subject: string;
      total: number;
      correct: number;
      lastSeenIndex: number;
    }>();
    (stats.recentAttempts || []).forEach((attempt, index) => {
      const subject = attempt.subject || 'General';
      const topic = attempt.topic || 'General';
      const key = `${subject}::${topic}`;
      const current = map.get(key) || {
        topic,
        subject,
        total: 0,
        correct: 0,
        lastSeenIndex: index,
      };
      current.total += 1;
      if (attempt.correct) current.correct += 1;
      current.lastSeenIndex = Math.min(current.lastSeenIndex, index);
      map.set(key, current);
    });
    return Array.from(map.values())
      .map((row) => ({
        ...row,
        pct: row.total > 0 ? Math.round((row.correct / row.total) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total || a.lastSeenIndex - b.lastSeenIndex);
  }, [stats.recentAttempts]);

  const mostPracticedTopic = topicRows[0] || null;
  const needsWorkTopics = topicRows.filter((row) => row.total >= 2).sort((a, b) => a.pct - b.pct).slice(0, 4);
  const topicCoverageSummary = useMemo(() => {
    const totalSubjectsTouched = subjects.length;
    const totalTopicsTouched = topicRows.length;
    const dominantSubject = subjects[0]?.[0] || '—';
    const dominantSubjectShare = totalAnswered > 0 && subjects[0]
      ? Math.round((subjects[0][1].total / totalAnswered) * 100)
      : 0;
    return {
      totalSubjectsTouched,
      totalTopicsTouched,
      dominantSubject,
      dominantSubjectShare,
    };
  }, [subjects, topicRows, totalAnswered]);

  const subjectCoverageRows = useMemo(() =>
    subjects.slice(0, 8).map(([subject, value]) => ({
      subject,
      total: value.total,
      pct: totalAnswered > 0 ? Math.round((value.total / totalAnswered) * 100) : 0,
      accuracy: value.total > 0 ? Math.round((value.correct / value.total) * 100) : 0,
    })),
    [subjects, totalAnswered]
  );

  const pieData = useMemo(() =>
    subjects.slice(0, 5).map(([subject, { correct, total }], i) => ({
      name: subject.split(' ')[0],
      fullName: subject,
      value: total,
      pct: total > 0 ? Math.round((correct / total) * 100) : 0,
      fill: PIE_COLORS[i % PIE_COLORS.length],
    })),
    [subjects]
  );

  const trendData = useMemo(() => {
    const recent = [...(stats.recentAttempts || [])].reverse();
    if (recent.length < 4) return [];
    const numGroups = Math.min(7, Math.floor(recent.length / 2));
    if (numGroups < 2) return [];
    const chunkSize = Math.ceil(recent.length / numGroups);
    return Array.from({ length: numGroups }, (_, i) => {
      const chunk = recent.slice(i * chunkSize, (i + 1) * chunkSize);
      if (!chunk.length) return null;
      const correct = chunk.filter(a => a.correct).length;
      const accuracy = Math.round((correct / chunk.length) * 100);
      return {
        name: `S${i + 1}`,
        'Accuracy (%)': accuracy,
        'Score (%)': Math.round(accuracy * 0.67),
      };
    }).filter((d): d is NonNullable<typeof d> => d !== null);
  }, [stats.recentAttempts]);

  const scoreDistData = useMemo(() => {
    const entries = Object.values(stats.bySubject || {});
    const b = [0, 0, 0, 0];
    entries.forEach(({ correct, total }) => {
      if (!total) return;
      const pct = (correct / total) * 100;
      if (pct <= 50) b[0]++;
      else if (pct <= 70) b[1]++;
      else if (pct <= 85) b[2]++;
      else b[3]++;
    });
    const sum = b.reduce((a, x) => a + x, 0) || 1;
    return [
      { name: '0-50%', value: Math.round((b[0] / sum) * 100), fill: '#ef4444' },
      { name: '51-70%', value: Math.round((b[1] / sum) * 100), fill: '#f59e0b' },
      { name: '71-85%', value: Math.round((b[2] / sum) * 100), fill: '#22c55e' },
      { name: '86-100%', value: Math.round((b[3] / sum) * 100), fill: '#2563eb' },
    ];
  }, [stats.bySubject]);

  const recentAttempts = (stats.recentAttempts || []).slice(0, 6);
  const recentAttemptReview = useMemo(() => (stats.recentAttempts || []).slice(0, 20), [stats.recentAttempts]);

  const testReviewSummary = useMemo(() => {
    const attempts = recentAttemptReview;
    const total = attempts.length;
    const correct = attempts.filter((attempt) => attempt.correct).length;
    const wrong = total - correct;
    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
    const times = attempts.map((attempt) => parseAttemptTimeToSeconds(attempt.time)).filter((value) => value > 0);
    const avgSeconds = times.length ? Math.round(times.reduce((sum, value) => sum + value, 0) / times.length) : 0;
    const fastestSeconds = times.length ? Math.min(...times) : 0;
    const slowestSeconds = times.length ? Math.max(...times) : 0;
    return { total, correct, wrong, accuracy, avgSeconds, fastestSeconds, slowestSeconds };
  }, [recentAttemptReview]);

  const paceBreakdown = useMemo(() => {
    const buckets = { Fast: 0, Balanced: 0, Slow: 0 };
    recentAttemptReview.forEach((attempt) => {
      const label = paceLabel(parseAttemptTimeToSeconds(attempt.time));
      buckets[label] += 1;
    });
    return [
      { name: 'Fast', value: buckets.Fast, fill: '#16a34a' },
      { name: 'Balanced', value: buckets.Balanced, fill: '#2563eb' },
      { name: 'Slow', value: buckets.Slow, fill: '#f59e0b' },
    ];
  }, [recentAttemptReview]);

  const recentAccuracyTrend = useMemo(() => {
    const ordered = [...recentAttemptReview].reverse();
    return ordered.map((attempt, index) => ({
      name: `A${index + 1}`,
      Accuracy: attempt.correct ? 100 : 0,
      Pace: parseAttemptTimeToSeconds(attempt.time),
    }));
  }, [recentAttemptReview]);

  const mistakeBySubject = useMemo(() => {
    const map = new Map<string, number>();
    recentAttemptReview.forEach((attempt) => {
      if (attempt.correct) return;
      map.set(attempt.subject, (map.get(attempt.subject) || 0) + 1);
    });
    return Array.from(map.entries())
      .map(([subject, wrong]) => ({ subject, wrong }))
      .sort((a, b) => b.wrong - a.wrong)
      .slice(0, 5);
  }, [recentAttemptReview]);

  const mistakeByTopic = useMemo(() => {
    const map = new Map<string, { subject: string; topic: string; wrong: number }>();
    recentAttemptReview.forEach((attempt) => {
      if (attempt.correct) return;
      const subject = attempt.subject || 'General';
      const topic = attempt.topic || 'General';
      const key = `${subject}::${topic}`;
      const current = map.get(key) || { subject, topic, wrong: 0 };
      current.wrong += 1;
      map.set(key, current);
    });
    return Array.from(map.values()).sort((a, b) => b.wrong - a.wrong).slice(0, 5);
  }, [recentAttemptReview]);

  const reviewHighlights = useMemo(() => {
    if (!recentAttemptReview.length) return [];
    const hints: string[] = [];
    if (testReviewSummary.accuracy < BENCHMARK) {
      hints.push(`Recent review accuracy is ${testReviewSummary.accuracy}%, below your ${BENCHMARK}% benchmark.`);
    } else {
      hints.push(`Recent review accuracy is ${testReviewSummary.accuracy}%, holding above benchmark.`);
    }
    if (testReviewSummary.avgSeconds > 60) {
      hints.push(`Average solve time is ${formatAttemptSeconds(testReviewSummary.avgSeconds)} — speed is a drag on output.`);
    } else if (testReviewSummary.avgSeconds > 0) {
      hints.push(`Average solve time is ${formatAttemptSeconds(testReviewSummary.avgSeconds)} — pace is controlled.`);
    }
    if (mistakeBySubject[0]) {
      hints.push(`Most recent mistakes are clustering in ${mistakeBySubject[0].subject}.`);
    }
    if (mistakeByTopic[0]) {
      hints.push(`Top risky topic right now: ${mistakeByTopic[0].subject} → ${mistakeByTopic[0].topic}.`);
    }
    return hints.slice(0, 4);
  }, [recentAttemptReview, testReviewSummary, mistakeBySubject, mistakeByTopic]);

  const firstExamEntry = useMemo(() => {
    const firstC = Object.keys(commissionMap)[0];
    return firstC ? Object.values(commissionMap[firstC] || {})[0] : null;
  }, [commissionMap]);

  const daysLeft = daysUntil('2027-06-06');
  const accuracyColor = overallAccuracy >= BENCHMARK ? '#16a34a' : overallAccuracy >= 50 ? '#f59e0b' : '#ef4444';

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '9px 18px', fontSize: 13.5, fontWeight: active ? 700 : 500,
    color: active ? '#2563eb' : 'var(--text-sec)', background: 'none',
    borderTop: 'none', borderLeft: 'none', borderRight: 'none',
    borderBottom: `2px solid ${active ? '#2563eb' : 'transparent'}`,
    cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' as const,
    transition: 'color 0.1s, border-color 0.1s',
  });

  return (
    <div style={{ fontFamily: "'Inter', sans-serif" }}>

      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 3px', color: 'var(--text)', letterSpacing: '-0.3px' }}>
            My Progress
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-tert)', margin: 0 }}>
            Performance insights across all subjects and exams
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 7,
            padding: '7px 13px', background: '#eff6ff',
            border: '1px solid #bfdbfe', borderRadius: 10,
            fontSize: 12.5, fontWeight: 700, color: '#2563eb',
          }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            {daysLeft} days to Prelims 2027
          </div>
          {stats.streak > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '7px 13px', background: '#fff1f2',
              border: '1px solid #fecdd3', borderRadius: 10,
              fontSize: 12.5, fontWeight: 700, color: '#e11d48',
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
              </svg>
              {stats.streak} day streak
            </div>
          )}
        </div>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 24, gap: 0 }}>
        <button style={tabStyle(tab === 'overview')} onClick={() => setTab('overview')}>Overview</button>
        <button style={tabStyle(tab === 'strengths')} onClick={() => setTab('strengths')}>Strengths &amp; Weaknesses</button>
        <button style={tabStyle(tab === 'topic')} onClick={() => setTab('topic')}>Topic Analysis</button>
        <button style={tabStyle(tab === 'test-analysis')} onClick={() => setTab('test-analysis')}>Test Analysis</button>
      </div>

      {/* ── OVERVIEW TAB ────────────────────────────────────────────────────── */}
      {tab === 'overview' && (
        <>
          {!hasData ? (
            <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '56px 32px', textAlign: 'center' }}>
              <div style={{
                width: 56, height: 56, borderRadius: 14, background: '#eff6ff',
                display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px',
              }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
                </svg>
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>No activity yet</div>
              <div style={{ fontSize: 13.5, color: 'var(--text-sec)', maxWidth: 340, margin: '0 auto 24px', lineHeight: 1.7 }}>
                Answer questions in practice mode to see your accuracy, subject mastery, and improvement trends here.
              </div>
              {firstExamEntry && (
                <button
                  onClick={() => startPractice(firstExamEntry.fullName, firstExamEntry.years?.[0] || 2024)}
                  style={{ padding: '10px 22px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  Start Practicing
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Stat cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>

                {/* Accuracy */}
                <div style={{
                  background: 'var(--bg)', border: '1px solid var(--border)',
                  borderLeft: `3px solid ${accuracyColor}`,
                  borderRadius: 12, padding: '16px 18px',
                }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <CircularProgress pct={overallAccuracy} />
                    <div>
                      <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Accuracy</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', lineHeight: 1 }}>{overallAccuracy}%</div>
                      <div style={{ fontSize: 11, color: overallAccuracy >= BENCHMARK ? '#16a34a' : '#f59e0b', marginTop: 5, fontWeight: 600 }}>
                        {overallAccuracy >= BENCHMARK ? `${overallAccuracy - BENCHMARK}% above target` : `${BENCHMARK - overallAccuracy}% below ${BENCHMARK}% target`}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Questions Solved */}
                <div style={{
                  background: 'var(--bg)', border: '1px solid var(--border)',
                  borderLeft: '3px solid #7c3aed',
                  borderRadius: 12, padding: '16px 18px',
                }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <div style={{ width: 44, height: 44, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#ede9fe' }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <line x1="16" y1="13" x2="8" y2="13"/>
                        <line x1="16" y1="17" x2="8" y2="17"/>
                      </svg>
                    </div>
                    <div>
                      <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Questions Solved</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', lineHeight: 1 }}>{totalAnswered.toLocaleString()}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-sec)', marginTop: 5 }}>all time</div>
                    </div>
                  </div>
                </div>

                {/* Subjects Covered */}
                <div style={{
                  background: 'var(--bg)', border: '1px solid var(--border)',
                  borderLeft: '3px solid #0891b2',
                  borderRadius: 12, padding: '16px 18px',
                }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <div style={{ width: 44, height: 44, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#cffafe' }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                      </svg>
                    </div>
                    <div>
                      <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Subjects</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', lineHeight: 1 }}>{subjects.length}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-sec)', marginTop: 5 }}>
                        {strongSubjects.length > 0 ? `${strongSubjects.length} strong` : 'covered so far'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Day Streak */}
                <div style={{
                  background: 'var(--bg)', border: '1px solid var(--border)',
                  borderLeft: '3px solid #ef4444',
                  borderRadius: 12, padding: '16px 18px',
                }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <div style={{ width: 44, height: 44, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff1f2' }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
                      </svg>
                    </div>
                    <div>
                      <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Day Streak</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', lineHeight: 1 }}>{stats.streak}</div>
                      <div style={{ fontSize: 11, color: stats.streak >= 7 ? '#e11d48' : stats.streak > 0 ? '#16a34a' : 'var(--text-tert)', marginTop: 5, fontWeight: 600 }}>
                        {stats.streak >= 7 ? 'On a roll!' : stats.streak > 0 ? 'Keep going' : 'Start today'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Main 2-col layout */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 20, alignItems: 'start' }}>

                {/* Left column */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                  {/* Performance Trend */}
                  <SectionCard>
                    <SectionHeader title="Performance Trend" />
                    {trendData.length < 2 ? (
                      <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tert)', fontSize: 13 }}>
                        Answer more questions to see your performance trend.
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={trendData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                          <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-tert)' }} />
                          <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--text-tert)' }} />
                          <Tooltip
                            contentStyle={{
                              fontSize: 12, background: 'var(--bg)',
                              border: '1px solid var(--border)', borderRadius: 8,
                            }}
                          />
                          <Legend wrapperStyle={{ fontSize: 12 }} />
                          <Line type="monotone" dataKey="Accuracy (%)" stroke="#2563eb" strokeWidth={2} dot={{ r: 4, fill: '#2563eb' }} activeDot={{ r: 5 }} />
                          <Line type="monotone" dataKey="Score (%)" stroke="#22c55e" strokeWidth={2} dot={{ r: 4, fill: '#22c55e' }} activeDot={{ r: 5 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </SectionCard>

                  {/* Charts row */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

                    {/* Accuracy by Section */}
                    <SectionCard>
                      <SectionHeader title="Accuracy by Section" />
                      {pieData.length === 0 ? (
                        <div style={{ height: 130, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tert)', fontSize: 12 }}>
                          No data yet
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ flexShrink: 0 }}>
                            <PieChart width={110} height={110}>
                              <Pie
                                data={pieData} cx={55} cy={55}
                                innerRadius={28} outerRadius={50}
                                dataKey="value" strokeWidth={0}
                              />
                            </PieChart>
                          </div>
                          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {pieData.map((entry, i) => (
                              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                  <div style={{
                                    width: 8, height: 8, borderRadius: '50%',
                                    background: PIE_COLORS[i % PIE_COLORS.length], flexShrink: 0,
                                  }} />
                                  <span style={{ fontSize: 11.5, color: 'var(--text-sec)', maxWidth: 64, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {entry.name}
                                  </span>
                                </div>
                                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{entry.pct}%</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </SectionCard>

                    {/* Score Distribution */}
                    <SectionCard>
                      <SectionHeader title="Score Distribution" />
                      <ResponsiveContainer width="100%" height={110}>
                        <BarChart data={scoreDistData} margin={{ top: 0, right: 0, left: -32, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                          <XAxis dataKey="name" tick={{ fontSize: 9.5, fill: 'var(--text-tert)' }} />
                          <YAxis tick={{ fontSize: 10, fill: 'var(--text-tert)' }} unit="%" />
                          <Tooltip
                            formatter={(v: number) => [`${v}%`, 'Subjects']}
                            contentStyle={{ fontSize: 11, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8 }}
                          />
                          <Bar dataKey="value" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                      <div style={{ textAlign: 'center', fontSize: 10.5, color: 'var(--text-tert)', marginTop: 4 }}>
                        Score Range
                      </div>
                    </SectionCard>
                  </div>
                </div>

                {/* Right sidebar */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, position: 'sticky', top: 24 }}>

                  {/* Weak Areas */}
                  <SectionCard>
                    <SectionHeader title="Weak Areas" action="View All" onAction={() => setTab('strengths')} />
                    {weakSubjects.length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--text-tert)', lineHeight: 1.6 }}>
                        Practice at least 5 questions per subject to identify weak areas.
                      </div>
                    ) : (
                      <>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {weakSubjects.map(({ subject, pct }) => {
                            const color = pct >= 75 ? '#2563eb' : pct >= 55 ? '#f59e0b' : '#ef4444';
                            return (
                              <div key={subject}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                  <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '75%' }}>
                                    {subject}
                                  </span>
                                  <span style={{ fontSize: 12.5, fontWeight: 700, color }}>{pct}%</span>
                                </div>
                                <div style={{ height: 5, background: 'var(--bg-canvas)', borderRadius: 99, overflow: 'hidden' }}>
                                  <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 99 }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {weakSubjects[0] && (
                          <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--bg-alt)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text-sec)', lineHeight: 1.5 }}>
                            <span style={{ fontWeight: 700, color: 'var(--text)' }}>{weakSubjects[0].subject}</span> needs the most work — start here to gain marks fastest.
                          </div>
                        )}
                      </>
                    )}
                  </SectionCard>

                  {/* Recent Tests */}
                  <SectionCard>
                    <SectionHeader title="Recent Activity" action="Full Analysis" onAction={() => setTab('test-analysis')} />
                    {recentAttempts.length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--text-tert)' }}>No recent activity.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {recentAttempts.map((att, i) => (
                          <div
                            key={i}
                            style={{
                              display: 'flex', alignItems: 'flex-start', gap: 10,
                              paddingBottom: i < recentAttempts.length - 1 ? 10 : 0,
                              borderBottom: i < recentAttempts.length - 1 ? '1px solid var(--border)' : 'none',
                            }}
                          >
                            <div style={{
                              width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                              background: att.correct ? '#dcfce7' : '#fee2e2',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 11, fontWeight: 700,
                              color: att.correct ? '#16a34a' : '#dc2626',
                            }}>
                              {att.correct ? '✓' : '✗'}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {att.q}
                              </div>
                              <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                                <span style={{ fontSize: 10.5, color: '#2563eb', fontWeight: 600 }}>{att.subject}</span>
                                <span style={{ fontSize: 10.5, color: 'var(--text-tert)' }}>{att.time}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </SectionCard>

                  {/* Quick actions */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <button
                      onClick={() => setView('home')}
                      style={{ padding: '10px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', width: '100%' }}
                    >
                      Continue Practicing
                    </button>
                    <button
                      onClick={() => setView('leaderboard')}
                      style={{ padding: '10px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, fontWeight: 500, color: 'var(--text-sec)', cursor: 'pointer', fontFamily: 'inherit', width: '100%' }}
                    >
                      View Leaderboard
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ── STRENGTHS & WEAKNESSES TAB ──────────────────────────────────────── */}
      {tab === 'strengths' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
            {[
              { label: 'Overall Accuracy', value: `${overallAccuracy}%`, hint: overallAccuracy >= BENCHMARK ? 'On track' : `${Math.max(BENCHMARK - overallAccuracy, 0)}% below target`, color: accuracyColor },
              { label: 'Strong Subjects', value: strongSubjects.length, hint: strongSubjects.length > 0 ? `${strongSubjects.map(s => s.subject.split(' ')[0]).join(', ')}` : 'Practice to identify', color: '#16a34a' },
              { label: 'Needs Attention', value: weakSubjects.length, hint: weakSubjects.length > 0 ? `Starting with ${weakSubjects[0].subject}` : 'Keep practicing', color: '#ef4444' },
              { label: 'Practice Streak', value: `${stats.streak}d`, hint: stats.streak > 0 ? 'Consistency is compounding' : 'Restart with a short session', color: '#e11d48' },
            ].map(({ label, value, hint, color }) => (
              <div key={label} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderLeft: `3px solid ${color}`, borderRadius: 12, padding: '16px 18px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>{label}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)', lineHeight: 1 }}>{value}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-sec)', marginTop: 8, lineHeight: 1.5 }}>{hint}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 0.85fr', gap: 20 }}>
            <SectionCard>
              <SectionHeader title="Strongest Subjects" />
              {strongSubjects.length === 0 ? (
                <div style={{ color: 'var(--text-tert)', fontSize: 13, lineHeight: 1.6 }}>
                  Practice at least 5 questions in a subject to classify it as a strength.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {strongSubjects.map(({ subject, pct, total, correct, gapToBenchmark }) => (
                    <div key={subject} style={{ padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-alt)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{subject}</span>
                        <span style={{ fontSize: 12, fontWeight: 800, color: '#16a34a' }}>{pct}%</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-tert)', marginBottom: 8 }}>
                        {correct}/{total} correct · {gapToBenchmark >= 0 ? `${gapToBenchmark}% above target` : `${Math.abs(gapToBenchmark)}% below target`}
                      </div>
                      <div style={{ height: 5, background: 'var(--bg-canvas)', borderRadius: 99, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: '#16a34a', borderRadius: 99 }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            <SectionCard>
              <SectionHeader title="Needs Work" />
              {weakSubjects.length === 0 ? (
                <div style={{ color: 'var(--text-tert)', fontSize: 13, lineHeight: 1.6 }}>
                  No weak pattern yet. Answer more questions to see which subjects need recovery.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {weakSubjects.map(({ subject, pct }) => {
                    const color = pct >= 55 ? '#f59e0b' : '#ef4444';
                    return (
                      <div key={subject} style={{ paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
                          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{subject}</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color }}>{pct}%</span>
                        </div>
                        <div style={{ height: 5, background: 'var(--bg-canvas)', borderRadius: 99, overflow: 'hidden', marginBottom: 6 }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 99 }} />
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-tert)' }}>
                          {pct >= BENCHMARK ? 'Stable — room to improve.' : `Needs ${BENCHMARK - pct}% more to hit target.`}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionCard>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <SectionCard>
              <SectionHeader title="Performance Signals" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {[
                  { label: 'Best current subject', value: strongSubjects[0]?.subject || 'Not enough data', color: '#16a34a' },
                  { label: 'Most fragile subject', value: weakSubjects[0]?.subject || 'No weak signal yet', color: '#ef4444' },
                  { label: 'Correct answers (total)', value: Object.values(stats.bySubject || {}).reduce((a, s) => a + s.correct, 0).toLocaleString(), color: '#2563eb' },
                  { label: 'Total XP earned', value: `${stats.xp} XP`, color: '#7c3aed' },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 13, color: 'var(--text-sec)' }}>{label}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color }}>{value}</span>
                  </div>
                ))}
              </div>
            </SectionCard>

            <SectionCard>
              <SectionHeader title="Where to Focus Next" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ padding: '12px 14px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, fontSize: 12.5, color: '#1d4ed8', lineHeight: 1.6 }}>
                  {weakSubjects.length > 0
                    ? `Open your next session with ${weakSubjects[0].subject} — that's currently your clearest path to gaining marks.`
                    : 'Practice across 2–3 subjects so the app can identify reliable strengths and weak spots.'}
                </div>
                {strongSubjects[0] && (
                  <div style={{ padding: '12px 14px', background: 'var(--bg-alt)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12.5, color: 'var(--text-sec)', lineHeight: 1.6 }}>
                    {strongSubjects[0].subject} is your strongest area. Use it for confidence, but don't over-practice your comfort zone.
                  </div>
                )}
                {needsWorkTopics.length > 0 && (
                  <div style={{ padding: '12px 14px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, fontSize: 12.5, color: '#c2410c', lineHeight: 1.6 }}>
                    Risky topics: {needsWorkTopics.map((row) => `${row.subject} → ${row.topic}`).join(' · ')}.
                  </div>
                )}
              </div>
            </SectionCard>
          </div>
        </div>
      )}

      {/* ── TOPIC ANALYSIS TAB ──────────────────────────────────────────────── */}
      {tab === 'topic' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
            {[
              { label: 'Subjects Touched', value: topicCoverageSummary.totalSubjectsTouched, hint: 'Breadth of your practice', color: '#2563eb' },
              { label: 'Topics Seen', value: topicCoverageSummary.totalTopicsTouched, hint: 'From recent sessions', color: '#7c3aed' },
              { label: 'Most Practiced', value: mostPracticedTopic?.topic || '—', hint: mostPracticedTopic ? `${mostPracticedTopic.total} recent attempts` : 'No topic trail yet', color: '#0891b2' },
              { label: 'Dominant Subject', value: topicCoverageSummary.dominantSubject, hint: topicCoverageSummary.dominantSubjectShare ? `${topicCoverageSummary.dominantSubjectShare}% of your attempts` : 'No mix yet', color: '#f59e0b' },
            ].map(({ label, value, hint, color }) => (
              <div key={label} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderLeft: `3px solid ${color}`, borderRadius: 12, padding: '16px 18px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>{label}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-sec)', marginTop: 8, lineHeight: 1.5 }}>{hint}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: 20 }}>
            <SectionCard>
              <SectionHeader title="Recent Topic Coverage" />
              {topicRows.length === 0 ? (
                <div style={{ color: 'var(--text-tert)', fontSize: 13 }}>No data yet. Start practicing to see topic analysis.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {topicRows.slice(0, 8).map((row) => {
                    const color = row.pct >= 75 ? '#16a34a' : row.pct >= 50 ? '#f59e0b' : '#ef4444';
                    return (
                      <div key={`${row.subject}-${row.topic}`} style={{ padding: '12px 14px', background: 'var(--bg-alt)', borderRadius: 10, border: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{row.topic}</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color }}>{row.pct}%</span>
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-tert)', marginBottom: 8 }}>
                          {row.subject} · {row.correct}/{row.total} correct
                        </div>
                        <div style={{ height: 5, background: 'var(--bg-canvas)', borderRadius: 99, overflow: 'hidden' }}>
                          <div style={{ width: `${row.pct}%`, height: '100%', background: color, borderRadius: 99 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionCard>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <SectionCard>
                <SectionHeader title="Subject Coverage Mix" />
                {subjectCoverageRows.length === 0 ? (
                  <div style={{ color: 'var(--text-tert)', fontSize: 13 }}>No practice data yet.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {subjectCoverageRows.map((row) => (
                      <div key={row.subject}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 12.5, color: 'var(--text)', fontWeight: 500 }}>{row.subject}</span>
                          <span style={{ fontSize: 11.5, color: 'var(--text-tert)', fontWeight: 600 }}>{row.total}Q · {row.pct}%</span>
                        </div>
                        <div style={{ height: 5, background: 'var(--bg-canvas)', borderRadius: 99, overflow: 'hidden' }}>
                          <div style={{ width: `${row.pct}%`, height: '100%', background: '#2563eb', borderRadius: 99 }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>

              {subjectCoverageRows.length > 0 && (
                <SectionCard>
                  <div style={{ fontSize: 12.5, color: 'var(--text-sec)', lineHeight: 1.6 }}>
                    {subjectCoverageRows[0].pct >= 50
                      ? <><span style={{ fontWeight: 700, color: 'var(--text)' }}>{subjectCoverageRows[0].subject}</span> is taking {subjectCoverageRows[0].pct}% of your practice. Consider balancing adjacent areas.</>
                      : 'Practice is spread reasonably. Keep rotating subjects to prevent blind spots.'}
                  </div>
                </SectionCard>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── TEST ANALYSIS TAB ───────────────────────────────────────────────── */}
      {tab === 'test-analysis' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
            {[
              { label: 'Attempts Reviewed', value: testReviewSummary.total, hint: 'Latest answered questions in view', color: '#2563eb' },
              { label: 'Recent Accuracy', value: `${testReviewSummary.accuracy}%`, hint: `${testReviewSummary.correct} correct / ${testReviewSummary.wrong} wrong`, color: testReviewSummary.accuracy >= BENCHMARK ? '#16a34a' : '#ef4444' },
              { label: 'Average Pace', value: formatAttemptSeconds(testReviewSummary.avgSeconds), hint: 'Time per question (recent)', color: '#0891b2' },
              { label: 'Fastest / Slowest', value: `${formatAttemptSeconds(testReviewSummary.fastestSeconds)} / ${formatAttemptSeconds(testReviewSummary.slowestSeconds)}`, hint: 'Useful for spotting overthinking', color: '#f59e0b' },
            ].map(({ label, value, hint, color }) => (
              <div key={label} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderLeft: `3px solid ${color}`, borderRadius: 12, padding: '16px 18px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>{label}</div>
                <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--text)', lineHeight: 1.2 }}>{value}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-sec)', marginTop: 8, lineHeight: 1.5 }}>{hint}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <SectionCard>
              <SectionHeader title="Recent Attempt Accuracy" />
              {recentAccuracyTrend.length < 2 ? (
                <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tert)', fontSize: 13 }}>
                  Answer a few more questions to see your review trend.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={recentAccuracyTrend} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-tert)' }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--text-tert)' }} />
                    <Tooltip
                      contentStyle={{ fontSize: 12, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8 }}
                      formatter={(value: number, key: string) => key === 'Accuracy' ? [`${value}%`, 'Result'] : [formatAttemptSeconds(value), 'Pace']}
                    />
                    <Line type="monotone" dataKey="Accuracy" stroke="#2563eb" strokeWidth={2} dot={{ r: 4, fill: '#2563eb' }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </SectionCard>

            <SectionCard>
              <SectionHeader title="Pace Distribution" />
              {testReviewSummary.total === 0 ? (
                <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tert)', fontSize: 13 }}>
                  No timing data yet.
                </div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={paceBreakdown} margin={{ top: 10, right: 10, left: -20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-tert)' }} />
                      <YAxis tick={{ fontSize: 11, fill: 'var(--text-tert)' }} />
                      <Tooltip contentStyle={{ fontSize: 12, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8 }} />
                      <Bar dataKey="value" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  <div style={{ fontSize: 11.5, color: 'var(--text-tert)', marginTop: 8 }}>
                    Fast: under 30s · Balanced: 30–60s · Slow: above 60s
                  </div>
                </>
              )}
            </SectionCard>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '0.9fr 1.1fr', gap: 20 }}>
            <SectionCard>
              <SectionHeader title="Mistake Concentration" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>By Subject</div>
                  {mistakeBySubject.length === 0 ? (
                    <div style={{ fontSize: 12.5, color: 'var(--text-tert)' }}>No recent mistakes.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {mistakeBySubject.map((row) => (
                        <div key={row.subject} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                          <span style={{ fontSize: 13, color: 'var(--text)' }}>{row.subject}</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#ef4444' }}>{row.wrong} wrong</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>By Topic</div>
                  {mistakeByTopic.length === 0 ? (
                    <div style={{ fontSize: 12.5, color: 'var(--text-tert)' }}>No topic-level error cluster yet.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {mistakeByTopic.map((row) => (
                        <div key={`${row.subject}-${row.topic}`} style={{ padding: '10px 12px', background: 'var(--bg-alt)', border: '1px solid var(--border)', borderRadius: 10 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>{row.topic}</div>
                          <div style={{ fontSize: 11.5, color: 'var(--text-tert)', marginTop: 3 }}>{row.subject} · {row.wrong} wrong</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </SectionCard>

            <SectionCard>
              <SectionHeader title="Reviewer Notes" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {reviewHighlights.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: 'var(--text-tert)' }}>No review insights yet.</div>
                ) : reviewHighlights.map((note) => (
                  <div key={note} style={{ padding: '11px 14px', borderRadius: 10, background: 'var(--bg-alt)', border: '1px solid var(--border)', fontSize: 12.5, color: 'var(--text-sec)', lineHeight: 1.6 }}>
                    {note}
                  </div>
                ))}
              </div>

              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 110px 110px 84px 84px',
                padding: '8px 12px', background: 'var(--bg-alt)',
                borderRadius: '8px 8px 0 0', fontSize: 11, fontWeight: 700,
                color: 'var(--text-tert)', textTransform: 'uppercase',
                letterSpacing: '0.04em', gap: 10,
              }}>
                <div>Question</div>
                <div style={{ textAlign: 'center' }}>Subject</div>
                <div style={{ textAlign: 'center' }}>Topic</div>
                <div style={{ textAlign: 'center' }}>Result</div>
                <div style={{ textAlign: 'right' }}>Pace</div>
              </div>
              {recentAttemptReview.map((att, i) => {
                const seconds = parseAttemptTimeToSeconds(att.time);
                const pace = paceLabel(seconds);
                const paceColor = pace === 'Fast' ? '#16a34a' : pace === 'Balanced' ? '#2563eb' : '#f59e0b';
                return (
                  <div
                    key={i}
                    style={{
                      display: 'grid', gridTemplateColumns: '1fr 110px 110px 84px 84px',
                      padding: '10px 12px', borderTop: '1px solid var(--border)',
                      fontSize: 13, gap: 10, alignItems: 'center',
                    }}
                  >
                    <div style={{ fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {att.q}
                    </div>
                    <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-sec)' }}>
                      {att.subject.split(' ')[0]}
                    </div>
                    <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-sec)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {att.topic || 'General'}
                    </div>
                    <div style={{ textAlign: 'center', fontSize: 12, fontWeight: 600, color: att.correct ? '#16a34a' : '#ef4444' }}>
                      {att.correct ? '✓ Correct' : '✗ Wrong'}
                    </div>
                    <div style={{ textAlign: 'right', fontSize: 11.5, color: paceColor, fontWeight: 700 }}>
                      {att.time} · {pace}
                    </div>
                  </div>
                );
              })}
            </SectionCard>
          </div>
        </div>
      )}
    </div>
  );
}
