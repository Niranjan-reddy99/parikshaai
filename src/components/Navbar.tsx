import React, { useState } from 'react';
import { ChevronRight, ChevronDown, Eye, FileText, Loader2, LogOut, Upload, DollarSign, Moon, Sun, ShieldCheck } from 'lucide-react';
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
  openPatternDebug: () => void;
  openPatternIngestion: () => void;
  openPatternPractice: () => void;
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
  setView, openCommission, openExam, openCostModal, openUploadModal, openPatternDebug, openPatternIngestion, openPatternPractice, toggleAdmin, handleLogout,
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
    padding: '11px 12px', borderRadius: 12, cursor: 'pointer',
    fontSize: 13, fontWeight: active ? 700 : 500,
    color: active ? C.headingEm : C.textSec,
    background: active ? C.accentDim : hovered ? C.surface2 : 'transparent',
    border: `1px solid ${active ? 'rgba(15,118,110,0.24)' : 'transparent'}`,
    marginBottom: 3, userSelect: 'none' as const,
    transition: 'all 0.15s',
    position: 'relative' as const,
  });

  const navLabel = (text: string) => (
    <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: C.textTert, padding: '0 12px', marginBottom: 8, marginTop: 4 }}>
      {text}
    </div>
  );

  return (
    <aside style={{ background: C.surface2, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', zIndex: 20, height: '100vh', backdropFilter: 'blur(20px)' }}>

      {/* Top section: brand + user card + streak */}
      <div style={{ padding: '24px 20px 20px', borderBottom: `1px solid ${C.border}`, flexShrink: 0, background: `linear-gradient(180deg, ${C.surface2}, ${C.surface})` }}>
        {/* Brand */}
        <div onClick={() => setView('dashboard')} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, cursor: 'pointer' }} className="hover-lift">
          <div style={{ width: 38, height: 38, border: `1px solid rgba(15,118,110,0.18)`, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: 'var(--c-shadow-glow)', background: 'linear-gradient(135deg, rgba(15,118,110,0.14), rgba(202,138,4,0.08))' }}>
            <svg viewBox="0 0 14 14" fill="none" width="14" height="14">
              <rect x="2" y="2" width="10" height="10" rx="3" stroke="var(--c-text)" strokeWidth="1.2" />
              <path d="M5 7h4m-2-2v4" stroke="var(--c-accent)" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 22, fontWeight: 500, color: C.headingEm, letterSpacing: '-0.5px', lineHeight: 1 }}>
              Pariksha<span style={{ color: C.accent }}>.</span>
            </div>
            <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.textTert, marginTop: 4 }}>
              PYQ Intelligence
            </div>
          </div>
        </div>

        {/* User card */}
        <div className="glass-panel" style={{ borderRadius: 18, padding: '14px 16px', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: C.surface3, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: C.text, flexShrink: 0, fontFamily: "'DM Mono', monospace", overflow: 'hidden' }}>
              {user.photoURL
                ? <img src={user.photoURL} style={{ width: 32, height: 32, borderRadius: '50%' }} alt="" />
                : firstName}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</div>
              <div style={{ fontSize: 11, color: C.textTert, fontFamily: "'DM Mono', monospace", marginTop: 1 }}>
                {dataLoading ? 'Loading...' : `${commissions.length} commissions live`}
              </div>
            </div>
            {dataLoading && <Loader2 style={{ width: 14, height: 14, color: C.textTert, flexShrink: 0 }} className="animate-spin" />}
          </div>
          {/* XP bar (decorative) */}
          <div style={{ fontSize: 10, color: C.textTert, display: 'flex', justifyContent: 'space-between', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            <span>Workspace</span><span style={{ color: C.accent }}>{isAdmin ? 'Admin' : 'Student'}</span>
          </div>
          <div style={{ height: 2, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: '60%', background: `linear-gradient(90deg, rgba(15,118,110,0.25), ${C.accent})`, borderRadius: 2 }} />
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
      <nav style={{ flex: 1, overflowY: 'auto', padding: '18px 12px 10px' }}>

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

          {/* Pattern Practice — visible to all users */}
          <div
            onClick={openPatternPractice}
            onMouseEnter={() => setHoveredItem('pattern-practice')}
            onMouseLeave={() => setHoveredItem(null)}
            style={itemStyle(view === 'pattern-practice', hoveredItem === 'pattern-practice')}
          >
            {view === 'pattern-practice' && <div style={{ position: 'absolute', left: -1, top: '25%', bottom: '25%', width: 2, background: '#f59e0b', borderRadius: '0 2px 2px 0' }} />}
            <span style={{ width: 16, textAlign: 'center', flexShrink: 0, opacity: view === 'pattern-practice' || hoveredItem === 'pattern-practice' ? 1 : 0.6, fontSize: 13 }}>📈</span>
            Pattern Practice
          </div>
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
      <div style={{ padding: '14px 12px 18px', borderTop: `1px solid ${C.border}`, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4, background: C.surface2, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)' }}>
        {/* Dark mode toggle */}
        <div
          onClick={toggleDarkMode}
          onMouseEnter={() => setHoveredItem('darkmode')}
          onMouseLeave={() => setHoveredItem(null)}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, cursor: 'pointer', fontSize: 13, color: C.textSec, background: hoveredItem === 'darkmode' ? C.surface3 : 'transparent', transition: 'all 0.15s' }}
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
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, cursor: 'pointer', fontSize: 13, color: C.textSec, background: hoveredItem === 'upload' ? C.surface3 : 'transparent', transition: 'all 0.15s' }}
            >
              <Upload style={{ width: 15, height: 15 }} /> Upload PDF
            </div>
            <div
              onClick={openPatternIngestion}
              onMouseEnter={() => setHoveredItem('pattern-ingestion')}
              onMouseLeave={() => setHoveredItem(null)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, cursor: 'pointer', fontSize: 13, color: view === 'pattern-ingestion' ? C.accent : C.textSec, background: view === 'pattern-ingestion' ? C.accentDim : (hoveredItem === 'pattern-ingestion' ? C.surface3 : 'transparent'), transition: 'all 0.15s' }}
            >
              <FileText style={{ width: 15, height: 15 }} /> Scanned Book Lab
            </div>
            <div
              onClick={openPatternDebug}
              onMouseEnter={() => setHoveredItem('pattern-debug')}
              onMouseLeave={() => setHoveredItem(null)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, cursor: 'pointer', fontSize: 13, color: view === 'pattern-debug' ? C.accent : C.textSec, background: view === 'pattern-debug' ? C.accentDim : (hoveredItem === 'pattern-debug' ? C.surface3 : 'transparent'), transition: 'all 0.15s' }}
            >
              <Eye style={{ width: 15, height: 15 }} /> Pattern Debug
            </div>
            <div
              onClick={openCostModal}
              onMouseEnter={() => setHoveredItem('cost')}
              onMouseLeave={() => setHoveredItem(null)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, cursor: 'pointer', fontSize: 13, color: C.textSec, background: hoveredItem === 'cost' ? C.surface3 : 'transparent', transition: 'all 0.15s' }}
            >
              <DollarSign style={{ width: 15, height: 15 }} /> Cost Log
            </div>
          </>
        )}
        <div
          onClick={toggleAdmin}
          onMouseEnter={() => setHoveredItem('admin')}
          onMouseLeave={() => setHoveredItem(null)}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: isAdmin ? 700 : 500, color: isAdmin ? C.warn : C.textSec, background: isAdmin ? C.warnDim : (hoveredItem === 'admin' ? C.surface3 : 'transparent'), border: `1px solid ${isAdmin ? `${C.warn}40` : 'transparent'}`, transition: 'all 0.15s' }}
        >
          <ShieldCheck style={{ width: 15, height: 15 }} /> {isAdmin ? 'Admin ON' : 'Admin'}
        </div>
        <div
          onClick={handleLogout}
          onMouseEnter={() => setHoveredItem('logout')}
          onMouseLeave={() => setHoveredItem(null)}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, cursor: 'pointer', fontSize: 13, color: C.textSec, background: hoveredItem === 'logout' ? C.surface3 : 'transparent', transition: 'all 0.15s' }}
        >
          <LogOut style={{ width: 15, height: 15 }} /> Sign out
        </div>
      </div>
    </aside>
  );
}
