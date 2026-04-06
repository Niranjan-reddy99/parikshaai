import React from 'react';
import { BookOpen, Loader2, ChevronRight, FileText, Play, Brain, BarChart3, Zap, Target } from 'lucide-react';
import { C } from '../lib/tokens';
import { COMMISSION_FULL_NAMES } from '../lib/examUtils';
import { type Question, type CommissionMap } from '../types';

interface HomeViewProps {
  questions: Question[];
  commissionMap: CommissionMap;
  dataLoading: boolean;
  isAdmin: boolean;
  openCommission: (c: string) => void;
  openExam: (examName: string, commission: string, examType: string) => void;
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
  UPSC:    { accent: '#F5A623', glow: 'rgba(245,166,35,0.18)',   emblemBg: 'rgba(245,166,35,0.10)' },
  TSPSC:   { accent: '#7C6EF5', glow: 'rgba(124,110,245,0.18)',  emblemBg: 'rgba(124,110,245,0.10)' },
  APPSC:   { accent: '#2BBFFF', glow: 'rgba(43,191,255,0.18)',   emblemBg: 'rgba(43,191,255,0.10)'  },
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
  questions, commissionMap, dataLoading, isAdmin,
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

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto' }}>

      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      {!dataLoading && commissions.length > 0 && (
        <div style={{ marginBottom: 40, padding: '40px 36px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 24, position: 'relative', overflow: 'hidden' }}>
          {/* Background glow */}
          <div style={{ position: 'absolute', top: -60, right: -60, width: 300, height: 300, background: 'radial-gradient(circle, rgba(45,212,191,0.08) 0%, transparent 70%)', pointerEvents: 'none' }} />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 32 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* Commission badges */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                {['UPSC', 'APPSC', 'TSPSC'].filter(c => commissions.includes(c)).map(c => {
                  const theme = getTheme(c);
                  return (
                    <span key={c} style={{ padding: '4px 12px', background: theme.accent + '18', border: `1px solid ${theme.accent}40`, borderRadius: 99, fontSize: 11, fontWeight: 700, color: theme.accent, fontFamily: "'DM Mono', monospace" }}>
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

              <h1 style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 34, fontWeight: 400, color: C.text, lineHeight: 1.2, marginBottom: 12, letterSpacing: '-0.5px' }}>
                Master PYQs with<br />
                <em style={{ fontStyle: 'italic', color: C.headingEm }}>data-backed precision</em>
              </h1>
              <p style={{ fontSize: 14, color: C.textSec, lineHeight: 1.7, marginBottom: 24, maxWidth: 480 }}>
                Practice previous year questions from UPSC, APPSC, and TSPSC with instant AI explanations, subject-wise analysis, and timed mock tests.
              </p>

              {/* Stats inline */}
              <div style={{ display: 'flex', gap: 24 }}>
                {[
                  { value: questions.length.toLocaleString(), label: 'Questions' },
                  { value: totalExamPapers.toString(), label: 'Exam Papers' },
                  { value: `${totalYears}+`, label: 'Years Covered' },
                  { value: commissions.length.toString(), label: 'Commissions' },
                ].map(({ value, label }) => (
                  <div key={label}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: C.text, fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>{value}</div>
                    <div style={{ fontSize: 10, color: C.textTert, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 4 }}>{label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Value props column */}
            <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 240 }}>
              {[
                { icon: <Brain style={{ width: 14, height: 14 }} />, title: 'AI Explanations', desc: 'Generated on first click, cached forever', color: C.accent },
                { icon: <BarChart3 style={{ width: 14, height: 14 }} />, title: 'Subject Analytics', desc: 'Track accuracy across every subject', color: C.blue },
                { icon: <Target style={{ width: 14, height: 14 }} />, title: 'Timed Mock Tests', desc: 'Full paper simulation with timer', color: '#f87171' },
                { icon: <Zap style={{ width: 14, height: 14 }} />, title: 'Pattern Insights', desc: 'AI report on question patterns', color: C.warn },
              ].map(({ icon, title, desc, color }) => (
                <div key={title} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10 }}>
                  <div style={{ width: 30, height: 30, borderRadius: 8, background: color + '18', color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {icon}
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{title}</div>
                    <div style={{ fontSize: 11, color: C.textTert }}>{desc}</div>
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
        <div style={{ textAlign: 'center', padding: '80px 20px', background: C.surface, borderRadius: 20, border: `1px dashed ${C.border}` }}>
          <BookOpen style={{ width: 40, height: 40, color: C.textTert, margin: '0 auto 16px' }} />
          <h3 style={{ fontWeight: 700, color: C.textSec, marginBottom: 8, fontSize: 16 }}>No question bank yet</h3>
          <p style={{ fontSize: 13, color: C.textTert }}>Upload exam PDFs via Admin → Upload Paper to populate the question bank.</p>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <p style={{ fontSize: 10, fontWeight: 700, color: C.textTert, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                Select a Commission
              </p>
              <p style={{ fontSize: 12, color: C.textTert, marginTop: 2 }}>Click a card to explore papers, or use Quick Practice / Mock Test buttons</p>
            </div>
          </div>

          {/* Commission cards — clean summary only, drill down via CommissionView */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16, marginBottom: 40 }}>
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
                  style={{
                    background: C.surface,
                    border: `1px solid ${isHighlighted ? theme.accent + '28' : C.border}`,
                    borderRadius: 18, overflow: 'hidden', cursor: 'pointer',
                    transition: 'transform 0.15s, box-shadow 0.15s, border-color 0.15s',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLDivElement).style.borderColor = theme.accent + '70';
                    (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)';
                    (e.currentTarget as HTMLDivElement).style.boxShadow = `0 12px 36px ${theme.glow}`;
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLDivElement).style.borderColor = isHighlighted ? theme.accent + '28' : C.border;
                    (e.currentTarget as HTMLDivElement).style.transform = 'none';
                    (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
                  }}>
                  <div style={{ height: 3, background: `linear-gradient(90deg, ${theme.accent}, ${theme.accent}22)` }} />
                  <div style={{ padding: '18px 18px 16px' }}>

                    {/* Header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                      <CommissionEmblem commission={commission} theme={theme} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                          <h2 style={{ fontSize: 18, fontWeight: 900, color: C.text, letterSpacing: '-0.02em', lineHeight: 1 }}>{commission}</h2>
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
