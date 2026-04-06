import React, { useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp, Play, ShieldCheck, BookOpen, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { C, diffColor, diffBg } from '../lib/tokens';
import { COLORS } from '../lib/examUtils';
import { formatTime } from '../lib/utils';
import { type Question, type CommissionMap, type WeightageItem, type View } from '../types';

interface ExamDetailViewProps {
  selectedCommission: string;
  selectedExamType: string;
  selectedExamName: string;
  selectedYear: number;
  setSelectedYear: (y: number) => void;
  commissionMap: CommissionMap;
  examYearQs: Question[];
  weightage: WeightageItem[];
  questions: Question[];
  startPractice: (examName: string, year: number, subject?: string, topic?: string) => void;
  startMockExam: (examName: string, year: number) => void;
  browseWithFilters: (subject?: string, topic?: string, subtopic?: string) => void;
  setView: (v: View) => void;
  isAdmin: boolean;
  setRenameModal: (v: { fullName: string; year: number } | null) => void;
  setRenameValue: (v: string) => void;
  setDeleteExamTarget: (v: { fullName: string; year: number } | null) => void;
  doAddBlankQuestion?: (examName: string, year: number) => void;
}

export function ExamDetailView({
  selectedCommission, selectedExamType, selectedExamName, selectedYear, setSelectedYear,
  commissionMap, examYearQs, weightage, questions,
  startPractice, startMockExam, browseWithFilters, setView,
  isAdmin, setRenameModal, setRenameValue, setDeleteExamTarget, doAddBlankQuestion
}: ExamDetailViewProps) {
  const [expandedSubjects, setExpandedSubjects] = useState<Record<string, boolean>>({});

  const info = commissionMap[selectedCommission]?.[selectedExamType];
  if (!info) return null;

  const examDuration = formatTime(examYearQs.length * 72);

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
        <button onClick={() => setView('commission')}
          style={{ width: 36, height: 36, borderRadius: 10, background: C.surface, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: C.textSec }}>
          <ArrowLeft style={{ width: 16, height: 16 }} />
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: C.text }}>{selectedCommission} — {selectedExamType}</h1>
          <p style={{ fontSize: 13, color: C.textSec }}>{examYearQs.length} questions · {selectedYear}</p>
        </div>
        {isAdmin && (
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button onClick={() => doAddBlankQuestion?.(selectedExamName, selectedYear)}
              style={{ padding: '6px 14px', background: C.accentDim, border: `1px solid ${C.accent}30`, borderRadius: 10, fontSize: 12, fontWeight: 700, color: C.accent, cursor: 'pointer' }}>+ Add Question</button>
            <button onClick={() => { setRenameValue(selectedExamName); setRenameModal({ fullName: selectedExamName, year: selectedYear }); }}
              style={{ padding: '6px 14px', background: C.warnDim, border: `1px solid ${C.warn}30`, borderRadius: 10, fontSize: 12, fontWeight: 700, color: C.warn, cursor: 'pointer' }}>Rename Exam</button>
            <button onClick={() => { setDeleteExamTarget({ fullName: selectedExamName, year: selectedYear }); }}
              style={{ padding: '6px 14px', background: C.dangerDim, border: `1px solid ${C.danger}30`, borderRadius: 10, fontSize: 12, fontWeight: 700, color: C.danger, cursor: 'pointer' }}>Delete Exam</button>
          </div>
        )}
      </div>

      {/* Year selector */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 28 }}>
        {info.years.map(y => {
          const count = questions.filter(q => q.exam === selectedExamName && q.year === y).length;
          const active = selectedYear === y;
          return (
            <button key={y} onClick={() => setSelectedYear(y)}
              style={{ padding: '8px 18px', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer', transition: 'all 0.15s',
                background: active ? C.accent : C.surface,
                border: `1px solid ${active ? C.accent : C.border}`,
                color: active ? '#0a1a18' : C.textSec }}>
              {y}
              <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.7, fontFamily: "'DM Mono', monospace" }}>({count}Q)</span>
            </button>
          );
        })}
      </div>

      {/* ── Mode Selection ──────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 28 }}>
        {/* Practice Mode */}
        <button onClick={() => startPractice(selectedExamName, selectedYear)}
          style={{ padding: '22px 24px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 18, cursor: 'pointer', textAlign: 'left', position: 'relative', overflow: 'hidden', transition: 'border-color 0.15s' }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = C.accent + '60')}
          onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${C.accent}, #00FFAA)` }} />
          <div style={{ width: 44, height: 44, borderRadius: 12, background: C.accentDim, border: `1px solid ${C.accent}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
            <BookOpen style={{ width: 20, height: 20, color: C.accent }} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.text, marginBottom: 6 }}>Practice Mode</div>
          <div style={{ fontSize: 12, color: C.textSec, lineHeight: 1.6, marginBottom: 14 }}>
            Learn at your own pace. Instant answer feedback with explanations after every question.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ padding: '4px 12px', background: C.accentDim, border: `1px solid ${C.accent}30`, borderRadius: 99, fontSize: 11, fontWeight: 700, color: C.accent, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Play style={{ width: 10, height: 10 }} /> Start Practice →
            </span>
            <span style={{ fontSize: 10, color: C.textTert }}>{examYearQs.length} questions</span>
          </div>
        </button>

        {/* Exam Mode */}
        <button onClick={() => startMockExam(selectedExamName, selectedYear)}
          style={{ padding: '22px 24px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 18, cursor: 'pointer', textAlign: 'left', position: 'relative', overflow: 'hidden', transition: 'border-color 0.15s' }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = C.blue + '60')}
          onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${C.blue}, #7C3AED)` }} />
          <div style={{ width: 44, height: 44, borderRadius: 12, background: C.blueDim, border: `1px solid ${C.blue}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
            <ShieldCheck style={{ width: 20, height: 20, color: C.blue }} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.text, marginBottom: 6 }}>Exam Mode</div>
          <div style={{ fontSize: 12, color: C.textSec, lineHeight: 1.6, marginBottom: 14 }}>
            Real exam simulation with a countdown timer. No hints. Submit to see results and explanations.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ padding: '4px 12px', background: C.blueDim, border: `1px solid ${C.blue}30`, borderRadius: 99, fontSize: 11, fontWeight: 700, color: C.blue, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Clock style={{ width: 10, height: 10 }} /> {examDuration} Timer
            </span>
            <span style={{ fontSize: 10, color: C.textTert }}>{examYearQs.length} questions</span>
          </div>
        </button>
      </div>

      {/* ── Subject Breakdown ───────────────────────────────────────────────── */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 18, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${C.border}` }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Subject Breakdown</div>
            <div style={{ fontSize: 12, color: C.textSec }}>{selectedCommission} {selectedExamType} {selectedYear}</div>
          </div>
          <button onClick={() => browseWithFilters()}
            style={{ padding: '7px 14px', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 12, fontWeight: 600, color: C.textSec, cursor: 'pointer' }}>
            Browse All
          </button>
        </div>

        {weightage.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: C.textTert, fontSize: 13 }}>No data for selected year</div>
        ) : (
          <div>
            {weightage.map((subData, si) => {
              const isExpanded = expandedSubjects[subData.subject];
              const color = COLORS[si % COLORS.length];
              return (
                <div key={subData.subject} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingRight: 16 }}>
                    <button onClick={() => setExpandedSubjects(p => ({ ...p, [subData.subject]: !p[subData.subject] }))}
                      style={{ flex: 1, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 14, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                      <div style={{ width: 12, height: 12, borderRadius: '50%', background: color, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                          <span style={{ fontWeight: 600, color: C.text, fontSize: 14 }}>{subData.subject}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: C.textSec, fontFamily: "'DM Mono', monospace" }}>{subData.count} Q</span>
                            <span style={{ fontSize: 11, fontWeight: 800, color: '#000', background: color, padding: '2px 8px', borderRadius: 6 }}>{subData.pct}%</span>
                            {isExpanded ? <ChevronUp style={{ width: 14, height: 14, color: C.textTert }} /> : <ChevronDown style={{ width: 14, height: 14, color: C.textTert }} />}
                          </div>
                        </div>
                        <div style={{ height: 4, background: C.border, borderRadius: 99, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${subData.pct}%`, background: color, borderRadius: 99 }} />
                        </div>
                      </div>
                    </button>
                    <button onClick={() => startPractice(selectedExamName, selectedYear, subData.subject)}
                      style={{ padding: '6px 12px', background: C.accentDim, border: `1px solid ${C.accent}30`, borderRadius: 8, fontSize: 11, fontWeight: 700, color: C.accent, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      <Play style={{ width: 10, height: 10 }} /> Practice
                    </button>
                  </div>

                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
                        style={{ overflow: 'hidden', background: C.bg, borderTop: `1px solid ${C.border}` }}>
                        {subData.topics.map(topData => (
                          <div key={topData.topic} style={{ display: 'flex', alignItems: 'center', padding: '10px 20px 10px 48px', borderBottom: `1px solid ${C.border}`, gap: 12 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                                <span style={{ fontSize: 13, color: C.textSec, fontWeight: 500 }}>{topData.topic}</span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <span style={{ fontSize: 11, color: C.textTert, fontFamily: "'DM Mono', monospace" }}>{topData.count} Q</span>
                                  <span style={{ fontSize: 10, fontWeight: 700, color: C.textTert, background: C.surface, padding: '1px 6px', borderRadius: 4 }}>{topData.pct}%</span>
                                </div>
                              </div>
                              <div style={{ height: 3, background: C.border, borderRadius: 99, overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${topData.pct}%`, background: C.textTert, borderRadius: 99 }} />
                              </div>
                            </div>
                            <button onClick={() => startPractice(selectedExamName, selectedYear, subData.subject, topData.topic)}
                              style={{ padding: '4px 10px', background: 'none', border: `1px solid ${C.border}`, borderRadius: 7, fontSize: 10, fontWeight: 700, color: C.textSec, cursor: 'pointer', flexShrink: 0 }}>
                              Practice
                            </button>
                          </div>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
