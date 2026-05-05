import React from 'react';
import { Brain, ChevronRight, Flag, Loader2, Pencil, RotateCcw } from 'lucide-react';
import { motion } from 'motion/react';
import { ExplanationSkeleton } from '../../components/skeletons/ExplanationSkeleton';
import { C, diffBg, diffColor } from '../../lib/tokens';
import { QuestionText } from '../../lib/QuestionText';
import { type Question, type View } from '../../types';
import {
  BLOCKED_EXPLANATION,
  UNAVAILABLE_EXPLANATION,
  getPracticeOptionState,
  getPracticeOptionStyles,
} from './practiceUtils';

interface PracticeQuestionCardProps {
  question: Question;
  practiceIndex: number;
  practiceQueueLength: number;
  practiceAnswered: boolean;
  practiceSelectedOption: string | null;
  practiceAnswerLoading: boolean;
  practiceExplanationLoading: boolean;
  isAdmin: boolean;
  bookmarkedIds: Set<string>;
  hasMoreQuestions: boolean;
  onToggleBookmark: (question: Question) => void;
  onFlagQuestion: (question: Question) => void;
  setEditQuestion: (question: Question) => void;
  handleAnswerSelect: (key: string) => void;
  nextPracticeQuestion: () => void;
  prevPracticeQuestion: () => void;
  retryLoadMore: () => void;
  startPractice: (examName: string, year: number, subject?: string, topic?: string) => void;
  setView: (view: View) => void;
  selectedExamName: string;
  selectedYear: number;
  practiceSubject: string;
  practiceTopic: string;
}

export function PracticeQuestionCard({
  question,
  practiceIndex,
  practiceQueueLength,
  practiceAnswered,
  practiceSelectedOption,
  practiceAnswerLoading,
  practiceExplanationLoading,
  isAdmin,
  bookmarkedIds,
  hasMoreQuestions,
  onToggleBookmark,
  onFlagQuestion,
  setEditQuestion,
  handleAnswerSelect,
  nextPracticeQuestion,
  prevPracticeQuestion,
  retryLoadMore,
  startPractice,
  setView,
  selectedExamName,
  selectedYear,
  practiceSubject,
  practiceTopic,
}: PracticeQuestionCardProps) {
  const optionStyles = getPracticeOptionStyles();
  const isBookmarked = bookmarkedIds.has(question.id);

  return (
    <div className="glass-panel" style={{ borderRadius: 24, padding: '36px 36px', marginBottom: 16, transition: 'border-color 0.15s', border: `1px solid ${C.borderHover}` }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ padding: '3px 10px', background: 'rgba(96,165,250,0.12)', color: C.blue, fontSize: 10, fontWeight: 700, borderRadius: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {question.subject}
          </span>
          <span style={{ padding: '3px 10px', background: 'transparent', border: `1px solid ${C.border}`, color: C.textSec, fontSize: 10, borderRadius: 8 }}>
            {question.topic}
          </span>
          {question.subtopic && (
            <span style={{ padding: '3px 10px', background: 'transparent', border: `1px solid ${C.borderLight}`, color: C.textTert, fontSize: 10, borderRadius: 8 }}>
              {question.subtopic}
            </span>
          )}
          <span style={{ padding: '3px 10px', background: diffBg[question.difficulty] || 'var(--c-surface3)', color: diffColor[question.difficulty] || C.textSec, fontSize: 10, fontWeight: 600, borderRadius: 8 }}>
            {question.difficulty}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button
            onClick={() => onToggleBookmark(question)}
            title={isBookmarked ? 'Remove bookmark' : 'Bookmark this question'}
            style={{
              padding: 7,
              background: isBookmarked ? C.accentDim : 'transparent',
              border: `1px solid ${isBookmarked ? C.accent : C.border}`,
              borderRadius: 6,
              cursor: 'pointer',
              color: isBookmarked ? C.accent : C.textTert,
              display: 'flex',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(event) => {
              if (!isBookmarked) {
                event.currentTarget.style.borderColor = C.accent;
                event.currentTarget.style.color = C.accent;
              }
            }}
            onMouseLeave={(event) => {
              if (!isBookmarked) {
                event.currentTarget.style.borderColor = C.border;
                event.currentTarget.style.color = C.textTert;
              }
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill={isBookmarked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
            </svg>
          </button>

          <button
            onClick={() => onFlagQuestion(question)}
            title="Flag this question"
            style={{ padding: 7, background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, cursor: 'pointer', color: C.textTert, display: 'flex', transition: 'all 0.15s' }}
            onMouseEnter={(event) => {
              event.currentTarget.style.borderColor = C.warn;
              event.currentTarget.style.color = C.warn;
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.borderColor = C.border;
              event.currentTarget.style.color = C.textTert;
            }}
          >
            <Flag style={{ width: 13, height: 13 }} />
          </button>

          {isAdmin && (
            <button
              onClick={() => setEditQuestion(question)}
              style={{ padding: 7, background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, cursor: 'pointer', color: C.textTert, display: 'flex', flexShrink: 0, transition: 'all 0.15s' }}
              onMouseEnter={(event) => {
                event.currentTarget.style.borderColor = C.accent;
                event.currentTarget.style.color = C.accent;
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.borderColor = C.border;
                event.currentTarget.style.color = C.textTert;
              }}
            >
              <Pencil style={{ width: 13, height: 13 }} />
            </button>
          )}
        </div>
      </div>

      {question.passage && (
        <div style={{ padding: '16px 20px', borderRadius: 10, background: 'var(--bg-alt)', border: `1px solid ${C.border}`, marginBottom: 20 }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: C.textSec, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Passage</p>
          <p style={{ fontSize: 14, color: C.textSec, lineHeight: 1.8, whiteSpace: 'pre-wrap', fontFamily: "'Inter', sans-serif" }}>{question.passage}</p>
        </div>
      )}

      <div style={{ fontSize: 17, fontWeight: 500, color: C.text, marginBottom: 32 }}>
        <div style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", color: C.textTert, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
          Question {practiceIndex + 1}
        </div>
        <QuestionText text={question.question} hasImage={question.has_image} imageUrl={question.image_url} style={{ fontSize: 17, fontWeight: 500, lineHeight: 1.65 }} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
        {Object.entries(question.options).map(([optionKey, optionValue]) => {
          const state = getPracticeOptionState(question, optionKey, practiceAnswered, practiceSelectedOption);
          const styles = optionStyles[state];
          const isAnswerKey = practiceAnswered && question.answer === optionKey;
          const isWrongKey = practiceAnswered && practiceSelectedOption === optionKey && question.answer !== optionKey;

          return (
            <button
              key={optionKey}
              disabled={practiceAnswered || practiceAnswerLoading}
              onClick={() => handleAnswerSelect(optionKey)}
              style={{
                width: '100%',
                padding: '14px 16px',
                borderRadius: 10,
                border: styles.border,
                background: styles.background,
                cursor: practiceAnswered ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 14,
                textAlign: 'left',
                transition: 'all 0.15s',
                userSelect: 'none',
              }}
              onMouseEnter={(event) => {
                if (!practiceAnswered && state === 'idle') event.currentTarget.style.borderColor = 'var(--c-border-l)';
              }}
              onMouseLeave={(event) => {
                if (!practiceAnswered && state === 'idle') event.currentTarget.style.borderColor = C.border;
              }}
            >
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 6,
                  background: styles.keyBg,
                  border: `1px solid ${C.border}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 500,
                  fontSize: 11,
                  fontFamily: "'DM Mono', monospace",
                  color: styles.keyColor,
                  flexShrink: 0,
                  marginTop: 1,
                  transition: 'all 0.15s',
                }}
              >
                {optionKey}
              </div>
              <span style={{ flex: 1, fontSize: 14, fontWeight: 300, color: styles.textColor, lineHeight: 1.6, paddingTop: 2 }}>{optionValue}</span>
              {isAnswerKey && <span style={{ fontSize: 14, flexShrink: 0, paddingTop: 2 }}>✓</span>}
              {isWrongKey && <span style={{ fontSize: 14, flexShrink: 0, paddingTop: 2 }}>✗</span>}
            </button>
          );
        })}
      </div>

      {practiceAnswerLoading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.blue, fontSize: 13, marginBottom: 16 }}>
          <Loader2 style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} /> Verifying answer...
        </div>
      )}

      {!practiceAnswered && !practiceAnswerLoading && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          {practiceIndex < practiceQueueLength - 1 ? (
            <button
              onClick={nextPracticeQuestion}
              style={{ padding: '8px 16px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, fontWeight: 500, color: C.textSec, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}
            >
              Skip <ChevronRight style={{ width: 14, height: 14 }} />
            </button>
          ) : (
            <button
              onClick={() => setView('exam-detail')}
              style={{ padding: '8px 16px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, fontWeight: 500, color: C.textSec, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Done
            </button>
          )}
        </div>
      )}

      {practiceAnswered && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <div
            style={{
              padding: '11px 16px',
              borderRadius: 10,
              marginBottom: question.source ? 8 : 16,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontSize: 13,
              fontWeight: 600,
              background: practiceSelectedOption === question.answer ? 'rgba(52,211,153,0.10)' : 'rgba(248,113,113,0.10)',
              color: practiceSelectedOption === question.answer ? '#34d399' : '#f87171',
              border: `1px solid ${practiceSelectedOption === question.answer ? 'rgba(52,211,153,0.25)' : 'rgba(248,113,113,0.25)'}`,
            }}
          >
            {practiceSelectedOption === question.answer ? (
              <>
                <span>✓</span> Correct!
              </>
            ) : (
              <>
                <span>✗</span> Incorrect — correct answer is <strong>{question.answer}</strong>
              </>
            )}
          </div>

          {question.source && (
            <div style={{ padding: '7px 14px', borderRadius: 8, marginBottom: 16, fontSize: 11, color: C.textSec, background: C.bg, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", color: C.textTert, textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0 }}>Source</span>
              <span style={{ width: 1, height: 12, background: C.border, flexShrink: 0 }} />
              <span>{question.source}</span>
            </div>
          )}

          {practiceExplanationLoading ? (
            <ExplanationSkeleton />
          ) : question.explanation === BLOCKED_EXPLANATION ? (
            <div style={{ padding: '16px 20px', background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 12, marginBottom: 20 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#c2410c', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Brain style={{ width: 12, height: 12 }} /> Explanation Pending Review
              </div>
              <p style={{ fontSize: 13.5, lineHeight: 1.85, color: '#7c2d12', margin: 0 }}>{BLOCKED_EXPLANATION}</p>
            </div>
          ) : question.explanation === UNAVAILABLE_EXPLANATION ? (
            <div style={{ padding: '16px 20px', background: 'var(--bg-alt)', border: `1px solid ${C.border}`, borderRadius: 12, marginBottom: 20 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.textSec, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Brain style={{ width: 12, height: 12 }} /> Explanation Unavailable
              </div>
              <p style={{ fontSize: 13.5, lineHeight: 1.85, color: C.textSec, margin: 0 }}>{UNAVAILABLE_EXPLANATION}</p>
            </div>
          ) : question.explanation && question.explanation.length > 5 ? (
            <div style={{ padding: '16px 20px', background: '#f8faff', border: '1px solid #dbeafe', borderRadius: 12, marginBottom: 20 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#2563eb', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Brain style={{ width: 12, height: 12 }} /> Explanation
              </div>
              <p style={{ fontSize: 13.5, lineHeight: 1.85, color: '#374151', margin: 0 }}>{question.explanation}</p>
            </div>
          ) : null}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button
              onClick={prevPracticeQuestion}
              disabled={practiceIndex === 0}
              style={{ padding: '8px 16px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, fontWeight: 500, color: C.textSec, cursor: practiceIndex === 0 ? 'not-allowed' : 'pointer', opacity: practiceIndex === 0 ? 0.3 : 1, display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}
            >
              ← Prev
            </button>

            {practiceIndex < practiceQueueLength - 1 ? (
              <button
                onClick={nextPracticeQuestion}
                style={{ padding: '9px 20px', background: '#2563eb', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700, color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'inherit' }}
              >
                Next Question →
              </button>
            ) : hasMoreQuestions ? (
              <button
                onClick={retryLoadMore}
                style={{ padding: '9px 20px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, fontWeight: 700, color: C.text, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'inherit' }}
              >
                Load Next 20 →
              </button>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => startPractice(selectedExamName, selectedYear, practiceSubject, practiceTopic)}
                  style={{ padding: '8px 16px', background: 'var(--c-surface3)', border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, fontWeight: 500, color: C.textSec, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}
                >
                  <RotateCcw style={{ width: 13, height: 13 }} /> Restart
                </button>
                <button
                  onClick={() => setView('exam-detail')}
                  style={{ padding: '8px 16px', background: '#2563eb', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700, color: 'white', cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </div>
  );
}
