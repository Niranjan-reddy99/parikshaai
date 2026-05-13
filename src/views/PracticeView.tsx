import React, { useRef, useEffect } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { QuestionCardSkeleton } from '../components/skeletons/QuestionCardSkeleton';
import { C } from '../lib/tokens';
import { type ExamOutline, type Question, type View } from '../types';
import { PracticeFocusBar } from './practice/PracticeFocusBar';
import { PracticeQuestionCard } from './practice/PracticeQuestionCard';
import { PracticeSessionSidebar } from './practice/PracticeSessionSidebar';
import {
  getAvailablePracticeSubjects,
  getAvailablePracticeTopics,
  getPracticeProgress,
} from './practice/practiceUtils';

interface PracticeViewProps {
  practiceQueue: Question[];
  practiceIndex: number;
  practiceAnswered: boolean;
  practiceSelectedOption: string | null;
  practiceAnswerLoading: boolean;
  practiceExplanationLoading: boolean;
  practiceInitLoading: boolean;
  practiceInitMessage: string;
  practiceLoadProgress: { loaded: number; total: number | null };
  practiceSubject: string;
  practiceTopic: string;
  selectedExamName: string;
  selectedExamType: string;
  selectedYear: number;
  examOutline: ExamOutline | null;
  currentPracticeQ: Question | null;
  sessionAnswers: (null | { selected: string; correct: boolean })[];
  handleAnswerSelect: (key: string) => void;
  nextPracticeQuestion: () => void;
  prevPracticeQuestion: () => void;
  jumpToPracticeQuestion: (i: number) => void;
  startPractice: (examName: string, year: number, subject?: string, topic?: string) => void;
  retryLoadMore: () => void;
  hasMoreQuestions: boolean;
  loadingMoreQuestions: boolean;
  loadMoreError: string | null;
  setView: (v: View) => void;
  onFlagQuestion: (q: Question) => void;
  bookmarkedIds: Set<string>;
  onToggleBookmark: (q: Question) => void;
  backView: View;
}

export function PracticeView({
  practiceQueue, practiceIndex, practiceAnswered, practiceSelectedOption, practiceAnswerLoading,
  practiceExplanationLoading,
  practiceInitLoading, practiceInitMessage, practiceLoadProgress,
  practiceSubject, practiceTopic,
  selectedExamName, selectedExamType, selectedYear, examOutline,
  currentPracticeQ, sessionAnswers, handleAnswerSelect, nextPracticeQuestion, prevPracticeQuestion,
  jumpToPracticeQuestion, startPractice, setView, onFlagQuestion, backView,
  retryLoadMore, hasMoreQuestions, loadingMoreQuestions, loadMoreError,
  bookmarkedIds, onToggleBookmark,
}: PracticeViewProps) {
  // =========================
  // SECTION: State Management
  // =========================
  const activeQRef = useRef<HTMLButtonElement>(null);

  // =========================
  // SECTION: Effects
  // =========================
  useEffect(() => {
    activeQRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [practiceIndex]);

  // =========================
  // SECTION: Render Loading States
  // =========================
  if (practiceInitLoading && !practiceQueue.length) return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '80px 16px', textAlign: 'center' }}>
      <Loader2 style={{ width: 28, height: 28, margin: '0 auto 16px', color: C.accent, animation: 'spin 1s linear infinite' }} />
      <h3 style={{ fontFamily: "'Inter', sans-serif", fontSize: 22, fontWeight: 400, color: C.text, marginBottom: 8 }}>Preparing practice set</h3>
      <p style={{ fontSize: 13, color: C.textSec, marginBottom: 10 }}>{practiceInitMessage || 'Loading questions...'}</p>
      <p style={{ fontSize: 12, color: C.textTert }}>
        {practiceLoadProgress.total
          ? `${practiceLoadProgress.loaded} of ${practiceLoadProgress.total} questions loaded`
          : 'Building topic session from the server'}
      </p>
    </div>
  );

  if (!practiceQueue.length) return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '80px 16px', textAlign: 'center' }}>
      <div style={{ width: 48, height: 48, margin: '0 auto 16px', color: 'var(--text-tert)' }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
      </div>
      <h3 style={{ fontFamily: "'Inter', sans-serif", fontSize: 22, fontWeight: 400, color: C.text, marginBottom: 8 }}>No questions found</h3>
      <p style={{ fontSize: 13, color: C.textSec, marginBottom: 24 }}>Try adjusting your subject or topic filters.</p>
      <button onClick={() => setView(backView)}
        style={{ padding: '9px 18px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, color: C.textSec, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: "inherit" }}>
        <ArrowLeft style={{ width: 14, height: 14 }} /> Back
      </button>
    </div>
  );

  if (!currentPracticeQ) return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '80px 16px', textAlign: 'center' }}>
      <Loader2 style={{ width: 28, height: 28, margin: '0 auto 16px', color: C.accent, animation: 'spin 1s linear infinite' }} />
      <h3 style={{ fontFamily: "'Inter', sans-serif", fontSize: 22, fontWeight: 400, color: C.text, marginBottom: 8 }}>Refreshing practice session</h3>
      <p style={{ fontSize: 13, color: C.textSec, marginBottom: 24 }}>
        The question set changed after your edit, so we’re re-aligning the current practice queue.
      </p>
      <button onClick={() => setView(backView)}
        style={{ padding: '9px 18px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, color: C.textSec, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: "inherit" }}>
        <ArrowLeft style={{ width: 14, height: 14 }} /> Back
      </button>
    </div>
  );

  // =========================
  // SECTION: Derived Data
  // =========================
  const currentQuestion = currentPracticeQ;
  const progress = getPracticeProgress(practiceIndex, practiceQueue.length);
  const availableSubjects = getAvailablePracticeSubjects(examOutline);
  const availableTopics = getAvailablePracticeTopics(examOutline, practiceSubject);

  // =========================
  // SECTION: Render Practice UI
  // =========================
  return (
    <div className="practice-layout">
      <div className="practice-main-column">
        <PracticeFocusBar
          practiceIndex={practiceIndex}
          practiceQueueLength={practiceQueue.length}
          progress={progress}
          practiceInitLoading={practiceInitLoading}
          practiceInitMessage={practiceInitMessage}
          practiceLoadProgress={practiceLoadProgress}
          practiceSubject={practiceSubject}
          practiceTopic={practiceTopic}
          availableSubjects={availableSubjects}
          availableTopics={availableTopics}
          selectedExamName={selectedExamName}
          selectedYear={selectedYear}
          backViewLabel={backView}
          onBack={() => setView(backView)}
          startPractice={startPractice}
        />

        <PracticeQuestionCard
          question={currentQuestion}
          practiceIndex={practiceIndex}
          practiceQueueLength={practiceQueue.length}
          practiceAnswered={practiceAnswered}
          practiceSelectedOption={practiceSelectedOption}
          practiceAnswerLoading={practiceAnswerLoading}
          practiceExplanationLoading={practiceExplanationLoading}
          bookmarkedIds={bookmarkedIds}
          hasMoreQuestions={hasMoreQuestions}
          onToggleBookmark={onToggleBookmark}
          onFlagQuestion={onFlagQuestion}
          handleAnswerSelect={handleAnswerSelect}
          nextPracticeQuestion={nextPracticeQuestion}
          prevPracticeQuestion={prevPracticeQuestion}
          retryLoadMore={retryLoadMore}
          startPractice={startPractice}
          setView={setView}
          selectedExamName={selectedExamName}
          selectedYear={selectedYear}
          practiceSubject={practiceSubject}
          practiceTopic={practiceTopic}
        />

      {loadingMoreQuestions && (
        <div style={{ marginTop: 14 }}>
          <QuestionCardSkeleton />
        </div>
      )}
      {loadMoreError && (
        <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 10, border: `1px solid ${C.warn}40`, background: C.warnDim, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ fontSize: 12, color: C.textSec }}>Could not load the next question batch.</div>
          <button onClick={retryLoadMore} style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.text, cursor: 'pointer', fontSize: 12 }}>Retry</button>
        </div>
      )}
      </div>

      {practiceQueue.length > 0 && (
        <div className="practice-sidebar-card">
          <PracticeSessionSidebar
            practiceIndex={practiceIndex}
            practiceQueueLength={practiceQueue.length}
            sessionAnswers={sessionAnswers}
            activeQuestionRef={activeQRef}
            jumpToPracticeQuestion={jumpToPracticeQuestion}
          />
        </div>
      )}
    </div>
  );
}
