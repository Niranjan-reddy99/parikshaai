import { useMemo, useState, useEffect } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar,
} from 'recharts';
import { type View, type CommissionMap } from '../types/index';
import { type UserStats } from '../lib/stats';
import { API_BASE } from '../lib/api';
import { auth } from '../firebase';

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

type Tab = 'overview' | 'strengths' | 'topic' | 'patterns' | 'test-analysis';

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

function SectionCard({ children, style, className }: { children: React.ReactNode; style?: React.CSSProperties; className?: string }) {
  return (
    <div className={className} style={{
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

  // Server-side weakness report — resolves pattern tags from all past attempts,
  // including those answered before pattern tagging was introduced.
  const [serverReport, setServerReport] = useState<{
    pattern_weaknesses: { pattern_tag: string; accuracy: number; total: number; correct: number }[];
    topic_weaknesses: { subject: string; topic: string; subtopic: string; accuracy: number; total: number; correct: number }[];
    weaknesses: { subject: string; accuracy: number; total: number; correct: number }[];
  } | null>(null);
  const [patternLoading, setPatternLoading] = useState(false);

  useEffect(() => {
    if (tab !== 'patterns') return;
    let cancelled = false;
    setPatternLoading(true);
    (async () => {
      try {
        const currentUser = auth.currentUser;
        if (!currentUser) { setPatternLoading(false); return; }
        const token = await currentUser.getIdToken();
        const res = await fetch(`${API_BASE}/user/weakness-report`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setServerReport(data);
        }
      } catch (e) {
        console.error('weakness-report fetch failed:', e);
      } finally {
        if (!cancelled) setPatternLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tab]);

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

  const patternWeaknesses = useMemo(() => {
    return Object.entries(stats.byPattern || {})
      .filter(([, v]) => v.total >= 2)
      .map(([pattern, v]) => ({
        pattern,
        total: v.total,
        correct: v.correct,
        pct: v.total > 0 ? Math.round((v.correct / v.total) * 100) : 0,
      }))
      .sort((a, b) => a.pct - b.pct);
  }, [stats.byPattern]);

  const topicWeaknesses = useMemo(() => {
    return Object.values(stats.byTopic || {})
      .filter((v) => v.total >= 2)
      .map((v) => ({
        ...v,
        pct: v.total > 0 ? Math.round((v.correct / v.total) * 100) : 0,
      }))
      .sort((a, b) => a.pct - b.pct)
      .slice(0, 6);
  }, [stats.byTopic]);

  const accuracyColor = overallAccuracy >= BENCHMARK ? '#16a34a' : overallAccuracy >= 50 ? '#f59e0b' : '#ef4444';
  const primaryWeakSubject = weakSubjects[0] || null;
  const primaryWeakTopic = needsWorkTopics[0] || null;
  const focusTitle = primaryWeakTopic
    ? `${primaryWeakTopic.subject}: ${primaryWeakTopic.topic}`
    : primaryWeakSubject?.subject || 'Build a reliable practice signal';
  const focusCopy = primaryWeakTopic
    ? `${primaryWeakTopic.pct}% accuracy across recent attempts. A short focused set here will give you the fastest improvement signal.`
    : primaryWeakSubject
      ? `${primaryWeakSubject.pct}% accuracy right now. Start here before adding more new topics.`
      : 'Answer one short practice set so Pariksha can identify your weak and strong areas clearly.';
  const progressTone = overallAccuracy >= BENCHMARK
    ? 'You are above the target benchmark. Keep the rhythm steady.'
    : overallAccuracy >= 50
      ? 'You are close. The fastest gain is focused review, not more random solving.'
      : 'Start small. Accuracy will improve fastest by fixing one weak area at a time.';

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '9px 18px', fontSize: 13.5, fontWeight: active ? 700 : 500,
    color: active ? '#2563eb' : 'var(--text-sec)', background: 'none',
    borderTop: 'none', borderLeft: 'none', borderRight: 'none',
    borderBottom: `2px solid ${active ? '#2563eb' : 'transparent'}`,
    cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' as const,
    transition: 'color 0.1s, border-color 0.1s',
  });

  return (
    <div className="dashboard-shell" style={{ fontFamily: "'Inter', sans-serif" }}>

      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="dashboard-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 3px', color: 'var(--text)', letterSpacing: '-0.3px' }}>
            My Progress
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-tert)', margin: 0 }}>
            Clear signals on where you are improving and where you should focus next.
          </p>
        </div>
        <div className="dashboard-header-badges" style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 7,
            padding: '7px 13px', background: '#eff6ff',
            border: '1px solid #bfdbfe', borderRadius: 10,
            fontSize: 12.5, fontWeight: 700, color: '#2563eb',
          }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v18h18"/><polyline points="7 14 11 10 15 13 21 7"/>
            </svg>
            {overallAccuracy}% overall accuracy
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
      <div className="dashboard-tabs" style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 24, gap: 0 }}>
        <button style={tabStyle(tab === 'overview')} onClick={() => setTab('overview')}>Overview</button>
        <button style={tabStyle(tab === 'strengths')} onClick={() => setTab('strengths')}>Focus Areas</button>
        <button style={tabStyle(tab === 'topic')} onClick={() => setTab('topic')}>Topics</button>
        <button style={tabStyle(tab === 'patterns')} onClick={() => setTab('patterns')}>Patterns</button>
        <button style={tabStyle(tab === 'test-analysis')} onClick={() => setTab('test-analysis')}>Tests</button>
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
            <div className="progress-overview">
              <section className="progress-coach-panel">
                <div className="progress-coach-copy">
                  <span className="progress-eyebrow">Focus now</span>
                  <h2>{focusTitle}</h2>
                  <p>{focusCopy}</p>
                </div>
                <div className="progress-coach-actions">
                  <button onClick={() => setTab(primaryWeakSubject ? 'strengths' : 'topic')}>
                    View focus areas
                  </button>
                  <button className="secondary" onClick={() => setView('home')}>
                    Practice
                  </button>
                </div>
              </section>

              <div className="progress-quick-stats">
                {[
                  {
                    label: 'Accuracy',
                    value: `${overallAccuracy}%`,
                    hint: progressTone,
                    color: accuracyColor,
                  },
                  {
                    label: 'Solved',
                    value: totalAnswered.toLocaleString(),
                    hint: 'Total questions answered so far.',
                    color: '#2563eb',
                  },
                  {
                    label: 'Pace',
                    value: testReviewSummary.avgSeconds > 0 ? formatAttemptSeconds(testReviewSummary.avgSeconds) : 'No signal',
                    hint: testReviewSummary.avgSeconds > 0 ? `${paceLabel(testReviewSummary.avgSeconds)} recent pace.` : 'Answer timed questions to measure pace.',
                    color: '#0891b2',
                  },
                ].map((item) => (
                  <div className="progress-stat-card" key={item.label} style={{ borderTopColor: item.color }}>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                    <p>{item.hint}</p>
                  </div>
                ))}
              </div>

              <div className="progress-simple-grid">
                <SectionCard className="progress-simple-card">
                  <SectionHeader title="Improve first" action="Open details" onAction={() => setTab('strengths')} />
                  {weakSubjects.length === 0 ? (
                    <p className="progress-empty-copy">Practice a little more to reveal your first weak area.</p>
                  ) : (
                    <div className="progress-list">
                      {weakSubjects.slice(0, 3).map(({ subject, pct }, index) => (
                        <div className="progress-list-row" key={subject}>
                          <span className="progress-row-index">{index + 1}</span>
                          <div>
                            <strong>{subject}</strong>
                            <p>{pct}% accuracy. Review this before adding new topics.</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>

                <SectionCard className="progress-simple-card">
                  <SectionHeader title="Keep confident" action="See topics" onAction={() => setTab('topic')} />
                  {strongSubjects.length === 0 ? (
                    <p className="progress-empty-copy">A few more attempts will show your reliable areas.</p>
                  ) : (
                    <div className="progress-list">
                      {strongSubjects.slice(0, 3).map(({ subject, pct, total }) => (
                        <div className="progress-list-row is-strong" key={subject}>
                          <span className="progress-row-index">OK</span>
                          <div>
                            <strong>{subject}</strong>
                            <p>{pct}% accuracy from {total} attempts. Use this as confidence, not comfort-zone practice.</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── STRENGTHS & WEAKNESSES TAB ──────────────────────────────────────── */}
      {tab === 'strengths' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="dashboard-stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
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

          <div className="dashboard-split-grid" style={{ display: 'grid', gridTemplateColumns: '1.15fr 0.85fr', gap: 20 }}>
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

          <div className="dashboard-half-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
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
          <div className="dashboard-stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
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

          <div className="dashboard-split-grid" style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: 20 }}>
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

      {/* ── PATTERNS TAB ────────────────────────────────────────────────────── */}
      {tab === 'patterns' && (() => {
        // Merge localStorage (real-time) + server (covers all past attempts).
        // Server data is authoritative for historical pattern accuracy.
        const serverPatterns = serverReport?.pattern_weaknesses ?? [];
        const serverTopics   = serverReport?.topic_weaknesses   ?? [];
        const activePatternList = serverPatterns.length > 0 ? serverPatterns : patternWeaknesses;
        const activeTopicList   = serverTopics.length   > 0 ? serverTopics   : topicWeaknesses;
        const loading = tab === 'patterns' && serverReport === null;

        return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {loading ? (
            <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '40px 32px', textAlign: 'center', color: 'var(--text-tert)', fontSize: 14 }}>
              Loading pattern analysis…
            </div>
          ) : activePatternList.length === 0 && activeTopicList.length === 0 ? (
            <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '56px 32px', textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>No pattern data yet</div>
              <div style={{ fontSize: 13.5, color: 'var(--text-sec)', maxWidth: 380, margin: '0 auto', lineHeight: 1.7 }}>
                Answer a few practice questions — your pattern-level weaknesses will appear here automatically.
              </div>
            </div>
          ) : (
            <>
              {/* Pattern accuracy cards */}
              {activePatternList.length > 0 && (
                <SectionCard>
                  <SectionHeader title="Pattern-level accuracy" />
                  <p style={{ fontSize: 12, color: 'var(--text-tert)', marginBottom: 14, lineHeight: 1.6 }}>
                    Where you struggle by question style — not just subject.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {activePatternList.map((item) => {
                      const label = (item as any).pattern_tag ?? (item as any).pattern;
                      const pct   = (item as any).accuracy    ?? (item as any).pct ?? 0;
                      const { correct, total } = item as any;
                      const color = pct >= 70 ? '#16a34a' : pct >= 50 ? '#f59e0b' : '#ef4444';
                      const isWeak = pct < BENCHMARK;
                      return (
                        <div key={label} style={{ padding: '12px 14px', background: isWeak ? 'rgba(239,68,68,0.04)' : 'var(--bg-alt)', border: `1px solid ${isWeak ? 'rgba(239,68,68,0.2)' : 'var(--border)'}`, borderRadius: 10 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ padding: '3px 8px', background: 'rgba(124,111,255,0.12)', color: '#7c6fff', fontSize: 10, fontWeight: 700, borderRadius: 6, textTransform: 'uppercase' }}>{label}</span>
                              {isWeak && <span style={{ fontSize: 10, color: '#ef4444', fontWeight: 600 }}>needs work</span>}
                            </div>
                            <span style={{ fontSize: 13, fontWeight: 800, color }}>{pct}%</span>
                          </div>
                          <div style={{ height: 5, background: 'var(--bg-canvas)', borderRadius: 99, overflow: 'hidden', marginBottom: 6 }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 99 }} />
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: 11.5, color: 'var(--text-tert)' }}>{correct}/{total} correct</span>
                            {isWeak && (
                              <button onClick={() => setView('home')}
                                style={{ fontSize: 11, fontWeight: 600, color: '#2563eb', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>
                                Practice this →
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </SectionCard>
              )}

              {/* Topic weakness cards */}
              {activeTopicList.length > 0 && (
                <SectionCard>
                  <SectionHeader title="Weakest topics (all attempts)" />
                  <p style={{ fontSize: 12, color: 'var(--text-tert)', marginBottom: 14, lineHeight: 1.6 }}>
                    Topics where your accuracy is lowest across all attempts — not just recent ones.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {activeTopicList.map((item) => {
                      const { subject, topic, subtopic, correct, total } = item as any;
                      const pct = (item as any).accuracy ?? (item as any).pct ?? 0;
                      const color = pct >= 70 ? '#16a34a' : pct >= 50 ? '#f59e0b' : '#ef4444';
                      const isWeak = pct < BENCHMARK;
                      return (
                        <div key={`${subject}::${topic}`} style={{ padding: '11px 13px', background: isWeak ? 'rgba(239,68,68,0.04)' : 'var(--bg-alt)', border: `1px solid ${isWeak ? 'rgba(239,68,68,0.18)' : 'var(--border)'}`, borderRadius: 10 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                            <div>
                              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{topic}</span>
                              <div style={{ fontSize: 11, color: 'var(--text-tert)', marginTop: 2 }}>
                                {subject}{subtopic ? ` · ${subtopic}` : ''}
                              </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                              {isWeak && (
                                <button onClick={() => startPractice('', 0, subject, topic)}
                                  style={{ fontSize: 11, fontWeight: 600, color: '#2563eb', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>
                                  Practice →
                                </button>
                              )}
                              <span style={{ fontSize: 13, fontWeight: 800, color }}>{pct}%</span>
                            </div>
                          </div>
                          <div style={{ height: 4, background: 'var(--bg-canvas)', borderRadius: 99, overflow: 'hidden' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 99 }} />
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-tert)', marginTop: 5 }}>{correct}/{total} correct</div>
                        </div>
                      );
                    })}
                  </div>
                </SectionCard>
              )}

              {/* Actionable insight */}
              {(activePatternList[0] || activeTopicList[0]) && (() => {
                const p0 = activePatternList[0] as any;
                const t0 = activeTopicList[0] as any;
                const p0pct = p0?.accuracy ?? p0?.pct ?? 0;
                return (
                  <SectionCard>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Next best move</div>
                    <div style={{ fontSize: 13, color: 'var(--text-sec)', lineHeight: 1.7 }}>
                      {p0 && p0pct < BENCHMARK
                        ? <>Your weakest pattern is <strong style={{ color: '#7c6fff' }}>{p0.pattern_tag ?? p0.pattern}</strong> at {p0pct}% accuracy. Slow down on these question types in your next session.</>
                        : t0
                          ? <>Focus on <strong style={{ color: 'var(--text)' }}>{t0.topic}</strong> ({t0.subject}) — {t0.accuracy ?? t0.pct}% accuracy, your clearest gain opportunity.</>
                          : 'Keep practicing to surface deeper pattern-level insights.'}
                    </div>
                    <button onClick={() => setView('home')}
                      style={{ marginTop: 14, padding: '9px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                      Start practice session
                    </button>
                  </SectionCard>
                );
              })()}
            </>
          )}
        </div>
        );
      })()}

      {/* ── TEST ANALYSIS TAB ───────────────────────────────────────────────── */}
      {tab === 'test-analysis' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="dashboard-stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
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

          <div className="dashboard-half-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
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

          <div className="dashboard-split-grid" style={{ display: 'grid', gridTemplateColumns: '0.9fr 1.1fr', gap: 20 }}>
            <SectionCard>
              <SectionHeader title="Mistake Concentration" />
              <div className="desktop-only" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
              <div className="mobile-only" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ padding: '12px 14px', background: 'var(--bg-alt)', border: '1px solid var(--border)', borderRadius: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                    Biggest subject drag
                  </div>
                  {mistakeBySubject.length === 0 ? (
                    <div style={{ fontSize: 12.5, color: 'var(--text-tert)' }}>No recent mistakes recorded.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {mistakeBySubject.slice(0, 3).map((row, index) => (
                        <div key={row.subject} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 12.5, color: 'var(--text)' }}>{index + 1}. {row.subject}</span>
                          <span style={{ fontSize: 11.5, fontWeight: 700, color: '#ef4444' }}>{row.wrong} wrong</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ padding: '12px 14px', background: 'var(--bg-alt)', border: '1px solid var(--border)', borderRadius: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                    Top risky topics
                  </div>
                  {mistakeByTopic.length === 0 ? (
                    <div style={{ fontSize: 12.5, color: 'var(--text-tert)' }}>No topic cluster yet.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {mistakeByTopic.slice(0, 3).map((row) => (
                        <div key={`${row.subject}-${row.topic}`} style={{ padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>{row.topic}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-tert)', marginTop: 3 }}>{row.subject} · {row.wrong} wrong</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </SectionCard>

            <SectionCard className="dashboard-review-card">
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

              <div className="dashboard-review-table-head desktop-only" style={{
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
                    className="dashboard-review-table-row desktop-only"
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
              <div className="mobile-only" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {recentAttemptReview.slice(0, 4).map((att, i) => {
                  const seconds = parseAttemptTimeToSeconds(att.time);
                  const pace = paceLabel(seconds);
                  const paceColor = pace === 'Fast' ? '#16a34a' : pace === 'Balanced' ? '#2563eb' : '#f59e0b';
                  return (
                    <div key={i} style={{ padding: '12px 14px', background: 'var(--bg-alt)', border: '1px solid var(--border)', borderRadius: 12 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', lineHeight: 1.5, marginBottom: 8 }}>
                        {att.q}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: '#2563eb', background: 'rgba(37,99,235,0.08)', borderRadius: 999, padding: '3px 8px' }}>
                          {att.subject}
                        </span>
                        <span style={{ fontSize: 10.5, color: 'var(--text-tert)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 999, padding: '3px 8px' }}>
                          {att.topic || 'General'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: att.correct ? '#16a34a' : '#ef4444' }}>
                          {att.correct ? 'Correct' : 'Wrong'}
                        </span>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: paceColor }}>
                          {att.time} · {pace}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          </div>
        </div>
      )}
    </div>
  );
}
