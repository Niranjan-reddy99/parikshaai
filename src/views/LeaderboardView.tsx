import React, { useMemo, useState } from 'react';
import { C } from '../lib/tokens';
import { type UserStats } from '../lib/stats';

interface LeaderboardViewProps {
  stats: UserStats;
  user: { displayName: string | null };
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
  { name: 'Meera Pillai',  initials: 'MP', xp: 980,  acc: 61, streak: 1  },
  { name: 'Rohan Gupta',   initials: 'RG', xp: 720,  acc: 55, streak: 0  },
  { name: 'Tanya Bose',    initials: 'TB', xp: 450,  acc: 48, streak: 0  },
  { name: 'Vijay Shankar', initials: 'VS', xp: 210,  acc: 42, streak: 0  },
];

const AV_COLORS = ['#1a4a42','#1a2a42','#2a1a42','#1a422a','#421a1a','#422a1a','#1a4242','#2a421a','#42421a','#1a1a42','#422a42','#2a4242','#42241a','#241a42','#1a4224'];

export function LeaderboardView({ stats, user }: LeaderboardViewProps) {
  const [tab, setTab] = useState<'weekly' | 'monthly' | 'alltime'>('weekly');

  const overallAcc = useMemo(() => {
    let correct = 0, total = 0;
    for (const v of Object.values(stats.bySubject)) { correct += v.correct; total += v.total; }
    return total > 0 ? Math.round((correct / total) * 100) : 0;
  }, [stats.bySubject]);

  const myInitials = (user.displayName ?? 'You').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || 'ME';
  const myName = user.displayName ?? 'You';

  const entries = useMemo(() => {
    const base = ASPIRANTS.map((a, i) => ({ ...a, isMe: false, color: AV_COLORS[i] }));
    const me = { name: myName, initials: myInitials, xp: stats.xp, acc: overallAcc, streak: stats.streak, isMe: true, color: '#0d4a3a' };
    return [...base, me].sort((a, b) => b.xp - a.xp);
  }, [stats.xp, overallAcc, stats.streak, myName, myInitials]);

  const myRank = entries.findIndex(e => e.isMe) + 1;

  const rankDisplay = (rank: number) => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return `#${rank}`;
  };

  const tabs: { id: 'weekly' | 'monthly' | 'alltime'; label: string }[] = [
    { id: 'weekly', label: 'Weekly' },
    { id: 'monthly', label: 'Monthly' },
    { id: 'alltime', label: 'All time' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 900 }}>

      {/* ── Page header ── */}
      <div>
        <div style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", color: C.textTert, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
          Rankings
        </div>
        <h2 style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 24, fontWeight: 400, letterSpacing: '-0.3px', color: C.text, marginBottom: 6 }}>
          <em style={{ fontStyle: 'italic', color: C.headingEm }}>Leaderboard</em>
        </h2>
        <p style={{ fontSize: 13, color: C.textTert, lineHeight: 1.5 }}>
          Weekly rankings based on XP earned. You are ranked <strong style={{ color: C.text }}>#{myRank}</strong> out of {entries.length} aspirants.
        </p>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: 2, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, padding: 3, width: 'fit-content' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '6px 16px', borderRadius: 4, fontSize: 12, fontWeight: 500, cursor: 'pointer', border: 'none', background: tab === t.id ? 'var(--c-surface3)' : 'transparent', color: tab === t.id ? C.text : C.textSec, transition: 'all 0.15s', fontFamily: "'DM Sans', system-ui, sans-serif" }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Table ── */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden' }}>
        {/* Table header */}
        <div style={{ display: 'grid', gridTemplateColumns: '44px 1fr 90px 70px 70px', alignItems: 'center', gap: 16, padding: '10px 16px', borderBottom: `1px solid ${C.border}` }}>
          {['Rank', 'Aspirant', 'XP', 'Accuracy', 'Streak'].map(h => (
            <div key={h} style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", color: C.textTert, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</div>
          ))}
        </div>

        {/* Rows */}
        {entries.map((e, i) => (
          <div key={i}
            style={{
              display: 'grid', gridTemplateColumns: '44px 1fr 90px 70px 70px',
              alignItems: 'center', gap: 16, padding: '9px 16px', borderRadius: 6,
              background: e.isMe ? 'rgba(45,212,191,0.07)' : 'transparent',
              border: e.isMe ? `1px solid rgba(45,212,191,0.20)` : '1px solid transparent',
              margin: e.isMe ? '2px 8px' : '0 8px',
              cursor: 'pointer', transition: 'background 0.15s',
            }}
            onMouseEnter={ev => { if (!e.isMe) ev.currentTarget.style.background = 'var(--c-surface2)'; }}
            onMouseLeave={ev => { if (!e.isMe) ev.currentTarget.style.background = 'transparent'; }}>

            {/* Rank */}
            <div style={{ fontSize: i < 3 ? 16 : 12, fontFamily: "'DM Mono', monospace", color: i < 3 ? C.warn : C.textTert, textAlign: 'right' }}>
              {rankDisplay(i + 1)}
            </div>

            {/* Identity */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: e.color, border: `1px solid ${e.isMe ? 'rgba(45,212,191,0.40)' : 'transparent'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 600, color: e.isMe ? '#2dd4bf' : C.accent, fontFamily: "'DM Mono', monospace", flexShrink: 0 }}>
                {e.initials}
              </div>
              <div>
                <div style={{ fontSize: 13, color: C.text, fontWeight: e.isMe ? 500 : 400 }}>{e.name}{e.isMe ? ' (You)' : ''}</div>
              </div>
            </div>

            {/* XP */}
            <div style={{ fontSize: 12, fontFamily: "'DM Mono', monospace", color: C.accent }}>{e.xp.toLocaleString()}</div>

            {/* Accuracy */}
            <div style={{ fontSize: 12, fontFamily: "'DM Mono', monospace", color: C.textSec }}>{e.acc > 0 ? `${e.acc}%` : '—'}</div>

            {/* Streak */}
            <div style={{ fontSize: 12, fontFamily: "'DM Mono', monospace", color: e.streak > 0 ? C.warn : C.textTert }}>
              {e.streak > 0 ? `🔥 ${e.streak}` : '—'}
            </div>
          </div>
        ))}

        <div style={{ height: 8 }} />
      </div>

      {/* ── My rank card ── */}
      <div style={{ background: 'rgba(45,212,191,0.07)', border: '1px solid rgba(45,212,191,0.20)', borderRadius: 14, padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 20 }}>
        <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 32, fontWeight: 300, color: C.accent, minWidth: 60 }}>#{myRank}</div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: C.text, marginBottom: 2 }}>Your current rank</div>
          <div style={{ fontSize: 12, color: C.textSec }}>
            {stats.xp.toLocaleString()} XP · {overallAcc > 0 ? `${overallAcc}% accuracy` : 'Start answering to track accuracy'} · {stats.streak > 0 ? `🔥 ${stats.streak}-day streak` : 'No active streak'}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 11, color: C.textTert, fontFamily: "'DM Mono', monospace", textAlign: 'right' }}>
          <div>Earn more XP to</div>
          <div>climb the ranks</div>
        </div>
      </div>
    </div>
  );
}
