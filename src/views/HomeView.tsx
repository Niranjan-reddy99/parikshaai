import React from 'react';
import { BookOpen, Loader2, ChevronRight, FileText, Play, Brain, BarChart3, Zap, Target } from 'lucide-react';
import { C } from '../lib/tokens';
import { COMMISSION_FULL_NAMES } from '../lib/examUtils';
import { type QuestionMeta, type CommissionMap } from '../types';

interface HomeViewProps {
  questions: QuestionMeta[];
  commissionMap: CommissionMap;
  dataLoading: boolean;
  isAdmin: boolean;
  reviewPapers: { exam_name: string; exam_year: number; question_count: number; reasons: string[] }[];
  openCommission: (c: string) => void;
  openExam: (examName: string, commission: string, examType: string, preferredYear?: number) => void;
  startPractice: (examName: string, year: number, subject?: string, topic?: string) => void;
  startMockExam: (examName: string, year: number) => void;
  setSelectedExamName: (v: string) => void;
  setSelectedExamType: (v: string) => void;
  setSelectedCommission: (v: string) => void;
  setSelectedYear: (v: number) => void;
  setRenameModal: (v: { fullName: string; year: number } | null) => void;
  setRenameValue: (v: string) => void;
  setDeleteExamTarget: (v: { fullName: string; year: number } | null) => void;
}

const COMMISSION_THEME: Record<string, { accent: string; glow: string; emblemBg: string }> = {
  UPSC:    { accent: '#B45309', glow: 'rgba(180,83,9,0.18)',   emblemBg: 'rgba(180,83,9,0.08)' },
  TSPSC:   { accent: '#0F766E', glow: 'rgba(15,118,110,0.18)',  emblemBg: 'rgba(15,118,110,0.08)' },
  APPSC:   { accent: '#0369A1', glow: 'rgba(3,105,161,0.18)',   emblemBg: 'rgba(3,105,161,0.08)'  },
  UPPSC:   { accent: '#22c55e', glow: 'rgba(34,197,94,0.18)',    emblemBg: 'rgba(34,197,94,0.10)'   },
  SSC:     { accent: '#FF6B6B', glow: 'rgba(255,107,107,0.18)',  emblemBg: 'rgba(255,107,107,0.10)' },
  IBPS:    { accent: '#FF8C42', glow: 'rgba(255,140,66,0.18)',   emblemBg: 'rgba(255,140,66,0.10)'  },
  AP:      { accent: '#2dd4bf', glow: 'rgba(45,212,191,0.18)',   emblemBg: 'rgba(45,212,191,0.10)'  },
  DEFAULT: { accent: '#2dd4bf', glow: 'rgba(45,212,191,0.18)',   emblemBg: 'rgba(45,212,191,0.10)'  },
};

function getTheme(commission: string) {
  return COMMISSION_THEME[commission] || COMMISSION_THEME.DEFAULT;
}

function CommissionEmblem({ commission, theme }: { commission: string; theme: ReturnType<typeof getTheme> }) {
  return (
    <div style={{
      width: 64, height: 64, borderRadius: 18, background: theme.emblemBg,
      border: `1.5px solid ${theme.accent}40`,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, boxShadow: `0 4px 20px ${theme.glow}`,
    }}>
      <span style={{ fontSize: 20, fontWeight: 900, color: theme.accent, fontFamily: "'DM Mono',monospace", letterSpacing: '-0.03em', lineHeight: 1 }}>
        {commission.slice(0, 2)}
      </span>
      {commission.length > 2 && (
        <span style={{ fontSize: 7, fontWeight: 700, color: theme.accent, opacity: 0.65, letterSpacing: '0.12em', marginTop: 2 }}>
          {commission.slice(2)}
        </span>
      )}
    </div>
  );
}

// Subject difficulty pill breakdown
function SubjectBar({ subjects }: { subjects: { subject: string; count: number }[] }) {
  const total = subjects.reduce((a, s) => a + s.count, 0);
  if (!total) return null;
  const colors = ['#F5A623', '#7C6EF5', '#2dd4bf', '#f87171', '#34d399', '#60a5fa'];
  return (
    <div style={{ display: 'flex', gap: 2, borderRadius: 4, overflow: 'hidden', height: 4 }}>
      {subjects.slice(0, 6).map((s, i) => (
        <div key={s.subject}
          title={`${s.subject}: ${s.count}Q`}
          style={{ flex: s.count, background: colors[i % colors.length], minWidth: 2 }} />
      ))}
    </div>
  );
}

export function HomeView({
  questions, commissionMap, dataLoading, isAdmin, reviewPapers,
  openCommission, openExam, startPractice, startMockExam,
  setSelectedExamName, setSelectedExamType, setSelectedCommission, setSelectedYear,
  setRenameModal, setRenameValue, setDeleteExamTarget,
}: HomeViewProps) {
  const commissions = Object.keys(commissionMap).sort((a, b) => {
    const order = ['UPSC', 'APPSC', 'TSPSC'];
    const ai = order.indexOf(a), bi = order.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });
  const totalExamPapers = Object.values(commissionMap).flatMap(e => Object.keys(e)).length;
  const totalYears = [...new Set(Object.values(commissionMap).flatMap(e => Object.values(e).flatMap(i => i.years)))].length;
  const quickStartExam = React.useMemo(() => {
    for (const exams of Object.values(commissionMap)) {
      for (const info of Object.values(exams)) {
        if (info.years?.[0]) return { examName: info.fullName, year: info.years[0] };
      }
    }
    return null;
  }, [commissionMap]);
  const reviewPanel = isAdmin && reviewPapers.length > 0 ? (
    <div className="glass-panel" style={{ marginBottom: 20, padding: '18px 20px', borderRadius: 20, border: `1px solid ${C.warn}35` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 12 }}>
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, color: C.textTert, textTransform: 'uppercase', letterSpacing: '0.12em', fontFamily: "'DM Mono', monospace" }}>
            Admin Review Papers
          </p>
          <p style={{ fontSize: 13, color: C.textSec, marginTop: 4 }}>
            Blocked papers are shown here for cleanup only. They are hidden from aspirants.
          </p>
        </div>
        <div style={{ padding: '6px 10px', borderRadius: 999, background: C.warnDim, color: C.warn, fontSize: 11, fontWeight: 700 }}>
          {reviewPapers.length} blocked
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 420, overflowY: 'auto', paddingRight: 4 }}>
        {reviewPapers.map((paper) => (
          <button
            key={`${paper.exam_name}::${paper.exam_year}`}
            onClick={() => {
              const commission = paper.exam_name.trim().split(/\s+/)[0].toUpperCase();
              const examType = paper.exam_name.replace(/^\S+\s*/, '').trim() || 'General';
              setSelectedCommission(commission);
              setSelectedExamName(paper.exam_name);
              setSelectedExamType(examType);
              setSelectedYear(paper.exam_year);
              openExam(paper.exam_name, commission, examType, paper.exam_year);
            }}
            style={{ textAlign: 'left', padding: '12px 14px', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, cursor: 'pointer' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{paper.exam_name}</div>
                <div style={{ fontSize: 11, color: C.textTert, marginTop: 3 }}>
                  {paper.exam_year} · {paper.question_count} questions · {paper.reasons.join(', ')}
                </div>
              </div>
              <ChevronRight style={{ width: 14, height: 14, color: C.textTert, flexShrink: 0 }} />
            </div>
          </button>
        ))}
      </div>
    </div>
  ) : null;

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto' }}>

      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      {!dataLoading && commissions.length > 0 && (
        <div className="surface-card" style={{ marginBottom: 36, padding: '34px 36px 28px', borderRadius: 28, position: 'relative', overflow: 'hidden', border: `1px solid ${C.borderHover}` }}>
          {/* Background glow */}
          <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, rgba(255,255,255,0.28), transparent)`, pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', top: -100, right: -100, width: 340, height: 340, background: `radial-gradient(circle, rgba(15,118,110,0.08) 0%, transparent 62%)`, pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', left: 28, top: 16, fontSize: 10, color: C.textTert, letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: "'DM Mono', monospace" }}>
            Serious PYQ Infrastructure
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 28 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* Commission badges */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 16, marginTop: 10 }}>
                {['UPSC', 'APPSC', 'TSPSC'].filter(c => commissions.includes(c)).map(c => {
                  const theme = getTheme(c);
                  return (
                    <span key={c} style={{ padding: '6px 12px', background: theme.accent + '14', border: `1px solid ${theme.accent}24`, borderRadius: 99, fontSize: 11, fontWeight: 700, color: theme.accent, fontFamily: "'DM Mono', monospace" }}>
                      {c}
                    </span>
                  );
                })}
                {commissions.filter(c => !['UPSC','APPSC','TSPSC'].includes(c)).length > 0 && (
                  <span style={{ padding: '4px 12px', background: 'var(--c-surface3)', border: `1px solid ${C.border}`, borderRadius: 99, fontSize: 11, color: C.textTert }}>
                    +{commissions.filter(c => !['UPSC','APPSC','TSPSC'].includes(c)).length} more
                  </span>
                )}
              </div>

              <h1 style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 34, fontWeight: 500, color: C.headingEm, lineHeight: 1.08, marginBottom: 14, letterSpacing: '-0.8px', maxWidth: 560 }}>
                Build preparation on a
                <span style={{ color: C.accent, display: 'block' }}>clean, searchable,</span>
                trustworthy PYQ system.
              </h1>
              <p style={{ fontSize: 15, color: C.textSec, lineHeight: 1.65, marginBottom: 22, maxWidth: 500 }}>
                Practice curated PYQs from UPSC, APPSC, and TSPSC with topic structure, answer-aligned explanations, and analytics that help aspirants revise without noise.
              </p>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 22 }}>
                <button
                  onClick={() => openCommission(commissions[0])}
                  style={{ padding: '11px 18px', borderRadius: 12, border: 'none', background: C.accent, color: '#fff', fontWeight: 700, cursor: 'pointer', boxShadow: 'var(--c-shadow-glow)' }}
                >
                  Explore Question Bank
                </button>
                <button
                  onClick={() => quickStartExam && startPractice(quickStartExam.examName, quickStartExam.year)}
                  disabled={!quickStartExam}
                  style={{ padding: '11px 18px', borderRadius: 12, border: `1px solid ${C.border}`, background: C.surface2, color: C.headingEm, fontWeight: 700, cursor: quickStartExam ? 'pointer' : 'not-allowed', opacity: quickStartExam ? 1 : 0.6 }}
                >
                  Start Quick Practice
                </button>
              </div>

              {/* Stats inline */}
              <div style={{ display: 'flex', gap: 0, flexWrap: 'wrap', borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
                {[
                  { value: questions.length.toLocaleString(), label: 'Questions' },
                  { value: totalExamPapers.toString(), label: 'Exam Papers' },
                  { value: `${totalYears}+`, label: 'Years Covered' },
                  { value: commissions.length.toString(), label: 'Commissions' },
                ].map(({ value, label }) => (
                  <div key={label} style={{ minWidth: 120, paddingRight: 18, marginRight: 18, borderRight: label !== 'Commissions' ? `1px solid ${C.border}` : 'none' }}>
                    <div style={{ fontSize: 24, fontWeight: 500, color: C.headingEm, fontFamily: "'Fraunces', Georgia, serif", lineHeight: 1, letterSpacing: '-0.4px' }}>{value}</div>
                    <div style={{ fontSize: 9, color: C.textTert, textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 6, fontFamily: "'DM Mono', monospace" }}>{label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Value props column */}
            <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 260 }}>
              {[
                { icon: <Brain style={{ width: 14, height: 14 }} />, title: 'Answer-Aligned Explanations', desc: 'Generated only after answer validation', color: C.accent },
                { icon: <BarChart3 style={{ width: 14, height: 14 }} />, title: 'Topic-Level Revision', desc: 'Move from subject to topic to family cleanly', color: C.blue },
                { icon: <Target style={{ width: 14, height: 14 }} />, title: 'Mock + Practice Modes', desc: 'Timed simulations and focused drills', color: '#f87171' },
              ].map(({ icon, title, desc, color }) => (
                <div key={title} className="surface-card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 16 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 11, background: color + '12', color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {icon}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{title}</div>
                    <div style={{ fontSize: 11, color: C.textSec, marginTop: 2, lineHeight: 1.45 }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Content ─────────────────────────────────────────────────────────── */}
      {dataLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '80px 0', justifyContent: 'center', color: C.textSec }}>
          <Loader2 style={{ width: 20, height: 20, animation: 'spin 1s linear infinite', color: C.accent }} />
          <span style={{ fontSize: 14 }}>Loading question bank...</span>
        </div>
      ) : commissions.length === 0 ? (
        <>
          {reviewPanel}
          <div className="glass-panel" style={{ textAlign: 'center', padding: '80px 20px', borderRadius: 24 }}>
            <BookOpen style={{ width: 48, height: 48, color: C.textTert, margin: '0 auto 20px' }} />
            <h3 style={{ fontFamily: "'Fraunces', Georgia, serif", color: C.textSec, marginBottom: 12, fontSize: 22, fontWeight: 400 }}>No question bank yet</h3>
            <p style={{ fontSize: 14, color: C.textTert }}>Upload exam PDFs via Admin → Upload Paper to populate the question bank.</p>
          </div>
        </>
      ) : (
        <>
          {reviewPanel}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, color: C.textTert, textTransform: 'uppercase', letterSpacing: '0.12em', fontFamily: "'DM Mono', monospace" }}>
                Select a Commission
              </p>
              <p style={{ fontSize: 14, color: C.textSec, marginTop: 4 }}>Click a card to explore papers, or use Quick Practice / Mock Test buttons</p>
            </div>
          </div>

          {/* Commission cards — clean summary only, drill down via CommissionView */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 18, marginBottom: 40 }}>
            {commissions.map(commission => {
              const exams = commissionMap[commission];
              const examEntries = Object.entries(exams).sort((a, b) => b[1].count - a[1].count);
              const totalQs = Object.values(exams).reduce((a, e) => a + e.count, 0);
              const allYears = [...new Set(examEntries.flatMap(([, info]) => info.years))].sort((a, b) => b - a);
              const theme = getTheme(commission);
              const isHighlighted = ['UPSC', 'APPSC', 'TSPSC'].includes(commission);

              const subjectCounts = questions
                .filter(q => examEntries.some(([, i]) => q.exam === i.fullName))
                .reduce((acc, q) => { acc[q.subject] = (acc[q.subject] || 0) + 1; return acc; }, {} as Record<string, number>);
              const subjectList = Object.entries(subjectCounts)
                .map(([subject, count]) => ({ subject, count }))
                .sort((a, b) => b.count - a.count);

              return (
                <div key={commission}
                  onClick={() => openCommission(commission)}
                  className="glass-panel hover-lift"
                  style={{
                    border: `1px solid ${isHighlighted ? theme.accent + '30' : C.border}`,
                    borderRadius: 20, overflow: 'hidden', cursor: 'pointer',
                  }}>
                  <div style={{ height: 3, background: `linear-gradient(90deg, ${theme.accent}, ${theme.accent}22)` }} />
                  <div style={{ padding: '18px 18px 16px' }}>

                    {/* Header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
                      <CommissionEmblem commission={commission} theme={theme} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <h2 style={{ fontSize: 20, fontFamily: "'Fraunces', Georgia, serif", color: C.text, letterSpacing: '-0.3px', lineHeight: 1 }}>{commission}</h2>
                          {allYears[0] && (
                            <span style={{ fontSize: 9, fontWeight: 700, color: theme.accent, background: theme.accent + '12', border: `1px solid ${theme.accent}30`, borderRadius: 5, padding: '2px 6px', textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>
                              up to {allYears[0]}
                            </span>
                          )}
                        </div>
                        <p style={{ fontSize: 11, color: C.textSec }}>{COMMISSION_FULL_NAMES[commission] || commission}</p>
                      </div>
                    </div>

                    {/* Stats row */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 14 }}>
                      {[
                        { label: 'Questions', value: totalQs.toLocaleString() },
                        { label: 'Years',     value: allYears.length },
                        { label: 'Papers',    value: examEntries.length },
                      ].map(({ label, value }) => (
                        <div key={label} style={{ background: C.bg, borderRadius: 7, padding: '7px 8px', border: `1px solid ${C.border}` }}>
                          <p style={{ fontSize: 15, fontWeight: 800, color: C.text, fontFamily: "'DM Mono',monospace", lineHeight: 1 }}>{value}</p>
                          <p style={{ fontSize: 9, color: C.textTert, textTransform: 'uppercase' as const, letterSpacing: '0.07em', marginTop: 3 }}>{label}</p>
                        </div>
                      ))}
                    </div>

                    {/* Subject bar */}
                    {subjectList.length > 0 && (
                      <div style={{ marginBottom: 16 }}>
                        <SubjectBar subjects={subjectList} />
                        <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap' as const }}>
                          {subjectList.slice(0, 4).map((s, i) => {
                            const colors = ['#F5A623', '#7C6EF5', '#2dd4bf', '#f87171'];
                            return (
                              <span key={s.subject} style={{ fontSize: 9, color: C.textTert, display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: colors[i % colors.length], display: 'inline-block' }} />
                                {s.subject.slice(0, 14)}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Explore button */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
                      <span style={{ fontSize: 11, color: C.textTert }}>
                        {examEntries.length} exam type{examEntries.length !== 1 ? 's' : ''} · {allYears.slice(0, 3).join(', ')}{allYears.length > 3 ? '…' : ''}
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: theme.accent, display: 'flex', alignItems: 'center', gap: 4 }}>
                        Explore <ChevronRight style={{ width: 13, height: 13 }} />
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── How It Works strip ────────────────────────────────────────── */}
          <div style={{ padding: '32px 36px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 20, marginBottom: 20 }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: C.textTert, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 20, textAlign: 'center' }}>How It Works</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 24 }}>
              {[
                { step: '01', icon: <FileText style={{ width: 20, height: 20, color: C.accent }} />, title: 'Pick an Exam', desc: 'Choose commission, paper, and year from the cards above' },
                { step: '02', icon: <Play style={{ width: 20, height: 20, color: '#7C6EF5' }} />, title: 'Practice or Mock', desc: 'Topic-wise practice or full timed mock test simulation' },
                { step: '03', icon: <Brain style={{ width: 20, height: 20, color: '#F5A623' }} />, title: 'Get AI Explanation', desc: 'Instant Gemini-powered explanation for every answer' },
                { step: '04', icon: <BarChart3 style={{ width: 20, height: 20, color: '#34d399' }} />, title: 'Track & Improve', desc: 'Dashboard shows subject accuracy and activity heatmap' },
              ].map(({ step, icon, title, desc }) => (
                <div key={step} style={{ textAlign: 'center' }}>
                  <div style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--c-surface3)', border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                    {icon}
                  </div>
                  <div style={{ fontSize: 9, fontFamily: "'DM Mono', monospace", color: C.textTert, letterSpacing: '0.1em', marginBottom: 6 }}>STEP {step}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 6 }}>{title}</div>
                  <div style={{ fontSize: 11, color: C.textTert, lineHeight: 1.5 }}>{desc}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
