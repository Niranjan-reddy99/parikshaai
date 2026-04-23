import React, { useMemo } from 'react';
import { C } from '../lib/tokens';
import { type UserStats, xpToLevel } from '../lib/stats';
interface BadgesViewProps {
  stats: UserStats;
}

interface Badge {
  id: string;
  name: string;
  icon: string;
  desc: string;
  earned: boolean;
}

export function BadgesView({ stats }: BadgesViewProps) {
  const { level } = xpToLevel(stats.xp);

  const overallAcc = useMemo(() => {
    let correct = 0, total = 0;
    for (const v of Object.values(stats.bySubject)) { correct += v.correct; total += v.total; }
    return total > 0 ? Math.round((correct / total) * 100) : 0;
  }, [stats.bySubject]);

  const bestSubjectAcc = useMemo(() =>
    Object.entries(stats.bySubject)
      .filter(([, v]) => v.total >= 5)
      .map(([subject, v]) => ({ subject, acc: Math.round((v.correct / v.total) * 100) }))
      .sort((a, b) => b.acc - a.acc)[0],
    [stats.bySubject]
  );

  const badges: Badge[] = [
    { id: 'first10',     name: 'First Steps',   icon: '🎯', desc: 'Answer your first 10 questions',        earned: stats.totalAnswered >= 10 },
    { id: 'first100',    name: 'Century',        icon: '💯', desc: 'Answer 100 questions total',            earned: stats.totalAnswered >= 100 },
    { id: 'first500',    name: 'Grinder',        icon: '⚙️', desc: 'Answer 500 questions total',            earned: stats.totalAnswered >= 500 },
    { id: 'streak7',     name: 'Week Warrior',   icon: '🔥', desc: '7-day practice streak',                 earned: stats.streak >= 7 },
    { id: 'streak30',    name: 'Unstoppable',    icon: '📅', desc: '30-day practice streak',                earned: stats.streak >= 30 },
    { id: 'acc70',       name: 'Sharp Shooter',  icon: '🏹', desc: '70%+ accuracy with min 20 questions',   earned: overallAcc >= 70 && stats.totalAnswered >= 20 },
    { id: 'acc85',       name: 'Elite',          icon: '🌟', desc: '85%+ accuracy with min 50 questions',   earned: overallAcc >= 85 && stats.totalAnswered >= 50 },
    { id: 'subjectPro',  name: bestSubjectAcc ? `${bestSubjectAcc.subject} Pro` : 'Subject Pro', icon: '⚖️', desc: '90%+ accuracy in any subject (min 5 Qs)', earned: !!bestSubjectAcc && bestSubjectAcc.acc >= 90 },
    { id: 'level3',      name: 'Scholar',        icon: '📚', desc: 'Reach Level 3',                         earned: level >= 3 },
    { id: 'level5',      name: 'Expert',         icon: '🧠', desc: 'Reach Level 5',                         earned: level >= 5 },
    { id: 'xp5000',      name: 'XP Hoarder',     icon: '💰', desc: 'Earn 5,000 XP total',                   earned: stats.xp >= 5000 },
    { id: 'allSubjects', name: 'All-Rounder',    icon: '🌐', desc: 'Answer questions in 5+ subjects',       earned: Object.keys(stats.bySubject).length >= 5 },
  ];

  const earned = badges.filter(b => b.earned);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1000 }}>

      {/* ── Page header ───────────────────────────────────────────────────────── */}
      <div>
        <div style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", color: C.textTert, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
          Milestones
        </div>
        <h2 style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 24, fontWeight: 400, letterSpacing: '-0.3px', color: C.text, marginBottom: 6 }}>
          Achievements <em style={{ fontStyle: 'italic', color: C.headingEm }}>& Badges</em>
        </h2>
        <p style={{ fontSize: 13, color: C.textTert, lineHeight: 1.5 }}>
          {earned.length} of {badges.length} badges earned. Keep practicing to unlock more.
        </p>
      </div>

      {/* ── Progress bar ──────────────────────────────────────────────────────── */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '20px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontSize: 12, color: C.textTert, fontFamily: "'DM Mono', monospace" }}>
          <span>{earned.length} earned</span>
          <span>{badges.length - earned.length} remaining</span>
        </div>
        <div style={{ height: 4, background: 'var(--c-surface3)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${(earned.length / badges.length) * 100}%`, background: C.accent, borderRadius: 4, transition: 'width 1.2s ease' }} />
        </div>
      </div>

      {/* ── Badge grid ────────────────────────────────────────────────────────── */}
      {stats.totalAnswered === 0 ? (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '60px 40px', textAlign: 'center' }}>
          <div style={{ fontSize: 40, display: 'block', marginBottom: 16 }}>🏆</div>
          <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 20, fontWeight: 400, color: C.text, marginBottom: 8 }}>Start practicing to earn badges</div>
          <div style={{ fontSize: 13, color: C.textTert }}>Answer questions, build streaks, and unlock achievements.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          {badges.map(b => (
            <div key={b.id}
              style={{
                background: C.surface,
                border: `1px solid ${b.earned ? 'rgba(251,191,36,0.20)' : C.border}`,
                borderRadius: 14,
                padding: '24px 20px',
                textAlign: 'center',
                opacity: b.earned ? 1 : 0.4,
                transition: 'all 0.15s',
                cursor: 'default',
              }}
              onMouseEnter={e => { if (b.earned) { e.currentTarget.style.borderColor = 'rgba(251,191,36,0.40)'; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.5)'; } }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = b.earned ? 'rgba(251,191,36,0.20)' : C.border; e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}>
              <span style={{ fontSize: 32, display: 'block', marginBottom: 12, filter: b.earned ? 'drop-shadow(0 0 8px rgba(251,191,36,0.4))' : 'none' }}>
                {b.icon}
              </span>
              <div style={{ fontSize: 13, fontWeight: 500, color: b.earned ? C.text : C.textSec, marginBottom: 4 }}>{b.name}</div>
              <div style={{ fontSize: 11, color: C.textTert, lineHeight: 1.5, marginBottom: 10 }}>{b.desc}</div>
              <div style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", color: b.earned ? C.warn : C.textTert }}>
                {b.earned ? '✓ Earned' : 'Locked'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
