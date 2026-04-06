import React from 'react';
import { ArrowLeft, ChevronRight, RotateCcw, Loader2, Brain, Pencil } from 'lucide-react';
import { motion } from 'motion/react';
import { C, diffColor, diffBg } from '../lib/tokens';
import { type Question, type View } from '../types';

interface PracticeViewProps {
  practiceQueue: Question[];
  practiceIndex: number;
  practiceAnswered: boolean;
  practiceSelectedOption: string | null;
  practiceAnswerLoading: boolean;
  practiceSubject: string;
  practiceTopic: string;
  selectedExamName: string;
  selectedExamType: string;
  selectedYear: number;
  questions: Question[];
  currentPracticeQ: Question | null;
  isAdmin: boolean;
  sessionAnswers: (null | { selected: string; correct: boolean })[];
  handleAnswerSelect: (key: string) => void;
  nextPracticeQuestion: () => void;
  prevPracticeQuestion: () => void;
  jumpToPracticeQuestion: (i: number) => void;
  startPractice: (examName: string, year: number, subject?: string, topic?: string) => void;
  setView: (v: View) => void;
  setEditQuestion: (q: Question) => void;
}

export function PracticeView({
  practiceQueue, practiceIndex, practiceAnswered, practiceSelectedOption, practiceAnswerLoading,
  practiceSubject, practiceTopic,
  selectedExamName, selectedExamType, selectedYear, questions,
  currentPracticeQ, isAdmin, sessionAnswers, handleAnswerSelect, nextPracticeQuestion, prevPracticeQuestion,
  jumpToPracticeQuestion, startPractice, setView, setEditQuestion,
}: PracticeViewProps) {

  if (!practiceQueue.length) return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '80px 16px', textAlign: 'center' }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>📂</div>
      <h3 style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 22, fontWeight: 400, color: C.text, marginBottom: 8 }}>No questions found</h3>
      <p style={{ fontSize: 13, color: C.textSec, marginBottom: 24 }}>Try adjusting your subject or topic filters.</p>
      <button onClick={() => setView('exam-detail')}
        style={{ padding: '9px 18px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, color: C.textSec, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: "'DM Sans', system-ui, sans-serif" }}>
        <ArrowLeft style={{ width: 14, height: 14 }} /> Back
      </button>
    </div>
  );

  const q = currentPracticeQ!;
  const progress = ((practiceIndex + 1) / practiceQueue.length) * 100;
  const allExamQs = questions.filter(x => x.exam === selectedExamName && x.year === selectedYear);
  const availSubjects = [...new Set(allExamQs.map(x => x.subject))].sort();
  const availTopics = practiceSubject === 'All'
    ? [...new Set(allExamQs.map(x => x.topic))].sort()
    : [...new Set(allExamQs.filter(x => x.subject === practiceSubject).map(x => x.topic))].sort();

  const optionState = (key: string) => {
    if (!practiceAnswered) return practiceSelectedOption === key ? 'selected' : 'idle';
    if (q.answer === key) return 'correct';
    if (practiceSelectedOption === key) return 'wrong';
    return 'dim';
  };

  const diffClass: Record<string, { bg: string; color: string }> = {
    Easy:   { bg: 'rgba(52,211,153,0.12)',  color: '#34d399' },
    Medium: { bg: 'rgba(251,191,36,0.12)',  color: C.warn },
    Hard:   { bg: 'rgba(248,113,113,0.12)', color: C.danger },
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 240px', gap: 20, alignItems: 'start' }}>
      <div>

      {/* ── Focus bar ─────────────────────────────────────────────────────────── */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '12px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 20 }}>
        <button onClick={() => setView('exam-detail')}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.textSec, cursor: 'pointer', background: 'none', border: 'none', padding: '4px 0', fontFamily: "'DM Sans', system-ui, sans-serif", transition: 'color 0.15s', flexShrink: 0 }}
          onMouseEnter={e => e.currentTarget.style.color = C.text}
          onMouseLeave={e => e.currentTarget.style.color = C.textSec}>
          <ArrowLeft style={{ width: 14, height: 14 }} /> Back
        </button>
        <div style={{ width: 1, height: 20, background: C.border }} />
        <span style={{ fontSize: 12, fontFamily: "'DM Mono', monospace", color: C.textSec, whiteSpace: 'nowrap', flexShrink: 0 }}>
          {practiceIndex + 1} of {practiceQueue.length}
        </span>
        <div style={{ flex: 1, height: 4, background: 'var(--c-surface3)', borderRadius: 4, overflow: 'hidden' }}>
          <motion.div style={{ height: '100%', background: C.accent, borderRadius: 4 }}
            initial={{ width: 0 }} animate={{ width: `${progress}%` }} transition={{ duration: 0.3 }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#34d399', flexShrink: 0 }}>
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#34d399' }} />
          Practice
        </div>
        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, marginLeft: 4 }}>
          {[
            { val: practiceSubject, onChange: (v: string) => startPractice(selectedExamName, selectedYear, v, 'All'), options: ['All', ...availSubjects], placeholder: 'All Subjects' },
            { val: practiceTopic, onChange: (v: string) => startPractice(selectedExamName, selectedYear, practiceSubject, v), options: ['All', ...availTopics], placeholder: 'All Topics' },
          ].map((sel, i) => (
            <select key={i} value={sel.val} onChange={e => sel.onChange(e.target.value)}
              style={{ fontSize: 11, background: 'var(--c-surface3)', border: `1px solid ${C.border}`, borderRadius: 6, padding: '5px 10px', color: C.textSec, cursor: 'pointer', maxWidth: 120, fontFamily: "'DM Sans', system-ui, sans-serif" }}>
              <option value="All">{sel.placeholder}</option>
              {sel.options.filter(o => o !== 'All').map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          ))}
        </div>
      </div>

      {/* ── Question card ─────────────────────────────────────────────────────── */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 18, padding: '28px 28px', marginBottom: 16, transition: 'border-color 0.15s' }}>

        {/* Tags + admin edit */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ padding: '3px 10px', background: 'rgba(96,165,250,0.12)', color: C.blue, fontSize: 10, fontWeight: 700, borderRadius: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {q.subject}
            </span>
            <span style={{ padding: '3px 10px', background: 'var(--c-surface3)', color: C.textSec, fontSize: 10, borderRadius: 8 }}>
              {q.topic}
            </span>
            {q.subtopic && (
              <span style={{ padding: '3px 10px', background: 'var(--c-surface3)', color: C.textTert, fontSize: 10, borderRadius: 8 }}>
                {q.subtopic}
              </span>
            )}
            <span style={{ padding: '3px 10px', background: diffBg[q.difficulty] || 'var(--c-surface3)', color: diffColor[q.difficulty] || C.textSec, fontSize: 10, fontWeight: 600, borderRadius: 8 }}>
              {q.difficulty}
            </span>
          </div>
          {isAdmin && (
            <button onClick={() => setEditQuestion(q)}
              style={{ padding: 7, background: 'var(--c-surface3)', border: `1px solid ${C.border}`, borderRadius: 6, cursor: 'pointer', color: C.textTert, display: 'flex', flexShrink: 0, transition: 'all 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.accent; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textTert; }}>
              <Pencil style={{ width: 13, height: 13 }} />
            </button>
          )}
        </div>

        {/* Passage */}
        {q.passage && (
          <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.20)', marginBottom: 16 }}>
            <p style={{ fontSize: 9, fontWeight: 700, color: C.blue, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Passage</p>
            <p style={{ fontSize: 13, color: C.textSec, lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>{q.passage}</p>
          </div>
        )}

        {/* Question text */}
        <p style={{ fontSize: 15, fontWeight: 300, color: C.text, lineHeight: 1.8, marginBottom: 24, whiteSpace: 'pre-wrap' }}>{q.question}</p>

        {/* Options */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
          {Object.entries(q.options).map(([key, val]) => {
            const state = optionState(key);
            const styles: Record<string, React.CSSProperties> = {
              idle:     { border: `1px solid ${C.border}`,           background: 'var(--c-bg)',  keyBg: 'var(--c-surface3)',  keyColor: C.textSec,  textColor: C.text } as any,
              selected: { border: '1px solid rgba(45,212,191,0.40)', background: 'rgba(45,212,191,0.10)', keyBg: '#2dd4bf', keyColor: '#0a1a18', textColor: C.text } as any,
              correct:  { border: '1px solid rgba(52,211,153,0.40)', background: 'rgba(52,211,153,0.10)', keyBg: '#34d399', keyColor: '#0a1a18', textColor: C.text } as any,
              wrong:    { border: '1px solid rgba(248,113,113,0.40)', background: 'rgba(248,113,113,0.10)', keyBg: '#f87171', keyColor: '#0a1a18', textColor: C.text } as any,
              dim:      { border: `1px solid ${C.border}`,           background: 'transparent',  keyBg: 'var(--c-surface3)',  keyColor: C.textTert, textColor: C.textTert } as any,
            };
            const s = styles[state] as any;
            const isAnswerKey = practiceAnswered && q.answer === key;
            const isWrongKey = practiceAnswered && practiceSelectedOption === key && q.answer !== key;
            return (
              <button key={key}
                disabled={practiceAnswered || practiceAnswerLoading}
                onClick={() => handleAnswerSelect(key)}
                style={{ width: '100%', padding: '14px 16px', borderRadius: 10, border: s.border, background: s.background, cursor: practiceAnswered ? 'default' : 'pointer', display: 'flex', alignItems: 'flex-start', gap: 14, textAlign: 'left', transition: 'all 0.15s', userSelect: 'none' }}
                onMouseEnter={e => { if (!practiceAnswered && state === 'idle') e.currentTarget.style.borderColor = 'var(--c-border-l)'; }}
                onMouseLeave={e => { if (!practiceAnswered && state === 'idle') e.currentTarget.style.borderColor = C.border; }}>
                <div style={{ width: 26, height: 26, borderRadius: 6, background: s.keyBg, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 500, fontSize: 11, fontFamily: "'DM Mono', monospace", color: s.keyColor, flexShrink: 0, marginTop: 1, transition: 'all 0.15s' }}>
                  {key}
                </div>
                <span style={{ flex: 1, fontSize: 14, fontWeight: 300, color: s.textColor, lineHeight: 1.6, paddingTop: 2 }}>{val}</span>
                {isAnswerKey && <span style={{ fontSize: 14, flexShrink: 0, paddingTop: 2 }}>✓</span>}
                {isWrongKey && <span style={{ fontSize: 14, flexShrink: 0, paddingTop: 2 }}>✗</span>}
              </button>
            );
          })}
        </div>

        {practiceAnswerLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.blue, fontSize: 13, marginBottom: 16 }}>
            <Loader2 style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} /> Checking...
          </div>
        )}

        {/* Skip when unanswered */}
        {!practiceAnswered && !practiceAnswerLoading && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            {practiceIndex < practiceQueue.length - 1 ? (
              <button onClick={nextPracticeQuestion}
                style={{ padding: '8px 16px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, fontWeight: 500, color: C.textSec, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: "'DM Sans', system-ui, sans-serif" }}>
                Skip <ChevronRight style={{ width: 14, height: 14 }} />
              </button>
            ) : (
              <button onClick={() => setView('exam-detail')}
                style={{ padding: '8px 16px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, fontWeight: 500, color: C.textSec, cursor: 'pointer', fontFamily: "'DM Sans', system-ui, sans-serif" }}>
                Done
              </button>
            )}
          </div>
        )}

        {/* Answer reveal + explanation */}
        {practiceAnswered && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            {/* Result banner */}
            <div style={{ padding: '10px 16px', borderRadius: 8, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, fontWeight: 500,
              background: practiceSelectedOption === q.answer ? 'rgba(52,211,153,0.10)' : 'rgba(248,113,113,0.10)',
              color: practiceSelectedOption === q.answer ? '#34d399' : '#f87171',
              border: `1px solid ${practiceSelectedOption === q.answer ? 'rgba(52,211,153,0.25)' : 'rgba(248,113,113,0.25)'}` }}>
              {practiceSelectedOption === q.answer
                ? <><span>✓</span> Correct!</>
                : <><span>✗</span> Incorrect — correct answer is <strong>{q.answer}</strong></>}
            </div>

            {/* Explanation */}
            <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden', marginBottom: 20 }}>
              <div style={{ padding: '10px 16px', background: 'var(--c-surface3)', borderBottom: `1px solid ${C.border}`, fontSize: 11, fontFamily: "'DM Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.06em', color: C.textSec, display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.accent }} />
                Explanation
                {practiceAnswerLoading && <Loader2 style={{ width: 10, height: 10, marginLeft: 4, animation: 'spin 1s linear infinite' }} />}
              </div>
              <div style={{ padding: '16px 20px', fontSize: 13, lineHeight: 1.75, color: C.textSec }}>
                {q.explanation && q.explanation.length > 5 ? (
                  <><Brain style={{ width: 13, height: 13, display: 'inline', marginRight: 6, verticalAlign: 'middle', color: C.accent }} />{q.explanation}</>
                ) : (
                  <span style={{ color: C.textTert, fontStyle: 'italic' }}>No explanation available for this question.</span>
                )}
              </div>
            </div>

            {/* Navigation */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button onClick={prevPracticeQuestion} disabled={practiceIndex === 0}
                style={{ padding: '8px 16px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, fontWeight: 500, color: C.textSec, cursor: practiceIndex === 0 ? 'not-allowed' : 'pointer', opacity: practiceIndex === 0 ? 0.3 : 1, display: 'flex', alignItems: 'center', gap: 6, fontFamily: "'DM Sans', system-ui, sans-serif" }}>
                ← Prev
              </button>
              {practiceIndex < practiceQueue.length - 1 ? (
                <button onClick={nextPracticeQuestion}
                  style={{ padding: '9px 20px', background: C.accent, border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700, color: '#0a1a18', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontFamily: "'DM Sans', system-ui, sans-serif" }}>
                  Next Question →
                </button>
              ) : (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => startPractice(selectedExamName, selectedYear, practiceSubject, practiceTopic)}
                    style={{ padding: '8px 16px', background: 'var(--c-surface3)', border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, fontWeight: 500, color: C.textSec, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: "'DM Sans', system-ui, sans-serif" }}>
                    <RotateCcw style={{ width: 13, height: 13 }} /> Restart
                  </button>
                  <button onClick={() => setView('exam-detail')}
                    style={{ padding: '8px 16px', background: C.accent, border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700, color: '#0a1a18', cursor: 'pointer', fontFamily: "'DM Sans', system-ui, sans-serif" }}>
                    Done
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </div>

      {/* ── Q progress dots ───────────────────────────────────────────────────── */}
      {practiceQueue.length <= 30 && (
        <div style={{ display: 'flex', gap: 5, justifyContent: 'center', flexWrap: 'wrap' }}>
          {practiceQueue.map((_, i) => (
            <div key={i} style={{ height: 5, borderRadius: 99, transition: 'all 0.2s',
              width: i === practiceIndex ? 18 : 5,
              background: i === practiceIndex ? C.accent : i < practiceIndex ? 'rgba(45,212,191,0.40)' : 'var(--c-surface3)' }} />
          ))}
        </div>
      )}
      </div>

      {/* ── Side panel ── */}
      {practiceQueue.length > 0 && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '20px 16px', position: 'sticky', top: 0 }}>

          {/* Q navigator */}
          <div style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.06em', color: C.textTert, marginBottom: 12 }}>Questions</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4, marginBottom: 20 }}>
            {practiceQueue.map((_, i) => {
              const ans = sessionAnswers[i];
              let bg = 'var(--c-surface3)', color = C.textSec, border = `1px solid ${C.border}`;
              if (i === practiceIndex) { bg = '#2dd4bf'; color = '#0a1a18'; border = '1px solid #2dd4bf'; }
              else if (ans?.correct) { bg = 'rgba(52,211,153,0.12)'; color = '#34d399'; border = '1px solid rgba(52,211,153,0.25)'; }
              else if (ans && !ans.correct) { bg = 'rgba(248,113,113,0.12)'; color = '#f87171'; border = '1px solid rgba(248,113,113,0.25)'; }
              return (
                <button key={i} onClick={() => jumpToPracticeQuestion(i)}
                  style={{ aspectRatio: '1', borderRadius: 6, background: bg, border, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontFamily: "'DM Mono', monospace", color, cursor: 'pointer', transition: 'all 0.15s' }}>
                  {i + 1}
                </button>
              );
            })}
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: C.border, margin: '0 0 16px' }} />

          {/* Session stats */}
          <div style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.06em', color: C.textTert, marginBottom: 12 }}>Session</div>
          {(() => {
            const correct = sessionAnswers.filter(a => a?.correct).length;
            const incorrect = sessionAnswers.filter(a => a && !a.correct).length;
            const answered = correct + incorrect;
            const acc = answered > 0 ? Math.round((correct / answered) * 100) : 0;
            const xpEarned = correct * 10 + incorrect * 2;
            return [
              { label: 'Correct',   val: String(correct),   cls: 'ok'  },
              { label: 'Incorrect', val: String(incorrect),  cls: 'err' },
              { label: 'Accuracy',  val: answered > 0 ? `${acc}%` : '—', cls: 'info' },
              { label: 'XP earned', val: `+${xpEarned}`,    cls: 'a'   },
            ].map(({ label, val, cls }) => {
              const clsColor: Record<string, string> = { ok: '#34d399', err: '#f87171', info: '#60a5fa', a: '#2dd4bf' };
              return (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
                  <span style={{ color: C.textSec }}>{label}</span>
                  <span style={{ fontFamily: "'DM Mono', monospace", fontWeight: 500, color: clsColor[cls] || C.text }}>{val}</span>
                </div>
              );
            });
          })()}
        </div>
      )}
    </div>
  );
}
