import { useState } from 'react';
import { ArrowLeft, Lock } from 'lucide-react';
import { C } from '../lib/tokens';
import { COMMISSION_FULL_NAMES } from '../lib/examUtils';
import { type CommissionMap, type View } from '../types';

interface CommissionViewProps {
  selectedCommission: string;
  commissionMap: CommissionMap;
  searchQuery: string;
  setView: (v: View) => void;
  openExam: (examName: string, commission: string, examType: string) => void;
  startPractice: (examName: string, year: number) => void;
  startMockExam: (examName: string, year: number) => void;
  setSelectedExamName: (v: string) => void;
  setSelectedExamType: (v: string) => void;
  setSelectedYear: (v: number) => void;
  isLocked: (examName: string, year: number, commission?: string) => boolean;
  onLockedClick: () => void;
}

const COMMISSION_GRADIENTS: Record<string, string> = {
  UPSC:    'linear-gradient(135deg,#1e3a8a,#2563eb)',
  APPSC:   'linear-gradient(135deg,#064e3b,#059669)',
  TSPSC:   'linear-gradient(135deg,#4c1d95,#7c3aed)',
  TSLPRB:  'linear-gradient(135deg,#1e4d3b,#0891b2)',
  APSLPRB: 'linear-gradient(135deg,#0f4c81,#0369a1)',
  APHC:    'linear-gradient(135deg,#1a237e,#3949ab)',
  TSHC:    'linear-gradient(135deg,#4a148c,#7b1fa2)',
  SSC:     'linear-gradient(135deg,#92400e,#d97706)',
  IBPS:    'linear-gradient(135deg,#1e3a5f,#3b82f6)',
  RRB:     'linear-gradient(135deg,#7f1d1d,#dc2626)',
};

function DiffBar({ difficulty, total }: { difficulty: Record<string, number>; total: number }) {
  const easy = Math.round(((difficulty.Easy || 0) / total) * 100);
  const hard = Math.round(((difficulty.Hard || 0) / total) * 100);
  const med  = 100 - easy - hard;
  return (
    <div style={{ display: 'flex', height: 7, borderRadius: 4, overflow: 'hidden', gap: 2 }}>
      <div title={`Easy ${easy}%`}  style={{ width: `${easy}%`, background: '#10b981', minWidth: easy > 0 ? 3 : 0 }} />
      <div title={`Med ${med}%`}    style={{ width: `${med}%`,  background: '#f59e0b', minWidth: med > 0 ? 3 : 0 }} />
      <div title={`Hard ${hard}%`}  style={{ width: `${hard}%`, background: '#ef4444', minWidth: hard > 0 ? 3 : 0 }} />
    </div>
  );
}

export function CommissionView({
  selectedCommission, commissionMap, searchQuery, setView,
  openExam, startPractice, startMockExam,
  setSelectedExamName, setSelectedExamType, setSelectedYear,
  isLocked, onLockedClick,
}: CommissionViewProps) {
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);
  const exams = commissionMap[selectedCommission] || {};
  const norm = searchQuery.trim().toLowerCase();

  const examTypes = Object.entries(exams)
    .filter(([examType, info]) => {
      if (!norm) return true;
      return [examType, info.fullName, selectedCommission, ...(info.years || []).map(String)]
        .join(' ').toLowerCase().includes(norm);
    })
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: 'base' }));

  const totalQs = examTypes.reduce((s, [, e]) => s + e.count, 0);
  const allYears = [...new Set(examTypes.flatMap(([, e]) => e.years))].sort((a, b) => b - a);
  const gradient = COMMISSION_GRADIENTS[selectedCommission] || 'linear-gradient(135deg,#334155,#475569)';

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', fontFamily: 'var(--font-sans)' }}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{
        background: gradient, borderRadius: 16,
        padding: '22px 26px', marginBottom: 24, position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', right: -20, top: -20, width: 140, height: 140, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', right: 50, bottom: -30, width: 80, height: 80, borderRadius: '50%', background: 'rgba(255,255,255,0.07)', pointerEvents: 'none' }} />

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, position: 'relative', zIndex: 1 }}>
          <button
            onClick={() => setView('home')}
            style={{ width: 34, height: 34, borderRadius: 9, background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff', flexShrink: 0, marginTop: 2 }}
          >
            <ArrowLeft style={{ width: 14, height: 14 }} />
          </button>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: '0 0 3px', letterSpacing: '-0.3px' }}>
              {selectedCommission}
            </h1>
            <p style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.7)', margin: 0 }}>
              {COMMISSION_FULL_NAMES[selectedCommission] || selectedCommission}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
            {[
              { value: totalQs >= 1000 ? `${(totalQs / 1000).toFixed(1)}k` : totalQs, label: 'Questions' },
              { value: allYears.length, label: 'Years' },
              { value: examTypes.length, label: 'Papers' },
            ].map(({ value, label }) => (
              <div key={label} style={{ textAlign: 'center', padding: '8px 14px', background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 10 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', lineHeight: 1 }}>{value}</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)', marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Exam cards grid ─────────────────────────────────────────────── */}
      {examTypes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '64px 0', color: C.textTert, fontSize: 13 }}>
          {norm ? `No papers in ${selectedCommission} match "${searchQuery}".` : `No exams found for ${selectedCommission}.`}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 14 }}>
          {examTypes.map(([examType, info]) => {
            const hov = hoveredCard === examType;
            const latestYear = info.years[0];
            const locked = isLocked(info.fullName, latestYear, selectedCommission);
            const abbr = examType.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();

            return (
              <div
                key={examType}
                onMouseEnter={() => setHoveredCard(examType)}
                onMouseLeave={() => setHoveredCard(null)}
                style={{
                  background: 'var(--bg)', border: `1px solid ${hov ? '#94a3b8' : 'var(--border)'}`,
                  borderRadius: 16, overflow: 'hidden', cursor: 'pointer',
                  boxShadow: hov ? '0 8px 24px rgba(15,23,42,0.09)' : 'none',
                  transition: 'border-color 0.15s, box-shadow 0.15s',
                }}
                onClick={() => openExam(info.fullName, selectedCommission, examType)}
              >
                {/* Card top bar */}
                <div style={{ height: 4, background: gradient }} />

                <div style={{ padding: '16px 18px' }}>
                  {/* Title row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: 11, flexShrink: 0,
                      background: gradient,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 800, color: '#fff',
                    }}>
                      {abbr}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>{examType}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-tert)' }}>
                        {selectedCommission} · {info.years.length} year{info.years.length !== 1 ? 's' : ''} · {info.count.toLocaleString()} questions
                      </div>
                    </div>
                  </div>

                  {/* Year pills */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                    {info.years.slice(0, 5).map(y => {
                      const ylocked = isLocked(info.fullName, y, selectedCommission);
                      return (
                        <span
                          key={y}
                          onClick={e => {
                            e.stopPropagation();
                            if (ylocked) { onLockedClick(); return; }
                            setSelectedExamName(info.fullName);
                            setSelectedExamType(examType);
                            setSelectedYear(y);
                            setView('exam-detail');
                          }}
                          style={{
                            padding: '4px 10px', borderRadius: 8,
                            background: ylocked ? 'var(--bg-canvas)' : 'var(--bg-alt)',
                            border: '1px solid var(--border)',
                            fontSize: 11.5, fontWeight: 600,
                            color: ylocked ? C.textTert : C.textSec,
                            cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
                            opacity: ylocked ? 0.65 : 1,
                            transition: 'border-color 0.1s',
                          }}
                          onMouseEnter={e => { e.stopPropagation(); if (!ylocked) e.currentTarget.style.borderColor = '#94a3b8'; }}
                          onMouseLeave={e => { e.stopPropagation(); e.currentTarget.style.borderColor = 'var(--border)'; }}
                        >
                          {ylocked && <Lock style={{ width: 9, height: 9 }} />}{y}
                        </span>
                      );
                    })}
                    {info.years.length > 5 && (
                      <span style={{ padding: '4px 8px', borderRadius: 8, background: 'var(--bg-canvas)', border: '1px solid var(--border)', fontSize: 11, color: C.textTert }}>
                        +{info.years.length - 5} more
                      </span>
                    )}
                  </div>

                  {/* Difficulty bar */}
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                      <span style={{ fontSize: 10.5, color: C.textTert, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Difficulty mix</span>
                      <div style={{ display: 'flex', gap: 10, fontSize: 10 }}>
                        <span style={{ color: '#10b981', fontWeight: 700 }}>Easy</span>
                        <span style={{ color: '#f59e0b', fontWeight: 700 }}>Med</span>
                        <span style={{ color: '#ef4444', fontWeight: 700 }}>Hard</span>
                      </div>
                    </div>
                    <DiffBar difficulty={info.difficulty} total={info.count} />
                  </div>

                  {/* Action buttons */}
                  <div style={{ display: 'flex', gap: 8 }} onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => {
                        if (locked) { onLockedClick(); return; }
                        setSelectedExamName(info.fullName);
                        setSelectedExamType(examType);
                        setSelectedYear(latestYear);
                        startPractice(info.fullName, latestYear);
                      }}
                      style={{
                        flex: 1, padding: '9px 0',
                        background: locked ? 'var(--bg-alt)' : '#eff6ff',
                        border: `1px solid ${locked ? 'var(--border)' : '#bfdbfe'}`,
                        borderRadius: 9, fontSize: 12.5, fontWeight: 700,
                        color: locked ? C.textTert : '#2563eb',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                      }}
                    >
                      {locked ? <Lock style={{ width: 11, height: 11 }} /> : (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                      )}
                      {locked ? 'Premium' : 'Practice'}
                    </button>
                    <button
                      onClick={() => {
                        if (locked) { onLockedClick(); return; }
                        setSelectedExamName(info.fullName);
                        setSelectedExamType(examType);
                        setSelectedYear(latestYear);
                        startMockExam(info.fullName, latestYear);
                      }}
                      style={{
                        flex: 1, padding: '9px 0',
                        background: 'var(--bg)', border: '1px solid var(--border)',
                        borderRadius: 9, fontSize: 12.5, fontWeight: 700,
                        color: locked ? C.textTert : C.textSec,
                        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                      }}
                    >
                      {locked ? <Lock style={{ width: 11, height: 11 }} /> : (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      )}
                      {locked ? 'Locked' : 'Mock Test'}
                    </button>
                    <button
                      onClick={() => openExam(info.fullName, selectedCommission, examType)}
                      style={{
                        width: 36, background: 'var(--bg)', border: '1px solid var(--border)',
                        borderRadius: 9, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                      }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = '#94a3b8'}
                      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.textTert} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
