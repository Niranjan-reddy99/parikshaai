import React, { useRef, useEffect, useState } from 'react';
import { type ExamSession } from '../types';
import { MockQuestionPalette } from './mock/MockQuestionPalette';
import { MockQuestionPanel } from './mock/MockQuestionPanel';
import { MockTopBar } from './mock/MockTopBar';
import { getMockAnsweredCount, getMockTimerState, getMockTotalCount } from './mock/mockUtils';

interface MockViewProps {
  examSession: ExamSession;
  setExamSession: (s: ExamSession) => void;
  examTimer: number;
  finishExam: () => void;
  loadMoreQuestions: () => void;
  loadingMoreQuestions: boolean;
}

function SubmitConfirmModal({
  answered,
  total,
  onConfirm,
  onCancel,
}: {
  answered: number;
  total: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const unanswered = total - answered;
  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg)',
          borderRadius: 16,
          padding: '28px 28px 22px',
          maxWidth: 400,
          width: '100%',
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          border: '1px solid var(--border)',
        }}
      >
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>
            Submit Exam?
          </div>
          <div style={{ fontSize: 13.5, color: 'var(--text-sec)', lineHeight: 1.6 }}>
            You have answered <strong style={{ color: 'var(--text)' }}>{answered}</strong> of{' '}
            <strong style={{ color: 'var(--text)' }}>{total}</strong> questions.
            {unanswered > 0 && (
              <span style={{ color: '#d97706' }}> {unanswered} question{unanswered !== 1 ? 's' : ''} left unanswered.</span>
            )}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-tert)', marginTop: 8 }}>
            This action cannot be undone.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1, padding: '10px 0',
              background: 'var(--bg-alt)', border: '1px solid var(--border)',
              borderRadius: 9, fontSize: 13.5, fontWeight: 600,
              color: 'var(--text-sec)', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Continue Exam
          </button>
          <button
            onClick={onConfirm}
            style={{
              flex: 1, padding: '10px 0',
              background: '#2563eb', border: 'none',
              borderRadius: 9, fontSize: 13.5, fontWeight: 700,
              color: 'white', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}

export function MockView({ examSession, setExamSession, examTimer, finishExam, loadMoreQuestions, loadingMoreQuestions }: MockViewProps) {
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const mobileStripRef = useRef<HTMLDivElement>(null);
  const mobileActiveBtnRef = useRef<HTMLButtonElement>(null);

  const currentQuestion = examSession.questions[examSession.currentIndex];
  const answered = getMockAnsweredCount(examSession.answers);
  const loaded = examSession.questions.length;
  const total = getMockTotalCount(examSession.totalCount, loaded);
  const { timerCritical, timerColor } = getMockTimerState(examTimer);

  const selectAnswer = (key: string) =>
    setExamSession({ ...examSession, answers: { ...examSession.answers, [examSession.currentIndex]: key } });

  const goTo = (i: number) =>
    setExamSession({ ...examSession, currentIndex: i });

  // Keep active question centred in mobile horizontal strip
  useEffect(() => {
    const btn = mobileActiveBtnRef.current;
    const strip = mobileStripRef.current;
    if (!btn || !strip) return;
    strip.scrollTo({ left: btn.offsetLeft - strip.offsetWidth / 2 + btn.offsetWidth / 2, behavior: 'smooth' });
  }, [examSession.currentIndex]);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {showSubmitConfirm && (
        <SubmitConfirmModal
          answered={answered}
          total={total}
          onConfirm={() => { setShowSubmitConfirm(false); finishExam(); }}
          onCancel={() => setShowSubmitConfirm(false)}
        />
      )}

      <MockTopBar
        examTimer={examTimer}
        timerColor={timerColor}
        timerCritical={timerCritical}
        answered={answered}
        total={total}
        currentIndex={examSession.currentIndex}
        hasMore={!!examSession.hasMore}
        onSubmit={() => setShowSubmitConfirm(true)}
      />

      {/* Mobile-only horizontal question number strip */}
      <div className="practice-mobile-strip" ref={mobileStripRef}>
        {Array.from({ length: loaded }).map((_, index) => {
          const isCurrent = examSession.currentIndex === index;
          const isAnswered = !!examSession.answers[index];
          return (
            <button
              key={index}
              ref={isCurrent ? mobileActiveBtnRef : undefined}
              onClick={() => goTo(index)}
              style={{
                flexShrink: 0, width: 32, height: 32, borderRadius: 6,
                fontSize: 11, fontFamily: "'DM Mono', monospace", cursor: 'pointer',
                transition: 'all 0.15s',
                border: isCurrent ? '2px solid #2563eb' : '1px solid var(--border)',
                background: isCurrent ? '#2563eb' : isAnswered ? 'rgba(52,211,153,0.12)' : 'var(--bg-alt)',
                color: isCurrent ? '#fff' : isAnswered ? '#34D399' : 'var(--text-sec)',
              }}
            >
              {index + 1}
            </button>
          );
        })}
      </div>

      <div className="mock-layout">
        <div className="mock-main-column">
          <MockQuestionPanel
            question={currentQuestion}
            currentIndex={examSession.currentIndex}
            loadedCount={loaded}
            hasMore={!!examSession.hasMore}
            loadingMoreQuestions={loadingMoreQuestions}
            selectedAnswer={examSession.answers[examSession.currentIndex]}
            onSelectAnswer={selectAnswer}
            onPrevious={() => goTo(examSession.currentIndex - 1)}
            onNext={() => goTo(examSession.currentIndex + 1)}
            onLoadMoreQuestions={loadMoreQuestions}
          />
        </div>

        <div className="mock-sidebar-card">
          <MockQuestionPalette
            loadedCount={examSession.questions.length}
            currentIndex={examSession.currentIndex}
            answered={answered}
            total={total}
            answers={examSession.answers}
            onGoTo={goTo}
          />
        </div>
      </div>
    </div>
  );
}
