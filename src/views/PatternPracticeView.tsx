import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, BookOpen, ChevronRight, RotateCcw, Loader2, Brain, Trophy, TrendingUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { C } from '../lib/tokens';
import { QuestionText } from '../lib/QuestionText';
import { API_BASE } from '../lib/api';
import { type View } from '../types';

interface PatternBook {
  id: string;
  title: string;
  chapter: string;
  exam_target: string;
  question_count: number;
}

interface PatternQuestion {
  id: string;
  question_number: number;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: string | null;
  explanation?: string | null;
  difficulty: string;
  pattern_tag: string;
  source_page: number;
}

interface SessionAnswer {
  selected: string;
  correct: boolean | null; // null = no answer key
}

interface Props {
  setView: (v: View) => void;
  backView?: View;
  adminToken?: string;
}

export function PatternPracticeView({ setView, backView = 'home' as View, adminToken }: Props) {
  const [books, setBooks] = useState<PatternBook[]>([]);
  const [loadingBooks, setLoadingBooks] = useState(true);
  const [selectedBook, setSelectedBook] = useState<PatternBook | null>(null);
  const [allQuestions, setAllQuestions] = useState<PatternQuestion[]>([]);
  const [filteredQuestions, setFilteredQuestions] = useState<PatternQuestion[]>([]);
  const [patterns, setPatterns] = useState<string[]>([]);
  const [selectedPattern, setSelectedPattern] = useState<string>('All Patterns');
  const [loadingQs, setLoadingQs] = useState(false);
  const [quizStarted, setQuizStarted] = useState(false);
  const [index, setIndex] = useState(0);
  const [answered, setAnswered] = useState(false);
  const [selectedOpt, setSelectedOpt] = useState<string | null>(null);
  const [sessionAnswers, setSessionAnswers] = useState<(SessionAnswer | null)[]>([]);
  const [showScore, setShowScore] = useState(false);
  const activeQRef = useRef<HTMLButtonElement>(null);
  const patternMobileStripRef = useRef<HTMLDivElement>(null);
  const patternMobileActiveBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    fetch(`${API_BASE}/pattern-books`)
      .then(r => r.json())
      .then((data) => { setBooks(data); setLoadingBooks(false); })
      .catch(() => setLoadingBooks(false));
  }, []);

  // Update filtered list when selection changes
  useEffect(() => {
    if (selectedPattern === 'All Patterns') {
      setFilteredQuestions(allQuestions);
    } else {
      setFilteredQuestions(allQuestions.filter(q => q.pattern_tag === selectedPattern));
    }
    setIndex(0);
    setAnswered(false);
    setSelectedOpt(null);
    setSessionAnswers([]);
  }, [selectedPattern, allQuestions]);

  useEffect(() => {
    setSessionAnswers(new Array(filteredQuestions.length).fill(null));
  }, [filteredQuestions]);

  useEffect(() => {
    activeQRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [index]);

  useEffect(() => {
    const btn = patternMobileActiveBtnRef.current;
    const strip = patternMobileStripRef.current;
    if (!btn || !strip) return;
    strip.scrollTo({ left: btn.offsetLeft - strip.offsetWidth / 2 + btn.offsetWidth / 2, behavior: 'smooth' });
  }, [index]);

  const startQuiz = useCallback(async (book: PatternBook) => {
    setSelectedBook(book);
    setLoadingQs(true);
    try {
      const r = await fetch(`${API_BASE}/pattern-books/${book.id}/questions`);
      const data: PatternQuestion[] = await r.json();
      setAllQuestions(data);
      
      // Discover unique patterns in first-appearance order so the chapter
      // reads the same way the source book does.
      const p = Array.from(new Set(data.map(q => q.pattern_tag))).filter(Boolean);
      setPatterns(['All Patterns', ...p]);
      
      setSelectedPattern('All Patterns');
      setFilteredQuestions(data);
      setQuizStarted(true);
    } catch (e) {
      console.error("Failed to load pattern questions");
    }
    setLoadingQs(false);
  }, []);

  const handleSelect = (key: string) => {
    if (answered) return;
    setSelectedOpt(key);
    setAnswered(true);
    const q = filteredQuestions[index];
    const isCorrect = q.correct_answer ? key === q.correct_answer : null;
    setSessionAnswers(prev => {
      const next = [...prev];
      next[index] = { selected: key, correct: isCorrect };
      return next;
    });
  };

  const next = () => {
    if (index >= filteredQuestions.length - 1) {
      setShowScore(true);
    } else {
      setIndex(i => i + 1);
      setAnswered(false);
      setSelectedOpt(null);
    }
  };

  const prev = () => {
    if (index > 0) {
      setIndex(i => i - 1);
      const prev = sessionAnswers[index - 1];
      setAnswered(!!prev);
      setSelectedOpt(prev?.selected ?? null);
    }
  };

  const jump = (i: number) => {
    setIndex(i);
    const ans = sessionAnswers[i];
    setAnswered(!!ans);
    setSelectedOpt(ans?.selected ?? null);
  };

  const restart = () => {
    if (!selectedBook) return;
    setSessionAnswers(new Array(filteredQuestions.length).fill(null));
    setIndex(0); setAnswered(false); setSelectedOpt(null); setShowScore(false);
  };

  const optionState = (key: string, q: PatternQuestion) => {
    if (!answered) return selectedOpt === key ? 'selected' : 'idle';
    if (q.correct_answer && q.correct_answer === key) return 'correct';
    if (selectedOpt === key && q.correct_answer && q.correct_answer !== key) return 'wrong';
    if (selectedOpt === key && !q.correct_answer) return 'selected'; // no key — just show selection
    return 'dim';
  };

  const optionStyles: Record<string, React.CSSProperties & { keyBg: string; keyColor: string; textColor: string }> = {
    idle:     { border: `1px solid ${C.border}`,           background: 'transparent',             keyBg: 'var(--c-surface3)', keyColor: C.textSec,   textColor: C.text },
    selected: { border: `1px solid ${C.accent}60`,         background: 'var(--c-accent-dim)',      keyBg: C.accent,            keyColor: '#0a1a18',   textColor: C.text },
    correct:  { border: '1px solid rgba(52,211,153,0.4)',  background: 'rgba(52,211,153,0.10)',    keyBg: '#34d399',           keyColor: '#0a1a18',   textColor: C.text },
    wrong:    { border: '1px solid rgba(248,113,113,0.4)', background: 'rgba(248,113,113,0.10)',   keyBg: '#f87171',           keyColor: '#0a1a18',   textColor: C.text },
    dim:      { border: `1px solid ${C.borderLight ?? C.border}`, background: 'transparent',       keyBg: 'var(--c-surface3)', keyColor: C.textTert,  textColor: C.textTert },
  };

  // ── Score screen ──────────────────────────────────────────────────────────
  if (showScore && selectedBook) {
    const answered_n = sessionAnswers.filter(Boolean).length;
    const correct_n  = sessionAnswers.filter(a => a?.correct === true).length;
    const wrong_n    = sessionAnswers.filter(a => a?.correct === false).length;
    const skipped_n  = filteredQuestions.length - answered_n;
    const acc = answered_n > 0 ? Math.round((correct_n / answered_n) * 100) : 0;
    const hasAnsKey = filteredQuestions.some(q => q.correct_answer);

    return (
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '60px 16px' }}>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-panel"
          style={{ borderRadius: 24, padding: '48px 40px', textAlign: 'center' }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>
            {acc >= 80 ? '🏆' : acc >= 60 ? '💪' : acc >= 40 ? '📚' : '🎯'}
          </div>
          <h2 style={{ fontSize: 28, fontWeight: 400, fontFamily: "'Fraunces', Georgia, serif", color: C.text, marginBottom: 8 }}>
            Session Complete
          </h2>
          <p style={{ fontSize: 13, color: C.textSec, marginBottom: 36 }}>
            {selectedBook.title}
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 36 }}>
            {[
              { label: 'Questions',  val: String(filteredQuestions.length),  color: C.text },
              { label: 'Attempted',  val: String(answered_n),         color: C.text },
              ...(hasAnsKey ? [
                { label: 'Correct',    val: String(correct_n),          color: '#34d399' },
                { label: 'Wrong',      val: String(wrong_n),            color: '#f87171' },
                { label: 'Skipped',    val: String(skipped_n),          color: C.textSec },
                { label: 'Accuracy',   val: `${acc}%`,                  color: acc >= 70 ? '#34d399' : acc >= 40 ? C.warn : '#f87171' },
              ] : [
                { label: 'Skipped',    val: String(skipped_n),          color: C.textSec },
              ]),
            ].map(({ label, val, color }) => (
              <div key={label} className="glass-panel" style={{ borderRadius: 12, padding: '16px 20px', textAlign: 'left' }}>
                <div style={{ fontSize: 10, color: C.textTert, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: "'DM Mono', monospace", marginBottom: 6 }}>{label}</div>
                <div style={{ fontSize: 24, fontWeight: 700, fontFamily: "'DM Mono', monospace", color }}>{val}</div>
              </div>
            ))}
          </div>

          {!hasAnsKey && (
            <div style={{ padding: '12px 16px', borderRadius: 10, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', fontSize: 12, color: C.warn, marginBottom: 24 }}>
              ⚠️ Answer key not available for this chapter yet. Contact admin to add answers.
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button onClick={restart}
              style={{ padding: '10px 20px', background: 'var(--c-surface3)', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontWeight: 500, color: C.textSec, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              <RotateCcw style={{ width: 13, height: 13 }} /> Restart
            </button>
            <button onClick={() => { setQuizStarted(false); setShowScore(false); }}
              style={{ padding: '10px 20px', background: C.accent, border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, color: '#0a1a18', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              <BookOpen style={{ width: 13, height: 13 }} /> Choose Another Chapter
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  // ── Quiz screen ───────────────────────────────────────────────────────────
  if (quizStarted && filteredQuestions.length > 0) {
    const q = filteredQuestions[index];
    const progress = ((index + 1) / filteredQuestions.length) * 100;
    const s = optionStyles[optionState('', q)]; // placeholder

    return (
      <>
      {/* Mobile-only horizontal question strip */}
      <div className="practice-mobile-strip" ref={patternMobileStripRef}>
        {filteredQuestions.map((_, i) => {
          const ans = sessionAnswers[i];
          const isActive = i === index;
          let bg = 'var(--bg-alt)', color = 'var(--text-sec)', border = '1px solid var(--border)';
          if (isActive) { bg = '#2563eb'; color = '#fff'; border = '1px solid #2563eb'; }
          else if (ans?.correct === true)  { bg = 'rgba(52,211,153,0.12)'; color = '#34D399'; border = '1px solid rgba(52,211,153,0.25)'; }
          else if (ans?.correct === false) { bg = 'rgba(248,113,113,0.12)'; color = '#F43F5E'; border = '1px solid rgba(248,113,113,0.25)'; }
          else if (ans)                    { bg = 'rgba(251,191,36,0.12)';  color = '#f59e0b'; border = '1px solid rgba(251,191,36,0.25)'; }
          return (
            <button key={i} ref={isActive ? patternMobileActiveBtnRef : undefined} onClick={() => jump(i)}
              style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 6, background: bg, border,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontFamily: "'DM Mono', monospace", color, cursor: 'pointer', transition: 'all 0.15s' }}>
              {i + 1}
            </button>
          );
        })}
      </div>

      <div className="pattern-quiz-layout">
        <div>
          {/* Focus bar */}
          <div className="glass-panel" style={{ borderRadius: 16, padding: '14px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 16 }}>
            <button onClick={() => { setQuizStarted(false); }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.textSec, cursor: 'pointer', background: 'none', border: 'none', flexShrink: 0 }}>
              <ArrowLeft style={{ width: 14, height: 14 }} /> Back
            </button>
            <div style={{ width: 1, height: 20, background: C.border }} />
            <span style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", color: C.textSec, flexShrink: 0 }}>
              {index + 1} / {filteredQuestions.length}
            </span>
            <div style={{ flex: 1, height: 4, background: 'var(--c-surface3)', borderRadius: 4, overflow: 'hidden' }}>
              <motion.div style={{ height: '100%', background: C.accent, borderRadius: 4 }}
                initial={{ width: 0 }} animate={{ width: `${progress}%` }} transition={{ duration: 0.3 }} />
            </div>
            
            {/* Pattern Dropdown */}
            <select 
              value={selectedPattern}
              onChange={(e) => setSelectedPattern(e.target.value)}
              style={{ 
                background: 'var(--c-surface3)', 
                border: `1px solid ${C.border}`, 
                color: C.textSec, 
                fontSize: 11, 
                padding: '4px 8px', 
                borderRadius: 6,
                outline: 'none',
                maxWidth: 150
              }}
            >
              {patterns.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          {/* Question card */}
          <div className="glass-panel" style={{ borderRadius: 20, padding: '36px', marginBottom: 16 }}>
            {/* Tags */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
              <span style={{ padding: '3px 10px', background: 'var(--c-surface3)', color: C.textSec, fontSize: 10, borderRadius: 8 }}>
                {selectedBook?.chapter ?? 'Practice'}
              </span>
              <span style={{ padding: '3px 10px', background: 'rgba(52,211,153,0.12)', color: '#34d399', fontSize: 10, fontWeight: 700, borderRadius: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {q.pattern_tag}
              </span>
              {q.source_page && (
                <span style={{ padding: '3px 10px', background: 'var(--c-surface3)', color: C.textTert, fontSize: 10, borderRadius: 8 }}>
                  p.{q.source_page}
                </span>
              )}
            </div>

            {/* Question text */}
            <div style={{ fontSize: 18, fontWeight: 400, color: C.text, marginBottom: 32, fontFamily: "'Fraunces', Georgia, serif", lineHeight: 1.7 }}>
              <QuestionText text={q.question_text} hasImage={false} imageUrl={null}
                style={{ fontSize: 18, fontWeight: 400, fontFamily: "'Fraunces', Georgia, serif" }} />
            </div>

            {/* Options */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
              {(['A', 'B', 'C', 'D'] as const).map((key) => {
                const val = q[`option_${key.toLowerCase()}` as 'option_a'];
                const state = optionState(key, q);
                const os = optionStyles[state];
                return (
                  <button key={key} disabled={answered} onClick={() => handleSelect(key)}
                    style={{ width: '100%', padding: '14px 16px', borderRadius: 10, border: os.border, background: os.background,
                      cursor: answered ? 'default' : 'pointer', display: 'flex', alignItems: 'flex-start', gap: 14,
                      textAlign: 'left', transition: 'all 0.15s', userSelect: 'none' }}>
                    <div style={{ width: 26, height: 26, borderRadius: 6, background: os.keyBg, border: `1px solid ${C.border}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 500, fontSize: 11,
                      fontFamily: "'DM Mono', monospace", color: os.keyColor, flexShrink: 0, marginTop: 1, transition: 'all 0.15s' }}>
                      {key}
                    </div>
                    <span style={{ flex: 1, fontSize: 14, fontWeight: 300, color: os.textColor, lineHeight: 1.6, paddingTop: 2 }}>
                      {val || '—'}
                    </span>
                    {answered && q.correct_answer === key && <span style={{ fontSize: 14, flexShrink: 0 }}>✓</span>}
                    {answered && selectedOpt === key && q.correct_answer && q.correct_answer !== key && <span style={{ fontSize: 14, flexShrink: 0 }}>✗</span>}
                  </button>
                );
              })}
            </div>

            {/* Not answered yet — skip */}
            {!answered && (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={next}
                  style={{ padding: '8px 16px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6,
                    fontSize: 13, color: C.textSec, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                  Skip <ChevronRight style={{ width: 14, height: 14 }} />
                </button>
              </div>
            )}

            {/* Answered */}
            {answered && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                {/* Result banner */}
                {q.correct_answer && (
                  <div style={{ padding: '10px 16px', borderRadius: 8, marginBottom: 16,
                    display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, fontWeight: 500,
                    background: selectedOpt === q.correct_answer ? 'rgba(52,211,153,0.10)' : 'rgba(248,113,113,0.10)',
                    color: selectedOpt === q.correct_answer ? '#34d399' : '#f87171',
                    border: `1px solid ${selectedOpt === q.correct_answer ? 'rgba(52,211,153,0.25)' : 'rgba(248,113,113,0.25)'}` }}>
                    {selectedOpt === q.correct_answer
                      ? <><span>✓</span> Correct!</>
                      : <><span>✗</span> Wrong — correct answer is <strong>{q.correct_answer}</strong></>}
                  </div>
                )}
                {!q.correct_answer && (
                  <div style={{ padding: '10px 16px', borderRadius: 8, marginBottom: 16,
                    background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)',
                    fontSize: 12, color: C.warn }}>
                    📝 You selected <strong>{selectedOpt}</strong>. Answer key not available yet — review manually.
                  </div>
                )}

                {/* Explanation Box */}
                {q.explanation && (
                  <div style={{ padding: '20px', borderRadius: 12, marginBottom: 20, background: 'var(--c-surface3)', border: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.textSec, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Brain style={{ width: 14, height: 14, color: C.accent }} /> Detailed Solution
                    </div>
                    <div style={{ fontSize: 14, lineHeight: 1.6, color: C.text, fontFamily: "'DM Sans', system-ui, sans-serif" }}>
                      <QuestionText text={q.explanation} hasImage={false} imageUrl={null} />
                    </div>
                  </div>
                )}

                {/* Navigation */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <button onClick={prev} disabled={index === 0}
                    style={{ padding: '8px 16px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6,
                      fontSize: 13, color: C.textSec, cursor: index === 0 ? 'not-allowed' : 'pointer', opacity: index === 0 ? 0.3 : 1,
                      display: 'flex', alignItems: 'center', gap: 6 }}>
                    ← Prev
                  </button>
                  {index < filteredQuestions.length - 1 ? (
                    <button onClick={next}
                      style={{ padding: '9px 20px', background: C.accent, border: 'none', borderRadius: 6,
                        fontSize: 13, fontWeight: 700, color: '#0a1a18', cursor: 'pointer' }}>
                      Next Question →
                    </button>
                  ) : (
                    <button onClick={() => setShowScore(true)}
                      style={{ padding: '9px 20px', background: C.accent, border: 'none', borderRadius: 6,
                        fontSize: 13, fontWeight: 700, color: '#0a1a18', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Trophy style={{ width: 14, height: 14 }} /> See Score
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </div>
        </div>

        {/* Side panel — hidden on mobile, replaced by horizontal strip above */}
        <div className="pattern-quiz-sidebar glass-panel" style={{ borderRadius: 16, padding: '24px 20px', position: 'sticky', top: 0 }}>
          <div style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.06em',
            color: C.textTert, marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
            <span>Questions</span><span>{index + 1}/{filteredQuestions.length}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4, marginBottom: 20,
            maxHeight: 220, overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: `${C.border} transparent` }}>
            {filteredQuestions.map((_, i) => {
              const ans = sessionAnswers[i];
              let bg = 'var(--c-surface3)', color = C.textSec, border = `1px solid ${C.border}`;
              if (i === index) { bg = C.accent; color = '#0a1a18'; border = `1px solid ${C.accent}`; }
              else if (ans?.correct === true)  { bg = 'rgba(52,211,153,0.12)'; color = '#34D399'; border = '1px solid rgba(52,211,153,0.25)'; }
              else if (ans?.correct === false) { bg = 'rgba(248,113,113,0.12)'; color = '#F43F5E'; border = '1px solid rgba(248,113,113,0.25)'; }
              else if (ans)                    { bg = 'rgba(251,191,36,0.12)';  color = '#f59e0b'; border = '1px solid rgba(251,191,36,0.25)'; }
              return (
                <button key={i} ref={i === index ? activeQRef : undefined} onClick={() => jump(i)}
                  style={{ aspectRatio: '1', borderRadius: 6, background: bg, border, display: 'flex',
                    alignItems: 'center', justifyContent: 'center', fontSize: 11, fontFamily: "'DM Mono', monospace",
                    color, cursor: 'pointer', transition: 'all 0.15s' }}>
                  {i + 1}
                </button>
              );
            })}
          </div>

          <div style={{ height: 1, background: C.border, margin: '0 0 16px' }} />
          <div style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.06em', color: C.textTert, marginBottom: 12 }}>Session</div>
          {(() => {
            const c = sessionAnswers.filter(a => a?.correct === true).length;
            const w = sessionAnswers.filter(a => a?.correct === false).length;
            const att = sessionAnswers.filter(Boolean).length;
            return [
              { label: 'Attempted', val: String(att), col: C.text },
              { label: 'Correct',   val: String(c),   col: '#34D399' },
              { label: 'Wrong',     val: String(w),   col: '#F43F5E' },
            ].map(({ label, val, col }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '5px 0', borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
                <span style={{ color: C.textSec }}>{label}</span>
                <span style={{ fontFamily: "'DM Mono', monospace", fontWeight: 500, color: col }}>{val}</span>
              </div>
            ));
          })()}
        </div>
      </div>
      </>
    );
  }

  // ── Book selector ─────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <button onClick={() => setView(backView)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.textSec, cursor: 'pointer', background: 'none', border: 'none', marginBottom: 20 }}>
          <ArrowLeft style={{ width: 14, height: 14 }} /> Back
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <TrendingUp style={{ width: 22, height: 22, color: '#f59e0b' }} />
          </div>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 400, fontFamily: "'Fraunces', Georgia, serif", color: C.text, margin: 0 }}>
              Pattern Practice
            </h1>
            <p style={{ fontSize: 13, color: C.textSec, margin: 0 }}>SSC CGL · Chapter-wise Questions</p>
          </div>
        </div>
      </div>

      {loadingBooks ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.textSec, fontSize: 13 }}>
          <Loader2 style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} /> Loading chapters...
        </div>
      ) : books.length === 0 ? (
        <div className="glass-panel" style={{ borderRadius: 16, padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📂</div>
          <p style={{ fontSize: 14, color: C.textSec }}>No pattern books found. Ask your admin to ingest an SSC pattern PDF.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {books.map(book => (
            <motion.div key={book.id} whileHover={{ y: -2 }} className="glass-panel"
              style={{ borderRadius: 16, padding: '24px 24px', cursor: 'pointer', transition: 'border-color 0.15s' }}
              onClick={() => startQuiz(book)}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(251,191,36,0.12)',
                  border: '1px solid rgba(251,191,36,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <BookOpen style={{ width: 16, height: 16, color: '#f59e0b' }} />
                </div>
                <span style={{ padding: '3px 8px', background: 'rgba(251,191,36,0.08)', color: '#f59e0b',
                  fontSize: 10, fontWeight: 700, borderRadius: 6, border: '1px solid rgba(251,191,36,0.2)' }}>
                  {book.exam_target}
                </span>
              </div>
              <h3 style={{ fontSize: 15, fontWeight: 500, color: C.text, margin: '0 0 6px', fontFamily: "'DM Sans', system-ui, sans-serif", lineHeight: 1.4 }}>
                {book.chapter || book.title}
              </h3>
              <p style={{ fontSize: 12, color: C.textSec, margin: '0 0 16px' }}>{book.title}</p>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, fontFamily: "'DM Mono', monospace", color: C.textTert }}>
                  {book.question_count} questions
                </span>
                <span style={{ fontSize: 12, color: C.accent, fontWeight: 600 }}>Start →</span>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
