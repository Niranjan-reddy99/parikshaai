import { useState } from 'react';
import { type CommissionMap, type View } from '../types';
import { type UserStats } from '../lib/stats';

interface HomeViewProps {
  commissionMap: CommissionMap;
  openCommission?: (c: string) => void;
  openExam: (examName: string, commission: string, examType: string, preferredYear?: number) => void;
  startPractice: (examName: string, year: number, subject?: string, topic?: string) => void;
  startMockExam: (examName: string, year: number) => void;
  setView: (v: View) => void;
  openQuestionBankHome: () => void;
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

function daysUntil(dateStr: string) {
  return Math.max(0, Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000));
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
          <span key={key} style={{ fontSize: 10, color: 'var(--text-tert)', fontWeight: 500, width: 24, textAlign: 'center' }}>{label}</span>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        {days.map(({ key, count, isToday }) => (
          <div
            key={key}
            title={`${count} questions`}
            style={{
              width: 24, height: 24, borderRadius: '50%',
              background: count > 0 ? '#2563eb' : 'var(--bg-canvas)',
              border: isToday ? '2px solid #2563eb' : '2px solid transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
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

export function HomeView({
  commissionMap, openCommission,
  openExam, startPractice, startMockExam,
  setView, openQuestionBankHome,
  stats, userDisplayName, userId,
}: HomeViewProps) {
  const [hoveredCommission, setHoveredCommission] = useState<string | null>(null);
  const [hoveredShortcut, setHoveredShortcut] = useState<number | null>(null);

  const firstName = userDisplayName?.split(' ')[0] || 'Aspirant';
  const dailyGoal = parseInt(localStorage.getItem(`pyq_dailygoal_${userId}`) || '20', 10);
  const today = new Date().toISOString().split('T')[0];
  const todayCount = stats.dailyActivity?.[today] || 0;
  const goalPct = Math.min(100, Math.round((todayCount / dailyGoal) * 100));
  const daysLeft = daysUntil('2027-06-06');

  const totals = Object.values(stats.bySubject || {}).reduce(
    (acc, s) => ({ correct: acc.correct + s.correct, total: acc.total + s.total }),
    { correct: 0, total: 0 },
  );
  const accuracy = totals.total > 0 ? Math.round((totals.correct / totals.total) * 100) : 0;

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

  // Find UPSC or first available exam for quick shortcuts
  const upscExams = Object.entries(commissionMap['UPSC'] || {});
  const upscPrelimsEntry = upscExams.find(([k]) => k.toLowerCase().includes('prelim')) || upscExams[0];
  const firstCommission = commissions[0];
  const firstExamEntries = Object.entries(commissionMap[firstCommission] || {});
  const firstExam = firstExamEntries[0]?.[1];

  const quickShortcuts = [
    {
      tag: 'Last 5 Years',
      tagColor: '#7c3aed', tagBg: '#f5f3ff',
      title: upscPrelimsEntry ? upscPrelimsEntry[0] : (firstExamEntries[0]?.[0] || 'Practice'),
      sub: 'Most recent papers',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
      ),
      iconColor: '#7c3aed', iconBg: '#f5f3ff',
      onClick: () => {
        const entry = upscPrelimsEntry || firstExamEntries[0];
        if (entry) startPractice(entry[1].fullName, entry[1].years[0]);
      },
    },
    {
      tag: 'Weak Topics',
      tagColor: '#dc2626', tagBg: '#fef2f2',
      title: 'Your Weak Areas',
      sub: 'Practice where you\'re losing marks',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 3v18h18"/><polyline points="7 14 11 10 15 13 21 7"/>
        </svg>
      ),
      iconColor: '#dc2626', iconBg: '#fef2f2',
      onClick: () => setView('dashboard'),
    },
    {
      tag: 'Topic-wise',
      tagColor: '#059669', tagBg: '#f0fdf4',
      title: 'Browse by Topic',
      sub: 'Practice across exams by subject',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/>
        </svg>
      ),
      iconColor: '#059669', iconBg: '#f0fdf4',
      onClick: () => setView('feed'),
    },
  ];

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", display: 'grid', gridTemplateColumns: '1fr 256px', gap: 20, alignItems: 'start' }}>

      {/* ── LEFT: main content ─────────────────────────────────────────── */}
      <div>

        {/* Greeting banner */}
        <div style={{
          background: 'linear-gradient(135deg,#0f172a 0%,#1e3a8a 60%,#1d4ed8 100%)',
          borderRadius: 14, padding: '20px 24px', marginBottom: 20,
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', right: -20, top: -20, width: 130, height: 130, borderRadius: '50%', background: 'rgba(255,255,255,0.04)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', right: 40, bottom: -40, width: 80, height: 80, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', pointerEvents: 'none' }} />

          {/* Sarnath SVG placeholder in top-right */}
          <div style={{ position: 'absolute', right: 24, top: '50%', transform: 'translateY(-50%)', opacity: 0.15, pointerEvents: 'none' }}>
            <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
              <circle cx="28" cy="28" r="26" stroke="white" strokeWidth="1.5"/>
              <path d="M28 8 L28 48 M18 18 L38 18 M16 28 L40 28 M18 38 L38 38" stroke="white" strokeWidth="1.2"/>
              <circle cx="28" cy="18" r="4" stroke="white" strokeWidth="1.2"/>
            </svg>
          </div>

          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginBottom: 4, letterSpacing: '-0.2px' }}>
              Hi, {firstName}
            </div>
            <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.6)', marginBottom: 14 }}>
              {goalPct >= 100
                ? 'Daily goal complete. Strong work.'
                : todayCount === 0
                  ? 'Pick an exam below and get started.'
                  : `${dailyGoal - todayCount} more questions to hit today's goal.`}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(255,255,255,0.12)', borderRadius: 20, padding: '4px 11px', border: '1px solid rgba(255,255,255,0.18)' }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: '#fff' }}><span style={{ color: '#fde68a' }}>{daysLeft}d</span> to Prelims 2027</span>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 20, padding: '4px 11px', border: '1px solid rgba(255,255,255,0.15)' }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: '#fff' }}>{todayCount}/{dailyGoal} today</span>
                {goalPct >= 100 && (
                  <svg style={{ marginLeft: 5, verticalAlign: 'middle' }} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                )}
              </div>
              {stats.streak > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(251,191,36,0.18)', borderRadius: 20, padding: '4px 11px', border: '1px solid rgba(251,191,36,0.3)' }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="#fbbf24" stroke="none"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: '#fde68a' }}>{stats.streak}d streak</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Quick Practice Set */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Quick Practice</h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
            {quickShortcuts.map((s, i) => {
              const hov = hoveredShortcut === i;
              return (
                <div
                  key={i}
                  onClick={s.onClick}
                  onMouseEnter={() => setHoveredShortcut(i)}
                  onMouseLeave={() => setHoveredShortcut(null)}
                  style={{
                    background: 'var(--bg)', border: `1px solid ${hov ? '#94a3b8' : 'var(--border)'}`,
                    borderRadius: 12, padding: '14px 16px', cursor: 'pointer',
                    boxShadow: hov ? '0 4px 16px rgba(15,23,42,0.08)' : 'none',
                    transition: 'border-color 0.12s, box-shadow 0.12s',
                    display: 'flex', flexDirection: 'column', gap: 10,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: s.tagBg, color: s.tagColor }}>
                      {s.tag}
                    </span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tert)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: s.iconBg, color: s.iconColor, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {s.icon}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', lineHeight: 1.3 }}>{s.title}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-tert)', marginTop: 2 }}>{s.sub}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Previous Year Questions — commission cards */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: '0 0 2px' }}>Previous Year Questions</h2>
              <p style={{ fontSize: 12, color: 'var(--text-tert)', margin: 0 }}>Understand the examiner's mindset by practicing PYQs</p>
            </div>
            <button onClick={openQuestionBankHome} style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0, fontFamily: 'inherit', flexShrink: 0 }}>
              Browse all
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10 }}>
            {commissionStats.map(({ commission, totalQs, allYears, papers, meta }) => {
              const hov = hoveredCommission === commission;
              return (
                <div
                  key={commission}
                  onClick={() => openCommission ? openCommission(commission) : openQuestionBankHome()}
                  onMouseEnter={() => setHoveredCommission(commission)}
                  onMouseLeave={() => setHoveredCommission(null)}
                  style={{
                    borderRadius: 12, overflow: 'hidden', cursor: 'pointer',
                    background: 'var(--bg)', border: `1px solid ${hov ? '#94a3b8' : 'var(--border)'}`,
                    transform: hov ? 'translateY(-2px)' : 'none',
                    boxShadow: hov ? '0 6px 20px rgba(15,23,42,0.09)' : 'none',
                    transition: 'transform 0.15s, box-shadow 0.15s, border-color 0.12s',
                  }}
                >
                  <div style={{ height: 4, background: meta?.gradient || '#475569' }} />
                  <div style={{ padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                        background: meta?.gradient || '#475569',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 800, color: '#fff',
                      }}>
                        {meta?.abbr || commission.slice(0, 2)}
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{commission}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--text-tert)', marginTop: 1 }}>{meta?.label || commission}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 12 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
                          {totalQs >= 1000 ? `${(totalQs / 1000).toFixed(1)}k` : totalQs}
                        </div>
                        <div style={{ fontSize: 9.5, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>questions</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{allYears.length}</div>
                        <div style={{ fontSize: 9.5, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>years</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{papers}</div>
                        <div style={{ fontSize: 9.5, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>papers</div>
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, position: 'sticky', top: 24 }}>

        {/* Days to Prelims */}
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 14, padding: '18px 20px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tert)', marginBottom: 6 }}>Days left to Prelims 2027</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 42, fontWeight: 900, color: 'var(--text)', lineHeight: 1, letterSpacing: '-2px' }}>
              {daysLeft}
            </div>
            <svg width="44" height="44" viewBox="0 0 56 56" fill="none" opacity="0.18">
              <circle cx="28" cy="28" r="26" stroke="var(--text)" strokeWidth="2"/>
              <path d="M28 10 L28 46 M20 20 L36 20 M18 28 L38 28 M20 36 L36 36" stroke="var(--text)" strokeWidth="1.5"/>
              <circle cx="28" cy="20" r="5" stroke="var(--text)" strokeWidth="1.5"/>
            </svg>
          </div>
        </div>

        {/* Today's Activity */}
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 18px' }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', marginBottom: 14 }}>Today's Activity</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            {[
              {
                value: todayCount,
                label: 'MCQs Practiced',
                color: '#7c3aed',
                icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
              },
              {
                value: totals.total > 0 ? `${accuracy}%` : '—',
                label: 'Accuracy',
                color: accuracy >= 70 ? '#16a34a' : accuracy >= 50 ? '#f59e0b' : '#ef4444',
                icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>,
              },
            ].map(({ value, label, color, icon }) => (
              <div key={label} style={{ padding: '10px 12px', background: 'var(--bg-alt)', borderRadius: 10 }}>
                <div style={{ color, marginBottom: 4 }}>{icon}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', lineHeight: 1 }}>{value}</div>
                <div style={{ fontSize: 10.5, color: 'var(--text-tert)', marginTop: 3 }}>{label}</div>
              </div>
            ))}
          </div>
          <button
            onClick={() => setView('leaderboard')}
            style={{
              width: '100%', padding: '8px 0',
              background: 'var(--bg-alt)', border: '1px solid var(--border)',
              borderRadius: 8, fontSize: 12.5, fontWeight: 600,
              color: '#2563eb', cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            View Leaderboard
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
          </button>
        </div>

        {/* Streak */}
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill={stats.streak > 0 ? '#f59e0b' : 'none'} stroke={stats.streak > 0 ? '#f59e0b' : 'var(--text-tert)'} strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{stats.streak}-day streak</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-tert)', marginTop: 2 }}>
                {stats.streak > 0 ? 'Keep the momentum going' : 'Practice today to start your streak'}
              </div>
            </div>
          </div>
          <StreakDots dailyActivity={stats.dailyActivity || {}} />
        </div>

        {/* Start practicing CTA */}
        {firstExam && (
          <button
            onClick={() => startPractice(firstExam.fullName, firstExam.years[0])}
            style={{
              width: '100%', padding: '11px 0',
              background: '#2563eb', border: 'none',
              borderRadius: 10, fontSize: 13, fontWeight: 700,
              color: '#fff', cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            Start Practicing
          </button>
        )}

        {/* My Progress link */}
        <button
          onClick={() => setView('dashboard')}
          style={{
            width: '100%', padding: '10px 0',
            background: 'var(--bg)', border: '1px solid var(--border)',
            borderRadius: 10, fontSize: 13, fontWeight: 600,
            color: 'var(--text-sec)', cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><polyline points="7 14 11 10 15 13 21 7"/></svg>
          My Progress
        </button>
      </div>
    </div>
  );
}
