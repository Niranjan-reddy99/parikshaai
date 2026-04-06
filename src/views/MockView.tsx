import React from 'react';
import { Clock, ArrowLeft, ChevronRight } from 'lucide-react';
import { C, diffColor, diffBg } from '../lib/tokens';
import { formatTime } from '../lib/utils';
import { type ExamSession } from '../types';

interface MockViewProps {
  examSession: ExamSession;
  setExamSession: (s: ExamSession) => void;
  examTimer: number;
  finishExam: () => void;
}

export function MockView({ examSession, setExamSession, examTimer, finishExam }: MockViewProps) {
  const q = examSession.questions[examSession.currentIndex];
  const answered = Object.keys(examSession.answers).length;
  const total = examSession.questions.length;
  const timerCritical = examTimer < 300;
  const timerWarn = examTimer < 600;

  const selectAnswer = (key: string) =>
    setExamSession({ ...examSession, answers: { ...examSession.answers, [examSession.currentIndex]: key } });

  const goTo = (i: number) =>
    setExamSession({ ...examSession, currentIndex: i });

  const timerColor = timerCritical ? C.danger : timerWarn ? C.warn : C.text;

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* ── Top Bar ─────────────────────────────────────────────────────────── */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          {/* Timer */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock style={{ width: 18, height: 18, color: timerColor }} />
            <span style={{ fontSize: 22, fontWeight: 800, fontFamily: "'DM Mono', monospace", color: timerColor, animation: timerCritical ? 'pulse 1s infinite' : 'none' }}>
              {formatTime(examTimer)}
            </span>
          </div>
          <div style={{ width: 1, height: 24, background: C.border }} />
          <span style={{ fontSize: 13, color: C.textSec }}>
            <span style={{ fontWeight: 700, color: C.text, fontFamily: "'DM Mono', monospace" }}>{answered}</span>/{total} answered
          </span>
          <div style={{ width: 1, height: 24, background: C.border }} />
          <span style={{ fontSize: 13, color: C.textSec }}>
            Q <span style={{ fontWeight: 700, color: C.text, fontFamily: "'DM Mono', monospace" }}>{examSession.currentIndex + 1}</span>/{total}
          </span>
        </div>
        <button onClick={() => { if (window.confirm('Submit exam? This cannot be undone.')) finishExam(); }}
          style={{ padding: '9px 20px', background: C.dangerDim, border: `1px solid ${C.danger}40`, borderRadius: 10, fontSize: 13, fontWeight: 700, color: C.danger, cursor: 'pointer' }}>
          Submit Exam
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: 16, alignItems: 'start' }}>
        {/* ── Question Panel ───────────────────────────────────────────────── */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 18, padding: '28px 24px' }}>
          {/* Tags */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
            <span style={{ padding: '4px 12px', background: C.blueDim, color: C.blue, fontSize: 10, fontWeight: 700, borderRadius: 99, textTransform: 'uppercase' }}>{q.subject}</span>
            <span style={{ padding: '4px 12px', background: diffBg[q.difficulty] || C.bg, color: diffColor[q.difficulty] || C.textSec, fontSize: 10, fontWeight: 700, borderRadius: 99 }}>{q.difficulty}</span>
            {q.subtopic && <span style={{ padding: '4px 12px', background: C.bg, color: C.textTert, fontSize: 10, borderRadius: 99, border: `1px solid ${C.border}` }}>{q.subtopic}</span>}
          </div>

          {/* Passage */}
          {q.passage && (
            <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.20)', marginBottom: 14 }}>
              <p style={{ fontSize: 9, fontWeight: 700, color: C.blue, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Passage</p>
              <p style={{ fontSize: 13, color: C.textSec, lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>{q.passage}</p>
            </div>
          )}

          {/* Question */}
          <p style={{ fontSize: 17, fontWeight: 600, color: C.text, lineHeight: 1.7, marginBottom: 24, whiteSpace: 'pre-wrap' }}>{q.question}</p>

          {/* Options */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
            {Object.entries(q.options).map(([key, val]) => {
              const selected = examSession.answers[examSession.currentIndex] === key;
              return (
                <button key={key} onClick={() => selectAnswer(key)}
                  style={{ width: '100%', padding: '14px 16px', borderRadius: 14, border: `1.5px solid ${selected ? C.blue : C.border}`, background: selected ? C.blueDim : C.bg, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left', transition: 'all 0.15s' }}
                  onMouseEnter={e => { if (!selected) e.currentTarget.style.borderColor = C.borderHover; }}
                  onMouseLeave={e => { if (!selected) e.currentTarget.style.borderColor = C.border; }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: selected ? C.blue + '30' : C.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, color: selected ? C.blue : C.textSec, flexShrink: 0 }}>{key}</div>
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: selected ? C.text : C.textSec, lineHeight: 1.5 }}>{val}</span>
                </button>
              );
            })}
          </div>

          {/* Navigation */}
          <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
            <button disabled={examSession.currentIndex === 0} onClick={() => goTo(examSession.currentIndex - 1)}
              style={{ padding: '9px 18px', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 13, fontWeight: 600, color: C.textSec, cursor: examSession.currentIndex === 0 ? 'not-allowed' : 'pointer', opacity: examSession.currentIndex === 0 ? 0.4 : 1, display: 'flex', alignItems: 'center', gap: 8 }}>
              <ArrowLeft style={{ width: 14, height: 14 }} /> Previous
            </button>
            <button disabled={examSession.currentIndex === total - 1} onClick={() => goTo(examSession.currentIndex + 1)}
              style={{ padding: '9px 18px', background: C.accent, border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, color: '#0a1a18', cursor: examSession.currentIndex === total - 1 ? 'not-allowed' : 'pointer', opacity: examSession.currentIndex === total - 1 ? 0.4 : 1, display: 'flex', alignItems: 'center', gap: 8 }}>
              Next <ChevronRight style={{ width: 14, height: 14 }} />
            </button>
          </div>
        </div>

        {/* ── Question Palette ─────────────────────────────────────────────── */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: '16px', position: 'sticky', top: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.textSec, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Navigator</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 5, marginBottom: 14 }}>
            {examSession.questions.map((_, i) => {
              const isCurrent = examSession.currentIndex === i;
              const isAnswered = !!examSession.answers[i];
              return (
                <button key={i} onClick={() => goTo(i)}
                  style={{ aspectRatio: '1', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: isCurrent ? `2px solid ${C.accent}` : '1px solid transparent', transition: 'all 0.1s',
                    background: isCurrent ? C.accentDim : isAnswered ? 'rgba(52,211,153,0.12)' : 'var(--c-surface3)',
                    color: isCurrent ? C.accent : isAnswered ? '#34d399' : C.textTert }}>
                  {i + 1}
                </button>
              );
            })}
          </div>
          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              { color: '#34d399', bg: 'rgba(52,211,153,0.12)', label: `Answered (${answered})` },
              { color: C.textTert, bg: 'var(--c-surface3)', label: `Skipped (${total - answered})` },
            ].map(({ color, bg, label }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, fontWeight: 600, color: C.textTert }}>
                <div style={{ width: 12, height: 12, borderRadius: 3, background: bg, border: `1px solid ${color}40` }} />
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
