import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { API_BASE } from '../lib/api';
import { type UserStats } from '../lib/stats';
import { COMMISSION_FULL_NAMES } from '../lib/examUtils';

interface LeaderboardViewProps {
  stats: UserStats;
  user: Pick<User, 'uid' | 'displayName' | 'getIdToken'>;
}

const AV_COLORS = [
  '#1e3a8a','#065f46','#581c87','#1e4d3b','#0f4c81',
  '#7f1d1d','#1a4a42','#92400e','#164e63','#3b0764',
  '#1c3d5a','#3d1c5a','#1c5a3d','#5a3d1c','#1c5a1c',
];

function getInitials(name: string) {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

type TimeFilter = 'all-time' | 'monthly' | 'weekly';

interface LeaderboardApiEntry {
  rank: number;
  name: string;
  exam: string;
  commission: string;
  score: number;
  accuracy: number;
  streak: number;
  attempts: number;
  correct: number;
  is_me: boolean;
}

interface LeaderboardResponse {
  time_filter: TimeFilter;
  scope_commissions: string[];
  updated_at: string;
  total_aspirants: number;
  exams_covered: number;
  has_more: boolean;
  entries: LeaderboardApiEntry[];
  my_rank: number;
  my_entry: LeaderboardApiEntry | null;
}

function formatUpdatedAt(value: string | null | undefined) {
  if (!value) return 'Just now';
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return 'Just now';
  const diffMs = Date.now() - timestamp.getTime();
  const diffMinutes = Math.max(0, Math.round(diffMs / 60000));
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes === 1) return '1 min ago';
  if (diffMinutes < 60) return `${diffMinutes} mins ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours === 1) return '1 hour ago';
  if (diffHours < 24) return `${diffHours} hours ago`;
  return timestamp.toLocaleDateString();
}

export function LeaderboardView({ stats, user }: LeaderboardViewProps) {
  const [tab, setTab] = useState<'overall' | 'friends'>('overall');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all-time');
  const [entryLimit, setEntryLimit] = useState(50);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardResponse | null>(null);
  const enrolledCommissions = useMemo(() => {
    try {
      const raw = localStorage.getItem(`pyq_commissions_${user.uid}`);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : [];
    } catch {
      return [];
    }
  }, [user.uid]);

  const overallAcc = useMemo(() => {
    let correct = 0, total = 0;
    for (const v of Object.values(stats.bySubject)) { correct += v.correct; total += v.total; }
    return total > 0 ? Math.round((correct / total) * 100) : 0;
  }, [stats.bySubject]);

  const myName = user.displayName ?? 'You';
  const myInitials = getInitials(myName);
  const primaryCommission = enrolledCommissions[0] || 'UPSC';
  const leaderboardScopeLabel = enrolledCommissions.length === 0
    ? 'All exams'
    : enrolledCommissions.length === 1
    ? COMMISSION_FULL_NAMES[primaryCommission] || primaryCommission
    : `${primaryCommission} +${enrolledCommissions.length - 1} more`;

  useEffect(() => {
    setEntryLimit(50);
  }, [timeFilter, enrolledCommissions]);

  useEffect(() => {
    let cancelled = false;

    async function loadLeaderboard() {
      setLoading(true);
      setError(null);
      try {
        const token = await user.getIdToken();
        const params = new URLSearchParams({
          time_filter: timeFilter,
          limit: String(entryLimit),
        });
        if (enrolledCommissions.length > 0) {
          params.set('commissions', enrolledCommissions.join(','));
        }
        const res = await fetch(`${API_BASE}/leaderboard?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'include',
        });
        if (!res.ok) {
          throw new Error(`Leaderboard request failed (${res.status})`);
        }
        const data = (await res.json()) as LeaderboardResponse;
        if (!cancelled) {
          setLeaderboard(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load leaderboard');
          setLeaderboard(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadLeaderboard();
    return () => {
      cancelled = true;
    };
  }, [entryLimit, enrolledCommissions, refreshNonce, timeFilter, user]);

  const fallbackEntries = useMemo(() => {
    return [{
      name: myName,
      exam: leaderboardScopeLabel,
      commission: primaryCommission,
      initials: myInitials,
      xp: stats.xp,
      score: stats.xp,
      acc: overallAcc,
      streak: stats.streak,
      rank: 1,
      attempts: stats.totalAnswered,
      correct: 0,
      isMe: true,
      color: '#1e3a5f',
    }];
  }, [
    leaderboardScopeLabel,
    myInitials,
    myName,
    overallAcc,
    primaryCommission,
    stats.streak,
    stats.totalAnswered,
    stats.xp,
  ]);

  const entries = useMemo(() => {
    if (!leaderboard) return fallbackEntries;

    const mapped = leaderboard.entries.map((entry, index) => ({
      ...entry,
      initials: getInitials(entry.is_me ? myName : entry.name),
      isMe: entry.is_me,
      color: AV_COLORS[index % AV_COLORS.length],
      xp: entry.score,
      acc: entry.accuracy,
    }));
    const hasMe = mapped.some((entry) => entry.isMe);
    if (!hasMe && leaderboard.my_entry) {
      mapped.push({
        ...leaderboard.my_entry,
        initials: myInitials,
        isMe: true,
        color: '#1e3a5f',
        xp: leaderboard.my_entry.score,
        acc: leaderboard.my_entry.accuracy,
      });
    }
    return mapped;
  }, [fallbackEntries, leaderboard, myInitials, myName]);

  const myEntry = useMemo(
    () => entries.find((entry) => entry.isMe) ?? fallbackEntries[0],
    [entries, fallbackEntries]
  );
  const myRank = leaderboard?.my_rank ?? myEntry.rank ?? 1;
  const examsCovered = leaderboard?.exams_covered ?? 1;
  const totalAspirants = leaderboard?.total_aspirants ?? entries.length;
  const lastUpdatedLabel = formatUpdatedAt(leaderboard?.updated_at);

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '9px 22px', fontSize: 14, fontWeight: active ? 700 : 500,
    color: active ? 'var(--text)' : 'var(--text-sec)',
    background: 'none',
    borderTop: 'none', borderLeft: 'none', borderRight: 'none',
    borderBottom: `2px solid ${active ? '#2563eb' : 'transparent'}`,
    cursor: 'pointer', fontFamily: 'inherit',
    transition: 'color 0.1s, border-color 0.1s',
  });

  const rankBadge = (rank: number) => {
    if (rank === 1) return { text: '🥇', bg: '#fef9c3', color: '#854d0e' };
    if (rank === 2) return { text: '🥈', bg: '#f1f5f9', color: '#475569' };
    if (rank === 3) return { text: '🥉', bg: '#fff7ed', color: '#9a3412' };
    return { text: `${rank}`, bg: 'transparent', color: 'var(--text-tert)' };
  };

  const top3 = entries.filter(e => (e.rank || 0) <= 3).sort((a, b) => (a.rank || 0) - (b.rank || 0));

  return (
    <div style={{ fontFamily: "'Inter', sans-serif" }}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px', color: 'var(--text)', letterSpacing: '-0.3px' }}>Leaderboard</h1>
        <p style={{ fontSize: 13, color: 'var(--text-sec)', margin: 0 }}>
          {enrolledCommissions.length === 0 ? 'Rankings across all exams' : `Scoped to ${leaderboardScopeLabel}`}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 20, alignItems: 'start' }}>

        {/* ── Left column ─────────────────────────────────────────────── */}
        <div>
          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 18 }}>
            {(['overall', 'friends'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                padding: '8px 18px', fontSize: 13.5, fontWeight: tab === t ? 700 : 500,
                color: tab === t ? 'var(--text)' : 'var(--text-sec)',
                background: 'none', borderTop: 'none', borderLeft: 'none', borderRight: 'none',
                borderBottom: `2px solid ${tab === t ? '#2563eb' : 'transparent'}`,
                cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize',
              }}>
                {t}
              </button>
            ))}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
              <select
                value={timeFilter}
                onChange={e => setTimeFilter(e.target.value as TimeFilter)}
                style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 12.5, color: 'var(--text)', background: 'var(--bg)', fontFamily: 'inherit', cursor: 'pointer', outline: 'none' }}
              >
                <option value="all-time">All Time</option>
                <option value="monthly">This Month</option>
                <option value="weekly">This Week</option>
              </select>
              <button
                onClick={() => setRefreshNonce(v => v + 1)}
                title="Refresh"
                style={{ width: 30, height: 30, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 7, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tert)' }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Top 3 podium */}
          {!loading && top3.length === 3 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 20 }}>
              {[top3[1], top3[0], top3[2]].map((e, podiumIdx) => {
                if (!e) return null;
                const podiumOrder = [2, 1, 3];
                const rank = podiumOrder[podiumIdx];
                const heights = [72, 92, 56];
                const bg = rank === 1 ? '#fef9c3' : rank === 2 ? '#f1f5f9' : '#fff7ed';
                const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉';
                return (
                  <div key={e.name} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                    <div style={{
                      width: 44, height: 44, borderRadius: '50%',
                      background: e.isMe ? 'linear-gradient(135deg,#6366f1,#2563eb)' : e.color,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, fontWeight: 800, color: '#fff',
                      border: e.isMe ? '2px solid #2563eb' : '2px solid rgba(255,255,255,0.3)',
                    }}>{e.initials}</div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>{e.isMe ? 'You' : e.name.split(' ')[0]}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-tert)' }}>{e.xp.toLocaleString()} pts</div>
                    </div>
                    <div style={{
                      width: '100%', height: heights[podiumIdx],
                      background: bg, borderRadius: '10px 10px 0 0',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 2,
                    }}>
                      <span style={{ fontSize: 22 }}>{medal}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>#{rank}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ marginBottom: 14, padding: '11px 14px', borderRadius: 10, border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c', fontSize: 13 }}>
              {error}. Showing your local stats.
            </div>
          )}

          {/* Table */}
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '52px 1fr 90px 80px',
              padding: '9px 16px', background: 'var(--bg-alt)',
              fontSize: 10.5, fontWeight: 700, color: 'var(--text-tert)',
              textTransform: 'uppercase', letterSpacing: '0.05em', gap: 12,
              borderBottom: '1px solid var(--border)',
            }}>
              <div>Rank</div><div>Aspirant</div>
              <div style={{ textAlign: 'right' }}>Score</div>
              <div style={{ textAlign: 'right' }}>Acc.</div>
            </div>

            {loading && entries.length === 0 && (
              <div style={{ padding: '20px 16px', fontSize: 13, color: 'var(--text-sec)' }}>Building leaderboard…</div>
            )}

            {entries.map((e, i) => {
              const rank = e.rank || i + 1;
              const badge = rankBadge(rank);
              return (
                <div
                  key={`${rank}-${e.name}`}
                  style={{
                    display: 'grid', gridTemplateColumns: '52px 1fr 90px 80px',
                    padding: '11px 16px', gap: 12, alignItems: 'center',
                    borderBottom: i < entries.length - 1 ? '1px solid var(--border)' : 'none',
                    background: e.isMe ? '#eff6ff' : 'transparent',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={ev => { if (!e.isMe) ev.currentTarget.style.background = 'var(--bg-alt)'; }}
                  onMouseLeave={ev => { if (!e.isMe) ev.currentTarget.style.background = 'transparent'; }}
                >
                  <div style={{
                    width: 30, height: 30, borderRadius: 8,
                    background: badge.bg, color: badge.color,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: rank <= 3 ? 16 : 12.5, fontWeight: 700,
                  }}>{badge.text}</div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <div style={{
                      width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                      background: e.isMe ? 'linear-gradient(135deg,#6366f1,#2563eb)' : e.color,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11.5, fontWeight: 700, color: '#fff',
                      border: e.isMe ? '2px solid #2563eb' : 'none',
                    }}>{e.initials}</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: e.isMe ? 700 : 500, color: e.isMe ? '#2563eb' : 'var(--text)', lineHeight: 1.2 }}>
                        {e.isMe ? 'You' : e.name}
                      </div>
                      <div style={{ fontSize: 10.5, color: 'var(--text-tert)', marginTop: 2 }}>{e.exam || leaderboardScopeLabel}</div>
                    </div>
                  </div>

                  <div style={{ textAlign: 'right', fontSize: 13.5, fontWeight: 700, color: '#2563eb' }}>
                    {e.xp.toLocaleString()}
                  </div>
                  <div style={{ textAlign: 'right', fontSize: 13.5, fontWeight: 700, color: e.acc >= 70 ? '#16a34a' : e.acc >= 50 ? '#d97706' : 'var(--text-sec)' }}>
                    {e.acc > 0 ? `${e.acc}%` : '—'}
                  </div>
                </div>
              );
            })}
          </div>

          {leaderboard?.has_more && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
              <button
                onClick={() => setEntryLimit(v => v + 50)}
                style={{ padding: '9px 22px', border: '1px solid var(--border)', borderRadius: 9, background: 'var(--bg)', color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Show more
              </button>
            </div>
          )}
        </div>

        {/* ── Right sidebar ────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, position: 'sticky', top: 24 }}>

          {/* Your rank card */}
          <div style={{
            background: 'linear-gradient(160deg,#0f172a 0%,#1e3a8a 100%)',
            borderRadius: 16, padding: '22px 20px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14 }}>Your Rank</div>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'linear-gradient(135deg,#6366f1,#2563eb)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', fontSize: 16, fontWeight: 800, color: '#fff' }}>
              {myInitials}
            </div>
            <div style={{ fontSize: 38, fontWeight: 900, color: '#fff', letterSpacing: '-0.05em', lineHeight: 1 }}>
              #{myRank}
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', margin: '6px 0 18px' }}>
              {myRank <= 3 ? 'Top of the board!' : myRank <= 10 ? 'Top 10 — keep going!' : 'Keep practicing to climb'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 8px' }}>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', marginBottom: 3 }}>Score</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>{myEntry.xp.toLocaleString()}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 8px' }}>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', marginBottom: 3 }}>Accuracy</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: myEntry.acc >= 70 ? '#86efac' : myEntry.acc >= 50 ? '#fde68a' : '#fca5a5' }}>
                  {myEntry.acc > 0 ? `${myEntry.acc}%` : '—'}
                </div>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 18px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>Board stats</div>
            {[
              { label: 'Aspirants', value: totalAspirants.toLocaleString() },
              { label: 'Exams tracked', value: examsCovered || 1 },
              { label: 'Updated', value: loading ? '…' : lastUpdatedLabel },
              { label: 'Scope', value: leaderboardScopeLabel },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 12.5, color: 'var(--text-sec)' }}>{label}</span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', maxWidth: 120, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
