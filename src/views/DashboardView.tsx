import React, { useMemo, useState } from 'react';
import { C, accuracyColor } from '../lib/tokens';
import { type Question, type View, type CommissionMap } from '../types/index';
import { type UserStats, xpToLevel } from '../lib/stats';

interface DashboardViewProps {
  user: { displayName: string | null; uid: string };
  questions: Question[];
  commissionMap: CommissionMap;
  stats: UserStats;
  setView: (v: View) => void;
  openCommission: (c: string) => void;
  startPractice: (examName: string, year: number, subject?: string, topic?: string) => void;
}

const ASPIRANTS = [
  { name: 'Arjun Reddy',   initials: 'AR', xp: 4820, acc: 78, streak: 12 },
  { name: 'Priya Menon',   initials: 'PM', xp: 4210, acc: 82, streak: 5  },
  { name: 'Rahul Singh',   initials: 'RS', xp: 3980, acc: 71, streak: 8  },
  { name: 'Kavya Nair',    initials: 'KN', xp: 3650, acc: 85, streak: 15 },
  { name: 'Amit Kumar',    initials: 'AK', xp: 3240, acc: 68, streak: 3  },
  { name: 'Deepa Iyer',    initials: 'DI', xp: 2890, acc: 76, streak: 7  },
  { name: 'Suresh Rao',    initials: 'SR', xp: 2560, acc: 63, streak: 0  },
  { name: 'Ananya Joshi',  initials: 'AJ', xp: 2150, acc: 79, streak: 21 },
  { name: 'Vikram Dev',    initials: 'VD', xp: 1820, acc: 58, streak: 2  },
  { name: 'Sneha Patil',   initials: 'SP', xp: 1540, acc: 72, streak: 9  },
  { name: 'Kiran Sharma',  initials: 'KS', xp: 1230, acc: 65, streak: 4  },
];

const AV_COLORS = ['#1a4a42','#1a2a42','#2a1a42','#1a422a','#421a1a','#422a1a','#1a4242','#2a421a','#42421a','#1a1a42','#422a42'];

// ── Activity Heatmap ────────────────────────────────────────────────────────────
function ActivityHeatmap({ dailyActivity }: { dailyActivity: Record<string, number> }) {
  const weeks = useMemo(() => {
    const days: { key: string; count: number; dow: number }[] = [];
    const today = new Date();
    // go back 364 days (52 full weeks)
    const start = new Date(today);
    start.setDate(start.getDate() - 363);
    // align to Sunday
    start.setDate(start.getDate() - start.getDay());

    for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().split('T')[0];
      days.push({ key, count: dailyActivity?.[key] ?? 0, dow: d.getDay() });
    }

    const result: typeof days[] = [];
    for (let i = 0; i < days.length; i += 7) result.push(days.slice(i, i + 7));
    return result;
  }, [dailyActivity]);

  const maxCount = useMemo(() => Math.max(...Object.values(dailyActivity ?? {}), 1), [dailyActivity]);

  const cellColor = (count: number) => {
    if (count === 0) return 'var(--c-surface3)';
    const r = count / maxCount;
    if (r < 0.25) return 'rgba(45,212,191,0.20)';
    if (r < 0.5)  return 'rgba(45,212,191,0.45)';
    if (r < 0.75) return 'rgba(45,212,191,0.70)';
    return '#2dd4bf';
  };

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const totalDays = Object.values(dailyActivity ?? {}).filter(v => v > 0).length;
  const totalQ    = Object.values(dailyActivity ?? {}).reduce((a, b) => a + b, 0);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, overflowX: 'auto' }}>
        {/* Day labels */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingTop: 18, flexShrink: 0 }}>
          {['S','M','T','W','T','F','S'].map((d, i) => (
            <div key={i} style={{ height: 11, fontSize: 8, color: C.textTert, lineHeight: '11px', width: 10, textAlign: 'right' }}>{d}</div>
          ))}
        </div>
        <div style={{ flex: 1 }}>
          {/* Month labels */}
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
          {/* Grid */}
          <div style={{ display: 'flex', gap: 3 }}>
            {weeks.map((week, wi) => (
              <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0 }}>
                {week.map((day, di) => (
                  <div key={di}
                    title={day.count > 0 ? `${day.key}: ${day.count} questions` : day.key}
                    style={{ width: 11, height: 11, borderRadius: 2, background: cellColor(day.count), cursor: day.count > 0 ? 'default' : 'default', transition: 'opacity 0.1s' }} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ marginTop: 10, display: 'flex', gap: 16, alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: C.textTert }}>{totalDays} active days · {totalQ} questions total</span>
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

export function DashboardView({ user, questions, commissionMap, stats, setView, openCommission, startPractice }: DashboardViewProps) {
  const [nudgeDismissed, setNudgeDismissed] = useState(false);
  const { level, levelName, xpNext } = xpToLevel(stats.xp);

  const overallAcc = useMemo(() => {
    let correct = 0, total = 0;
    for (const v of Object.values(stats.bySubject)) { correct += v.correct; total += v.total; }
    return total > 0 ? Math.round((correct / total) * 100) : 0;
  }, [stats.bySubject]);

  const subjectAccuracies = useMemo(() =>
    Object.entries(stats.bySubject)
      .filter(([, v]) => v.total > 0)
      .map(([subject, v]) => ({ subject, pct: Math.round((v.correct / v.total) * 100), total: v.total }))
      .sort((a, b) => a.pct - b.pct),
    [stats.bySubject]
  );

  const weakestSubject = subjectAccuracies[0];

  // Pick first available exam for targeted weak-subject practice
  const firstAvailableExam = useMemo(() => {
    for (const [, exams] of Object.entries(commissionMap)) {
      for (const [, info] of Object.entries(exams)) {
        if (info.years[0]) return { fullName: info.fullName, year: info.years[0] };
      }
    }
    return null;
  }, [commissionMap]);

  const recentExams = useMemo(() => {
    const result: { commission: string; examName: string; examType: string; year: number; count: number }[] = [];
    for (const [commission, exams] of Object.entries(commissionMap)) {
      for (const [examType, info] of Object.entries(exams)) {
        result.push({ commission, examName: info.fullName, examType, year: info.years[0] ?? 0, count: info.count });
      }
    }
    return result.sort((a, b) => b.year - a.year).slice(0, 4);
  }, [commissionMap]);

  const { myRank, lbEntries } = useMemo(() => {
    const myInitials = (user.displayName ?? 'You').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || 'ME';
    const base = ASPIRANTS.map((a, i) => ({ ...a, isMe: false, color: AV_COLORS[i] }));
    const me = { name: user.displayName ?? 'You', initials: myInitials, xp: stats.xp, acc: overallAcc, streak: stats.streak, isMe: true, color: '#0d4a3a' };
    const sorted = [...base, me].sort((a, b) => b.xp - a.xp);
    return { myRank: sorted.findIndex(e => e.isMe) + 1, lbEntries: sorted };
  }, [stats.xp, overallAcc, stats.streak, user.displayName]);

  const firstName = (user.displayName ?? 'Aspirant').split(' ')[0];
  const today = new Date();
  const dateStr = today.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const hour = today.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const recs = [
    ...(weakestSubject && weakestSubject.pct < 70 && weakestSubject.total >= 3
      ? [{
          ico: '⚠',
          title: `${weakestSubject.subject} is your weak area`,
          desc: `${weakestSubject.pct}% accuracy · Practice targeted questions now`,
          action: () => firstAvailableExam
            ? startPractice(firstAvailableExam.fullName, firstAvailableExam.year, weakestSubject.subject)
            : setView('home'),
          accent: '#f87171',
        }]
      : []
    ),
    { ico: '▷', title: 'Browse PYQ Papers', desc: 'UPSC · APPSC · TSPSC exam papers', action: () => setView('home'), accent: C.accent },
    { ico: '📡', title: 'PYQ Question Feed', desc: 'Latest questions from all exams', action: () => setView('feed'), accent: C.blue },
    { ico: '◇', title: 'Achievements & Badges', desc: 'Track milestones and XP progress', action: () => setView('badges'), accent: C.warn },
  ].slice(0, 4);

  const cardStyle: React.CSSProperties = {
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: 14,
    overflow: 'hidden',
  };

  const cardHead = (title: string, action?: { label: string; fn: () => void }) => (
    <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: C.text, fontFamily: "'DM Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</div>
      {action && (
        <span onClick={action.fn} style={{ fontSize: 12, color: C.accent, cursor: 'pointer' }}>{action.label} →</span>
      )}
    </div>
  );

  const lbPreview = lbEntries.slice(0, 5);
  const myIdx = lbEntries.findIndex(e => e.isMe);
  const meInTop5 = myIdx < 5;

  // XP progress to next level
  const prevThreshold = [0, 500, 1200, 2500, 5000, 10000, 20000][level - 1] ?? 0;
  const xpProgress = Math.min(100, Math.round(((stats.xp - prevThreshold) / (xpNext - prevThreshold)) * 100));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 1200 }}>

      {/* ── Greeting header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", color: C.textTert, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
            {dateStr}
          </div>
          <h1 style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 26, fontWeight: 400, lineHeight: 1.15, color: C.text, letterSpacing: '-0.3px', marginBottom: 6 }}>
            {greeting}, <em style={{ fontStyle: 'italic', color: C.headingEm }}>{firstName}</em>
          </h1>
          <p style={{ fontSize: 13, color: C.textTert, lineHeight: 1.5 }}>
            {stats.totalAnswered > 0
              ? `${stats.totalAnswered.toLocaleString()} questions solved · ${overallAcc}% accuracy overall`
              : 'Start practicing to track your progress and earn badges.'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
          {stats.streak > 0 && (
            <div style={{ padding: '6px 14px', background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 99, fontSize: 12, color: C.warn, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
              🔥 {stats.streak}-day streak
            </div>
          )}
          <div style={{ padding: '6px 14px', background: 'rgba(45,212,191,0.08)', border: '1px solid rgba(45,212,191,0.2)', borderRadius: 99, fontSize: 12, color: C.accent, fontWeight: 500 }}>
            Lv.{level} {levelName}
          </div>
        </div>
      </div>

      {/* ── Stats row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        {[
          { label: 'Questions Solved', value: stats.totalAnswered.toLocaleString(), sub: stats.recentAttempts.length > 0 ? `${stats.recentAttempts.length} this session` : 'Start practicing', color: C.accent, icon: '📖' },
          { label: 'Overall Accuracy', value: overallAcc > 0 ? `${overallAcc}%` : '—', sub: overallAcc >= 60 ? 'Good progress' : overallAcc > 0 ? 'Keep practicing' : 'Answer to track', color: accuracyColor(overallAcc), icon: '⊙' },
          { label: 'Total XP', value: stats.xp.toLocaleString(), sub: `${xpProgress}% to Level ${level + 1}`, color: C.warn, icon: '⚡' },
          { label: 'Rank', value: `#${myRank}`, sub: myRank <= 5 ? 'Top 5! Keep going' : myRank <= 10 ? 'Top 10' : 'Earn XP to climb', color: myRank <= 10 ? '#34d399' : C.textTert, icon: '≡' },
        ].map(({ label, value, sub, color, icon }) => (
          <div key={label}
            style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '18px 18px', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 16, right: 16, fontSize: 18, opacity: 0.2 }}>{icon}</div>
            <div style={{ fontSize: 10, color: C.textTert, fontFamily: "'DM Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>{label}</div>
            <div style={{ fontSize: 28, fontWeight: 300, fontFamily: "'Fraunces', Georgia, serif", color: C.text, lineHeight: 1, letterSpacing: '-0.5px' }}>{value}</div>
            <div style={{ marginTop: 8, fontSize: 11, color }}>{sub}</div>
            {/* XP progress bar */}
            {label === 'Total XP' && (
              <div style={{ marginTop: 8, height: 3, background: 'var(--c-surface3)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${xpProgress}%`, background: C.warn, borderRadius: 2, transition: 'width 1s ease' }} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── Nudge bar ── */}
      {weakestSubject && !nudgeDismissed && weakestSubject.pct < 70 && weakestSubject.total >= 3 && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderLeft: `3px solid #f87171`, borderRadius: 10, padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 16, fontSize: 13 }}>
          <span style={{ fontSize: 16 }}>⚠</span>
          <div style={{ flex: 1, color: C.textSec }}>
            <strong style={{ color: C.text }}>{weakestSubject.subject} is your weak area</strong> — {weakestSubject.pct}% accuracy across {weakestSubject.total} questions.
          </div>
          <button
            onClick={() => firstAvailableExam
              ? startPractice(firstAvailableExam.fullName, firstAvailableExam.year, weakestSubject.subject)
              : setView('home')
            }
            style={{ fontSize: 12, color: '#0a1a18', background: C.accent, border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontWeight: 700, flexShrink: 0 }}>
            Practice Now →
          </button>
          <span onClick={() => setNudgeDismissed(true)} style={{ color: C.textTert, cursor: 'pointer', fontSize: 20, lineHeight: 1, flexShrink: 0 }}>×</span>
        </div>
      )}

      {/* ── Activity Heatmap ── */}
      <div style={cardStyle}>
        {cardHead('Activity')}
        <div style={{ padding: '16px 20px' }}>
          <ActivityHeatmap dailyActivity={stats.dailyActivity ?? {}} />
        </div>
      </div>

      {/* ── Quick Start ── */}
      {recentExams.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 10, color: C.textTert, fontFamily: "'DM Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.06em' }}>Quick Start</span>
            <span onClick={() => setView('home')} style={{ fontSize: 12, color: C.accent, cursor: 'pointer' }}>Browse all →</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {recentExams.map(e => (
              <div key={`${e.examName}-${e.year}`}
                onClick={() => startPractice(e.examName, e.year)}
                style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '16px 14px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 10, transition: 'all 0.15s' }}
                onMouseEnter={ev => { ev.currentTarget.style.borderColor = 'var(--c-border-l)'; ev.currentTarget.style.transform = 'translateY(-1px)'; }}
                onMouseLeave={ev => { ev.currentTarget.style.borderColor = C.border; ev.currentTarget.style.transform = 'none'; }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{e.examType}</div>
                <div style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", color: C.textTert }}>{e.count.toLocaleString()} Qs</div>
                <div style={{ alignSelf: 'flex-start', padding: '2px 8px', borderRadius: 99, background: 'rgba(45,212,191,0.10)', color: C.accent, fontSize: 10, fontWeight: 600, border: '1px solid rgba(45,212,191,0.20)', fontFamily: "'DM Mono', monospace" }}>
                  {e.commission}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Main 2-col grid ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20 }}>

        {/* Left column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Subject Performance */}
          <div style={cardStyle}>
            {cardHead('Subject Performance')}
            <div style={{ padding: '16px 20px' }}>
              {subjectAccuracies.length > 0 ? subjectAccuracies.map(s => (
                <div key={s.subject} style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: C.text, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {s.subject}
                      {s.pct < 50 && <span style={{ fontSize: 9, color: '#f87171', background: 'rgba(248,113,113,0.12)', padding: '1px 6px', borderRadius: 4 }}>weak</span>}
                      {s.pct >= 80 && <span style={{ fontSize: 9, color: '#34d399', background: 'rgba(52,211,153,0.12)', padding: '1px 6px', borderRadius: 4 }}>strong</span>}
                    </span>
                    <span style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", color: accuracyColor(s.pct) }}>{s.pct}%</span>
                  </div>
                  <div style={{ height: 5, background: 'var(--c-surface3)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${s.pct}%`, background: accuracyColor(s.pct), borderRadius: 3, transition: 'width 1s ease' }} />
                  </div>
                  <div style={{ fontSize: 10, color: C.textTert, marginTop: 3 }}>{s.total} questions attempted</div>
                </div>
              )) : (
                <div style={{ fontSize: 13, color: C.textTert, textAlign: 'center', padding: '40px 0' }}>
                  Answer questions to see subject accuracy
                </div>
              )}
            </div>
          </div>

          {/* Recent Attempts */}
          {stats.recentAttempts.length > 0 && (
            <div style={cardStyle}>
              {cardHead('Recent Attempts')}
              <div style={{ padding: '4px 0' }}>
                {stats.recentAttempts.slice(0, 8).map((a, i) => (
                  <div key={i}
                    style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '9px 20px', borderBottom: i < Math.min(stats.recentAttempts.length, 8) - 1 ? `1px solid ${C.border}` : 'none', transition: 'background 0.15s' }}
                    onMouseEnter={ev => ev.currentTarget.style.background = 'var(--c-surface2)'}
                    onMouseLeave={ev => ev.currentTarget.style.background = 'transparent'}>
                    <div style={{ width: 20, height: 20, borderRadius: 6, background: a.correct ? 'rgba(52,211,153,0.15)' : 'rgba(248,113,113,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span style={{ fontSize: 10, color: a.correct ? '#34d399' : '#f87171' }}>{a.correct ? '✓' : '✗'}</span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 300 }}>{a.q}</div>
                      <div style={{ fontSize: 10, color: C.textTert, marginTop: 2 }}>{a.subject} · {a.topic}</div>
                    </div>
                    <span style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", color: C.textTert, flexShrink: 0 }}>{a.time}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Recommendations */}
          <div style={cardStyle}>
            {cardHead('Recommendations')}
            <div style={{ padding: '4px 0' }}>
              {recs.map((r, i) => (
                <div key={i} onClick={r.action}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: i < recs.length - 1 ? `1px solid ${C.border}` : 'none', cursor: 'pointer', transition: 'all 0.15s' }}
                  onMouseEnter={ev => { ev.currentTarget.style.background = 'var(--c-surface2)'; ev.currentTarget.style.paddingLeft = '24px'; }}
                  onMouseLeave={ev => { ev.currentTarget.style.background = 'transparent'; ev.currentTarget.style.paddingLeft = '20px'; }}>
                  <div style={{ width: 30, height: 30, borderRadius: 8, background: r.accent + '18', border: `1px solid ${r.accent}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0, color: r.accent }}>
                    {r.ico}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>{r.title}</div>
                    <div style={{ fontSize: 11, color: C.textTert, marginTop: 2 }}>{r.desc}</div>
                  </div>
                  <span style={{ color: C.textTert, fontSize: 12 }}>→</span>
                </div>
              ))}
            </div>
          </div>

          {/* Leaderboard mini */}
          <div style={cardStyle}>
            {cardHead('Leaderboard', { label: 'See all', fn: () => setView('leaderboard') })}
            <div style={{ padding: '8px' }}>
              {lbPreview.map((e, i) => (
                <div key={i}
                  style={{ display: 'grid', gridTemplateColumns: '24px 1fr auto', alignItems: 'center', gap: 10, padding: '7px 8px', borderRadius: 6, marginBottom: 2, cursor: 'default', transition: 'background 0.15s',
                    background: e.isMe ? 'rgba(45,212,191,0.07)' : 'transparent',
                    border: e.isMe ? '1px solid rgba(45,212,191,0.20)' : '1px solid transparent' }}>
                  <div style={{ fontSize: i < 3 ? 14 : 11, fontFamily: "'DM Mono', monospace", color: i < 3 ? C.warn : C.textTert, textAlign: 'center' }}>
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 22, height: 22, borderRadius: '50%', background: AV_COLORS[i] || '#0d4a3a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, color: e.isMe ? '#2dd4bf' : C.accent, fontFamily: "'DM Mono', monospace", flexShrink: 0 }}>
                      {e.initials}
                    </div>
                    <span style={{ fontSize: 12, color: C.text, fontWeight: e.isMe ? 600 : 400 }}>{e.name}{e.isMe ? ' (You)' : ''}</span>
                  </div>
                  <span style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", color: C.accent }}>{e.xp.toLocaleString()}</span>
                </div>
              ))}
              {!meInTop5 && (
                <>
                  <div style={{ padding: '4px 8px', color: C.textTert, fontSize: 11, textAlign: 'center' }}>···</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr auto', alignItems: 'center', gap: 10, padding: '7px 8px', borderRadius: 6, background: 'rgba(45,212,191,0.07)', border: '1px solid rgba(45,212,191,0.20)' }}>
                    <div style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", color: C.textTert, textAlign: 'center' }}>#{myRank}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#0d4a3a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, color: '#2dd4bf', fontFamily: "'DM Mono', monospace", flexShrink: 0 }}>
                        {(user.displayName ?? 'You').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || 'ME'}
                      </div>
                      <span style={{ fontSize: 12, color: C.text, fontWeight: 500 }}>You</span>
                    </div>
                    <span style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", color: C.accent }}>{stats.xp.toLocaleString()}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
