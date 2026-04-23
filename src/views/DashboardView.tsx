import { useMemo } from 'react';
import { C, accuracyColor } from '../lib/tokens';
import { type QuestionMeta, type View, type CommissionMap } from '../types/index';
import { type UserStats, xpToLevel } from '../lib/stats';

interface DashboardViewProps {
  user: { displayName: string | null; uid: string };
  questions: QuestionMeta[];
  commissionMap: CommissionMap;
  stats: UserStats;
  setView: (v: View) => void;
  openCommission?: (c: string) => void;
  startPractice: (examName: string, year: number, subject?: string, topic?: string) => void;
}

const DAILY_GOAL = 20;
const BENCHMARK = 70; // % accuracy aspirants need to clear exams

// ── Activity Heatmap ──────────────────────────────────────────────────────────
function ActivityHeatmap({ dailyActivity }: { dailyActivity: Record<string, number> }) {
  const weeks = useMemo(() => {
    const days: { key: string; count: number }[] = [];
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - 363);
    start.setDate(start.getDate() - start.getDay());
    for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().split('T')[0];
      days.push({ key, count: dailyActivity?.[key] ?? 0 });
    }
    const result: typeof days[] = [];
    for (let i = 0; i < days.length; i += 7) result.push(days.slice(i, i + 7));
    return result;
  }, [dailyActivity]);

  const maxCount = useMemo(() => Math.max(...Object.values(dailyActivity ?? {}), 1), [dailyActivity]);
  const cellColor = (count: number) => {
    if (count === 0) return 'var(--c-surface3)';
    const r = count / maxCount;
    if (r < 0.25) return 'rgba(45,212,191,0.18)';
    if (r < 0.5)  return 'rgba(45,212,191,0.40)';
    if (r < 0.75) return 'rgba(45,212,191,0.65)';
    return '#2dd4bf';
  };

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const totalDays = Object.values(dailyActivity ?? {}).filter(v => v > 0).length;
  const totalQ    = Object.values(dailyActivity ?? {}).reduce((a, b) => a + b, 0);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, overflowX: 'auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingTop: 18, flexShrink: 0 }}>
          {['S','M','T','W','T','F','S'].map((d, i) => (
            <div key={i} style={{ height: 11, fontSize: 8, color: C.textTert, lineHeight: '11px', width: 10, textAlign: 'right' }}>{d}</div>
          ))}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', marginBottom: 4, gap: 3 }}>
            {weeks.map((week, wi) => {
              const firstDay = new Date(week[0].key);
              const show = firstDay.getDate() <= 7;
              return (
                <div key={wi} style={{ width: 11, fontSize: 8, color: show ? C.textTert : 'transparent', flexShrink: 0, textAlign: 'center' }}>
                  {show ? months[firstDay.getMonth()].slice(0, 1) : ''}
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 3 }}>
            {weeks.map((week, wi) => (
              <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0 }}>
                {week.map((day, di) => (
                  <div key={di}
                    title={day.count > 0 ? `${day.key}: ${day.count} questions` : day.key}
                    style={{ width: 11, height: 11, borderRadius: 2, background: cellColor(day.count) }} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ marginTop: 10, display: 'flex', gap: 16, alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: C.textTert }}>{totalDays} active days · {totalQ.toLocaleString()} questions total</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
          <span style={{ fontSize: 10, color: C.textTert }}>Less</span>
          {[0, 0.25, 0.5, 0.75, 1.0].map((r, i) => (
            <div key={i} style={{ width: 10, height: 10, borderRadius: 2, background: r === 0 ? 'var(--c-surface3)' : `rgba(45,212,191,${r})` }} />
          ))}
          <span style={{ fontSize: 10, color: C.textTert }}>More</span>
        </div>
      </div>
    </div>
  );
}

// ── Coach insight engine (no API call — computed from stats) ──────────────────
interface CoachInsight {
  icon: string;
  title: string;
  body: string;
  cta: string;
  color: string;
  subject?: string;
  isMock?: boolean;
}

function computeCoachInsight(
  stats: UserStats,
  subjectAccuracies: { subject: string; pct: number; total: number }[],
  untouchedSubjects: string[],
  todayCount: number,
  overallAcc: number,
  recentAcc: number | null,
): CoachInsight {
  // New user — no data yet
  if (stats.totalAnswered === 0) return {
    icon: '👋',
    title: 'Your preparation journey starts here',
    body: 'Complete your first practice session. The coach will analyze your answers and pinpoint exactly where to focus.',
    cta: 'Start First Session',
    color: C.accent,
  };

  // Daily goal just hit — push to mock
  if (todayCount >= DAILY_GOAL) return {
    icon: '🎯',
    title: `Daily goal complete — ${todayCount} questions done today`,
    body: 'Excellent. You showed up. Now stress-test your preparation with a timed mock under real exam conditions.',
    cta: 'Take a Mock Test',
    color: '#34d399',
    isMock: true,
  };

  // Critical weak subject (<45%, ≥5 questions) — highest priority signal
  const critical = subjectAccuracies.find(s => s.pct < 45 && s.total >= 5);
  if (critical) return {
    icon: '⚠',
    title: `${critical.subject} is critically weak`,
    body: `${critical.pct}% accuracy across ${critical.total} questions. Exam cutoffs require 70%+ here. Every day without fixing this costs you rank.`,
    cta: `Fix ${critical.subject} Now`,
    color: '#f87171',
    subject: critical.subject,
  };

  // Untouched subject — blind spot risk
  if (untouchedSubjects.length > 0) return {
    icon: '📍',
    title: `${untouchedSubjects[0]} — you haven't started this yet`,
    body: `This subject appears in recent exam papers but has zero attempts in your profile. It's a hidden gap.`,
    cta: `Start ${untouchedSubjects[0]}`,
    color: C.warn,
    subject: untouchedSubjects[0],
  };

  // Accuracy declining — recent vs overall
  if (recentAcc !== null && recentAcc < overallAcc - 10) return {
    icon: '📉',
    title: 'Your recent accuracy is slipping',
    body: `Last 20 questions: ${recentAcc}% vs your overall ${overallAcc}%. You may be rushing. Take a slower, deliberate session today.`,
    cta: 'Practice Carefully',
    color: C.warn,
  };

  // Moderate weak subject (<70%, ≥3 questions)
  const moderate = subjectAccuracies.find(s => s.pct < BENCHMARK && s.total >= 3);
  if (moderate) return {
    icon: '📈',
    title: `${moderate.subject} — ${BENCHMARK - moderate.pct}% below the pass mark`,
    body: `${moderate.pct}% accuracy. A focused session today will measurably improve your rank. This is the highest-leverage use of your time.`,
    cta: `Practice ${moderate.subject}`,
    color: '#60a5fa',
    subject: moderate.subject,
  };

  // Everything looks good — push to mock
  return {
    icon: '✨',
    title: 'Your preparation is on track',
    body: `${overallAcc}% overall accuracy. Time to stress-test it. A full mock will reveal what practice sessions hide.`,
    cta: 'Take a Full Mock Test',
    color: C.accent,
    isMock: true,
  };
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export function DashboardView({ user, questions, commissionMap, stats, setView, openCommission, startPractice }: DashboardViewProps) {
  const { level, levelName, xpNext } = xpToLevel(stats.xp);
  const firstName = (user.displayName ?? 'Aspirant').split(' ')[0];
  const today = new Date();
  const todayKey = today.toISOString().split('T')[0];
  const hour = today.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  // Today's count from daily activity
  const todayCount = (stats.dailyActivity ?? {})[todayKey] ?? 0;
  const todayPct = Math.min(100, Math.round((todayCount / DAILY_GOAL) * 100));
  const goalDone = todayCount >= DAILY_GOAL;

  // Overall accuracy (all-time)
  const overallAcc = useMemo(() => {
    let correct = 0, total = 0;
    for (const v of Object.values(stats.bySubject)) { correct += v.correct; total += v.total; }
    return total > 0 ? Math.round((correct / total) * 100) : 0;
  }, [stats.bySubject]);

  // Subject accuracies sorted weakest first
  const subjectAccuracies = useMemo(() =>
    Object.entries(stats.bySubject)
      .filter(([, v]) => v.total > 0)
      .map(([subject, v]) => ({ subject, pct: Math.round((v.correct / v.total) * 100), total: v.total }))
      .sort((a, b) => a.pct - b.pct),
    [stats.bySubject]
  );

  // Subjects available in the question bank but never practiced — blind spots
  const untouchedSubjects = useMemo(() => {
    const practiced = new Set(Object.keys(stats.bySubject));
    const allSubs = [...new Set(questions.map(q => q.subject).filter(Boolean))];
    return allSubs.filter(s => !practiced.has(s));
  }, [questions, stats.bySubject]);

  // Recent accuracy (last 20 attempts) vs overall — shows trajectory
  const recentAcc = useMemo(() => {
    const r = stats.recentAttempts ?? [];
    if (r.length < 5) return null;
    return Math.round((r.filter(a => a.correct).length / r.length) * 100);
  }, [stats.recentAttempts]);

  const accDelta = recentAcc !== null ? recentAcc - overallAcc : null;

  // How many days since first practice
  const prepDayCount = useMemo(() => {
    const dates = Object.keys(stats.dailyActivity ?? {}).sort();
    if (dates.length === 0) return 1;
    const diff = Math.ceil((today.getTime() - new Date(dates[0]).getTime()) / 86400000);
    return Math.max(1, diff + 1);
  }, [stats.dailyActivity]);

  // First available exam for practice CTAs
  const firstExam = useMemo(() => {
    for (const [, exams] of Object.entries(commissionMap)) {
      for (const [, info] of Object.entries(exams)) {
        if (info.years[0]) return { fullName: info.fullName, year: info.years[0] };
      }
    }
    return null;
  }, [commissionMap]);

  // Recent 4 exams for Quick Jump
  const recentExams = useMemo(() => {
    const result: { commission: string; examName: string; examType: string; year: number; count: number }[] = [];
    for (const [commission, exams] of Object.entries(commissionMap)) {
      for (const [examType, info] of Object.entries(exams)) {
        result.push({ commission, examName: info.fullName, examType, year: info.years[0] ?? 0, count: info.count });
      }
    }
    return result.sort((a, b) => b.year - a.year).slice(0, 4);
  }, [commissionMap]);

  // XP progress to next level
  const prevThreshold = [0, 500, 1200, 2500, 5000, 10000, 20000][level - 1] ?? 0;
  const xpPct = Math.min(100, Math.round(((stats.xp - prevThreshold) / (xpNext - prevThreshold)) * 100));

  // Coach insight — pure computation, no API
  const coach = useMemo(() => computeCoachInsight(
    stats, subjectAccuracies, untouchedSubjects, todayCount, overallAcc, recentAcc
  ), [stats, subjectAccuracies, untouchedSubjects, todayCount, overallAcc, recentAcc]);

  const handleCoachCta = () => {
    if (coach.isMock) { setView('home'); return; }
    if (coach.subject && firstExam) {
      startPractice(firstExam.fullName, firstExam.year, coach.subject);
    } else if (coach.subject) {
      setView('home');
    } else {
      firstExam ? startPractice(firstExam.fullName, firstExam.year) : setView('home');
    }
  };

  const handlePractice = () =>
    firstExam ? startPractice(firstExam.fullName, firstExam.year) : setView('home');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 1200 }}>

      {/* ── Greeting ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20 }}>
        <div>
          <div style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", color: C.textTert, letterSpacing: '0.10em', textTransform: 'uppercase', marginBottom: 7 }}>
            Preparation Control Room
          </div>
          <h1 style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 34, fontWeight: 500, lineHeight: 1.08, color: C.headingEm, letterSpacing: '-0.8px' }}>
            {greeting}, <em style={{ fontStyle: 'italic', color: C.headingEm }}>{firstName}</em>
          </h1>
          <p style={{ fontSize: 13, color: C.textSec, marginTop: 8 }}>
            Day {prepDayCount} of preparation · {stats.totalAnswered > 0 ? `${stats.totalAnswered.toLocaleString()} questions solved` : 'Start building your history'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
          {stats.streak > 0 && (
            <div style={{ padding: '8px 14px', background: C.warnDim, border: `1px solid ${C.warn}25`, borderRadius: 99, fontSize: 12, color: C.warn, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
              🔥 {stats.streak}-day streak
            </div>
          )}
          <div style={{ padding: '8px 14px', background: C.accentDim, border: `1px solid rgba(15,118,110,0.18)`, borderRadius: 99, fontSize: 12, color: C.accent, fontWeight: 700 }}>
            Lv.{level} · {levelName}
          </div>
        </div>
      </div>

      {/* ── Today's Mission ───────────────────────────────────────────────────── */}
      <div className="glass-panel" style={{
        borderRadius: 28, padding: '30px 32px', position: 'relative', overflow: 'hidden',
        border: `1px solid ${goalDone ? 'rgba(21,128,61,0.18)' : 'rgba(15,118,110,0.14)'}`,
        background: `linear-gradient(135deg, ${C.surface2}, ${C.surface})`,
      }}>
        {/* Ambient glow */}
        <div style={{ position: 'absolute', top: -60, right: -60, width: 240, height: 240, borderRadius: '50%', background: goalDone ? 'rgba(21,128,61,0.08)' : 'rgba(15,118,110,0.07)', pointerEvents: 'none' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 32, position: 'relative' }}>
          {/* Goal block */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", color: C.textTert, textTransform: 'uppercase', letterSpacing: '0.10em', marginBottom: 14 }}>
              Today’s Focus
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
              <span style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 48, fontWeight: 500, color: goalDone ? C.success : C.headingEm, lineHeight: 1 }}>
                {todayCount}
              </span>
              <span style={{ fontSize: 20, color: C.textTert, fontWeight: 400 }}>/ {DAILY_GOAL}</span>
              <span style={{ fontSize: 13, color: C.textSec, marginLeft: 2 }}>questions completed today</span>
            </div>
            {/* Progress bar */}
            <div style={{ height: 8, background: C.surface3, borderRadius: 999, overflow: 'hidden', marginBottom: 10, maxWidth: 460 }}>
              <div style={{
                height: '100%', width: `${todayPct}%`,
                background: goalDone ? C.success : `linear-gradient(90deg, ${C.accent}, ${C.blue})`,
                borderRadius: 999, transition: 'width 0.8s ease',
              }} />
            </div>
            <div style={{ fontSize: 12, color: C.textSec }}>
              {goalDone
                ? 'Goal complete. This is the kind of consistency that compounds.'
                : todayCount === 0
                  ? `${DAILY_GOAL} questions to hit today’s target`
                  : `${DAILY_GOAL - todayCount} more to close today’s target`}
            </div>
          </div>

          {/* Divider */}
          <div style={{ width: 1, height: 96, background: C.border, flexShrink: 0 }} />

          {/* Action buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
            <button onClick={handlePractice} style={{
              padding: '12px 24px', background: C.accent, color: '#fff',
              border: 'none', borderRadius: 14, fontSize: 13, fontWeight: 700,
              cursor: 'pointer', whiteSpace: 'nowrap', letterSpacing: '0.01em',
              boxShadow: 'var(--c-shadow-glow)',
            }}>
              {todayCount === 0 ? 'Start Practice' : goalDone ? 'Keep Going' : 'Continue Practice'}
            </button>
            <button onClick={() => setView('home')} style={{
              padding: '12px 24px', background: 'rgba(255,255,255,0.72)', color: C.headingEm,
              border: `1px solid ${C.border}`, borderRadius: 14, fontSize: 13, fontWeight: 600,
              cursor: 'pointer', whiteSpace: 'nowrap',
            }}>
              Open Mock Centre
            </button>
          </div>
        </div>
      </div>

      {/* ── Stats strip (3 cards) ─────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16 }}>

        {/* Streak */}
        <div className="glass-panel hover-lift" style={{ borderRadius: 16, padding: '20px 22px' }}>
          <div style={{ fontSize: 10, color: C.textTert, fontFamily: "'DM Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Study Streak</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
            <span style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 34, fontWeight: 300, color: stats.streak > 0 ? C.warn : C.textTert, lineHeight: 1 }}>
              {stats.streak}
            </span>
            <span style={{ fontSize: 14, color: C.textTert, fontWeight: 300 }}>days</span>
          </div>
          <div style={{ fontSize: 11, color: stats.streak > 7 ? C.warn : stats.streak > 0 ? C.textSec : C.textTert }}>
            {stats.streak > 14 ? '🔥 Exceptional consistency' : stats.streak > 7 ? '🔥 Great momentum' : stats.streak > 0 ? `🔥 Don't break it` : '— Start your streak today'}
          </div>
        </div>

        {/* Accuracy */}
        <div className="glass-panel hover-lift" style={{ borderRadius: 16, padding: '20px 22px' }}>
          <div style={{ fontSize: 10, color: C.textTert, fontFamily: "'DM Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Overall Accuracy</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
            <span style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 34, fontWeight: 300, color: overallAcc > 0 ? accuracyColor(overallAcc) : C.textTert, lineHeight: 1 }}>
              {overallAcc > 0 ? `${overallAcc}%` : '—'}
            </span>
            {accDelta !== null && (
              <span style={{ fontSize: 12, fontFamily: "'DM Mono', monospace", color: accDelta >= 0 ? '#34d399' : '#f87171', padding: '2px 6px', borderRadius: 4, background: accDelta >= 0 ? 'rgba(52,211,153,0.10)' : 'rgba(248,113,113,0.10)' }}>
                {accDelta >= 0 ? '↑' : '↓'}{Math.abs(accDelta)}%
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: C.textTert }}>
            {overallAcc === 0 ? 'Answer questions to track'
              : overallAcc >= BENCHMARK ? `✓ Above ${BENCHMARK}% benchmark`
              : `${BENCHMARK - overallAcc}% below pass mark`}
          </div>
        </div>

        {/* XP + Level */}
        <div className="glass-panel hover-lift" style={{ borderRadius: 16, padding: '20px 22px' }}>
          <div style={{ fontSize: 10, color: C.textTert, fontFamily: "'DM Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>XP · Level {level}</div>
          <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 34, fontWeight: 300, color: C.accent, lineHeight: 1, marginBottom: 10 }}>
            {stats.xp.toLocaleString()}
          </div>
          <div style={{ height: 3, background: 'var(--c-surface3)', borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
            <div style={{ height: '100%', width: `${xpPct}%`, background: C.accent, borderRadius: 2, transition: 'width 1s ease' }} />
          </div>
          <div style={{ fontSize: 11, color: C.textTert }}>{levelName} · {xpPct}% to Level {level + 1}</div>
        </div>
      </div>

      {/* ── Coach + Subject Benchmark ─────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20 }}>

        {/* AI Coach card */}
        <div className="glass-panel" style={{ borderRadius: 18, overflow: 'hidden', border: `1px solid ${coach.color}28` }}>
          <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: coach.color, boxShadow: `0 0 8px ${coach.color}` }} />
            <span style={{ fontSize: 10, fontWeight: 600, color: C.textTert, fontFamily: "'DM Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              AI Coach · Today's Focus
            </span>
          </div>
          <div style={{ padding: '26px 26px 24px' }}>
            <div style={{ fontSize: 26, marginBottom: 14, lineHeight: 1 }}>{coach.icon}</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: C.text, marginBottom: 10, lineHeight: 1.35 }}>
              {coach.title}
            </div>
            <div style={{ fontSize: 13, color: C.textSec, lineHeight: 1.7, marginBottom: 22 }}>
              {coach.body}
            </div>
            <button
              onClick={handleCoachCta}
              style={{
                padding: '11px 22px', background: coach.color, color: '#0a1a18',
                border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700,
                cursor: 'pointer', letterSpacing: '0.01em',
              }}
            >
              {coach.cta} →
            </button>
          </div>
        </div>

        {/* Subject Coverage + Benchmark */}
        <div className="glass-panel" style={{ borderRadius: 18, overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: C.textTert, fontFamily: "'DM Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              Subject Coverage
            </span>
            <span style={{ fontSize: 10, color: C.textTert }}>Target {BENCHMARK}%</span>
          </div>
          <div style={{ padding: '16px 20px' }}>
            {subjectAccuracies.length === 0 && untouchedSubjects.length === 0 ? (
              <div style={{ fontSize: 13, color: C.textTert, textAlign: 'center', padding: '40px 0', lineHeight: 1.6 }}>
                Practice questions to see<br />your subject breakdown
              </div>
            ) : (
              <>
                {subjectAccuracies.slice(0, 5).map(s => (
                  <div key={s.subject} style={{ marginBottom: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                      <span style={{ fontSize: 12, color: C.text }}>{s.subject}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        {s.pct < 50 && (
                          <span style={{ fontSize: 9, color: '#f87171', background: 'rgba(248,113,113,0.12)', padding: '1px 5px', borderRadius: 3 }}>weak</span>
                        )}
                        {s.pct >= BENCHMARK && (
                          <span style={{ fontSize: 9, color: '#34d399', background: 'rgba(52,211,153,0.12)', padding: '1px 5px', borderRadius: 3 }}>✓</span>
                        )}
                        <span style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", color: accuracyColor(s.pct) }}>{s.pct}%</span>
                      </div>
                    </div>
                    <div style={{ height: 5, background: 'var(--c-surface3)', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
                      <div style={{ height: '100%', width: `${s.pct}%`, background: accuracyColor(s.pct), borderRadius: 3, transition: 'width 1s ease' }} />
                      {/* Benchmark target line */}
                      <div style={{ position: 'absolute', top: 0, left: `${BENCHMARK}%`, width: 1.5, height: '100%', background: 'rgba(255,255,255,0.25)' }} />
                    </div>
                  </div>
                ))}

                {/* Untouched subjects — shown as blank with "not started" */}
                {untouchedSubjects.slice(0, 3).map(s => (
                  <div key={s} style={{ marginBottom: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                      <span style={{ fontSize: 12, color: C.textTert }}>{s}</span>
                      <span style={{ fontSize: 9, color: C.textTert, background: 'var(--c-surface3)', padding: '1px 5px', borderRadius: 3 }}>not started</span>
                    </div>
                    <div style={{ height: 5, background: 'var(--c-surface3)', borderRadius: 3, position: 'relative' }}>
                      <div style={{ position: 'absolute', top: 0, left: `${BENCHMARK}%`, width: 1.5, height: '100%', background: 'rgba(255,255,255,0.15)' }} />
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Activity Heatmap ──────────────────────────────────────────────────── */}
      <div className="glass-panel" style={{ borderRadius: 18, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.border}` }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: C.textTert, fontFamily: "'DM Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            Activity — 52 Weeks
          </span>
        </div>
        <div style={{ padding: '16px 20px' }}>
          <ActivityHeatmap dailyActivity={stats.dailyActivity ?? {}} />
        </div>
      </div>

      {/* ── Quick Jump ────────────────────────────────────────────────────────── */}
      {recentExams.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 10, color: C.textTert, fontFamily: "'DM Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              Jump Into a Paper
            </span>
            <span onClick={() => setView('home')} style={{ fontSize: 12, color: C.accent, cursor: 'pointer' }}>
              Browse all →
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
            {recentExams.map(e => (
              <div
                key={`${e.examName}-${e.year}`}
                className="glass-panel hover-lift"
                onClick={() => startPractice(e.examName, e.year)}
                style={{ borderRadius: 16, padding: '18px 16px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 10, minHeight: 134 }}
              >
                <div style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", color: C.textTert, letterSpacing: '0.04em' }}>
                  {e.commission} · {e.year}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text, lineHeight: 1.35, flex: 1 }}>
                  {e.examType}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, color: C.textTert }}>{e.count.toLocaleString()} Qs</span>
                  <span style={{ fontSize: 11, color: C.accent }}>Practice →</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
