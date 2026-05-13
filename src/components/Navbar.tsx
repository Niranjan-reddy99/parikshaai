import React, { useState } from 'react';
import { LogOut } from 'lucide-react';
import { User } from 'firebase/auth';
import { type View, type CommissionMap } from '../types/index';
import { xpToLevel } from '../lib/stats';

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
  };
  return <>{icons[name] || null}</>;
}

function UserAvatar({ displayName, email, size = 32 }: { displayName: string | null; email: string | null; size?: number }) {
  const initials = displayName
    ? displayName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
    : email?.[0]?.toUpperCase() ?? '?';

  const colors = [
    { bg: '#dbeafe', fg: '#1d4ed8' },
    { bg: '#dcfce7', fg: '#16a34a' },
    { bg: '#fef3c7', fg: '#d97706' },
    { bg: '#f3e8ff', fg: '#7c3aed' },
    { bg: '#ffe4e6', fg: '#e11d48' },
    { bg: '#cffafe', fg: '#0891b2' },
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
}

export function Navbar({
  user, view, xp,
  setView, openQuestionBankHome, openPatternPractice, handleLogout,
  mode = 'sidebar',
  onNavigate,
}: NavbarProps) {
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
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
      badge: { text: 'PRO', color: '#d97706', bg: '#fff7e6' },
      onClick: () => setView('feed'),
    },
    {
      id: 'referral', icon: 'users', label: 'Refer & Earn', isActive: view === 'referral',
      badge: { text: 'NEW', color: '#16a34a', bg: '#dcfce7' },
      onClick: () => setView('referral'),
    },
  ];

  function renderItem(item: NavItemDef) {
    const active = item.isActive;
    const hovered = hoveredItem === item.id;
    return (
      <div
        key={item.id}
        onClick={() => {
          item.onClick();
          onNavigate?.();
        }}
        onMouseEnter={() => setHoveredItem(item.id)}
        onMouseLeave={() => setHoveredItem(null)}
        style={navItemStyle(active, hovered)}
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
      background: isDrawer ? 'transparent' : 'rgba(255,255,255,0.82)',
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
        display: 'flex', alignItems: 'center', gap: 9, flexShrink: 0,
      }}>
        <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="8" fill="#0f172a" />
          <path d="M9 22V10l7 4 7-4v12l-7-4z" fill="#5eead4" />
        </svg>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-0.04em', color: 'var(--text)', lineHeight: 1 }}>Pariksha</div>
          {isDrawer ? (
            <div style={{ fontSize: 10.5, color: 'var(--text-tert)', marginTop: 3 }}>
              Navigation
            </div>
          ) : null}
        </div>
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

        {/* LABS */}
        <SectionLabel label="Labs" />
        <div
          onClick={() => {
            openPatternPractice();
            onNavigate?.();
          }}
          onMouseEnter={() => setHoveredItem('pattern')}
          onMouseLeave={() => setHoveredItem(null)}
          style={navItemStyle(view === 'pattern-practice', hoveredItem === 'pattern')}
        >
          <span style={{ width: 15, height: 15, flexShrink: 0, color: view === 'pattern-practice' ? '#2563eb' : 'currentColor' }}>
            <NavIcon name="pulse" />
          </span>
          <span style={{ flex: 1 }}>Pattern Practice</span>
          <span style={{ padding: '1px 5px', background: '#dbeafe', color: '#2563eb', borderRadius: 3, fontSize: 9, fontWeight: 700 }}>
            BETA
          </span>
        </div>
      </nav>

      {/* Profile footer */}
      <div
        style={{
          padding: '12px 10px 10px',
          borderTop: '1px solid var(--border)',
          background: isDrawer ? 'transparent' : 'rgba(255,255,255,0.94)',
          boxShadow: isDrawer ? 'none' : '0 -12px 28px -30px rgba(15,23,42,0.28)',
          flexShrink: 0,
        }}
      >
        {user.uid === 'guest' ? (
          <div style={{ padding: '12px', border: '1px solid var(--border)', borderRadius: 10, textAlign: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 11.5, color: 'var(--text-sec)', marginBottom: 8, lineHeight: 1.5 }}>
              Sign in to track progress and streaks.
            </div>
            <button
              onClick={() => {
                handleLogout();
                onNavigate?.();
              }}
              style={{ width: '100%', padding: '7px', background: 'var(--text)', color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Sign in with Google
            </button>
          </div>
        ) : (
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
        )}

        {user.uid !== 'guest' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8 }}>
            <button
              type="button"
              onClick={() => {
                setView('profile');
                onNavigate?.();
              }}
              style={{
                minHeight: 38,
                padding: '0 12px',
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--bg-alt)',
                color: 'var(--text)',
                fontSize: 12.5,
                fontWeight: 700,
                fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              Profile
            </button>
            <button
              type="button"
              onClick={() => {
                handleLogout();
                onNavigate?.();
              }}
              onMouseEnter={() => setHoveredItem('logout')}
              onMouseLeave={() => setHoveredItem(null)}
              style={{
                minHeight: 38,
                padding: '0 12px',
                borderRadius: 10,
                border: `1px solid ${hoveredItem === 'logout' ? 'rgba(220,38,38,0.28)' : 'var(--border)'}`,
                background: hoveredItem === 'logout' ? 'rgba(254,226,226,0.7)' : 'rgba(255,255,255,0.88)',
                color: hoveredItem === 'logout' ? '#dc2626' : 'var(--text-tert)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                fontSize: 12.5,
                fontWeight: 700,
                fontFamily: 'inherit',
                cursor: 'pointer',
                transition: 'all 0.12s ease',
              }}
            >
              <LogOut style={{ width: 12, height: 12 }} />
              Sign out
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
