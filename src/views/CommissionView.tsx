import React, { useState } from 'react';
import { ArrowLeft, Play, ShieldCheck, ChevronRight } from 'lucide-react';
import { C } from '../lib/tokens';
import { COMMISSION_FULL_NAMES } from '../lib/examUtils';
import { type CommissionMap, type View } from '../types';

interface CommissionViewProps {
  selectedCommission: string;
  commissionMap: CommissionMap;
  setView: (v: View) => void;
  openExam: (examName: string, commission: string, examType: string) => void;
  startPractice: (examName: string, year: number) => void;
  startMockExam: (examName: string, year: number) => void;
  setSelectedExamName: (v: string) => void;
  setSelectedExamType: (v: string) => void;
  setSelectedYear: (v: number) => void;
}

export function CommissionView({
  selectedCommission, commissionMap, setView,
  openExam, startPractice, startMockExam,
  setSelectedExamName, setSelectedExamType, setSelectedYear,
}: CommissionViewProps) {
  const exams = commissionMap[selectedCommission] || {};
  const examTypes = Object.entries(exams).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: 'base' }));
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);

  const totalQs = examTypes.reduce((a, [, e]) => a + e.count, 0);
  const allYears = [...new Set(examTypes.flatMap(([, e]) => e.years))].sort((a, b) => b - a);

  const diffBar = (difficulty: Record<string, number>, total: number) => {
    const easy = Math.round(((difficulty.Easy || 0) / total) * 100);
    const hard = Math.round(((difficulty.Hard || 0) / total) * 100);
    const med  = 100 - easy - hard;
    return (
      <div style={{ display: 'flex', height: 4, borderRadius: 2, overflow: 'hidden', width: 80, gap: 1 }}>
        <div style={{ width: `${easy}%`, background: C.accent }} />
        <div style={{ width: `${med}%`,  background: C.warn  }} />
        <div style={{ width: `${hard}%`, background: C.danger }} />
      </div>
    );
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 28 }}>
        <button onClick={() => setView('home')}
          style={{ width: 34, height: 34, borderRadius: 8, background: C.surface, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: C.textSec, flexShrink: 0 }}>
          <ArrowLeft style={{ width: 15, height: 15 }} />
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: C.text, letterSpacing: '-0.3px' }}>{selectedCommission}</h1>
          <p style={{ fontSize: 12, color: C.textSec, marginTop: 2 }}>
            {COMMISSION_FULL_NAMES[selectedCommission] || selectedCommission}
          </p>
        </div>
        {/* Summary chips */}
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {[
            { value: totalQs.toLocaleString(), label: 'Questions' },
            { value: allYears.length,          label: 'Years' },
            { value: examTypes.length,         label: 'Papers' },
          ].map(({ value, label }) => (
            <div key={label} style={{ textAlign: 'center', padding: '6px 14px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: C.text, fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>{value}</div>
              <div style={{ fontSize: 9, color: C.textTert, textTransform: 'uppercase', letterSpacing: '0.07em', marginTop: 3 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Exam list */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden' }}>
        {/* Column header */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 160px 80px 180px', gap: 12, padding: '10px 20px', background: C.bg, borderBottom: `1px solid ${C.border}`, alignItems: 'center' }}>
          {['Exam', 'Questions', 'Years', 'Difficulty', ''].map((h, i) => (
            <div key={h} style={{ fontSize: 10, fontWeight: 700, color: C.textTert, textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: i >= 3 ? 'center' : 'left' }}>{h}</div>
          ))}
        </div>

        {examTypes.map(([examType, info], idx) => {
          const hovered = hoveredRow === examType;
          return (
            <div key={examType}
              style={{
                display: 'grid', gridTemplateColumns: '1fr 80px 160px 80px 180px',
                gap: 12, padding: '14px 20px', alignItems: 'center',
                borderBottom: idx < examTypes.length - 1 ? `1px solid ${C.border}` : 'none',
                background: hovered ? 'var(--c-surface2)' : 'transparent',
                transition: 'background 0.12s', cursor: 'pointer',
              }}
              onMouseEnter={() => setHoveredRow(examType)}
              onMouseLeave={() => setHoveredRow(null)}
              onClick={() => openExam(info.fullName, selectedCommission, examType)}>

              {/* Exam name */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: 9, background: C.accentDim, border: `1px solid ${C.accent}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: C.accent, fontFamily: "'DM Mono', monospace", flexShrink: 0 }}>
                  {examType.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{examType}</div>
                  <div style={{ fontSize: 11, color: C.textTert, marginTop: 1 }}>{selectedCommission} · {info.years.length} year{info.years.length !== 1 ? 's' : ''}</div>
                </div>
              </div>

              {/* Question count */}
              <div style={{ fontSize: 14, fontWeight: 800, color: C.text, fontFamily: "'DM Mono', monospace" }}>
                {info.count.toLocaleString()}
              </div>

              {/* Year chips (max 4, then +N) */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {info.years.slice(0, 4).map(y => (
                  <span key={y}
                    onClick={e => { e.stopPropagation(); setSelectedExamName(info.fullName); setSelectedExamType(examType); setSelectedYear(y); setView('exam-detail'); }}
                    style={{ padding: '2px 8px', background: C.bg, border: `1px solid ${C.border}`, color: C.textSec, fontSize: 10, fontWeight: 600, borderRadius: 6, fontFamily: "'DM Mono', monospace", cursor: 'pointer', transition: 'all 0.1s' }}
                    onMouseEnter={e => { e.stopPropagation(); e.currentTarget.style.borderColor = C.accent + '60'; e.currentTarget.style.color = C.accent; }}
                    onMouseLeave={e => { e.stopPropagation(); e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textSec; }}>
                    {y}
                  </span>
                ))}
                {info.years.length > 4 && (
                  <span style={{ padding: '2px 6px', background: C.bg, border: `1px solid ${C.border}`, color: C.textTert, fontSize: 10, borderRadius: 6 }}>
                    +{info.years.length - 4}
                  </span>
                )}
              </div>

              {/* Difficulty bar */}
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                {diffBar(info.difficulty, info.count)}
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => { setSelectedExamName(info.fullName); setSelectedExamType(examType); setSelectedYear(info.years[0]); startPractice(info.fullName, info.years[0]); }}
                  style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '7px 0', background: C.accentDim, border: `1px solid ${C.accent}30`, borderRadius: 8, fontSize: 11, fontWeight: 700, color: C.accent, cursor: 'pointer', transition: 'all 0.12s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = C.accent + '28'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = C.accentDim; }}>
                  <Play style={{ width: 10, height: 10 }} /> Practice
                </button>
                <button
                  onClick={() => { setSelectedExamName(info.fullName); setSelectedExamType(examType); setSelectedYear(info.years[0]); startMockExam(info.fullName, info.years[0]); }}
                  style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '7px 0', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11, fontWeight: 700, color: C.textSec, cursor: 'pointer', transition: 'all 0.12s' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--c-border-l)'; e.currentTarget.style.color = C.text; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textSec; }}>
                  <ShieldCheck style={{ width: 10, height: 10 }} /> Mock
                </button>
                <button
                  onClick={() => openExam(info.fullName, selectedCommission, examType)}
                  style={{ width: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, cursor: 'pointer', transition: 'all 0.12s', flexShrink: 0 }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent + '60'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; }}>
                  <ChevronRight style={{ width: 13, height: 13, color: C.textTert }} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {examTypes.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: C.textTert, fontSize: 13 }}>
          No exams found for {selectedCommission}.
        </div>
      )}
    </div>
  );
}
