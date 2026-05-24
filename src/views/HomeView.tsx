import { useState } from 'react';
import { ChevronRight, Play, Target, TrendingDown, TrendingUp, Zap } from 'lucide-react';
import { type CommissionMap, type View } from '../types';
import { type UserStats } from '../lib/stats';

interface HomeViewProps {
  commissionMap: CommissionMap;
  openCommission?: (c: string) => void;
  openExam: (examName: string, commission: string, examType: string, preferredYear?: number) => void;
  startPractice: (examName: string, year: number, subject?: string, topic?: string) => void;
  setView: (v: View) => void;
  openQuestionBankHome: () => void;
  openFeedWithSubject?: (subject: string) => void;
  stats: UserStats;
  userDisplayName: string | null;
  userId: string;
}

const ORDERED_COMMISSIONS = ['UPSC', 'APPSC', 'TSPSC', 'TSLPRB', 'APSLPRB', 'APHC', 'TSHC', 'SSC', 'IBPS', 'RRB'];

const COMMISSION_META: Record<string, { gradient: string; abbr: string; label: string }> = {
  UPSC:    { gradient: 'linear-gradient(135deg,#1e3a8a,#2563eb)', abbr: 'U',  label: 'Civil Services' },
  APPSC:   { gradient: 'linear-gradient(135deg,#064e3b,#059669)', abbr: 'A',  label: 'Andhra Pradesh' },
  TSPSC:   { gradient: 'linear-gradient(135deg,#4c1d95,#7c3aed)', abbr: 'T',  label: 'Telangana' },
  TSLPRB:  { gradient: 'linear-gradient(135deg,#1e4d3b,#0891b2)', abbr: 'TL', label: 'TS Police' },
  APSLPRB: { gradient: 'linear-gradient(135deg,#0f4c81,#0369a1)', abbr: 'AL', label: 'AP Police' },
  APHC:    { gradient: 'linear-gradient(135deg,#1a237e,#3949ab)', abbr: 'AH', label: 'AP High Court' },
  TSHC:    { gradient: 'linear-gradient(135deg,#4a148c,#7b1fa2)', abbr: 'TH', label: 'TS High Court' },
  SSC:     { gradient: 'linear-gradient(135deg,#92400e,#d97706)', abbr: 'S',  label: 'Staff Selection' },
  IBPS:    { gradient: 'linear-gradient(135deg,#1e3a5f,#3b82f6)', abbr: 'IB', label: 'Banking' },
  RRB:     { gradient: 'linear-gradient(135deg,#7f1d1d,#dc2626)', abbr: 'R',  label: 'Railways' },
};

const CANONICAL_SUBJECTS = [
  { num: 1, name: 'History & Culture',     feedSubject: 'History',             keys: ['history', 'culture', 'art'],        color: '#92400e', bg: '#fef3c7', softBg: 'rgba(146,64,14,0.08)' },
  { num: 2, name: 'Polity & Governance',   feedSubject: 'Polity',              keys: ['polity', 'governance', 'constitu'], color: '#1d4ed8', bg: '#dbeafe', softBg: 'rgba(29,78,216,0.08)' },
  { num: 3, name: 'Geography',             feedSubject: 'Geography',           keys: ['geography', 'geo'],                 color: '#065f46', bg: '#d1fae5', softBg: 'rgba(6,95,70,0.08)'   },
  { num: 4, name: 'Indian Economy',        feedSubject: 'Economy',             keys: ['economy', 'economic', 'finance'],   color: '#c2410c', bg: '#ffedd5', softBg: 'rgba(194,65,12,0.08)' },
  { num: 5, name: 'Science & Technology',  feedSubject: 'Science & Technology', keys: ['science', 'tech', 'biology', 'physics', 'chemistry'], color: '#6d28d9', bg: '#ede9fe', softBg: 'rgba(109,40,217,0.08)' },
  { num: 6, name: 'Environment',           feedSubject: 'Environment',         keys: ['environment', 'ecology', 'enviro'], color: '#047857', bg: '#d1fae5', softBg: 'rgba(4,120,87,0.08)'  },
  { num: 7, name: 'Current Affairs',       feedSubject: 'Current Affairs',     keys: ['current', 'affairs', 'news'],       color: '#be185d', bg: '#fce7f3', softBg: 'rgba(190,24,93,0.08)' },
];

function subjectAccuracy(stats: UserStats, keywords: string[]) {
  let correct = 0, total = 0;
  for (const [key, val] of Object.entries(stats.bySubject || {})) {
    if (keywords.some(kw => key.toLowerCase().includes(kw))) {
      correct += val.correct;
      total += val.total;
    }
  }
  return total > 0 ? { correct, total, pct: Math.round((correct / total) * 100) } : null;
}

function StreakDots({ dailyActivity }: { dailyActivity: Record<string, number> }) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86_400_000);
    const key = d.toISOString().split('T')[0];
    const label = d.toLocaleDateString('en', { weekday: 'short' }).slice(0, 1);
    return { key, label, count: dailyActivity[key] || 0, isToday: i === 6 };
  });
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        {days.map(({ key, label }) => (
          <span key={key} style={{ fontSize: 10, color: 'var(--text-tert)', fontWeight: 600, width: 28, textAlign: 'center' }}>{label}</span>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        {days.map(({ key, count, isToday }) => (
          <div
            key={key}
            title={`${count} questions`}
            style={{
              width: 28, height: 28, borderRadius: 8,
              background: count > 0 ? '#2563eb' : 'var(--bg-canvas)',
              border: isToday ? '2px solid #2563eb' : '2px solid transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s',
            }}
          >
            {count > 0 && (
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function GoalsModal({ dailyGoal, examYear, onSave, onClose }: {
  dailyGoal: number;
  examYear: number;
  onSave: (goal: number, year: number) => void;
  onClose: () => void;
}) {
  const [goal, setGoal] = useState(dailyGoal);
  const [year, setYear] = useState(examYear);
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: 'var(--bg)', borderRadius: 20, padding: 24, width: 320, boxShadow: '0 24px 48px -12px rgba(0,0,0,0.2)', border: '1px solid var(--border)' }}
      >
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>Update prep settings</div>
        <div style={{ fontSize: 12, color: 'var(--text-tert)', marginBottom: 20 }}>Set your exam target and daily question goal.</div>
        <label style={{ display: 'block', marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Exam Year</div>
          <select
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            style={{ width: '100%', padding: '8px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-alt)', fontSize: 13, fontFamily: 'inherit', color: 'var(--text)' }}
          >
            {[2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label style={{ display: 'block', marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Daily target (questions)</div>
          <select
            value={goal}
            onChange={e => setGoal(Number(e.target.value))}
            style={{ width: '100%', padding: '8px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-alt)', fontSize: 13, fontFamily: 'inherit', color: 'var(--text)' }}
          >
            {[10, 15, 20, 25, 30, 40, 50].map(g => <option key={g} value={g}>{g} questions/day</option>)}
          </select>
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onClose}
            style={{ flex: 1, padding: '9px 0', borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', fontSize: 12.5, fontWeight: 600, color: 'var(--text-sec)', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(goal, year)}
            style={{ flex: 1, padding: '9px 0', borderRadius: 10, border: 'none', background: '#2563eb', fontSize: 12.5, fontWeight: 700, color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export function HomeView({
  commissionMap, openCommission,
  startPractice,
  setView, openQuestionBankHome, openFeedWithSubject,
  stats, userDisplayName, userId,
}: HomeViewProps) {
  const [hoveredCommission, setHoveredCommission] = useState<string | null>(null);
  const [hoveredSubject, setHoveredSubject] = useState<number | null>(null);
  const [showGoals, setShowGoals] = useState(false);

  const firstName = userDisplayName?.split(' ')[0] || 'Aspirant';

  const [dailyGoal, setDailyGoal] = useState(() =>
    parseInt(localStorage.getItem(`pyq_dailygoal_${userId}`) || '20', 10)
  );
  const [examYear, setExamYear] = useState(() =>
    parseInt(localStorage.getItem(`pyq_examyear_${userId}`) || '2026', 10)
  );

  const today = new Date().toISOString().split('T')[0];
  const todayCount = stats.dailyActivity?.[today] || 0;
  const goalPct = Math.min(100, Math.round((todayCount / dailyGoal) * 100));
  const remainingToday = Math.max(dailyGoal - todayCount, 0);

  const totals = Object.values(stats.bySubject || {}).reduce(
    (acc, s) => ({ correct: acc.correct + s.correct, total: acc.total + s.total }),
    { correct: 0, total: 0 },
  );
  const overallAccuracy = totals.total > 0 ? Math.round((totals.correct / totals.total) * 100) : 0;

  // Strongest / weakest subject from stats
  const subjectEntries = Object.entries(stats.bySubject || {})
    .filter(([, v]) => v.total >= 5)
    .map(([name, v]) => ({ name, pct: Math.round((v.correct / v.total) * 100) }));
  const strongest = subjectEntries.length > 0
    ? subjectEntries.reduce((a, b) => (a.pct >= b.pct ? a : b))
    : null;
  const weakest = subjectEntries.length > 0
    ? subjectEntries.reduce((a, b) => (a.pct <= b.pct ? a : b))
    : null;

  const lastSubject = stats.recentAttempts?.[0]?.subject;
  const hasActivityToday = todayCount > 0;

  // Commission list
  const commissions = Object.keys(commissionMap).sort((a, b) => {
    const ai = ORDERED_COMMISSIONS.indexOf(a), bi = ORDERED_COMMISSIONS.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1; if (bi !== -1) return 1;
    return a.localeCompare(b);
  });
  const commissionStats = commissions.map(c => {
    const exams = commissionMap[c] || {};
    const totalQs = Object.values(exams).reduce((s, e) => s + e.count, 0);
    const allYears = [...new Set(Object.values(exams).flatMap(e => e.years))].sort((a, b) => b - a);
    const papers = Object.keys(exams).length;
    return { commission: c, totalQs, allYears, papers, meta: COMMISSION_META[c] };
  });

  // First available exam for quick start
  const firstCommission = commissions[0];
  const firstExamEntries = Object.entries(commissionMap[firstCommission] || {});
  const firstExam = firstExamEntries[0]?.[1];

  // Next step card content
  const nextStep = (() => {
    if (goalPct >= 100) {
      return {
        chip: 'Well done',
        heading: 'Daily target reached',
        sub: `You've answered ${todayCount} questions today. Review weak areas or explore patterns to stay sharp.`,
        primaryLabel: 'Review weak areas',
        primaryAction: () => setView('dashboard'),
        secondaryLabel: 'Explore patterns',
        secondaryAction: () => setView('pattern-practice'),
      };
    }
    if (hasActivityToday && lastSubject) {
      return {
        chip: 'Resume',
        heading: `Continue ${lastSubject} practice`,
        sub: `${remainingToday} more question${remainingToday === 1 ? '' : 's'} to hit today's target.`,
        primaryLabel: 'Resume practice',
        primaryAction: () => firstExam && startPractice(firstExam.fullName, firstExam.years[0], lastSubject),
        secondaryLabel: `${todayCount}/${dailyGoal} done`,
        secondaryAction: null,
      };
    }
    return {
      chip: 'Start',
      heading: 'Begin today\'s practice session',
      sub: `Practice ${dailyGoal} real PYQs to build consistent momentum. Every question counts.`,
      primaryLabel: 'Start practicing',
      primaryAction: () => firstExam && startPractice(firstExam.fullName, firstExam.years[0]),
      secondaryLabel: `Goal: ${dailyGoal} questions`,
      secondaryAction: null,
    };
  })();

  const handleSaveGoals = (goal: number, year: number) => {
    setDailyGoal(goal);
    setExamYear(year);
    localStorage.setItem(`pyq_dailygoal_${userId}`, String(goal));
    localStorage.setItem(`pyq_examyear_${userId}`, String(year));
    setShowGoals(false);
  };

  const dateLabel = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="home-layout" style={{ fontFamily: 'var(--font-sans)' }}>
      {showGoals && (
        <GoalsModal
          dailyGoal={dailyGoal}
          examYear={examYear}
          onSave={handleSaveGoals}
          onClose={() => setShowGoals(false)}
        />
      )}

      {/* ── LEFT: main content ─────────────────────────────────────────── */}
      <div className="home-main-column">

        {/* Page header */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 6 }}>
            {dateLabel}
          </div>
          <h1 style={{ fontSize: 30, fontWeight: 800, color: 'var(--text)', margin: 0, letterSpacing: '-0.03em', lineHeight: 1.15 }}>
            Welcome back, {firstName}
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-tert)', margin: '6px 0 0', lineHeight: 1.6 }}>
            Your daily progress, bookmarked sessions, and recommended next step — all in one place.
          </p>
        </div>

        {/* ── Next Step card ── */}
        <div style={{
          background: '#0f172a',
          borderRadius: 20,
          padding: '22px 24px',
          marginBottom: 24,
          position: 'relative',
          overflow: 'hidden',
          border: '1px solid #1e293b',
        }}>
          {/* Subtle glow */}
          <div style={{ position: 'absolute', right: -40, top: -40, width: 180, height: 180, borderRadius: '50%', background: 'radial-gradient(circle, rgba(37,99,235,0.18) 0%, transparent 70%)', pointerEvents: 'none' }} />

          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14, position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                TODAY'S FOCUS
              </div>
              <div style={{
                padding: '3px 10px', borderRadius: 20,
                background: goalPct >= 100 ? 'rgba(16,185,129,0.18)' : 'rgba(255,255,255,0.1)',
                border: `1px solid ${goalPct >= 100 ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.15)'}`,
                fontSize: 11, fontWeight: 700, color: goalPct >= 100 ? '#34d399' : 'rgba(255,255,255,0.7)',
              }}>
                {nextStep.chip}
              </div>
            </div>
            <button
              onClick={() => setView('dashboard')}
              style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(255,255,255,0.4)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}
            >
              Edit goals
            </button>
          </div>

          <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginBottom: 8, letterSpacing: '-0.02em', lineHeight: 1.25, position: 'relative' }}>
            {nextStep.heading}
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', marginBottom: 20, lineHeight: 1.6, position: 'relative' }}>
            {nextStep.sub}
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', position: 'relative' }}>
            <button
              onClick={() => nextStep.primaryAction?.()}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                padding: '10px 18px', borderRadius: 12, border: 'none',
                background: '#fff', color: '#0f172a',
                fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              <Play size={13} strokeWidth={2.5} />
              {nextStep.primaryLabel}
            </button>
            <div style={{
              display: 'inline-flex', alignItems: 'center',
              padding: '10px 16px', borderRadius: 12,
              background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
              fontSize: 12.5, fontWeight: 600, color: 'rgba(255,255,255,0.6)',
            }}>
              {nextStep.secondaryLabel}
            </div>
          </div>
        </div>

        {/* ── Practice Library ── */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 3 }}>PRACTICE LIBRARY</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>Browse subjects</div>
            </div>
            <button
              onClick={() => openFeedWithSubject ? openFeedWithSubject('') : openQuestionBankHome()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}
            >
              Open practice hub <ChevronRight size={14} />
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
            {CANONICAL_SUBJECTS.map(subj => {
              const acc = subjectAccuracy(stats, subj.keys);
              const hov = hoveredSubject === subj.num;
              return (
                <div
                  key={subj.num}
                  onMouseEnter={() => setHoveredSubject(subj.num)}
                  onMouseLeave={() => setHoveredSubject(null)}
                  onClick={() => openFeedWithSubject ? openFeedWithSubject(subj.feedSubject) : openQuestionBankHome()}
                  style={{
                    background: 'var(--bg)',
                    border: `1px solid ${hov ? subj.color + '44' : 'var(--border)'}`,
                    borderRadius: 16,
                    padding: '16px 16px',
                    cursor: 'pointer',
                    transform: hov ? 'translateY(-2px)' : 'none',
                    boxShadow: hov ? `0 8px 24px -8px ${subj.color}28` : '0 2px 8px -4px rgba(15,23,42,0.06)',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: 10,
                      background: subj.softBg,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 14, fontWeight: 900, color: subj.color,
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      {subj.num}
                    </div>
                    <ChevronRight size={14} color="var(--text-tert)" />
                  </div>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text)', marginBottom: 4, lineHeight: 1.3 }}>
                    {subj.name}
                  </div>
                  {acc ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ fontSize: 11, color: 'var(--text-tert)' }}>{acc.total} attempted</div>
                      <div style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--text-tert)' }} />
                      <div style={{ fontSize: 11, fontWeight: 700, color: acc.pct >= 65 ? '#16a34a' : acc.pct >= 45 ? '#d97706' : '#dc2626' }}>
                        {acc.pct}%
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: 'var(--text-tert)' }}>Practice ready</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Commission Library ── */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 3 }}>YOUR COMMISSIONS</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>All question banks</div>
            </div>
            <button
              onClick={openQuestionBankHome}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}
            >
              Browse all <ChevronRight size={14} />
            </button>
          </div>

          <div className="home-commission-grid">
            {commissionStats.map(({ commission, totalQs, allYears, papers, meta }) => {
              const hov = hoveredCommission === commission;
              return (
                <div
                  key={commission}
                  onClick={() => openCommission ? openCommission(commission) : openQuestionBankHome()}
                  onMouseEnter={() => setHoveredCommission(commission)}
                  onMouseLeave={() => setHoveredCommission(null)}
                  style={{
                    borderRadius: 16, overflow: 'hidden', cursor: 'pointer',
                    background: 'var(--bg)', border: `1px solid ${hov ? '#94a3b8' : 'var(--border)'}`,
                    transform: hov ? 'translateY(-2px)' : 'none',
                    boxShadow: hov ? '0 12px 28px -16px rgba(15,23,42,0.18)' : '0 2px 8px -4px rgba(15,23,42,0.06)',
                    transition: 'transform 0.15s, box-shadow 0.15s, border-color 0.12s',
                  }}
                >
                  <div style={{ height: 4, background: meta?.gradient || '#475569' }} />
                  <div style={{ padding: '14px 15px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
                      <div style={{
                        width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                        background: meta?.gradient || '#475569',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 10.5, fontWeight: 800, color: '#fff',
                      }}>
                        {meta?.abbr || commission.slice(0, 2)}
                      </div>
                      <div>
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>{commission}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-tert)', marginTop: 1 }}>{meta?.label || commission}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 14 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
                          {totalQs >= 1000 ? `${(totalQs / 1000).toFixed(1)}k` : totalQs}
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Qs</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>{allYears.length}</div>
                        <div style={{ fontSize: 9, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>years</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>{papers}</div>
                        <div style={{ fontSize: 9, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>papers</div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── RIGHT: sticky sidebar ──────────────────────────────────────── */}
      <div className="home-sidebar">

        {/* Profile Context */}
        <div className="surface-card" style={{ borderRadius: 20, padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              PROFILE CONTEXT
            </div>
            <div style={{
              padding: '3px 9px', borderRadius: 20,
              background: strongest ? 'rgba(22,163,74,0.1)' : 'rgba(245,158,11,0.1)',
              fontSize: 10.5, fontWeight: 700,
              color: strongest ? '#16a34a' : '#d97706',
            }}>
              {strongest ? 'Active' : 'Getting started'}
            </div>
          </div>

          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 14 }}>Prep settings</div>

          {[
            {
              label: 'EXAM YEAR',
              value: String(examYear),
              icon: <Target size={13} color="#2563eb" />,
            },
            {
              label: 'DAILY TARGET',
              value: `${dailyGoal} questions`,
              icon: <Zap size={13} color="#f59e0b" />,
            },
            ...(strongest ? [{
              label: 'STRONGEST',
              value: strongest.name.split(' ')[0],
              icon: <TrendingUp size={13} color="#16a34a" />,
            }] : []),
            ...(weakest && weakest.name !== strongest?.name ? [{
              label: 'WEAKEST',
              value: weakest.name.split(' ')[0],
              icon: <TrendingDown size={13} color="#dc2626" />,
            }] : []),
          ].map(item => (
            <div
              key={item.label}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 12px', borderRadius: 12, marginBottom: 8,
                background: 'var(--bg-alt)', border: '1px solid var(--border)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {item.icon}
                <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {item.label}
                </span>
              </div>
              <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>
                {item.value}
              </span>
            </div>
          ))}

          <button
            onClick={() => setShowGoals(true)}
            style={{
              width: '100%', marginTop: 4, padding: '9px 0',
              border: '1px solid var(--border)', borderRadius: 10,
              background: 'transparent', fontSize: 12.5, fontWeight: 600,
              color: 'var(--text-sec)', cursor: 'pointer', fontFamily: 'inherit',
              transition: 'border-color 0.15s',
            }}
          >
            Update goals
          </button>
        </div>

        {/* Progress Signals */}
        <div className="surface-card" style={{ borderRadius: 20, padding: '18px 20px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
            PROGRESS SIGNALS
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-tert)', marginBottom: 8 }}>Weekly consistency</div>
            <StreakDots dailyActivity={stats.dailyActivity || {}} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[
              {
                label: 'Total answered',
                value: totals.total > 999 ? `${(totals.total / 1000).toFixed(1)}k` : String(totals.total),
                color: '#2563eb',
              },
              {
                label: 'Accuracy',
                value: totals.total > 0 ? `${overallAccuracy}%` : '—',
                color: overallAccuracy >= 65 ? '#16a34a' : overallAccuracy >= 45 ? '#d97706' : '#dc2626',
              },
              {
                label: 'Streak',
                value: stats.streak > 0 ? `${stats.streak}d` : '0d',
                color: '#f59e0b',
              },
              {
                label: 'Daily Goal',
                value: `${todayCount}/${dailyGoal}`,
                color: goalPct >= 100 ? '#16a34a' : '#2563eb',
              },
            ].map(item => (
              <div key={item.label} style={{ padding: '10px 12px', borderRadius: 12, background: 'var(--bg-alt)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tert)', marginBottom: 4 }}>{item.label}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: item.color, letterSpacing: '-0.02em' }}>{item.value}</div>
              </div>
            ))}
          </div>

          {stats.streak > 0 && (
            <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 12, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="#fbbf24" stroke="none"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#d97706' }}>{stats.streak}-day streak — keep it alive!</span>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
