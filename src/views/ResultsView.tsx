import React, { useState, useEffect, useRef } from 'react';
import {
  Trophy, RotateCcw, ArrowLeft, CheckCircle2, XCircle, MinusCircle,
  ChevronDown, ChevronRight, BookOpen, Loader2,
} from 'lucide-react';
import { motion } from 'motion/react';
import { C } from '../lib/tokens';
import {
  formatAcceptedAnswerDetails,
  getAcceptedAnswers,
  isAcceptedAnswer,
  isDeletedQuestion,
} from '../lib/questionAnswers';
import { formatTime } from '../lib/utils';
import { API_BASE } from '../lib/api';
import {
  BLOCKED_EXPLANATION,
  UNAVAILABLE_EXPLANATION,
  DELETED_QUESTION_NOTE,
  MULTIPLE_ANSWERS_NOTE,
} from './practice/practiceUtils';
import { type ExamSession, type View } from '../types';

interface ResultsViewProps {
  examSession: ExamSession;
  examTimer: number;
  startMockExam: (examName: string, year: number) => void;
  setExamSession: (s: ExamSession | null) => void;
  loadMoreResults: () => Promise<void>;
  setView: (v: View) => void;
}

type TopicRow = { topic: string; total: number; correct: number; wrong: number; skipped: number };
type SubjectRow = { subject: string; total: number; correct: number; wrong: number; skipped: number; topics: TopicRow[] };

const COLORS = ['#F5A623','#7C6EF5','#2BBFFF','#22c55e','#FF6B6B','#FF8C42','#2dd4bf','#a78bfa','#fb7185','#34d399'];

function pct(c: number, t: number) { return t === 0 ? 0 : Math.round((c / t) * 100); }
function accColor(c: number, t: number) {
  const p = pct(c, t);
  return p >= 60 ? '#00af9b' : p >= 40 ? C.warn : C.danger;
}
function accBg(c: number, t: number) {
  const p = pct(c, t);
  return p >= 60 ? '#d1fae5' : p >= 40 ? C.warnDim : C.dangerDim;
}

export function ResultsView({ examSession, examTimer, startMockExam, setExamSession, loadMoreResults, setView }: ResultsViewProps) {
  const { questions: qs, answers, examName, year, duration } = examSession;
  const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(new Set());
  const [explanations, setExplanations] = useState<Record<string, string>>({});
  const [loadingExp, setLoadingExp] = useState<Set<string>>(new Set());
  const [visibleCount, setVisibleCount] = useState(20);
  const [loadingMoreResults, setLoadingMoreResults] = useState(false);

  useEffect(() => {
    setVisibleCount((prev) => Math.min(Math.max(prev, 20), qs.length || 20));
  }, [qs.length, examName, year]);

  const fetchBatchExplanations = async (questionIds: string[]) => {
    const merged: Record<string, string> = {};
    for (let i = 0; i < questionIds.length; i += 50) {
      const chunk = questionIds.slice(i, i + 50);
      if (!chunk.length) continue;
      const res = await fetch(`${API_BASE}/explanations/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question_ids: chunk }),
      });
      if (!res.ok) continue;
      const data: Record<string, string> = await res.json();
      Object.assign(merged, data || {});
    }
    return merged;
  };

  // Auto-prefetch explanations for all questions as soon as results mount.
  // Phase 1: load already-generated explanations in batches.
  // Phase 2: generate only the remaining missing ones with light concurrency.
  const prefetchDoneRef = useRef(false);
  useEffect(() => {
    if (prefetchDoneRef.current) return;
    prefetchDoneRef.current = true;
    const CONCURRENCY = 3;
    const work = qs
      .filter(q => q.id && (!q.explanation || q.explanation.length <= 5))
      .map(q => q.id!);
    if (!work.length) return;
    void (async () => {
      let cached: Record<string, string> = {};
      try {
        cached = await fetchBatchExplanations(work);
        if (Object.keys(cached).length) {
          setExplanations(prev => ({ ...prev, ...cached }));
        }
      } catch {
        // continue with generation requests
      }

      const missing = work.filter(id => !Object.prototype.hasOwnProperty.call(cached, id));
      let i = 0;
      const next = async () => {
        if (i >= missing.length) return;
        const id = missing[i++];
        setLoadingExp(prev => new Set(prev).add(id));
        try {
          const res = await fetch(`${API_BASE}/explanation/${id}`);
          if (res.ok) {
            const d = await res.json();
            const source = (d.source || '').toString();
            const expl = (d.explanation || '').trim();
            if (source === 'blocked-unverified-answer') {
              setExplanations(prev => ({ ...prev, [id]: BLOCKED_EXPLANATION }));
            } else if (source === 'deleted-question') {
              setExplanations(prev => ({ ...prev, [id]: DELETED_QUESTION_NOTE }));
            } else if (source === 'multiple-correct-answers') {
              setExplanations(prev => ({ ...prev, [id]: MULTIPLE_ANSWERS_NOTE }));
            } else if (source === 'hidden-contradiction') {
              setExplanations(prev => ({ ...prev, [id]: UNAVAILABLE_EXPLANATION }));
            } else if (expl) {
              setExplanations(prev => ({ ...prev, [id]: expl }));
            } else {
              setExplanations(prev => ({ ...prev, [id]: UNAVAILABLE_EXPLANATION }));
            }
          } else {
            setExplanations(prev => ({ ...prev, [id]: 'failed' }));
          }
        } catch {
          setExplanations(prev => ({ ...prev, [id]: 'failed' }));
        } finally {
          setLoadingExp(prev => { const n = new Set(prev); n.delete(id); return n; });
          next();
        }
      };
      for (let w = 0; w < CONCURRENCY; w++) next();
    })();
  }, []);

  // ── Core stats ──────────────────────────────────────────────────────────────
  const deletedQuestionCount = qs.filter((question) => isDeletedQuestion(question)).length;
  const totalQuestions = Math.max((examSession.totalCount || qs.length) - deletedQuestionCount, 0);
  const correct = qs.reduce((count, question, index) => {
    if (isDeletedQuestion(question) || !answers[index]) return count;
    return count + (isAcceptedAnswer(question, answers[index]) ? 1 : 0);
  }, 0);
  const attempted = qs.reduce((count, question, index) => {
    if (isDeletedQuestion(question) || !answers[index]) return count;
    return count + 1;
  }, 0);
  const wrong = attempted - correct;
  const skipped = Math.max(totalQuestions - attempted, 0);
  const accuracy = attempted > 0 ? Math.round((correct / attempted) * 100) : 0;
  const timeTaken = duration - examTimer;
  const scorePct = totalQuestions > 0 ? Math.round((correct / totalQuestions) * 100) : 0;
  const visibleQs = qs.slice(0, visibleCount);

  // ── Build subject → topic breakdown ─────────────────────────────────────────
  const subjectMap: Record<string, SubjectRow> = {};
  qs.forEach((q, i) => {
    if (isDeletedQuestion(q)) return;
    const isCorrect = !!answers[i] && isAcceptedAnswer(q, answers[i]);
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
      const res = await fetch(`${API_BASE}/explanation/${qId}`);
      if (res.ok) {
        const d = await res.json();
        const source = (d.source || '').toString();
        const expl = (d.explanation || '').trim();
        setExplanations(prev => ({
          ...prev,
          [qId]:
            source === 'blocked-unverified-answer'
              ? BLOCKED_EXPLANATION
              : source === 'deleted-question'
              ? DELETED_QUESTION_NOTE
              : source === 'multiple-correct-answers'
              ? MULTIPLE_ANSWERS_NOTE
              : source === 'hidden-contradiction'
              ? UNAVAILABLE_EXPLANATION
              : expl || UNAVAILABLE_EXPLANATION,
        }));
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
    <div className="results-shell" style={{ maxWidth: 900, margin: '0 auto', paddingBottom: 60 }}>

      {/* ── Score Hero ──────────────────────────────────────────────────────── */}
      <motion.div className="results-hero" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
        style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 20, padding: '28px 24px', textAlign: 'center', marginBottom: 16 }}>

        <div style={{ width: 64, height: 64, borderRadius: 18, background: '#dbeafe', border: '2px solid #2563eb40', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
          <Trophy style={{ width: 34, height: 34, color: '#2563eb' }} />
        </div>

        <div style={{ fontSize: 52, fontWeight: 800, color: C.text, fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>
          {correct}<span style={{ fontSize: 26, color: C.textSec }}>/{totalQuestions}</span>
        </div>
        <div style={{ fontSize: 13, color: C.textSec, marginTop: 4, marginBottom: 20 }}>{examName} · {year}</div>

        {/* Score progress bar */}
        <div style={{ height: 8, background: C.border, borderRadius: 99, overflow: 'hidden', maxWidth: 440, margin: '0 auto 20px' }}>
          <motion.div initial={{ width: 0 }} animate={{ width: `${scorePct}%` }} transition={{ duration: 1, ease: 'easeOut' }}
            style={{ height: '100%', borderRadius: 99,
              background: scorePct >= 60
                ? 'linear-gradient(90deg, #00af9b, #34d399)'
                : scorePct >= 40
                  ? `linear-gradient(90deg, ${C.warn}, #f59e0b)`
                  : `linear-gradient(90deg, ${C.danger}, #fb923c)` }} />
        </div>

        <div className="results-score-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, maxWidth: 560, margin: '0 auto' }}>
          {[
            { label: 'Correct',  value: correct,             color: '#00af9b' },
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
      <motion.div className="results-breakdown-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 18, overflow: 'hidden', marginBottom: 16 }}>

        {/* Table header */}
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Subject & Topic Breakdown</div>
          <div style={{ fontSize: 11, color: C.textTert, marginTop: 2 }}>Tap any subject row to see topic details</div>
        </div>

        {/* Column labels */}
        <div className="results-breakdown-grid results-breakdown-head" style={{ display: 'grid', gridTemplateColumns: '1fr 48px 48px 48px 48px 80px', padding: '8px 18px', background: C.bg, borderBottom: `1px solid ${C.border}`, gap: 4 }}>
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
              <button className="results-breakdown-grid results-breakdown-row" onClick={() => toggleSubject(s.subject)}
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
                <div style={numCell(s.correct, '#00af9b')}>{s.correct}</div>
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
                <div className="results-breakdown-grid results-breakdown-topic" key={t.topic}
                  style={{ display: 'grid', gridTemplateColumns: '1fr 48px 48px 48px 48px 80px', gap: 4,
                    padding: '9px 18px 9px 48px', background: C.bg, borderTop: `1px solid ${C.border}`, alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 4, height: 4, borderRadius: '50%', background: color, opacity: 0.5, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: C.textSec, fontWeight: 500 }}>{t.topic}</span>
                  </div>
                  <div style={numCell(t.total, C.textSec)}>{t.total}</div>
                  <div style={numCell(t.correct, '#00af9b')}>{t.correct}</div>
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
          {visibleQs.map((q, i) => {
            const deleted = isDeletedQuestion(q);
            const selectedAnswer = answers[i] || '';
            const acceptedAnswers = getAcceptedAnswers(q);
            const multipleAnswers = acceptedAnswers.length > 1;
            const isCorrect = !deleted && !!selectedAnswer && isAcceptedAnswer(q, selectedAnswer);
            const isAttempted = !!answers[i];
            const borderColor = deleted ? C.blue : isCorrect ? '#00af9b' : isAttempted ? C.danger : C.border;
            const Icon = deleted ? MinusCircle : isCorrect ? CheckCircle2 : isAttempted ? XCircle : MinusCircle;
            const expText = q.id ? explanations[q.id] : undefined;
            const isLoadingThisExp = q.id ? loadingExp.has(q.id) : false;
            const specialExplanation = deleted
              ? DELETED_QUESTION_NOTE
              : multipleAnswers
              ? MULTIPLE_ANSWERS_NOTE
              : null;
            const hasExplanationInline = !!(
              q.explanation &&
              q.explanation.length > 5 &&
              q.explanation !== BLOCKED_EXPLANATION &&
              q.explanation !== DELETED_QUESTION_NOTE &&
              q.explanation !== MULTIPLE_ANSWERS_NOTE
            );
            const answerStateLabel = deleted
              ? 'Deleted In Key'
              : isCorrect
              ? 'Correct'
              : isAttempted
              ? 'Wrong'
              : 'Skipped';

            return (
              <div className="results-review-card" key={i} style={{ background: C.surface, border: `1px solid ${C.border}`, borderLeft: `3px solid ${borderColor}`, borderRadius: 12, padding: '14px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, color: C.textTert }}>
                      Q{i + 1} · {q.subject || 'Untagged'} · {q.topic || 'General'}
                    </span>
                    {multipleAnswers && !deleted ? (
                      <span style={{ padding: '2px 8px', borderRadius: 999, background: 'rgba(37,99,235,0.12)', color: C.blue, fontSize: 10, fontWeight: 700 }}>
                        Multi-answer
                      </span>
                    ) : null}
                    {deleted ? (
                      <span style={{ padding: '2px 8px', borderRadius: 999, background: 'rgba(37,99,235,0.12)', color: C.blue, fontSize: 10, fontWeight: 700 }}>
                        Deleted in key
                      </span>
                    ) : null}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, fontSize: 11, fontWeight: 700,
                    color: deleted ? C.blue : isCorrect ? '#00af9b' : isAttempted ? C.danger : C.textTert }}>
                    <Icon style={{ width: 13, height: 13 }} />
                    {answerStateLabel}
                  </div>
                </div>
                <p style={{ fontSize: 13, color: C.text, marginBottom: 10, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{q.question}</p>
                <div className="results-answer-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                  <div style={{ padding: '10px 12px', borderRadius: 10,
                    background: deleted ? C.blueDim : isAttempted && !isCorrect ? C.dangerDim : C.bg,
                    border: `1px solid ${deleted ? C.blue + '30' : isAttempted && !isCorrect ? C.danger + '40' : C.border}` }}>
                    <p style={{ fontSize: 9, fontWeight: 700, color: C.textTert, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Your Answer</p>
                    <p style={{ fontSize: 12, fontWeight: 700, color: deleted ? C.blue : isCorrect ? '#00af9b' : isAttempted ? C.danger : C.textTert }}>
                      {selectedAnswer ? `${selectedAnswer}: ${q.options[selectedAnswer as keyof typeof q.options]}` : 'Not attempted'}
                    </p>
                  </div>
                  <div style={{ padding: '10px 12px', borderRadius: 10, background: deleted ? C.blueDim : '#d1fae5', border: deleted ? `1px solid ${C.blue}30` : '1px solid rgba(0,175,155,0.25)' }}>
                    <p style={{ fontSize: 9, fontWeight: 700, color: deleted ? C.blue : '#00af9b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                      {deleted ? 'Official Status' : multipleAnswers ? 'Accepted Answers' : 'Correct Answer'}
                    </p>
                    <p style={{ fontSize: 12, fontWeight: 700, color: deleted ? C.blue : '#059669' }}>
                      {deleted
                        ? DELETED_QUESTION_NOTE
                        : multipleAnswers
                        ? formatAcceptedAnswerDetails(q)
                        : q.answer
                        ? `${q.answer}: ${q.options[q.answer as keyof typeof q.options]}`
                        : '—'}
                    </p>
                  </div>
                </div>

                {/* AI-inferred answer disclaimer */}
                {!deleted && q.answerStatus === 'ai_inferred' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderRadius: 8, background: '#fffbeb', border: '1px solid #fcd34d', marginBottom: 8 }}>
                    <span style={{ fontSize: 12 }}>⚠️</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#92400e' }}>AI-inferred answer — no official key available for this paper. Please verify with the official key before relying on this.</span>
                  </div>
                )}

                {/* Explanation */}
                {specialExplanation ? (
                  <div style={{ padding: '10px 12px', borderRadius: 10, background: C.blueDim, border: `1px solid ${C.blue}20` }}>
                    <p style={{ fontSize: 11, color: C.textSec, lineHeight: 1.6 }}>
                      {specialExplanation}
                      {multipleAnswers && !deleted ? ` Accepted answers: ${formatAcceptedAnswerDetails(q)}.` : ''}
                    </p>
                  </div>
                ) : hasExplanationInline ? (
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

      {(visibleCount < qs.length || examSession.hasMore) && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 18 }}>
          <button
            onClick={async () => {
              if (visibleCount < qs.length) {
                setVisibleCount((prev) => Math.min(prev + 20, qs.length));
                return;
              }
              if (!examSession.hasMore || loadingMoreResults) return;
              setLoadingMoreResults(true);
              try {
                const before = qs.length;
                await loadMoreResults();
                setVisibleCount((prev) => Math.max(prev, before + 20));
              } finally {
                setLoadingMoreResults(false);
              }
            }}
            disabled={loadingMoreResults}
            style={{
              padding: '10px 18px',
              background: C.surface,
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 600,
              color: C.text,
              cursor: loadingMoreResults ? 'default' : 'pointer',
              opacity: loadingMoreResults ? 0.7 : 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {loadingMoreResults ? <Loader2 style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} /> : null}
            {visibleCount < qs.length ? 'Show Next 20 Questions' : 'Load Next 20 Questions'}
          </button>
        </div>
      )}

      {/* ── Actions ─────────────────────────────────────────────────────────── */}
      <div className="results-actions" style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 24 }}>
        <button onClick={() => { setExamSession(null); startMockExam(examSession.examName, examSession.year); }}
          style={{ padding: '10px 22px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 13, fontWeight: 600, color: C.textSec, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
          <RotateCcw style={{ width: 14, height: 14 }} /> Retry
        </button>
        <button onClick={() => { setExamSession(null); setView('exam-detail'); }}
          style={{ padding: '10px 22px', background: '#2563eb', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
          <ArrowLeft style={{ width: 14, height: 14 }} /> Back to Exam
        </button>
      </div>
    </div>
  );
}
