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

  const firstName = userDisplayName?.split(' ')[0] || 'Aspirant';
  const dailyGoal = parseInt(localStorage.getItem(`pyq_dailygoal_${userId}`) || '20', 10);
  const today = new Date().toISOString().split('T')[0];
  const todayCount = stats.dailyActivity?.[today] || 0;
  const goalPct = Math.min(100, Math.round((todayCount / dailyGoal) * 100));

  const totals = Object.values(stats.bySubject || {}).reduce(
    (acc, s) => ({ correct: acc.correct + s.correct, total: acc.total + s.total }),
    { correct: 0, total: 0 },
  );
  const accuracy = totals.total > 0 ? Math.round((totals.correct / totals.total) * 100) : 0;
  const remainingToday = Math.max(dailyGoal - todayCount, 0);
  const focusMessage = goalPct >= 100
    ? 'Today’s target is already done. Stay in rhythm with a fresh PYQ set or review weak areas.'
    : todayCount === 0
      ? 'Start with one clean practice set and build momentum early.'
      : `${remainingToday} more questions to close today’s target with intent.`;
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
  const nextAction = goalPct < 100 && firstExam
    ? {
        label: todayCount > 0 ? 'Finish today’s set' : 'Start today’s set',
        hint: `${remainingToday} question${remainingToday === 1 ? '' : 's'} left to hit your daily target.`,
        onClick: () => startPractice(firstExam.fullName, firstExam.years[0]),
      }
    : accuracy < 65
      ? {
          label: 'Review weak areas',
          hint: 'Focus on the topics where you are losing marks before adding more volume.',
          onClick: () => setView('dashboard'),
        }
      : {
          label: 'Explore smart practice',
          hint: 'You are stable enough to branch into topic-wise practice and newer papers.',
          onClick: () => setView('feed'),
        };

  return (
    <div className="home-layout" style={{ fontFamily: "var(--font-sans)" }}>

      {/* ── LEFT: main content ─────────────────────────────────────────── */}
      <div className="home-main-column">

        {/* Greeting banner */}
        <div style={{
          background: 'linear-gradient(145deg,#10243e 0%,#164a74 52%,#0f6cbd 100%)',
          borderRadius: 24, padding: '24px 24px', marginBottom: 24,
          position: 'relative', overflow: 'hidden',
          boxShadow: '0 24px 48px -28px rgba(15,23,42,0.45)',
        }}>
          <div style={{ position: 'absolute', right: -28, top: -28, width: 150, height: 150, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', right: 38, bottom: -56, width: 108, height: 108, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 1, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.28), transparent)' }} />

          {/* Sarnath SVG placeholder in top-right */}
          <div style={{ position: 'absolute', right: 24, top: '50%', transform: 'translateY(-50%)', opacity: 0.15, pointerEvents: 'none' }}>
            <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
              <circle cx="28" cy="28" r="26" stroke="white" strokeWidth="1.5"/>
              <path d="M28 8 L28 48 M18 18 L38 18 M16 28 L40 28 M18 38 L38 38" stroke="white" strokeWidth="1.2"/>
              <circle cx="28" cy="18" r="4" stroke="white" strokeWidth="1.2"/>
            </svg>
          </div>

          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#fff', marginBottom: 6, letterSpacing: '-0.03em' }}>
              Welcome back, {firstName}
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: 'rgba(255,255,255,0.72)', marginBottom: 16, maxWidth: 520 }}>
              {focusMessage}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 20, padding: '4px 11px', border: '1px solid rgba(255,255,255,0.15)' }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: '#fff' }}>{todayCount}/{dailyGoal} today</span>
                {goalPct >= 100 && (
                  <svg style={{ marginLeft: 5, verticalAlign: 'middle' }} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                )}
              </div>
              <div style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 20, padding: '4px 11px', border: '1px solid rgba(255,255,255,0.15)' }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: '#fff' }}>{totals.total > 0 ? `${accuracy}% accuracy` : 'Accuracy building'}</span>
              </div>
              {stats.streak > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(251,191,36,0.18)', borderRadius: 20, padding: '4px 11px', border: '1px solid rgba(251,191,36,0.3)' }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="#fbbf24" stroke="none"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: '#fde68a' }}>{stats.streak}d streak</span>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
              {firstExam && (
                <button
                  onClick={() => startPractice(firstExam.fullName, firstExam.years[0])}
                  style={{
                    padding: '10px 16px',
                    background: '#fff',
                    border: 'none',
                    borderRadius: 12,
                    color: '#10243e',
                    fontSize: 12.5,
                    fontWeight: 800,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 7,
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  Continue Practicing
                </button>
              )}
              <button
                onClick={() => setView('dashboard')}
                style={{
                  padding: '10px 16px',
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.18)',
                  borderRadius: 12,
                  color: '#fff',
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Review Progress
              </button>
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
            marginBottom: 24,
          }}
        >
          {[
            {
              label: 'Daily target',
              value: `${todayCount}/${dailyGoal}`,
              hint: goalPct >= 100 ? 'Completed today' : `${remainingToday} left`,
              accent: '#2563eb',
            },
            {
              label: 'Accuracy',
              value: totals.total > 0 ? `${accuracy}%` : '—',
              hint: accuracy >= 70 ? 'Stable' : accuracy >= 50 ? 'Improving' : 'Needs attention',
              accent: accuracy >= 70 ? '#16a34a' : accuracy >= 50 ? '#f59e0b' : '#ef4444',
            },
            {
              label: 'Streak',
              value: stats.streak > 0 ? `${stats.streak}d` : 'Start',
              hint: stats.streak > 0 ? 'Keep the chain alive' : 'Build momentum',
              accent: '#f59e0b',
            },
          ].map((item) => (
            <div
              key={item.label}
              className="surface-card"
              style={{ borderRadius: 18, padding: '16px 18px' }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                {item.label}
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)', lineHeight: 1.05, marginBottom: 5 }}>
                {item.value}
              </div>
              <div style={{ fontSize: 11.5, color: item.accent }}>
                {item.hint}
              </div>
            </div>
          ))}
        </div>

        {/* Previous Year Questions — commission cards */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <h2 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', margin: '0 0 2px' }}>Previous Year Questions</h2>
              <p style={{ fontSize: 12, color: 'var(--text-tert)', margin: 0 }}>Understand the examiner's mindset by practicing PYQs</p>
            </div>
            <button onClick={openQuestionBankHome} style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0, fontFamily: 'inherit', flexShrink: 0 }}>
              Browse all
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
                    borderRadius: 18, overflow: 'hidden', cursor: 'pointer',
                    background: 'var(--bg)', border: `1px solid ${hov ? '#94a3b8' : 'var(--border)'}`,
                    transform: hov ? 'translateY(-2px)' : 'none',
                    boxShadow: hov ? '0 18px 34px -24px rgba(15,23,42,0.22)' : '0 12px 24px -28px rgba(15,23,42,0.14)',
                    transition: 'transform 0.15s, box-shadow 0.15s, border-color 0.12s',
                  }}
                >
                  <div style={{ height: 5, background: meta?.gradient || '#475569' }} />
                  <div style={{ padding: '14px 15px' }}>
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
      <div className="home-sidebar">
        <div className="surface-card" style={{ borderRadius: 20, padding: '16px 18px' }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Today’s focus</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-tert)', marginTop: 4, lineHeight: 1.6 }}>
              {nextAction.hint}
            </div>
          </div>
          <div style={{ padding: '12px 14px', background: 'var(--bg-alt)', border: '1px solid var(--border)', borderRadius: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Weekly consistency</div>
            <StreakDots dailyActivity={stats.dailyActivity || {}} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              onClick={nextAction.onClick}
              style={{
                width: '100%', padding: '10px 0',
                background: '#2563eb', border: 'none',
                borderRadius: 10, fontSize: 12.5, fontWeight: 700,
                color: '#fff', cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {nextAction.label}
            </button>
            <button
              onClick={openQuestionBankHome}
              style={{
                width: '100%', padding: '10px 0',
                background: 'var(--bg)', border: '1px solid var(--border)',
                borderRadius: 10, fontSize: 12.5, fontWeight: 600,
                color: 'var(--text-sec)', cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Open Question Bank
            </button>
            <button
              onClick={() => setView('dashboard')}
              style={{
                width: '100%', padding: '10px 0',
                background: 'transparent', border: 'none',
                borderRadius: 10, fontSize: 12.5, fontWeight: 600,
                color: '#2563eb', cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Review progress
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
