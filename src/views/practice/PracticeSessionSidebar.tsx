import React from 'react';
import { C } from '../../lib/tokens';
import { getPracticeSessionStats } from './practiceUtils';

interface PracticeSessionSidebarProps {
  practiceIndex: number;
  practiceQueueLength: number;
  sessionAnswers: (null | { selected: string; correct: boolean })[];
  activeQuestionRef: React.RefObject<HTMLButtonElement | null>;
  jumpToPracticeQuestion: (index: number) => void;
}

export function PracticeSessionSidebar({
  practiceIndex,
  practiceQueueLength,
  sessionAnswers,
  activeQuestionRef,
  jumpToPracticeQuestion,
}: PracticeSessionSidebarProps) {
  const sessionStats = getPracticeSessionStats(sessionAnswers);

  return (
    <div style={{ background: 'var(--bg)', borderRadius: 14, padding: '20px 16px', position: 'sticky', top: 16, border: '1px solid var(--border)' }}>
      <div style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.08em', color: C.textTert, marginBottom: 14 }}>
        Session Navigator
      </div>

      <div style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.06em', color: C.textTert, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Questions</span>
        <span style={{ color: C.textTert }}>
          {practiceIndex + 1}/{practiceQueueLength}
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 4,
          marginBottom: 20,
          maxHeight: 220,
          overflowY: 'auto',
          paddingRight: 2,
          scrollbarWidth: 'thin',
          scrollbarColor: 'var(--border) transparent',
        }}
      >
        {Array.from({ length: practiceQueueLength }).map((_, index) => {
          const answerState = sessionAnswers[index];
          let background = 'var(--bg-alt)';
          let color = C.textSec;
          let border = '1px solid var(--border)';

          if (index === practiceIndex) {
            background = '#2563eb';
            color = 'white';
            border = '1px solid #2563eb';
          } else if (answerState?.correct) {
            background = 'rgba(52,211,153,0.12)';
            color = '#34D399';
            border = '1px solid rgba(52,211,153,0.25)';
          } else if (answerState && !answerState.correct) {
            background = 'rgba(248,113,113,0.12)';
            color = '#F43F5E';
            border = '1px solid rgba(248,113,113,0.25)';
          }

          return (
            <button
              key={index}
              ref={index === practiceIndex ? activeQuestionRef : undefined}
              onClick={() => jumpToPracticeQuestion(index)}
              style={{ aspectRatio: '1', borderRadius: 6, background, border, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontFamily: "'DM Mono', monospace", color, cursor: 'pointer', transition: 'all 0.15s' }}
            >
              {index + 1}
            </button>
          );
        })}
      </div>

      <div style={{ height: 1, background: 'var(--border)', margin: '0 0 16px' }} />

      <div style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.06em', color: C.textTert, marginBottom: 12 }}>
        Session
      </div>

      {[
        { label: 'Correct', value: String(sessionStats.correct), color: '#34D399' },
        { label: 'Incorrect', value: String(sessionStats.incorrect), color: '#F43F5E' },
        { label: 'Accuracy', value: sessionStats.answered > 0 ? `${sessionStats.accuracy}%` : '—', color: '#2563eb' },
        { label: 'XP earned', value: `+${sessionStats.xpEarned}`, color: '#2563eb' },
      ].map((statItem) => (
        <div key={statItem.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
          <span style={{ color: C.textSec }}>{statItem.label}</span>
          <span style={{ fontFamily: "'DM Mono', monospace", fontWeight: 500, color: statItem.color }}>{statItem.value}</span>
        </div>
      ))}
    </div>
  );
}
