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

const ORDERED_COMMISSIONS = ['UPSC', 'APPSC', 'TSPSC', 'TSLPRB', 'APSLPRB', 'APHC', 'TSHC', 'AP', 'TS', 'SSC', 'IBPS', 'RRB'];

const COMMISSION_ACCENT: Record<string, string> = {
  UPSC: '#2563eb', APPSC: '#059669', TSPSC: '#7c3aed',
  TSLPRB: '#0891b2', APSLPRB: '#0e7490', SSC: '#dc2626',
  IBPS: '#0284c7', RRB: '#d97706', APHC: '#be185d', TSHC: '#7c3aed',
};

const QUICK_TOPICS = [
  { subject: 'Polity', topic: 'Fundamental Rights', icon: '⚖️' },
  { subject: 'History', topic: 'Modern History', icon: '🏛️' },
  { subject: 'Economy', topic: 'Banking & Monetary Policy', icon: '📈' },
  { subject: 'Geography', topic: 'Indian Geography', icon: '🗺️' },
  { subject: 'Environment', topic: 'Biodiversity', icon: '🌿' },
  { subject: 'Science', topic: 'Science & Technology', icon: '🔬' },
];

function daysUntil(dateStr: string): number {
  const target = new Date(dateStr).getTime();
  const now = Date.now();
  return Math.max(0, Math.ceil((target - now) / 86_400_000));
}

function GoalRing({ pct, done, total }: { pct: number; done: number; total: number }) {
  const r = 32;
  const circ = 2 * Math.PI * r;
  const dash = Math.min(pct / 100, 1) * circ;
  const color = pct >= 100 ? '#16a34a' : '#2563eb';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <div style={{ position: 'relative', width: 76, height: 76, flexShrink: 0 }}>
        <svg width="76" height="76" viewBox="0 0 76 76">
          <circle cx="38" cy="38" r={r} fill="none" stroke="var(--bg-canvas)" strokeWidth="7" />
          <circle
            cx="38" cy="38" r={r} fill="none"
            stroke={color} strokeWidth="7" strokeLinecap="round"
            strokeDasharray={`${dash} ${circ}`}
            transform="rotate(-90 38 38)"
            style={{ transition: 'stroke-dasharray 0.5s ease' }}
          />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 14, fontWeight: 800, color, lineHeight: 1 }}>{pct}%</span>
        </div>
      </div>
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 3 }}>Today's Goal</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', lineHeight: 1 }}>
          {done}<span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-sec)', marginLeft: 4 }}>/ {total}</span>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-sec)', marginTop: 3 }}>questions done</div>
      </div>
    </div>
  );
}

function ActivityDots({ dailyActivity }: { dailyActivity: Record<string, number> }) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86_400_000);
    const key = d.toISOString().split('T')[0];
    const label = d.toLocaleDateString('en', { weekday: 'short' });
    const count = dailyActivity[key] || 0;
    return { key, label, count };
  });

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
      {days.map(({ key, label, count }) => {
        const active = count > 0;
        const isToday = key === new Date().toISOString().split('T')[0];
        return (
          <div key={key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, flex: 1 }}>
            <div
              title={`${count} questions`}
              style={{
                width: '100%', height: 26, borderRadius: 6,
                background: active ? '#2563eb' : 'var(--bg-canvas)',
                opacity: active ? (isToday ? 1 : 0.6) : 1,
                border: isToday ? '2px solid #2563eb' : '2px solid transparent',
                transition: 'background 0.15s',
              }}
            />
            <span style={{ fontSize: 9.5, color: isToday ? '#2563eb' : 'var(--text-tert)', fontWeight: isToday ? 700 : 400 }}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

function ExamCountdown() {
  // UPSC CSE Prelims 2027 estimated date
  const days = daysUntil('2027-06-06');
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      background: 'rgba(255,255,255,0.15)', borderRadius: 20,
      padding: '6px 14px', border: '1px solid rgba(255,255,255,0.22)',
    }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
      <span style={{ fontSize: 12, fontWeight: 700, color: 'white' }}>
        <span style={{ color: '#fde68a', fontWeight: 900 }}>{days}</span> days to Prelims 2027
      </span>
    </div>
  );
}

function StudyIllustration() {
  return (
    <svg viewBox="0 0 260 160" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ width: '100%', height: '100%' }}>
      <circle cx="180" cy="80" r="90" fill="rgba(255,255,255,0.04)" />
      <circle cx="180" cy="80" r="62" fill="rgba(255,255,255,0.05)" />
      {/* Book stack */}
      <rect x="110" y="22" width="96" height="112" rx="8" fill="rgba(255,255,255,0.07)" />
      <rect x="101" y="14" width="96" height="112" rx="8" fill="rgba(255,255,255,0.12)" />
      <rect x="92" y="6" width="96" height="112" rx="8" fill="rgba(255,255,255,0.2)" />
      <rect x="92" y="6" width="96" height="18" rx="8" fill="rgba(255,255,255,0.16)" />
      <rect x="106" y="32" width="56" height="5" rx="2.5" fill="rgba(255,255,255,0.75)" />
      <rect x="106" y="44" width="44" height="4" rx="2" fill="rgba(255,255,255,0.42)" />
      <rect x="106" y="54" width="50" height="4" rx="2" fill="rgba(255,255,255,0.35)" />
      <rect x="106" y="64" width="40" height="4" rx="2" fill="rgba(255,255,255,0.35)" />
      {/* Option circles */}
      <circle cx="110" cy="82" r="7" fill="rgba(255,255,255,0.2)" />
      <text x="110" y="86" textAnchor="middle" fontSize="7" fill="rgba(255,255,255,0.65)" fontWeight="700" fontFamily="sans-serif">A</text>
      <circle cx="128" cy="82" r="7" fill="rgba(94,234,212,0.9)" />
      <text x="128" y="86" textAnchor="middle" fontSize="7" fill="white" fontWeight="800" fontFamily="sans-serif">B</text>
      <circle cx="146" cy="82" r="7" fill="rgba(255,255,255,0.2)" />
      <text x="146" y="86" textAnchor="middle" fontSize="7" fill="rgba(255,255,255,0.65)" fontWeight="700" fontFamily="sans-serif">C</text>
      <circle cx="164" cy="82" r="7" fill="rgba(255,255,255,0.2)" />
      <text x="164" y="86" textAnchor="middle" fontSize="7" fill="rgba(255,255,255,0.65)" fontWeight="700" fontFamily="sans-serif">D</text>
      {/* Check badge */}
      <circle cx="172" cy="108" r="16" fill="rgba(22,163,74,0.88)" />
      <path d="M164 108l5.5 5.5 10.5-11" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* Trending line */}
      <polyline points="20,140 42,120 64,130 88,102" stroke="rgba(255,255,255,0.28)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="88" cy="102" r="4" fill="rgba(255,255,255,0.55)" />
      {/* XP badge */}
      <rect x="20" y="18" width="40" height="20" rx="10" fill="rgba(255,255,255,0.14)" stroke="rgba(255,255,255,0.24)" strokeWidth="1" />
      <text x="40" y="32" textAnchor="middle" fontSize="9.5" fill="white" fontWeight="800" fontFamily="sans-serif">+10 XP</text>
    </svg>
  );
}

export function HomeView({
  commissionMap,
  openExam, setView,
  openQuestionBankHome,
  stats, userDisplayName, userId,
  startPractice,
  startMockExam,
}: HomeViewProps) {
  const [hoveredAction, setHoveredAction] = useState<string | null>(null);
  const [hoveredPaper, setHoveredPaper] = useState<number | null>(null);

  const commissions = Object.keys(commissionMap).sort((a, b) => {
    const ai = ORDERED_COMMISSIONS.indexOf(a);
    const bi = ORDERED_COMMISSIONS.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });

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

  const firstExam = (() => {
    for (const c of commissions) {
      const exams = commissionMap[c] || {};
      for (const [, info] of Object.entries(exams)) {
        if (info.years?.length) return { fullName: info.fullName, year: info.years[0] };
      }
    }
    return null;
  })();

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

  const actions = [
    {
      id: 'browse',
      label: 'Question Bank',
      sub: 'Browse all papers & exams',
      color: '#2563eb',
      bg: '#eff6ff',
      onClick: openQuestionBankHome,
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
      ),
    },
    {
      id: 'mock',
      label: 'Mock Test',
      sub: 'Simulate exam conditions',
      color: '#7c3aed',
      bg: '#f5f3ff',
      onClick: () => firstExam ? startMockExam(firstExam.fullName, firstExam.year) : setView('home'),
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
      ),
    },
    {
      id: 'practice',
      label: 'Quick Practice',
      sub: 'Jump into a paper now',
      color: '#059669',
      bg: '#ecfdf5',
      onClick: () => firstExam ? startPractice(firstExam.fullName, firstExam.year) : openQuestionBankHome(),
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
      ),
    },
  ];

  return (
    <div style={{ fontFamily: "'Inter', sans-serif" }}>

      {/* ── Hero banner ───────────────────────────────────────────────────── */}
      <div style={{
        background: 'linear-gradient(135deg, #1e3a8a 0%, #2563eb 60%, #3b82f6 100%)',
        borderRadius: 18, padding: '26px 28px',
        marginBottom: 16,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        overflow: 'hidden', position: 'relative', minHeight: 158,
      }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: 18, pointerEvents: 'none', background: 'radial-gradient(ellipse at 75% 50%, rgba(255,255,255,0.07) 0%, transparent 58%)' }} />

        <div style={{ flex: 1, minWidth: 0, position: 'relative', zIndex: 1 }}>
          <h1 style={{ fontSize: 25, fontWeight: 800, color: 'white', margin: '0 0 4px', letterSpacing: '-0.4px', lineHeight: 1.2 }}>
            Hi, {firstName}
          </h1>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.62)', margin: '0 0 16px', lineHeight: 1.5 }}>
            {goalPct >= 100
              ? 'Daily goal complete — excellent work!'
              : todayCount === 0
              ? 'Ready to practice? Start with any topic below.'
              : `${dailyGoal - todayCount} more to hit today's goal`}
          </p>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <ExamCountdown />
            {stats.totalAnswered > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.13)', borderRadius: 20, padding: '6px 12px', border: '1px solid rgba(255,255,255,0.2)' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>
                </svg>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'white' }}>
                  {stats.totalAnswered >= 1000 ? `${(stats.totalAnswered / 1000).toFixed(1)}k` : stats.totalAnswered} done
                </span>
              </div>
            )}
            {stats.streak > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(251,191,36,0.18)', borderRadius: 20, padding: '6px 12px', border: '1px solid rgba(251,191,36,0.32)' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="#fbbf24" stroke="#fbbf24" strokeWidth="0">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
                </svg>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#fde68a' }}>{stats.streak} day streak</span>
              </div>
            )}
            {totals.total >= 10 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.11)', borderRadius: 20, padding: '6px 12px', border: '1px solid rgba(255,255,255,0.16)' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: accuracy >= 70 ? '#86efac' : accuracy >= 50 ? '#fde68a' : '#fca5a5' }}>
                  {accuracy}% accuracy
                </span>
              </div>
            )}
          </div>
        </div>

        <div style={{ width: 200, height: 148, flexShrink: 0, marginLeft: 16, opacity: 0.88, position: 'relative', zIndex: 1 }}>
          <StudyIllustration />
        </div>
      </div>

      {/* ── Focus row ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
        {/* Goal ring + activity */}
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <GoalRing pct={goalPct} done={todayCount} total={dailyGoal} />
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
              Last 7 days
            </div>
            <ActivityDots dailyActivity={stats.dailyActivity || {}} />
          </div>
          <button
            onClick={() => setView('dashboard')}
            style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0, fontFamily: 'inherit', textAlign: 'left' }}
          >
            Full analytics →
          </button>
        </div>

        {/* Quick actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {actions.map(({ id, label, sub, color, bg, onClick, icon }) => {
            const hov = hoveredAction === id;
            return (
              <button
                key={id}
                onClick={onClick}
                onMouseEnter={() => setHoveredAction(id)}
                onMouseLeave={() => setHoveredAction(null)}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', gap: 14,
                  background: 'var(--bg)',
                  border: `1px solid ${hov ? color : 'var(--border)'}`,
                  borderRadius: 12, padding: '13px 16px',
                  cursor: 'pointer', fontFamily: 'inherit',
                  boxShadow: hov ? `0 0 0 3px ${color}14` : 'none',
                  transition: 'border-color 0.12s, box-shadow 0.12s',
                  textAlign: 'left',
                }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: 9, flexShrink: 0,
                  background: hov ? bg : 'var(--bg-alt)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: hov ? color : 'var(--text-sec)',
                  transition: 'background 0.12s, color 0.12s',
                }}>
                  {icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', lineHeight: 1.2 }}>{label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-sec)', marginTop: 2 }}>{sub}</div>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tert)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  style={{ flexShrink: 0, transition: 'transform 0.12s', transform: hov ? 'translateX(3px)' : 'none' }}>
                  <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
                </svg>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Quick topics ──────────────────────────────────────────────────── */}
      {firstExam && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <h2 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Practice by Topic</h2>
            <button
              onClick={openQuestionBankHome}
              style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}
            >
              All topics →
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {QUICK_TOPICS.map(({ subject, topic, icon }) => (
              <button
                key={topic}
                onClick={() => startPractice(firstExam.fullName, firstExam.year, subject, topic)}
                style={{
                  padding: '8px 14px', background: 'var(--bg)', border: '1px solid var(--border)',
                  borderRadius: 999, fontSize: 12.5, fontWeight: 600, color: 'var(--text-sec)',
                  cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6,
                  transition: 'border-color 0.12s, color 0.12s, background 0.12s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#2563eb'; (e.currentTarget as HTMLButtonElement).style.color = '#2563eb'; (e.currentTarget as HTMLButtonElement).style.background = '#eff6ff'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-sec)'; (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg)'; }}
              >
                <span style={{ fontSize: 14 }}>{icon}</span>
                {topic}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Recent papers ─────────────────────────────────────────────────── */}
      {recentPapers.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <h2 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Recent Papers</h2>
            <button
              onClick={openQuestionBankHome}
              style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}
            >
              View all →
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
            {recentPapers.map((paper, i) => {
              const accent = COMMISSION_ACCENT[paper.commission] || '#475569';
              const hov = hoveredPaper === i;
              return (
                <div
                  key={i}
                  onClick={() => openExam(paper.examName, paper.commission, paper.examType, paper.year)}
                  onMouseEnter={() => setHoveredPaper(i)}
                  onMouseLeave={() => setHoveredPaper(null)}
                  style={{
                    background: 'var(--bg)', border: `1px solid ${hov ? accent : 'var(--border)'}`,
                    borderRadius: 10, overflow: 'hidden', cursor: 'pointer',
                    transition: 'border-color 0.12s, box-shadow 0.12s',
                    boxShadow: hov ? `0 0 0 3px ${accent}14` : 'none',
                  }}
                >
                  <div style={{ height: 3, background: accent }} />
                  <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {paper.examName}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-sec)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ fontWeight: 700, color: accent }}>{paper.commission}</span>
                        <span>·</span>
                        <span>{paper.year}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{paper.count}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-tert)' }}>Qs</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
