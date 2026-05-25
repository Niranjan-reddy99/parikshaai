import React, { useEffect, useRef, useState } from 'react';
import { Download, LogOut, MessageSquare, X } from 'lucide-react';
import { User } from 'firebase/auth';
import { type View, type CommissionMap } from '../types/index';
import { xpToLevel } from '../lib/stats';
import { API_BASE, adminHeaders } from '../lib/adminApi';

interface NavbarProps {
  user: User;
  view: View;
  commissionMap: CommissionMap;
  dataLoading: boolean;
  examDropdownOpen: boolean;
  setExamDropdownOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  dropdownHoveredCommission: string;
  setDropdownHoveredCommission: (c: string) => void;
  selectedCommission: string;
  selectedExamType: string;
  selectedYear: number;
  streak: number;
  xp: number;
  setView: (v: View) => void;
  openQuestionBankHome: () => void;
  openCommission: (c: string) => void;
  openExam: (examName: string, commission: string, examType: string) => void;
  openPatternPractice: () => void;
  handleLogout: () => void;
  mode?: 'sidebar' | 'drawer';
  onNavigate?: () => void;
  theme?: 'light' | 'dark';
  toggleTheme?: () => void;
}

function NavIcon({ name }: { name: string }) {
  const icons: Record<string, React.ReactNode> = {
    home: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12 12 3l9 9" /><path d="M5 10v10h14V10" />
      </svg>
    ),
    search: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
      </svg>
    ),
    chart: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18" /><polyline points="7 14 11 10 15 13 21 7" />
      </svg>
    ),
    trophy: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 9H4.5A2.5 2.5 0 0 1 2 6.5V5h4" /><path d="M18 9h1.5A2.5 2.5 0 0 0 22 6.5V5h-4" />
        <path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
        <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
        <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
      </svg>
    ),
    feed: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 11a9 9 0 0 1 9 9" /><path d="M4 4a16 16 0 0 1 16 16" /><circle cx="5" cy="19" r="1" />
      </svg>
    ),
    bookmark: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
      </svg>
    ),
    pulse: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    ),
    users: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
        <path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    ),
    wrench: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
      </svg>
    ),
  };
  return <>{icons[name] || null}</>;
}

function UserAvatar({ displayName, email, size = 32 }: { displayName: string | null; email: string | null; size?: number }) {
  const initials = displayName
    ? displayName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
    : email?.[0]?.toUpperCase() ?? '?';

  const colors = [
    { bg: 'rgba(37,99,235,0.15)',  fg: '#60a5fa' },
    { bg: 'rgba(22,163,74,0.15)',  fg: '#4ade80' },
    { bg: 'rgba(217,119,6,0.15)',  fg: '#fbbf24' },
    { bg: 'rgba(124,58,237,0.15)', fg: '#a78bfa' },
    { bg: 'rgba(225,29,72,0.15)',  fg: '#fb7185' },
    { bg: 'rgba(8,145,178,0.15)',  fg: '#22d3ee' },
  ];
  const colorIndex = (initials.charCodeAt(0) || 0) % colors.length;
  const { bg, fg } = colors[colorIndex];

  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill={bg} />
      <text x="16" y="20.5" textAnchor="middle" fill={fg} fontSize="12" fontWeight="700" fontFamily="Inter, sans-serif">
        {initials}
      </text>
    </svg>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, color: 'var(--text-tert)',
      textTransform: 'uppercase', letterSpacing: '0.07em',
      padding: '0 10px', marginBottom: 4, marginTop: 16,
    }}>
      {label}
    </div>
  );
}

interface NavItemDef {
  id: string;
  icon: string;
  label: string;
  badge?: { text: string; color: string; bg: string };
  onClick: () => void;
  isActive: boolean;
  locked?: boolean;
}

export function Navbar({
  user, view, xp,
  setView, openQuestionBankHome, openPatternPractice: _openPatternPractice, handleLogout,
  mode = 'sidebar',
  onNavigate,
  theme = 'light',
  toggleTheme = () => {},
}: NavbarProps) {
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  // ── PWA install prompt ────────────────────────────────────────────────────
  const installPromptRef = useRef<any>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      installPromptRef.current = e;
      setCanInstall(true);
    };
    const onInstalled = () => { setInstalled(true); setCanInstall(false); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!installPromptRef.current) return;
    installPromptRef.current.prompt();
    const { outcome } = await installPromptRef.current.userChoice;
    if (outcome === 'accepted') { setInstalled(true); setCanInstall(false); }
    installPromptRef.current = null;
  };

  // ── Feedback modal ────────────────────────────────────────────────────────
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackStatus, setFeedbackStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  const submitFeedback = async () => {
    if (!feedbackText.trim()) return;
    setFeedbackStatus('sending');
    try {
      await fetch(`${API_BASE}/feedback`, {
        method: 'POST',
        headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: feedbackText.trim(), user_email: user.email, user_uid: user.uid }),
      });
      setFeedbackStatus('sent');
      setFeedbackText('');
      setTimeout(() => { setShowFeedback(false); setFeedbackStatus('idle'); }, 1800);
    } catch {
      setFeedbackStatus('error');
    }
  };
  const { level, levelName, xpNext } = xpToLevel(xp);
  const xpProgress = Math.min(100, Math.round((xp / xpNext) * 100));
  const isDrawer = mode === 'drawer';

  const isHomeActive = ['home', 'commission', 'exam-detail'].includes(view);

  const navItemStyle = (active: boolean, hovered: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    padding: '7px 10px',
    borderRadius: 7,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: active ? 600 : 500,
    color: active ? 'var(--text)' : hovered ? 'var(--text-sec)' : 'var(--text-tert)',
    background: active ? 'var(--bg-alt)' : hovered ? 'var(--bg-alt)' : 'transparent',
    marginBottom: 1,
    userSelect: 'none' as const,
    transition: 'background 0.1s, color 0.1s',
    borderLeft: `2px solid ${active ? '#2563eb' : 'transparent'}`,
  });

  const practiceItems: NavItemDef[] = [
    {
      id: 'home', icon: 'home', label: 'Browse Exams', isActive: isHomeActive,
      onClick: () => setView('home'),
    },
    {
      id: 'browse', icon: 'search', label: 'Question Bank', isActive: view === 'browse',
      onClick: openQuestionBankHome,
    },
    {
      id: 'bookmarks', icon: 'bookmark', label: 'Bookmarks', isActive: view === 'bookmarks',
      onClick: () => setView('bookmarks'),
    },
    {
      id: 'pattern', icon: 'pulse', label: 'Pattern Practice', isActive: false,
      badge: { text: 'SOON', color: '#9ca3af', bg: 'rgba(156,163,175,0.12)' },
      onClick: () => {},
      locked: true,
    },
  ];

  const trackItems: NavItemDef[] = [
    {
      id: 'dashboard', icon: 'chart', label: 'My Progress', isActive: view === 'dashboard',
      onClick: () => setView('dashboard'),
    },
    {
      id: 'leaderboard', icon: 'trophy', label: 'Leaderboard', isActive: view === 'leaderboard',
      onClick: () => setView('leaderboard'),
    },
  ];

  const communityItems: NavItemDef[] = [
    {
      id: 'feed', icon: 'feed', label: 'PYQ Feed', isActive: view === 'feed',
      onClick: () => setView('feed'),
    },
    {
      id: 'referral', icon: 'users', label: 'Refer & Earn', isActive: view === 'referral',
      onClick: () => setView('referral'),
    },
  ];

  function renderItem(item: NavItemDef) {
    const active = item.isActive;
    const hovered = hoveredItem === item.id && !item.locked;
    return (
      <div
        key={item.id}
        onClick={() => {
          if (item.locked) return;
          item.onClick();
          onNavigate?.();
        }}
        onMouseEnter={() => setHoveredItem(item.id)}
        onMouseLeave={() => setHoveredItem(null)}
        style={{
          ...navItemStyle(active, hovered),
          ...(item.locked ? { opacity: 0.45, cursor: 'default', pointerEvents: 'none' } : {}),
        }}
        title={item.locked ? 'Coming soon' : undefined}
      >
        <span style={{ width: 15, height: 15, flexShrink: 0, color: active ? '#2563eb' : 'currentColor' }}>
          <NavIcon name={item.icon} />
        </span>
        <span style={{ flex: 1 }}>{item.label}</span>
        {item.badge && (
          <span style={{ padding: '1px 5px', background: item.badge.bg, color: item.badge.color, borderRadius: 3, fontSize: 9, fontWeight: 700 }}>
            {item.badge.text}
          </span>
        )}
      </div>
    );
  }

  return (
    <aside style={{
      background: isDrawer ? 'transparent' : 'var(--nav-bg)',
      backdropFilter: 'blur(18px)',
      borderRight: isDrawer ? 'none' : '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      zIndex: 20,
      height: '100%',
      width: isDrawer ? '100%' : 248,
    }}>

      {/* Brand logo */}
      <div style={{
        padding: isDrawer ? '20px 18px 14px' : '18px 16px 14px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 9, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="8" fill="#0f172a" />
            <path d="M9 22V10l7 4 7-4v12l-7-4z" fill="#5eead4" />
          </svg>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: 0, color: 'var(--text)', lineHeight: 1 }}>ParikshaGPT</div>
          </div>
        </div>

        <button
          type="button"
          onClick={toggleTheme}
          aria-label="Toggle theme"
          style={{
            background: 'var(--bg-alt)',
            border: '1px solid var(--border)',
            color: 'var(--text-sec)',
            cursor: 'pointer',
            padding: 6,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.15s ease',
          }}
        >
          {theme === 'light' ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
            </svg>
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '8px 8px 8px' }}>

        {/* PRACTICE */}
        <SectionLabel label="Practice" />
        {practiceItems.map(renderItem)}

        {/* TRACK */}
        <SectionLabel label="Track" />
        {trackItems.map(renderItem)}

        {/* COMMUNITY */}
        <SectionLabel label="Community" />
        {communityItems.map(renderItem)}

      </nav>

      {/* Profile footer */}
      <div
        style={{
          padding: '12px 10px 10px',
          borderTop: '1px solid var(--border)',
          background: isDrawer ? 'transparent' : 'var(--nav-footer-bg)',
          boxShadow: isDrawer ? 'none' : '0 -12px 28px -30px rgba(15,23,42,0.28)',
          flexShrink: 0,
        }}
      >
        <div style={{ marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 8px', borderRadius: 8 }}>
            <UserAvatar displayName={user.displayName} email={user.email} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {user.displayName || 'Aspirant'}
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--text-tert)', marginTop: 1 }}>
                Lv.{level} · {levelName}
              </div>
            </div>
          </div>
          <div style={{ padding: '0 8px 6px' }}>
            <div style={{ height: 3, background: 'var(--bg-canvas)', borderRadius: 2 }}>
              <div style={{ height: '100%', width: `${xpProgress}%`, background: '#2563eb', borderRadius: 2, transition: 'width 0.4s ease' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
              <span style={{ fontSize: 9.5, color: 'var(--text-tert)', fontWeight: 600 }}>{xp} XP</span>
              <span style={{ fontSize: 9.5, color: 'var(--text-tert)' }}>next: {xpNext}</span>
            </div>
          </div>
        </div>

        {/* Install App + Feedback row */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          {canInstall && !installed && (
            <button
              type="button"
              onClick={handleInstall}
              style={{
                flex: 1, minHeight: 34, padding: '0 10px', borderRadius: 9,
                border: '1px solid rgba(37,99,235,0.3)',
                background: 'rgba(37,99,235,0.08)',
                color: '#2563eb', fontSize: 12, fontWeight: 700,
                fontFamily: 'inherit', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                transition: 'background 0.15s',
              }}
            >
              <Download style={{ width: 12, height: 12 }} /> Install App
            </button>
          )}
          {installed && (
            <div style={{
              flex: 1, minHeight: 34, padding: '0 10px', borderRadius: 9,
              border: '1px solid rgba(34,197,94,0.25)',
              background: 'rgba(34,197,94,0.07)',
              color: '#16a34a', fontSize: 12, fontWeight: 700,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              ✓ Installed
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowFeedback(true)}
            style={{
              flex: canInstall && !installed ? 0 : 1,
              minHeight: 34, padding: '0 10px', borderRadius: 9,
              border: '1px solid var(--border)',
              background: 'var(--bg-alt)',
              color: 'var(--text-sec)', fontSize: 12, fontWeight: 700,
              fontFamily: 'inherit', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            <MessageSquare style={{ width: 12, height: 12 }} />
            {canInstall && !installed ? '' : 'Feedback'}
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8 }}>
          <button
            type="button"
            onClick={() => {
              setView('profile');
              onNavigate?.();
            }}
            style={{
              minHeight: 38, padding: '0 12px', borderRadius: 10,
              border: '1px solid var(--border)', background: 'var(--bg-alt)',
              color: 'var(--text)', fontSize: 12.5, fontWeight: 700,
              fontFamily: 'inherit', cursor: 'pointer',
            }}
          >
            Profile
          </button>
          <button
            type="button"
            onClick={() => { handleLogout(); onNavigate?.(); }}
            onMouseEnter={() => setHoveredItem('logout')}
            onMouseLeave={() => setHoveredItem(null)}
            style={{
              minHeight: 38, padding: '0 12px', borderRadius: 10,
              border: `1px solid ${hoveredItem === 'logout' ? 'var(--red)' : 'var(--border)'}`,
              background: hoveredItem === 'logout' ? 'var(--red-soft)' : 'var(--nav-signout-bg)',
              color: hoveredItem === 'logout' ? 'var(--red)' : 'var(--text-tert)',
              display: 'inline-flex', alignItems: 'center', gap: 7,
              fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit',
              cursor: 'pointer', transition: 'all 0.12s ease',
            }}
          >
            <LogOut style={{ width: 12, height: 12 }} /> Sign out
          </button>
        </div>

        {/* Legal links */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 10 }}>
          {(['Privacy Policy', 'Terms of Service'] as const).map(label => (
            <button
              key={label}
              type="button"
              onClick={() => { setView('legal'); onNavigate?.(); }}
              style={{
                background: 'none', border: 'none', padding: 0,
                fontSize: 10.5, color: 'var(--text-tert)',
                cursor: 'pointer', fontFamily: 'inherit',
                textDecoration: 'underline', textDecorationColor: 'transparent',
              }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--text-sec)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-tert)'}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Feedback modal */}
      {showFeedback && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 200,
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          padding: 16, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
        }}
          onClick={() => { setShowFeedback(false); setFeedbackStatus('idle'); }}
        >
          <div
            style={{
              width: '100%', maxWidth: 440,
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 18, padding: 20,
              boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>Send Feedback</div>
              <button
                onClick={() => { setShowFeedback(false); setFeedbackStatus('idle'); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tert)', padding: 4 }}
              >
                <X style={{ width: 16, height: 16 }} />
              </button>
            </div>
            {feedbackStatus === 'sent' ? (
              <div style={{ textAlign: 'center', padding: '16px 0', color: '#22c55e', fontWeight: 700, fontSize: 14 }}>
                ✓ Thanks — feedback received!
              </div>
            ) : (
              <>
                <textarea
                  value={feedbackText}
                  onChange={e => setFeedbackText(e.target.value)}
                  placeholder="What's working, what's broken, what you'd love to see..."
                  rows={4}
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    background: 'var(--bg-alt)', border: '1px solid var(--border)',
                    borderRadius: 10, color: 'var(--text)', fontSize: 13,
                    padding: '10px 12px', resize: 'vertical', fontFamily: 'inherit',
                    outline: 'none', marginBottom: 10,
                  }}
                />
                {feedbackStatus === 'error' && (
                  <div style={{ fontSize: 12, color: '#f87171', marginBottom: 8 }}>
                    Something went wrong — try again.
                  </div>
                )}
                <button
                  onClick={submitFeedback}
                  disabled={!feedbackText.trim() || feedbackStatus === 'sending'}
                  style={{
                    width: '100%', padding: '10px', borderRadius: 10, border: 'none',
                    background: feedbackText.trim() ? '#2563eb' : 'var(--border)',
                    color: feedbackText.trim() ? '#fff' : 'var(--text-tert)',
                    fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
                    cursor: feedbackText.trim() ? 'pointer' : 'not-allowed',
                  }}
                >
                  {feedbackStatus === 'sending' ? 'Sending…' : 'Send Feedback'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
