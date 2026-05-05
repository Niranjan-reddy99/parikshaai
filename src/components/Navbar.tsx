import React, { useState } from 'react';
import { Upload, FileText, Eye, DollarSign, ShieldCheck, LogOut } from 'lucide-react';
import { User } from 'firebase/auth';
import { type View, type CommissionMap } from '../types/index';
import { xpToLevel } from '../lib/stats';

interface NavbarProps {
  user: User;
  view: View;
  commissionMap: CommissionMap;
  dataLoading: boolean;
  isAdmin: boolean;
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
  openCommission: (c: string) => void;
  openExam: (examName: string, commission: string, examType: string) => void;
  openCostModal: () => void;
  openUploadModal: () => void;
  openPatternDebug: () => void;
  openPatternIngestion: () => void;
  openPatternPractice: () => void;
  toggleAdmin: () => void;
  showAdminToggle?: boolean;
  handleLogout: () => void;
}

type SideView = 'home' | 'browse' | 'dashboard' | 'leaderboard' | 'feed' | 'bookmarks';

function NavIcon({ name }: { name: string }) {
  const icons: Record<string, React.ReactNode> = {
    home: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12 12 3l9 9" /><path d="M5 10v10h14V10" />
      </svg>
    ),
    search: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
      </svg>
    ),
    chart: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18" /><polyline points="7 14 11 10 15 13 21 7" />
      </svg>
    ),
    trophy: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 9H4.5A2.5 2.5 0 0 1 2 6.5V5h4" /><path d="M18 9h1.5A2.5 2.5 0 0 0 22 6.5V5h-4" />
        <path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
        <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
        <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
      </svg>
    ),
    feed: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 11a9 9 0 0 1 9 9" /><path d="M4 4a16 16 0 0 1 16 16" /><circle cx="5" cy="19" r="1" />
      </svg>
    ),
    bookmark: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
      </svg>
    ),
    pulse: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    ),
  };
  return <>{icons[name] || null}</>;
}

const MAIN_NAV: { id: SideView; icon: string; label: string; pro?: boolean }[] = [
  { id: 'home',        icon: 'home',     label: 'Home' },
  { id: 'browse',      icon: 'search',   label: 'Question Bank' },
  { id: 'dashboard',   icon: 'chart',    label: 'Insights' },
  { id: 'bookmarks',   icon: 'bookmark', label: 'Bookmarks' },
  { id: 'leaderboard', icon: 'trophy',   label: 'Leaderboard' },
  { id: 'feed',        icon: 'feed',     label: 'PYQ Feed', pro: true },
];

export function Navbar({
  user, view, xp, isAdmin,
  setView, openPatternPractice, toggleAdmin, handleLogout,
  showAdminToggle = true,
  openCostModal, openUploadModal, openPatternDebug, openPatternIngestion,
}: NavbarProps) {
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const { level, levelName, xpNext } = xpToLevel(xp);
  const xpProgress = Math.min(100, Math.round((xp / xpNext) * 100));
  const avatarInitials = user.displayName
    ? user.displayName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
    : user.email?.[0]?.toUpperCase() ?? '?';

  const isActive = (id: SideView): boolean => {
    if (id === 'home')        return ['home', 'commission', 'exam-detail'].includes(view);
    if (id === 'browse')      return view === 'browse';
    if (id === 'dashboard')   return view === 'dashboard';
    if (id === 'leaderboard') return view === 'leaderboard';
    if (id === 'feed')        return view === 'feed';
    if (id === 'bookmarks')   return view === 'bookmarks';
    return false;
  };

  const navItemStyle = (active: boolean, hovered: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    padding: '7px 10px',
    borderRadius: 7,
    cursor: 'pointer',
    fontSize: 13.5,
    fontWeight: active ? 600 : 500,
    color: active ? 'var(--text)' : hovered ? 'var(--text-sec)' : 'var(--text-tert)',
    background: active ? 'var(--bg-alt)' : hovered ? 'var(--bg-alt)' : 'transparent',
    marginBottom: 1,
    userSelect: 'none' as const,
    transition: 'background 0.1s, color 0.1s',
    borderLeft: `2px solid ${active ? 'var(--blue)' : 'transparent'}`,
  });

  const footerItemStyle = (hovered: boolean, danger = false): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '5px 10px', borderRadius: 6, cursor: 'pointer',
    fontSize: 12, color: danger ? (hovered ? '#dc2626' : 'var(--text-tert)') : (hovered ? 'var(--text-sec)' : 'var(--text-tert)'),
    background: hovered ? 'var(--bg-alt)' : 'transparent',
    transition: 'all 0.1s', marginBottom: 1,
  });

  return (
    <aside style={{
      background: 'var(--bg)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      zIndex: 20,
      height: '100%',
    }}>

      {/* Main navigation */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '14px 8px 12px' }}>
        <div style={{
          fontSize: 10, fontWeight: 700, color: 'var(--text-tert)',
          textTransform: 'uppercase', letterSpacing: '0.07em',
          padding: '0 10px', marginBottom: 8,
        }}>
          Menu
        </div>

        {MAIN_NAV.map(item => {
          const active = isActive(item.id);
          const hovered = hoveredItem === item.id;
          return (
            <div
              key={item.id}
              onClick={() => setView(item.id)}
              onMouseEnter={() => setHoveredItem(item.id)}
              onMouseLeave={() => setHoveredItem(null)}
              style={navItemStyle(active, hovered)}
            >
              <span style={{
                width: 16, height: 16, flexShrink: 0,
                color: active ? '#2563eb' : 'currentColor',
              }}>
                <NavIcon name={item.icon} />
              </span>
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.pro && (
                <span style={{
                  padding: '1px 5px', background: '#fff7e6',
                  color: '#d97706', borderRadius: 3,
                  fontSize: 9, fontWeight: 700, letterSpacing: '0.02em',
                }}>
                  PRO
                </span>
              )}
            </div>
          );
        })}

        {/* Labs */}
        <div style={{ marginTop: 22 }}>
          <div style={{
            fontSize: 10, fontWeight: 700, color: 'var(--text-tert)',
            textTransform: 'uppercase', letterSpacing: '0.07em',
            padding: '0 10px', marginBottom: 8,
          }}>
            Labs
          </div>
          <div
            onClick={openPatternPractice}
            onMouseEnter={() => setHoveredItem('pattern')}
            onMouseLeave={() => setHoveredItem(null)}
            style={navItemStyle(view === 'pattern-practice', hoveredItem === 'pattern')}
          >
            <span style={{
              width: 16, height: 16, flexShrink: 0,
              color: view === 'pattern-practice' ? '#2563eb' : 'currentColor',
            }}>
              <NavIcon name="pulse" />
            </span>
            <span style={{ flex: 1 }}>Pattern Practice</span>
            <span style={{
              padding: '1px 5px', background: '#dbeafe',
              color: '#2563eb', borderRadius: 3,
              fontSize: 9, fontWeight: 700,
            }}>
              BETA
            </span>
          </div>
        </div>
      </nav>

      {/* Footer */}
      <div style={{ padding: '8px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
        {/* Guest sign-in */}
        {user.uid === 'guest' && (
          <div style={{
            padding: '12px', border: '1px solid var(--border)',
            borderRadius: 8, textAlign: 'center', marginBottom: 8,
          }}>
            <div style={{ fontSize: 11.5, color: 'var(--text-sec)', marginBottom: 8, lineHeight: 1.5 }}>
              Sign in to track progress and streaks.
            </div>
            <button
              onClick={handleLogout}
              style={{
                width: '100%', padding: '7px',
                background: 'var(--text)', color: 'white',
                border: 'none', borderRadius: 6,
                fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Sign in with Google
            </button>
          </div>
        )}

        {/* Admin tools */}
        {isAdmin && (
          <>
            <div onClick={openUploadModal} onMouseEnter={() => setHoveredItem('upload')} onMouseLeave={() => setHoveredItem(null)} style={footerItemStyle(hoveredItem === 'upload')}>
              <Upload style={{ width: 12, height: 12 }} /> Upload PDF
            </div>
            <div onClick={openPatternIngestion} onMouseEnter={() => setHoveredItem('ingestion')} onMouseLeave={() => setHoveredItem(null)} style={footerItemStyle(hoveredItem === 'ingestion')}>
              <FileText style={{ width: 12, height: 12 }} /> Scanned Book Lab
            </div>
            <div onClick={openPatternDebug} onMouseEnter={() => setHoveredItem('debug')} onMouseLeave={() => setHoveredItem(null)} style={footerItemStyle(hoveredItem === 'debug')}>
              <Eye style={{ width: 12, height: 12 }} /> Pattern Debug
            </div>
            <div onClick={openCostModal} onMouseEnter={() => setHoveredItem('cost')} onMouseLeave={() => setHoveredItem(null)} style={footerItemStyle(hoveredItem === 'cost')}>
              <DollarSign style={{ width: 12, height: 12 }} /> Cost Log
            </div>
          </>
        )}

        {showAdminToggle && (
          <div
            onClick={toggleAdmin}
            onMouseEnter={() => setHoveredItem('admin')}
            onMouseLeave={() => setHoveredItem(null)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
              borderRadius: 6, cursor: 'pointer', fontSize: 12,
              fontWeight: isAdmin ? 700 : 500,
              color: isAdmin ? '#d97706' : 'var(--text-tert)',
              background: isAdmin ? '#fef3c7' : (hoveredItem === 'admin' ? 'var(--bg-alt)' : 'transparent'),
              border: `1px solid ${isAdmin ? '#fbbf24' : 'transparent'}`,
              transition: 'all 0.1s', marginBottom: 1,
            }}
          >
            <ShieldCheck style={{ width: 12, height: 12 }} /> {isAdmin ? 'Admin ON' : 'Admin'}
          </div>
        )}

        <div
          onClick={handleLogout}
          onMouseEnter={() => setHoveredItem('logout')}
          onMouseLeave={() => setHoveredItem(null)}
          style={footerItemStyle(hoveredItem === 'logout', true)}
        >
          <LogOut style={{ width: 12, height: 12 }} /> Sign out
        </div>
      </div>
    </aside>
  );
}
