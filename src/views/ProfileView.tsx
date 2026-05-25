import React, { useMemo, useState } from 'react';
import { User } from 'firebase/auth';
import { type CommissionMap } from '../types';
import { type UserStats, xpToLevel } from '../lib/stats';

interface ProfileViewProps {
  user: User;
  stats: UserStats;
  commissionMap: CommissionMap;
  handleLogout: () => void;
  isPremium: boolean;
  onUpgrade: () => void;
}

const COMMISSION_LABELS: Record<string, string> = {
  UPSC:    'UPSC CSE',
  APPSC:   'APPSC',
  TSPSC:   'TSPSC',
  TSLPRB:  'TSLPRB',
  APSLPRB: 'APSLPRB',
  APHC:    'AP High Court',
  TSHC:    'TS High Court',
  SSC:     'SSC',
  IBPS:    'IBPS',
  RRB:     'RRB',
  AP:      'AP Govt',
  TS:      'TS Govt',
};

const DAILY_GOAL_OPTIONS = [5, 10, 20, 30, 50, 100];

type ExpandedRow = 'personal' | 'security' | 'preferences' | null;

function PersonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  );
}

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </svg>
  );
}

function ChevronRight({ flipped }: { flipped?: boolean }) {
  return (
    <svg
      width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="var(--text-tert)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: flipped ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}
    >
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  );
}

function SettingRow({
  icon, title, description, id, expanded, onToggle, children,
}: {
  icon: React.ReactNode; title: string; description: string;
  id: ExpandedRow; expanded: boolean; onToggle: (id: ExpandedRow) => void;
  children?: React.ReactNode;
}) {
  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div
        onClick={() => onToggle(id)}
        style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '15px 20px', cursor: 'pointer' }}
      >
        <div style={{
          width: 38, height: 38, borderRadius: 8, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(99,102,241,0.1)',
        }}>
          {icon}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>{title}</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-sec)' }}>{description}</div>
        </div>
        <ChevronRight flipped={expanded} />
      </div>
      {expanded && children && (
        <div style={{ padding: '12px 20px 16px 72px', background: 'var(--bg-alt)' }}>
          {children}
        </div>
      )}
    </div>
  );
}

export function ProfileView({ user, stats, commissionMap, handleLogout, isPremium, onUpgrade }: ProfileViewProps) {
  const { level, levelName, xpNext } = xpToLevel(stats.xp);
  const xpProgress = Math.min(100, Math.round((stats.xp / xpNext) * 100));
  const [expandedRow, setExpandedRow] = useState<ExpandedRow>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const [enrolledExams, setEnrolledExams] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(`pyq_commissions_${user.uid}`);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });

  const [dailyGoal, setDailyGoal] = useState<number>(() => {
    const raw = localStorage.getItem(`pyq_dailygoal_${user.uid}`);
    return raw ? parseInt(raw, 10) : 20;
  });

  const overallAccuracy = useMemo(() => {
    const entries = Object.values(stats.bySubject);
    const total = entries.reduce((a, s) => a + s.total, 0);
    const correct = entries.reduce((a, s) => a + s.correct, 0);
    return total > 0 ? Math.round((correct / total) * 100) : 0;
  }, [stats.bySubject]);

  const subjectBreakdown = useMemo(() =>
    Object.entries(stats.bySubject).sort((a, b) => b[1].total - a[1].total).slice(0, 6),
    [stats.bySubject]
  );

  const availableCommissions = Object.keys(commissionMap).sort();

  const toggleRow = (id: ExpandedRow) => setExpandedRow(prev => prev === id ? null : id);

  const toggleExam = (commission: string) => {
    const next = enrolledExams.includes(commission)
      ? enrolledExams.filter(c => c !== commission)
      : [...enrolledExams, commission];
    setEnrolledExams(next);
    localStorage.setItem(`pyq_commissions_${user.uid}`, JSON.stringify(next));
    flash('Saved');
  };

  const updateDailyGoal = (g: number) => {
    setDailyGoal(g);
    localStorage.setItem(`pyq_dailygoal_${user.uid}`, String(g));
    flash('Saved');
  };

  const flash = (msg: string) => {
    setSavedMsg(msg);
    setTimeout(() => setSavedMsg(null), 1800);
  };

  const avatarInitials = user.displayName
    ? user.displayName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : user.email?.[0]?.toUpperCase() ?? '?';

  const handle = user.email?.split('@')[0] ?? 'aspirant';

  const joinDate = user.metadata?.creationTime
    ? new Date(user.metadata.creationTime).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : 'Recently';

  const levelColors: Record<number, { bg: string; text: string; bar: string }> = {
    1: { bg: 'var(--green-soft)', text: 'var(--green)',  bar: 'var(--green)'  },
    2: { bg: 'var(--blue-soft)',  text: 'var(--blue)',   bar: '#2563eb'       },
    3: { bg: 'var(--warn-soft)',  text: 'var(--warn)',   bar: 'var(--warn)'   },
    4: { bg: 'rgba(168,85,247,0.12)',  text: 'rgba(168,85,247,0.9)',  bar: '#a855f7' },
    5: { bg: 'rgba(249,115,22,0.12)',  text: 'rgba(249,115,22,0.9)',  bar: '#f97316' },
    6: { bg: 'var(--red-soft)',   text: 'var(--red)',    bar: 'var(--red)'    },
  };
  const lc = levelColors[Math.min(level, 6)] ?? levelColors[6];

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", maxWidth: 760 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 2px', color: 'var(--text)', letterSpacing: '-0.3px' }}>My Profile</h1>
          <p style={{ fontSize: 13, color: 'var(--text-sec)', margin: 0 }}>Manage your account and preferences</p>
        </div>
        {savedMsg && (
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--green)', background: 'var(--green-soft)', border: '1px solid rgba(16,185,129,0.25)', padding: '4px 12px', borderRadius: 99 }}>
            ✓ {savedMsg}
          </span>
        )}
      </div>

      {/* ── User identity card ──────────────────────────────────────────────────── */}
      <div style={{
        background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 14,
        padding: '24px', marginBottom: 24,
      }}>
        <div className="profile-identity-inner" style={{ display: 'flex', alignItems: 'flex-start', gap: 20 }}>
          {/* Avatar with camera overlay */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div style={{
              width: 84, height: 84, borderRadius: '50%',
              background: 'linear-gradient(135deg, #6366f1, #2563eb)',
              color: 'white', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontWeight: 800, fontSize: 28,
              overflow: 'hidden', border: '3px solid var(--bg)',
              boxShadow: '0 2px 12px rgba(0,0,0,0.1)',
            }}>
              {user.photoURL
                ? <img src={user.photoURL} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
                : avatarInitials}
            </div>
            <button style={{
              position: 'absolute', bottom: 2, right: 2,
              width: 24, height: 24, borderRadius: '50%',
              background: 'var(--bg)', border: '1.5px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', padding: 0,
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-sec)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
            </button>
          </div>

          {/* Identity info */}
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 }}>
              <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
                {user.displayName || 'Aspirant'}
              </span>
              <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700, background: lc.bg, color: lc.text }}>
                Lv.{level} · {levelName}
              </span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-tert)', marginBottom: 10 }}>
              @{handle}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 12.5, color: 'var(--text-sec)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                Joined {joinDate}
              </div>
            </div>

            {/* XP bar */}
            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                <span style={{ fontSize: 11, color: 'var(--text-tert)' }}>{stats.xp.toLocaleString()} XP</span>
                <span style={{ fontSize: 11, color: 'var(--text-tert)' }}>{xpNext.toLocaleString()} XP to next level</span>
              </div>
              <div style={{ height: 5, background: 'var(--bg-canvas)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${xpProgress}%`, background: lc.bar, borderRadius: 3, transition: 'width 0.5s ease' }} />
              </div>
            </div>
          </div>

          {/* Edit Profile button */}
          <button className="profile-edit-btn" style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', background: 'var(--bg)',
            border: '1.5px solid var(--border)', borderRadius: 8,
            fontSize: 13, fontWeight: 500, color: 'var(--text)',
            cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
          }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            Edit Profile
          </button>
        </div>
      </div>

      {/* ── Stats mini-row ───────────────────────────────────────────────────────── */}
      <div className="profile-stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 24 }}>
        {[
          { label: 'Questions Solved', value: stats.totalAnswered.toLocaleString(), color: '#2563eb', bg: '#eff6ff' },
          { label: 'Accuracy',         value: `${overallAccuracy}%`,                color: overallAccuracy >= 70 ? '#15803d' : overallAccuracy >= 50 ? '#b45309' : '#b91c1c', bg: '#f9fafb' },
          { label: 'Day Streak',       value: `${stats.streak} 🔥`,                 color: '#b45309', bg: '#fff7ed' },
          { label: 'Total XP',         value: stats.xp.toLocaleString(),            color: '#7e22ce', bg: '#fdf4ff' },
        ].map(s => (
          <div key={s.label} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>
              {s.label}
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* ── Account section ─────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>Account</div>
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>

          <SettingRow
            id="personal" icon={<PersonIcon />}
            title="Personal Information"
            description="Update your name, email and contact details"
            expanded={expandedRow === 'personal'}
            onToggle={toggleRow}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Full Name</div>
                <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text)', padding: '8px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 7 }}>
                  {user.displayName || 'Not set'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Email</div>
                <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text)', padding: '8px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 7 }}>
                  {user.email}
                </div>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-tert)', margin: 0, lineHeight: 1.5 }}>
                Personal details are managed by your Google account.
              </p>
            </div>
          </SettingRow>

          <SettingRow
            id="security" icon={<LockIcon />}
            title="Security"
            description="Change password and manage account security"
            expanded={expandedRow === 'security'}
            onToggle={toggleRow}
          >
            <div style={{ padding: '10px 14px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Google Sign-In</div>
                <div style={{ fontSize: 12, color: 'var(--text-sec)', marginTop: 2 }}>Secure authentication via Google OAuth</div>
              </div>
              <span style={{ padding: '3px 10px', background: 'var(--green-soft)', color: 'var(--green)', borderRadius: 99, fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                Active
              </span>
            </div>
          </SettingRow>

          <SettingRow
            id="preferences" icon={<BellIcon />}
            title="Preferences"
            description="Manage app settings and notifications"
            expanded={expandedRow === 'preferences'}
            onToggle={toggleRow}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {/* Daily goal */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>Daily Practice Goal</div>
                <div style={{ fontSize: 12, color: 'var(--text-sec)', marginBottom: 10 }}>How many questions per day?</div>
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                  {DAILY_GOAL_OPTIONS.map(g => {
                    const active = dailyGoal === g;
                    return (
                      <button
                        key={g}
                        onClick={() => updateDailyGoal(g)}
                        style={{
                          width: 52, height: 40, border: `1.5px solid ${active ? '#2563eb' : 'var(--border)'}`,
                          borderRadius: 7, background: active ? 'var(--blue-soft)' : 'var(--bg)',
                          color: active ? 'var(--blue)' : 'var(--text-sec)',
                          fontSize: 13, fontWeight: active ? 700 : 500,
                          cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
                        }}
                      >
                        {g}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Enrolled exams */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>Enrolled Exams</div>
                <div style={{ fontSize: 12, color: 'var(--text-sec)', marginBottom: 10 }}>Select the exams you're preparing for</div>
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                  {availableCommissions.map(c => {
                    const enrolled = enrolledExams.includes(c);
                    return (
                      <button
                        key={c}
                        onClick={() => toggleExam(c)}
                        style={{
                          padding: '6px 12px', borderRadius: 99,
                          border: `1.5px solid ${enrolled ? '#2563eb' : 'var(--border)'}`,
                          background: enrolled ? 'var(--blue-soft)' : 'var(--bg)',
                          color: enrolled ? 'var(--blue)' : 'var(--text-sec)',
                          fontSize: 12, fontWeight: enrolled ? 700 : 500,
                          cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
                          display: 'flex', alignItems: 'center', gap: 4,
                        }}
                      >
                        {enrolled && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                        )}
                        {COMMISSION_LABELS[c] ?? c}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </SettingRow>
        </div>
      </div>

      {/* ── Subscription section ─────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 24, marginTop: 24 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>Subscription</div>
        {isPremium ? (
          <div style={{
            background: 'linear-gradient(135deg, rgba(245,158,11,0.10), rgba(217,119,6,0.06))',
            border: '1.5px solid rgba(245,158,11,0.35)',
            borderRadius: 12, padding: '18px 20px',
            display: 'flex', alignItems: 'center', gap: 14,
          }}>
            <div style={{ width: 42, height: 42, borderRadius: 10, background: 'linear-gradient(135deg,#f59e0b,#d97706)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, boxShadow: '0 4px 12px rgba(245,158,11,0.28)' }}>
              👑
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Premium</span>
                <span style={{ padding: '2px 8px', background: 'rgba(245,158,11,0.15)', color: '#d97706', borderRadius: 4, fontSize: 11, fontWeight: 700 }}>Active</span>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-sec)' }}>All papers unlocked · Full access across every commission</div>
            </div>
          </div>
        ) : (
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 42, height: 42, borderRadius: 10, background: 'var(--bg-alt)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
                🔓
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Free Plan</span>
                  <span style={{ padding: '2px 8px', background: 'var(--green-soft)', color: 'var(--green)', borderRadius: 4, fontSize: 11, fontWeight: 700 }}>Active</span>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-sec)' }}>One paper per commission · Upgrade to unlock everything</div>
              </div>
              <button
                onClick={onUpgrade}
                style={{
                  padding: '9px 18px',
                  background: 'linear-gradient(135deg,#f59e0b,#d97706)',
                  border: 'none', borderRadius: 8,
                  fontSize: 13, fontWeight: 700, color: 'white',
                  cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
                  boxShadow: '0 4px 14px rgba(245,158,11,0.30)',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="currentColor" stroke="none"/>
                </svg>
                Upgrade Plan
              </button>
            </div>
            {/* Mini feature teaser */}
            <div style={{ borderTop: '1px solid var(--border)', padding: '12px 20px', background: 'var(--bg-alt)', display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              {['All years 2015→present', 'Every commission', 'AI explanations instantly', 'Full leaderboard'].map(f => (
                <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--text-sec)' }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  {f}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Subject performance ───────────────────────────────────────────────────── */}
      {subjectBreakdown.length > 0 && (
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>Subject Performance</div>
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {subjectBreakdown.map(([subject, { correct, total }]) => {
                const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
                const barColor = pct >= 75 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444';
                return (
                  <div key={subject} className="profile-subject-row" style={{ display: 'grid', gridTemplateColumns: '160px 1fr 52px 56px', gap: 10, alignItems: 'center', fontSize: 13 }}>
                    <span style={{ color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={subject}>
                      {subject}
                    </span>
                    <div style={{ height: 5, background: 'var(--bg-canvas)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: barColor, borderRadius: 3 }} />
                    </div>
                    <span style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-sec)', fontWeight: 600 }}>
                      {pct}%
                    </span>
                    <span style={{ textAlign: 'right', fontSize: 11, color: 'var(--text-tert)' }}>
                      {total}Q
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Sign out ──────────────────────────────────────────────────────────────── */}
      <div style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
        <button
          onClick={handleLogout}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 18px', background: 'var(--bg)',
            border: '1.5px solid var(--border)', borderRadius: 8,
            color: '#dc2626', fontSize: 13, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
            transition: 'border-color 0.15s, background 0.15s',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = '#fca5a5';
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--red-soft)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg)';
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          Sign out
        </button>
      </div>
    </div>
  );
}
