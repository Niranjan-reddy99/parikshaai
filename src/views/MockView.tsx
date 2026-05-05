import React from 'react';
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

export function MockView({ examSession, setExamSession, examTimer, finishExam, loadMoreQuestions, loadingMoreQuestions }: MockViewProps) {
  // =========================
  // SECTION: Derived Data
  // =========================
  const currentQuestion = examSession.questions[examSession.currentIndex];
  const answered = getMockAnsweredCount(examSession.answers);
  const loaded = examSession.questions.length;
  const total = getMockTotalCount(examSession.totalCount, loaded);
  const { timerCritical, timerColor } = getMockTimerState(examTimer);

  // =========================
  // SECTION: Event Handlers
  // =========================
  const selectAnswer = (key: string) =>
    setExamSession({ ...examSession, answers: { ...examSession.answers, [examSession.currentIndex]: key } });

  const goTo = (i: number) =>
    setExamSession({ ...examSession, currentIndex: i });

  const handleSubmitExam = () => {
    if (window.confirm('Submit exam? This cannot be undone.')) finishExam();
  };

  // =========================
  // SECTION: Render Mock UI
  // =========================
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <MockTopBar
        examTimer={examTimer}
        timerColor={timerColor}
        timerCritical={timerCritical}
        answered={answered}
        total={total}
        currentIndex={examSession.currentIndex}
        hasMore={!!examSession.hasMore}
        onSubmit={handleSubmitExam}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: 20, alignItems: 'start' }}>
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
  );
}
