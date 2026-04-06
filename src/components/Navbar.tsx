import React, { useState } from 'react';
import { ChevronRight, ChevronDown, Loader2, LogOut, Upload, DollarSign, Moon, Sun, ShieldCheck } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { User } from 'firebase/auth';
import { C } from '../lib/tokens';
import { type View, type CommissionMap } from '../types/index';

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
  setView: (v: View) => void;
  openCommission: (c: string) => void;
  openExam: (examName: string, commission: string, examType: string) => void;
  openCostModal: () => void;
  openUploadModal: () => void;
  toggleAdmin: () => void;
  handleLogout: () => void;
  darkMode: boolean;
  toggleDarkMode: () => void;
}

export function Navbar({
  user, view, commissionMap, dataLoading, isAdmin, streak,
  examDropdownOpen, setExamDropdownOpen,
  dropdownHoveredCommission, setDropdownHoveredCommission,
  selectedCommission,
  setView, openCommission, openExam, openCostModal, openUploadModal, toggleAdmin, handleLogout,
  darkMode, toggleDarkMode,
}: NavbarProps) {
  const [examsOpen, setExamsOpen] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  const commissions = Object.keys(commissionMap).sort();
  const firstName = user.displayName ? user.displayName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : 'U';
  const displayName = user.displayName ?? 'User';

  const isActive = (ids: View[]) => ids.includes(view);

  const itemStyle = (active: boolean, hovered: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '7px 12px', borderRadius: 6, cursor: 'pointer',
    fontSize: 13, fontWeight: active ? 500 : 400,
    color: active ? C.text : C.textSec,
    background: active ? C.surface : hovered ? 'var(--c-surface2)' : 'transparent',
    border: `1px solid ${active ? C.border : 'transparent'}`,
    marginBottom: 1, userSelect: 'none' as const,
    transition: 'all 0.15s',
    position: 'relative' as const,
  });

  const navLabel = (text: string) => (
    <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: C.textTert, padding: '0 12px', marginBottom: 8, marginTop: 4 }}>
      {text}
    </div>
  );

  return (
    <aside style={{ background: 'var(--c-surface)', borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', zIndex: 20, height: '100vh' }}>

      {/* Top section: brand + user card + streak */}
      <div style={{ padding: '24px 20px 20px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        {/* Brand */}
        <div onClick={() => setView('dashboard')} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24, cursor: 'pointer' }}>
          <div style={{ width: 28, height: 28, border: `1.5px solid ${C.accent}40`, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg viewBox="0 0 14 14" fill="none" width="14" height="14">
              <path d="M7 1L12.5 4.25V10.75L7 14L1.5 10.75V4.25L7 1Z" stroke="#2dd4bf" strokeWidth="1.2" strokeLinejoin="round"/>
              <path d="M7 4L9.6 5.5V8.5L7 10L4.4 8.5V5.5L7 4Z" fill="#2dd4bf" opacity=".5"/>
            </svg>
          </div>
          <span style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 17, fontWeight: 600, color: C.text, letterSpacing: '-0.2px' }}>
            Parik<em style={{ fontStyle: 'italic', color: C.headingEm }}>sha</em>
          </span>
        </div>

        {/* User card */}
        <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg, #1a4a42 0%, #0f2d28 100%)', border: `1.5px solid ${C.accent}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: C.accent, flexShrink: 0, fontFamily: "'DM Mono', monospace", overflow: 'hidden' }}>
              {user.photoURL
                ? <img src={user.photoURL} style={{ width: 32, height: 32, borderRadius: '50%' }} alt="" />
                : firstName}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</div>
              <div style={{ fontSize: 11, color: C.textTert, fontFamily: "'DM Mono', monospace", marginTop: 1 }}>
                {dataLoading ? 'Loading...' : `${commissions.length} exams`}
              </div>
            </div>
            {dataLoading && <Loader2 style={{ width: 14, height: 14, color: C.accent, flexShrink: 0 }} className="animate-spin" />}
          </div>
          {/* XP bar (decorative) */}
          <div style={{ fontSize: 10, color: C.textTert, fontFamily: "'DM Mono', monospace", display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span>Progress</span><span>{isAdmin ? 'Admin' : 'User'}</span>
          </div>
          <div style={{ height: 2, background: 'var(--c-surface3)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: '60%', background: C.accent, borderRadius: 2 }} />
          </div>
        </div>

        {/* Streak */}
        {streak > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.warnDim, border: `1px solid ${C.warn}26`, borderRadius: 6, padding: '6px 12px', fontSize: 12 }}>
            <span style={{ fontSize: 14 }}>🔥</span>
            <span style={{ color: C.textSec }}>Day streak</span>
            <span style={{ color: C.warn, fontWeight: 600, fontFamily: "'DM Mono', monospace", marginLeft: 'auto' }}>{streak}</span>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '16px 12px' }}>

        {/* Overview */}
        {navLabel('Overview')}
        {[
          { id: 'dashboard' as View, icon: '⊞', label: 'Dashboard' },
          { id: 'leaderboard' as View, icon: '≡', label: 'Leaderboard' },
        ].map(item => {
          const active = item.id === 'dashboard'
            ? isActive(['dashboard', 'home'])
            : view === item.id;
          const hovered = hoveredItem === item.id;
          return (
            <div
              key={item.id}
              onClick={() => setView(item.id)}
              onMouseEnter={() => setHoveredItem(item.id)}
              onMouseLeave={() => setHoveredItem(null)}
              style={itemStyle(active, hovered)}
            >
              {active && <div style={{ position: 'absolute', left: -1, top: '25%', bottom: '25%', width: 2, background: C.accent, borderRadius: '0 2px 2px 0' }} />}
              <span style={{ width: 16, textAlign: 'center', flexShrink: 0, opacity: active || hovered ? 1 : 0.6, fontSize: 13 }}>{item.icon}</span>
              {item.label}
            </div>
          );
        })}

        {/* Practice */}
        <div style={{ marginTop: 20 }}>
          {navLabel('Practice')}

          {/* Exams accordion */}
          <div
            onClick={() => setExamsOpen(o => !o)}
            onMouseEnter={() => setHoveredItem('exams')}
            onMouseLeave={() => setHoveredItem(null)}
            style={{
              ...itemStyle(isActive(['commission', 'exam-detail', 'practice', 'mock', 'results', 'report', 'browse']), hoveredItem === 'exams'),
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {isActive(['commission', 'exam-detail', 'practice', 'mock', 'results', 'report', 'browse']) && (
                <div style={{ position: 'absolute', left: -1, top: '25%', bottom: '25%', width: 2, background: C.accent, borderRadius: '0 2px 2px 0' }} />
              )}
              <span style={{ width: 16, textAlign: 'center', flexShrink: 0, opacity: 0.6, fontSize: 13 }}>▷</span>
              Browse Exams
            </div>
            <ChevronDown style={{ width: 13, height: 13, color: C.textTert, transform: examsOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }} />
          </div>

          <AnimatePresence>
            {examsOpen && commissions.length > 0 && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                style={{ overflow: 'hidden' }}
              >
                <div style={{ paddingLeft: 12, marginBottom: 4 }}>
                  {commissions.map(c => (
                    <div
                      key={c}
                      onClick={() => openCommission(c)}
                      onMouseEnter={() => setHoveredItem('c-' + c)}
                      onMouseLeave={() => setHoveredItem(null)}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                        color: selectedCommission === c && isActive(['commission', 'exam-detail']) ? C.accent : C.textSec,
                        background: hoveredItem === 'c-' + c ? 'var(--c-surface2)' : 'transparent',
                        transition: 'all 0.1s', marginBottom: 1,
                      }}
                    >
                      <span>{c}</span>
                      <span style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", color: C.textTert }}>
                        {Object.values(commissionMap[c] || {}).reduce((a, e) => a + e.count, 0)}Q
                      </span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* PYQ Feed under Practice */}
          {[
            { id: 'feed' as View, icon: '📡', label: 'PYQ Feed' },
          ].map(item => {
            const active = view === item.id;
            const hovered = hoveredItem === item.id;
            return (
              <div
                key={item.id}
                onClick={() => setView(item.id)}
                onMouseEnter={() => setHoveredItem(item.id)}
                onMouseLeave={() => setHoveredItem(null)}
                style={itemStyle(active, hovered)}
              >
                {active && <div style={{ position: 'absolute', left: -1, top: '25%', bottom: '25%', width: 2, background: C.accent, borderRadius: '0 2px 2px 0' }} />}
                <span style={{ width: 16, textAlign: 'center', flexShrink: 0, opacity: active || hovered ? 1 : 0.6, fontSize: 13 }}>{item.icon}</span>
                {item.label}
              </div>
            );
          })}
        </div>

        {/* Progress */}
        <div style={{ marginTop: 20 }}>
          {navLabel('Progress')}
          {[
            { id: 'badges' as View, icon: '◇', label: 'Achievements' },
          ].map(item => {
            const active = view === item.id;
            const hovered = hoveredItem === item.id;
            return (
              <div
                key={item.id}
                onClick={() => setView(item.id)}
                onMouseEnter={() => setHoveredItem(item.id)}
                onMouseLeave={() => setHoveredItem(null)}
                style={itemStyle(active, hovered)}
              >
                {active && <div style={{ position: 'absolute', left: -1, top: '25%', bottom: '25%', width: 2, background: C.accent, borderRadius: '0 2px 2px 0' }} />}
                <span style={{ width: 16, textAlign: 'center', flexShrink: 0, opacity: active || hovered ? 1 : 0.6, fontSize: 13 }}>{item.icon}</span>
                {item.label}
              </div>
            );
          })}
        </div>
      </nav>

      {/* Footer */}
      <div style={{ padding: '12px', borderTop: `1px solid ${C.border}`, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {/* Dark mode toggle */}
        <div
          onClick={toggleDarkMode}
          onMouseEnter={() => setHoveredItem('darkmode')}
          onMouseLeave={() => setHoveredItem(null)}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: C.textSec, background: hoveredItem === 'darkmode' ? 'var(--c-surface2)' : 'transparent', transition: 'all 0.15s' }}
        >
          {darkMode
            ? <Sun style={{ width: 15, height: 15 }} />
            : <Moon style={{ width: 15, height: 15 }} />
          }
          {darkMode ? 'Light mode' : 'Dark mode'}
        </div>

        {/* Admin controls */}
        {isAdmin && (
          <>
            <div
              onClick={openUploadModal}
              onMouseEnter={() => setHoveredItem('upload')}
              onMouseLeave={() => setHoveredItem(null)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: C.textSec, background: hoveredItem === 'upload' ? 'var(--c-surface2)' : 'transparent', transition: 'all 0.15s' }}
            >
              <Upload style={{ width: 15, height: 15 }} /> Upload PDF
            </div>
            <div
              onClick={openCostModal}
              onMouseEnter={() => setHoveredItem('cost')}
              onMouseLeave={() => setHoveredItem(null)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: C.textSec, background: hoveredItem === 'cost' ? 'var(--c-surface2)' : 'transparent', transition: 'all 0.15s' }}
            >
              <DollarSign style={{ width: 15, height: 15 }} /> Cost Log
            </div>
          </>
        )}
        <div
          onClick={toggleAdmin}
          onMouseEnter={() => setHoveredItem('admin')}
          onMouseLeave={() => setHoveredItem(null)}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: isAdmin ? C.warn : C.textSec, background: isAdmin ? C.warnDim : (hoveredItem === 'admin' ? 'var(--c-surface2)' : 'transparent'), transition: 'all 0.15s' }}
        >
          <ShieldCheck style={{ width: 15, height: 15 }} /> {isAdmin ? 'Admin ON' : 'Admin'}
        </div>
        <div
          onClick={handleLogout}
          onMouseEnter={() => setHoveredItem('logout')}
          onMouseLeave={() => setHoveredItem(null)}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: C.textSec, background: hoveredItem === 'logout' ? 'var(--c-surface2)' : 'transparent', transition: 'all 0.15s' }}
        >
          <LogOut style={{ width: 15, height: 15 }} /> Sign out
        </div>
      </div>
    </aside>
  );
}
