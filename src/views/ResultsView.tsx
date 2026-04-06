import React, { useState } from 'react';
import {
  Trophy, RotateCcw, ArrowLeft, CheckCircle2, XCircle, MinusCircle,
  ChevronDown, ChevronRight, BookOpen, Loader2,
} from 'lucide-react';
import { motion } from 'motion/react';
import { C } from '../lib/tokens';
import { formatTime } from '../lib/utils';
import { type ExamSession, type View } from '../types';

interface ResultsViewProps {
  examSession: ExamSession;
  examTimer: number;
  startMockExam: (examName: string, year: number) => void;
  setExamSession: (s: ExamSession | null) => void;
  setView: (v: View) => void;
}

type TopicRow = { topic: string; total: number; correct: number; wrong: number; skipped: number };
type SubjectRow = { subject: string; total: number; correct: number; wrong: number; skipped: number; topics: TopicRow[] };

const COLORS = ['#F5A623','#7C6EF5','#2BBFFF','#22c55e','#FF6B6B','#FF8C42','#2dd4bf','#a78bfa','#fb7185','#34d399'];

function pct(c: number, t: number) { return t === 0 ? 0 : Math.round((c / t) * 100); }
function accColor(c: number, t: number) {
  const p = pct(c, t);
  return p >= 60 ? C.accent : p >= 40 ? C.warn : C.danger;
}
function accBg(c: number, t: number) {
  const p = pct(c, t);
  return p >= 60 ? C.accentDim : p >= 40 ? C.warnDim : C.dangerDim;
}

export function ResultsView({ examSession, examTimer, startMockExam, setExamSession, setView }: ResultsViewProps) {
  const { questions: qs, answers, examName, year, duration } = examSession;
  const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(new Set());
  const [explanations, setExplanations] = useState<Record<string, string>>({});
  const [loadingExp, setLoadingExp] = useState<Set<string>>(new Set());

  // ── Core stats ──────────────────────────────────────────────────────────────
  const correct = qs.reduce((a, q, i) => a + (answers[i] === q.answer ? 1 : 0), 0);
  const attempted = Object.keys(answers).length;
  const wrong = attempted - correct;
  const skipped = qs.length - attempted;
  const accuracy = attempted > 0 ? Math.round((correct / attempted) * 100) : 0;
  const timeTaken = duration - examTimer;
  const scorePct = Math.round((correct / qs.length) * 100);

  // ── Build subject → topic breakdown ─────────────────────────────────────────
  const subjectMap: Record<string, SubjectRow> = {};
  qs.forEach((q, i) => {
    const isCorrect = answers[i] === q.answer;
    const isAttempted = !!answers[i];
    const sub = q.subject || 'Untagged';
    const top = q.topic || 'General';

    if (!subjectMap[sub]) subjectMap[sub] = { subject: sub, total: 0, correct: 0, wrong: 0, skipped: 0, topics: [] };
    const s = subjectMap[sub];
    s.total++;
    if (isCorrect) s.correct++; else if (isAttempted) s.wrong++; else s.skipped++;

    let t = s.topics.find(x => x.topic === top);
    if (!t) { t = { topic: top, total: 0, correct: 0, wrong: 0, skipped: 0 }; s.topics.push(t); }
    t.total++;
    if (isCorrect) t.correct++; else if (isAttempted) t.wrong++; else t.skipped++;
  });

  const sortedSubjects = Object.values(subjectMap).sort((a, b) => b.total - a.total);

  // ── Lazy explanation loader ──────────────────────────────────────────────────
  const loadExplanation = async (qId: string) => {
    if (!qId || loadingExp.has(qId)) return;
    setLoadingExp(prev => new Set(prev).add(qId));
    try {
      const res = await fetch(`http://localhost:8000/explanation/${qId}`);
      if (res.ok) {
        const d = await res.json();
        setExplanations(prev => ({ ...prev, [qId]: d.explanation || 'No explanation available.' }));
      } else {
        setExplanations(prev => ({ ...prev, [qId]: 'failed' }));
      }
    } catch {
      setExplanations(prev => ({ ...prev, [qId]: 'failed' }));
    } finally {
      setLoadingExp(prev => { const n = new Set(prev); n.delete(qId); return n; });
    }
  };

  const toggleSubject = (sub: string) => {
    setExpandedSubjects(prev => {
      const n = new Set(prev);
      n.has(sub) ? n.delete(sub) : n.add(sub);
      return n;
    });
  };

  // ── Shared table cell style ──────────────────────────────────────────────────
  const numCell = (val: number | string, color: string): React.CSSProperties => ({
    fontSize: 12, fontWeight: 700, color, textAlign: 'center',
    fontFamily: "'DM Mono', monospace",
  });

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', paddingBottom: 60 }}>

      {/* ── Score Hero ──────────────────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
        style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 20, padding: '32px 28px', textAlign: 'center', marginBottom: 16 }}>

        <div style={{ width: 72, height: 72, borderRadius: 20, background: C.accentDim, border: `2px solid ${C.accent}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
          <Trophy style={{ width: 34, height: 34, color: C.accent }} />
        </div>

        <div style={{ fontSize: 52, fontWeight: 800, color: C.text, fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>
          {correct}<span style={{ fontSize: 26, color: C.textSec }}>/{qs.length}</span>
        </div>
        <div style={{ fontSize: 13, color: C.textSec, marginTop: 4, marginBottom: 20 }}>{examName} · {year}</div>

        {/* Score progress bar */}
        <div style={{ height: 8, background: C.border, borderRadius: 99, overflow: 'hidden', maxWidth: 440, margin: '0 auto 20px' }}>
          <motion.div initial={{ width: 0 }} animate={{ width: `${scorePct}%` }} transition={{ duration: 1, ease: 'easeOut' }}
            style={{ height: '100%', borderRadius: 99,
              background: scorePct >= 60
                ? `linear-gradient(90deg, ${C.accent}, #00FFAA)`
                : scorePct >= 40
                  ? `linear-gradient(90deg, ${C.warn}, #f59e0b)`
                  : `linear-gradient(90deg, ${C.danger}, #fb923c)` }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, maxWidth: 560, margin: '0 auto' }}>
          {[
            { label: 'Correct',  value: correct,             color: C.accent },
            { label: 'Wrong',    value: wrong,               color: C.danger },
            { label: 'Skipped',  value: skipped,             color: C.textTert },
            { label: 'Accuracy', value: `${accuracy}%`,      color: accuracy >= 60 ? C.accent : accuracy >= 40 ? C.warn : C.danger },
            { label: 'Time',     value: formatTime(timeTaken), color: C.blue },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ padding: '10px 6px', background: C.bg, borderRadius: 10, border: `1px solid ${C.border}` }}>
              <p style={{ fontSize: 18, fontWeight: 800, color, fontFamily: "'DM Mono', monospace" }}>{value}</p>
              <p style={{ fontSize: 9, color: C.textTert, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>{label}</p>
            </div>
          ))}
        </div>
      </motion.div>

      {/* ── Subject & Topic Breakdown Table ─────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 18, overflow: 'hidden', marginBottom: 16 }}>

        {/* Table header */}
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Subject & Topic Breakdown</div>
          <div style={{ fontSize: 11, color: C.textTert, marginTop: 2 }}>Tap any subject row to see topic details</div>
        </div>

        {/* Column labels */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 48px 48px 48px 48px 80px', padding: '8px 18px', background: C.bg, borderBottom: `1px solid ${C.border}`, gap: 4 }}>
          {['Subject / Topic', 'Total', '✓', '✗', 'Skip', 'Accuracy'].map((h, i) => (
            <div key={h} style={{ fontSize: 10, fontWeight: 700, color: C.textTert, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: i > 0 ? 'center' : 'left' }}>{h}</div>
          ))}
        </div>

        {sortedSubjects.map((s, si) => {
          const color = COLORS[si % COLORS.length];
          const isExpanded = expandedSubjects.has(s.subject);
          const sortedTopics = [...s.topics].sort((a, b) => b.total - a.total);

          return (
            <div key={s.subject} style={{ borderBottom: `1px solid ${C.border}` }}>

              {/* Subject row */}
              <button onClick={() => toggleSubject(s.subject)}
                style={{ width: '100%', display: 'grid', gridTemplateColumns: '1fr 48px 48px 48px 48px 80px', gap: 4,
                  padding: '13px 18px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {isExpanded
                    ? <ChevronDown style={{ width: 13, height: 13, color: C.textTert, flexShrink: 0 }} />
                    : <ChevronRight style={{ width: 13, height: 13, color: C.textTert, flexShrink: 0 }} />}
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{s.subject}</span>
                  {(s.subject === 'Untagged' || s.topics.some(t => t.topic === 'General')) && (
                    <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: C.warnDim, color: C.warn, fontWeight: 700 }}>needs tagging</span>
                  )}
                </div>
                <div style={numCell(s.total, C.text)}>{s.total}</div>
                <div style={numCell(s.correct, C.accent)}>{s.correct}</div>
                <div style={numCell(s.wrong, s.wrong > 0 ? C.danger : C.textTert)}>{s.wrong}</div>
                <div style={numCell(s.skipped, C.textTert)}>{s.skipped}</div>
                <div style={{ textAlign: 'center' }}>
                  <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 800,
                    background: accBg(s.correct, s.total), color: accColor(s.correct, s.total) }}>
                    {pct(s.correct, s.total)}%
                  </span>
                </div>
              </button>

              {/* Topic rows (expanded) */}
              {isExpanded && sortedTopics.map(t => (
                <div key={t.topic}
                  style={{ display: 'grid', gridTemplateColumns: '1fr 48px 48px 48px 48px 80px', gap: 4,
                    padding: '9px 18px 9px 48px', background: C.bg, borderTop: `1px solid ${C.border}`, alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 4, height: 4, borderRadius: '50%', background: color, opacity: 0.5, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: C.textSec, fontWeight: 500 }}>{t.topic}</span>
                  </div>
                  <div style={numCell(t.total, C.textSec)}>{t.total}</div>
                  <div style={numCell(t.correct, C.accent)}>{t.correct}</div>
                  <div style={numCell(t.wrong, t.wrong > 0 ? C.danger : C.textTert)}>{t.wrong}</div>
                  <div style={numCell(t.skipped, C.textTert)}>{t.skipped}</div>
                  <div style={{ textAlign: 'center' }}>
                    <span style={{ padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700,
                      background: accBg(t.correct, t.total), color: accColor(t.correct, t.total) }}>
                      {pct(t.correct, t.total)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </motion.div>

      {/* ── Question Review ──────────────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
          Question Review
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {qs.map((q, i) => {
            const isCorrect = answers[i] === q.answer;
            const isAttempted = !!answers[i];
            const borderColor = isCorrect ? C.accent : isAttempted ? C.danger : C.border;
            const Icon = isCorrect ? CheckCircle2 : isAttempted ? XCircle : MinusCircle;
            const expText = q.id ? explanations[q.id] : undefined;
            const isLoadingThisExp = q.id ? loadingExp.has(q.id) : false;
            const hasExplanationInline = !!(q.explanation && q.explanation.length > 5);

            return (
              <div key={i} style={{ background: C.surface, border: `1px solid ${C.border}`, borderLeft: `3px solid ${borderColor}`, borderRadius: 12, padding: '14px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: C.textTert }}>
                    Q{i + 1} · {q.subject || 'Untagged'} · {q.topic || 'General'}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, fontSize: 11, fontWeight: 700,
                    color: isCorrect ? C.accent : isAttempted ? C.danger : C.textTert }}>
                    <Icon style={{ width: 13, height: 13 }} />
                    {isCorrect ? 'Correct' : isAttempted ? 'Wrong' : 'Skipped'}
                  </div>
                </div>
                <p style={{ fontSize: 13, color: C.text, marginBottom: 10, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{q.question}</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                  <div style={{ padding: '10px 12px', borderRadius: 10,
                    background: isAttempted && !isCorrect ? C.dangerDim : C.bg,
                    border: `1px solid ${isAttempted && !isCorrect ? C.danger + '40' : C.border}` }}>
                    <p style={{ fontSize: 9, fontWeight: 700, color: C.textTert, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Your Answer</p>
                    <p style={{ fontSize: 12, fontWeight: 700, color: isCorrect ? C.accent : isAttempted ? C.danger : C.textTert }}>
                      {answers[i] ? `${answers[i]}: ${q.options[answers[i] as keyof typeof q.options]}` : 'Not attempted'}
                    </p>
                  </div>
                  <div style={{ padding: '10px 12px', borderRadius: 10, background: C.accentDim, border: `1px solid ${C.accent}30` }}>
                    <p style={{ fontSize: 9, fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Correct Answer</p>
                    <p style={{ fontSize: 12, fontWeight: 700, color: C.accent }}>
                      {q.answer ? `${q.answer}: ${q.options[q.answer as keyof typeof q.options]}` : '—'}
                    </p>
                  </div>
                </div>

                {/* Explanation */}
                {hasExplanationInline ? (
                  <div style={{ padding: '10px 12px', borderRadius: 10, background: C.blueDim, border: `1px solid ${C.blue}20` }}>
                    <p style={{ fontSize: 11, color: C.textSec, lineHeight: 1.6 }}>{q.explanation}</p>
                  </div>
                ) : expText !== undefined && expText !== 'failed' ? (
                  <div style={{ padding: '10px 12px', borderRadius: 10, background: C.blueDim, border: `1px solid ${C.blue}20` }}>
                    <p style={{ fontSize: 11, color: C.textSec, lineHeight: 1.6 }}>{expText}</p>
                  </div>
                ) : q.id ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button onClick={() => {
                      if (q.id) {
                        setExplanations(prev => { const n = {...prev}; delete n[q.id!]; return n; });
                        loadExplanation(q.id);
                      }
                    }}
                      disabled={isLoadingThisExp}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px',
                        background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8,
                        fontSize: 11, fontWeight: 600, color: C.textSec,
                        cursor: isLoadingThisExp ? 'default' : 'pointer', opacity: isLoadingThisExp ? 0.6 : 1 }}>
                      {isLoadingThisExp
                        ? <><Loader2 style={{ width: 11, height: 11, animation: 'spin 1s linear infinite' }} /> Generating...</>
                        : <><BookOpen style={{ width: 11, height: 11 }} /> {expText === 'failed' ? 'Retry Explanation' : 'Show Explanation'}</>}
                    </button>
                    {expText === 'failed' && <span style={{ fontSize: 11, color: C.danger }}>Failed to load</span>}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </motion.div>

      {/* ── Actions ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 24 }}>
        <button onClick={() => { setExamSession(null); startMockExam(examSession.examName, examSession.year); }}
          style={{ padding: '10px 22px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 13, fontWeight: 600, color: C.textSec, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
          <RotateCcw style={{ width: 14, height: 14 }} /> Retry
        </button>
        <button onClick={() => { setExamSession(null); setView('exam-detail'); }}
          style={{ padding: '10px 22px', background: C.accent, border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, color: '#0a1a18', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
          <ArrowLeft style={{ width: 14, height: 14 }} /> Back to Exam
        </button>
      </div>
    </div>
  );
}
