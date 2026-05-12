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

  return (
    <div style={{ fontFamily: "'Inter', sans-serif" }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, color: 'var(--text)', letterSpacing: '-0.3px' }}>Leaderboard</h1>
        <span style={{ fontSize: 22 }}>🏆</span>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-sec)', margin: '0 0 20px' }}>
        {enrolledCommissions.length === 0
          ? 'Compete with aspirants across the country'
          : `Showing ranks for your enrolled exam track${enrolledCommissions.length > 1 ? 's' : ''}`}
      </p>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
        <button style={tabStyle(tab === 'overall')} onClick={() => setTab('overall')}>Overall</button>
        <button style={tabStyle(tab === 'friends')} onClick={() => setTab('friends')}>Friends</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 20, alignItems: 'start' }}>

        {/* Left: table */}
        <div>
          {/* Filter bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <select
              value={timeFilter}
              onChange={e => setTimeFilter(e.target.value as TimeFilter)}
              style={{ padding: '7px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, color: 'var(--text)', background: 'var(--bg)', fontFamily: 'inherit', cursor: 'pointer', outline: 'none' }}
            >
              <option value="all-time">All Time</option>
              <option value="monthly">This Month</option>
              <option value="weekly">This Week</option>
            </select>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-tert)' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
              {loading ? 'Refreshing leaderboard...' : `Updated ${lastUpdatedLabel}`}
              <button
                onClick={() => setRefreshNonce((value) => value + 1)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--text-tert)', display: 'flex' }}
                aria-label="Refresh leaderboard"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>
                </svg>
              </button>
            </div>
          </div>

          {error && (
            <div style={{
              marginBottom: 14,
              padding: '12px 14px',
              borderRadius: 10,
              border: '1px solid #fecaca',
              background: '#fef2f2',
              color: '#b91c1c',
              fontSize: 13,
            }}>
              {error}. Showing your local stats until the leaderboard comes back.
            </div>
          )}

          {!error && leaderboard?.has_more && (
            <div style={{ marginBottom: 14, fontSize: 12, color: 'var(--text-tert)' }}>
              Showing top {leaderboard.entries.length} ranks{leaderboard.my_entry && !leaderboard.entries.some((entry) => entry.is_me) ? ' plus your position' : ''}.
            </div>
          )}

          {/* Table */}
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            {/* Header */}
            <div style={{
              display: 'grid', gridTemplateColumns: '60px 1fr 100px 90px',
              padding: '10px 18px', background: 'var(--bg-alt)',
              fontSize: 11, fontWeight: 600, color: 'var(--text-tert)',
              textTransform: 'uppercase', letterSpacing: '0.04em', gap: 12,
              borderBottom: '1px solid var(--border)',
            }}>
              <div>Rank</div>
              <div>Aspirant</div>
              <div style={{ textAlign: 'right' }}>Score</div>
              <div style={{ textAlign: 'right' }}>Accuracy</div>
            </div>

            {/* Rows */}
            {loading && entries.length === 0 && (
              <div style={{ padding: '20px 18px', fontSize: 13, color: 'var(--text-sec)' }}>
                Building leaderboard from recent attempts...
              </div>
            )}
            {entries.map((e, i) => {
              const badge = rankBadge(e.rank || i + 1);
              return (
                <div
                  key={`${e.rank}-${e.name}-${e.exam}`}
                  style={{
                    display: 'grid', gridTemplateColumns: '60px 1fr 100px 90px',
                    padding: '12px 18px', gap: 12, alignItems: 'center',
                    borderBottom: i < entries.length - 1 ? '1px solid var(--border)' : 'none',
                    background: e.isMe ? '#eff6ff' : 'transparent',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={ev => { if (!e.isMe) ev.currentTarget.style.background = 'var(--bg-alt)'; }}
                  onMouseLeave={ev => { if (!e.isMe) ev.currentTarget.style.background = 'transparent'; }}
                >
                  {/* Rank */}
                  <div style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: badge.bg, color: badge.color,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: e.rank <= 3 ? 18 : 13, fontWeight: 700,
                  }}>
                    {badge.text}
                  </div>

                  {/* Identity */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                      background: e.isMe ? 'linear-gradient(135deg, #6366f1, #2563eb)' : e.color,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 700, color: 'white',
                      border: e.isMe ? '2px solid #2563eb' : 'none',
                    }}>
                      {e.initials}
                    </div>
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: e.isMe ? 700 : 500, color: e.isMe ? '#2563eb' : 'var(--text)' }}>
                        {e.isMe ? 'You' : e.name}
                        {e.isMe && <span style={{ fontSize: 11, fontWeight: 500, color: '#2563eb', marginLeft: 6 }}>(#{myRank})</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-tert)' }}>{e.exam}</div>
                    </div>
                  </div>

                  {/* Score */}
                  <div style={{ textAlign: 'right', fontSize: 14, fontWeight: 700, color: '#2563eb' }}>
                    {e.xp.toLocaleString()}
                  </div>

                  {/* Accuracy */}
                  <div style={{ textAlign: 'right', fontSize: 14, fontWeight: 700, color: '#16a34a' }}>
                    {e.acc > 0 ? `${e.acc}%` : '—'}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
            {leaderboard?.has_more ? (
              <button
                onClick={() => setEntryLimit((value) => value + 50)}
                style={{
                  padding: '9px 20px', border: '1px solid var(--border)', borderRadius: 8,
                  background: 'var(--bg)', color: 'var(--text)', fontSize: 13, fontWeight: 500,
                  cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                View More
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
            ) : null}
          </div>
        </div>

        {/* Right sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, position: 'sticky', top: 24 }}>

          {/* Your Rank */}
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 18px', textAlign: 'center' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 12 }}>Your Rank</div>
            <div style={{
              width: 64, height: 64, borderRadius: '50%', margin: '0 auto 12px',
              background: 'linear-gradient(135deg, #dbeafe, #eff6ff)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '2px solid #bfdbfe',
            }}>
              <span style={{ fontSize: 26 }}>🏆</span>
            </div>
            <div style={{ fontSize: 32, fontWeight: 800, color: '#2563eb', marginBottom: 4 }}>#{myRank}</div>
            <div style={{ fontSize: 12, color: 'var(--text-sec)', marginBottom: 16 }}>
              {myRank <= 5 ? 'Excellent! Keep pushing!' : myRank <= 10 ? 'Great going! Keep pushing!' : 'Good going! Keep pushing your limits.'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ background: 'var(--bg-alt)', borderRadius: 8, padding: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--text-tert)', marginBottom: 2 }}>Score</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{myEntry.xp.toLocaleString()}</div>
              </div>
              <div style={{ background: 'var(--bg-alt)', borderRadius: 8, padding: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--text-tert)', marginBottom: 2 }}>Accuracy</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#16a34a' }}>{myEntry.acc > 0 ? `${myEntry.acc}%` : '—'}</div>
              </div>
            </div>
          </div>

          {/* Leaderboard Info */}
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>Leaderboard Info</div>
            {[
              { label: 'Total Aspirants', value: totalAspirants, icon: '👥' },
              { label: 'Exams Covered', value: examsCovered || '1', icon: '📋' },
              { label: 'Last Updated', value: lastUpdatedLabel, icon: '🕐' },
              { label: 'Scope', value: leaderboardScopeLabel, icon: '🎯' },
            ].map(({ label, value, icon }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 12.5, color: 'var(--text-sec)' }}>{icon} {label}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{value}</span>
              </div>
            ))}
          </div>

          {/* How it works */}
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>How it works?</div>
            {[
              'This board now uses actual attempt history from the backend, not placeholder ranks.',
              'Your board is scoped to the commissions you selected in onboarding/profile.',
              'Update enrolled exams in Profile to change this leaderboard scope.',
            ].map((tip, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                <span style={{ width: 16, height: 16, borderRadius: '50%', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-sec)', lineHeight: 1.5 }}>{tip}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
