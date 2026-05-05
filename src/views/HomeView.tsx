import { useState } from 'react';
import { type CommissionMap, type View } from '../types';
import { type UserStats } from '../lib/stats';
interface HomeViewProps {
  commissionMap: CommissionMap;
  openCommission: (c: string) => void;
  openExam: (examName: string, commission: string, examType: string, preferredYear?: number) => void;
  startPractice: (examName: string, year: number, subject?: string, topic?: string) => void;
  startMockExam: (examName: string, year: number) => void;
  setView: (v: View) => void;
  stats: UserStats;
  userDisplayName: string | null;
  userId: string;
}

const ORDERED_COMMISSIONS = ['UPSC', 'APPSC', 'TSPSC', 'TSLPRB', 'APSLPRB', 'APHC', 'TSHC', 'AP', 'TS', 'SSC', 'IBPS', 'RRB'];


function QuickActionCard({ icon, title, desc, onClick }: {
  icon: React.ReactNode; title: string; desc: string; onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: 'var(--bg)',
        border: `1px solid ${hovered ? 'var(--blue)' : 'var(--border)'}`,
        borderRadius: 12,
        padding: '18px 20px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 14,
        transition: 'border-color 0.15s, box-shadow 0.15s',
        boxShadow: hovered ? '0 0 0 3px rgba(37,99,235,0.08)' : 'none',
      }}
    >
      <div style={{
        width: 40, height: 40, borderRadius: 10, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18,
        background: hovered ? '#eff6ff' : 'var(--bg-alt)',
        transition: 'background 0.15s',
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 3 }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--text-sec)', lineHeight: 1.5 }}>{desc}</div>
      </div>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-tert)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}>
        <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
      </svg>
    </div>
  );
}

export function HomeView({
  commissionMap,
  openCommission, openExam, setView,
  stats, userDisplayName, userId,
  startPractice,
  startMockExam,
}: HomeViewProps) {
  const commissions = Object.keys(commissionMap).sort((a, b) => {
    const ai = ORDERED_COMMISSIONS.indexOf(a);
    const bi = ORDERED_COMMISSIONS.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });

  const firstName = userDisplayName?.split(' ')[0] || 'Aspirant';

  // Today's goal
  const dailyGoal = parseInt(localStorage.getItem(`pyq_dailygoal_${userId}`) || '20', 10);
  const today = new Date().toISOString().split('T')[0];
  const todayCount = stats.dailyActivity?.[today] || 0;
  const goalPct = Math.min(100, Math.round((todayCount / dailyGoal) * 100));

  // Weak areas — subjects sorted by lowest accuracy, min 5 attempts
  const weakAreas = Object.entries(stats.bySubject || {})
    .filter(([, s]) => s.total >= 5)
    .map(([subject, s]) => ({ subject, pct: Math.round((s.correct / s.total) * 100) }))
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 4);

  // First mock-able exam
  const firstMockExam = (() => {
    for (const c of commissions) {
      const exams = commissionMap[c] || {};
      for (const [, info] of Object.entries(exams)) {
        if (info.years?.length) return { fullName: info.fullName, year: info.years[0] };
      }
    }
    return null;
  })();

  const firstPracticeExam = firstMockExam;

  const recentPapers = commissions.flatMap(c => {
    const exams = commissionMap[c] || {};
    return Object.entries(exams).map(([, info]) => ({
      commission: c,
      examName: info.fullName,
      year: Math.max(...(info.years || [2024])),
      count: info.count,
      examType: Object.keys(commissionMap[c] || {}).find(k => commissionMap[c][k] === info) || '',
    }));
  }).sort((a, b) => b.year - a.year).slice(0, 6);

  const barColor = (pct: number) => pct >= 75 ? '#16a34a' : pct >= 50 ? '#f59e0b' : '#ef4444';

  return (
    <div style={{ fontFamily: "'Inter', sans-serif" }}>

      {/* ── Greeting ─────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)', margin: '0 0 4px', letterSpacing: '-0.4px' }}>
          Hi, {firstName} 👋
        </h1>
        <p style={{ fontSize: 13.5, color: 'var(--text-sec)', margin: 0 }}>
          Let's continue your preparation
        </p>
      </div>

      {/* ── Quick Actions ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        <QuickActionCard
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
            </svg>
          }
          title="Open Question Bank"
          desc="Browse commissions, papers, and years"
          onClick={() => setView('browse')}
        />
        <QuickActionCard
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
          }
          title="Take Mock Test"
          desc="Simulate real exam experience"
          onClick={() => firstMockExam ? startMockExam(firstMockExam.fullName, firstMockExam.year) : setView('home')}
        />
        <QuickActionCard
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20V10"/><path d="m18 20-6-6-6 6"/><path d="M12 4v6"/>
            </svg>
          }
          title="Start Practice"
          desc="Jump straight into a paper and keep momentum"
          onClick={() => firstPracticeExam ? startPractice(firstPracticeExam.fullName, firstPracticeExam.year) : setView('browse')}
        />
      </div>

      {/* ── Today's Goal + Weak Areas ─────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 28 }}>

        {/* Today's Goal */}
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
            </svg>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Today's Goal</span>
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>
            {todayCount} <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-sec)' }}>/ {dailyGoal} questions</span>
          </div>
          <div style={{ height: 8, background: 'var(--bg-canvas)', borderRadius: 99, overflow: 'hidden', margin: '12px 0 8px' }}>
            <div style={{ width: `${goalPct}%`, height: '100%', background: '#2563eb', borderRadius: 99, transition: 'width 0.4s ease' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-tert)' }}>
            <span>{goalPct}% complete</span>
            <button
              onClick={() => setView('dashboard')}
              style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}
            >
              View Progress →
            </button>
          </div>
        </div>

        {/* Weak Areas */}
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3v18h18"/><polyline points="7 14 11 10 15 13 21 7"/>
              </svg>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Weak Areas</span>
            </div>
            <button
              onClick={() => setView('dashboard')}
              style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}
            >
              View All
            </button>
          </div>
          {weakAreas.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-tert)', paddingTop: 4 }}>
              {stats.totalAnswered < 5 ? 'Practice at least 5 questions to see weak areas.' : 'No weak areas detected yet.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {weakAreas.map(({ subject, pct }) => (
                <div key={subject} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subject}</div>
                    <div style={{ height: 5, background: 'var(--bg-canvas)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: barColor(pct), borderRadius: 99 }} />
                    </div>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: barColor(pct) }}>{pct}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Recent Papers ─────────────────────────────────────────────────────── */}
      {recentPapers.length > 0 && (
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', margin: '0 0 14px' }}>
            Recent Papers
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(248px, 1fr))', gap: 8 }}>
            {recentPapers.map((paper, i) => (
              <div
                key={i}
                onClick={() => openExam(paper.examName, paper.commission, paper.examType, paper.year)}
                style={{
                  background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 9,
                  padding: '11px 14px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                  transition: 'border-color 0.12s, background 0.12s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-alt)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg)'; }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {paper.examName}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-sec)', marginTop: 2 }}>
                    {paper.commission} · {paper.year}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                    {paper.count}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-tert)' }}>questions</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
