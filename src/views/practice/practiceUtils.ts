import { C } from '../../lib/tokens';
import { type ExamOutline, type Question } from '../../types';

export const BLOCKED_EXPLANATION =
  'Explanation withheld until the correct answer is verified for this question.';
export const UNAVAILABLE_EXPLANATION =
  'Explanation is not available for this question yet.';

export function getAvailablePracticeSubjects(examOutline: ExamOutline | null) {
  return (examOutline?.subjects || []).map((subjectItem) => subjectItem.subject).sort();
}

export function getAvailablePracticeTopics(examOutline: ExamOutline | null, practiceSubject: string) {
  const allSubjects = examOutline?.subjects || [];

  return practiceSubject === 'All'
    ? allSubjects.flatMap((subjectItem) => subjectItem.topics.map((topicItem) => topicItem.topic)).sort()
    : (allSubjects.find((subjectItem) => subjectItem.subject === practiceSubject)?.topics || [])
        .map((topicItem) => topicItem.topic)
        .sort();
}

export function getPracticeProgress(practiceIndex: number, practiceQueueLength: number) {
  return ((practiceIndex + 1) / practiceQueueLength) * 100;
}

export function getPracticeOptionState(
  question: Question,
  optionKey: string,
  practiceAnswered: boolean,
  practiceSelectedOption: string | null
) {
  if (!practiceAnswered) {
    return practiceSelectedOption === optionKey ? 'selected' : 'idle';
  }

  if (question.answer === optionKey) return 'correct';
  if (practiceSelectedOption === optionKey) return 'wrong';
  return 'dim';
}

export function getPracticeOptionStyles() {
  return {
    idle: {
      border: `1px solid ${C.border}`,
      background: 'transparent',
      keyBg: C.surface3,
      keyColor: C.textSec,
      textColor: C.text,
    },
    selected: {
      border: '1px solid #2563eb60',
      background: '#dbeafe',
      keyBg: '#2563eb',
      keyColor: 'white',
      textColor: C.text,
    },
    correct: {
      border: '1px solid rgba(52,211,153,0.40)',
      background: 'rgba(52,211,153,0.10)',
      keyBg: '#34d399',
      keyColor: '#0a1a18',
      textColor: C.text,
    },
    wrong: {
      border: '1px solid rgba(248,113,113,0.40)',
      background: 'rgba(248,113,113,0.10)',
      keyBg: '#f87171',
      keyColor: '#0a1a18',
      textColor: C.text,
    },
    dim: {
      border: `1px solid ${C.borderLight}`,
      background: 'transparent',
      keyBg: C.surface3,
      keyColor: C.textTert,
      textColor: C.textTert,
    },
  } as const;
}

export function getPracticeSessionStats(sessionAnswers: (null | { selected: string; correct: boolean })[]) {
  const correct = sessionAnswers.filter((answer) => answer?.correct).length;
  const incorrect = sessionAnswers.filter((answer) => answer && !answer.correct).length;
  const answered = correct + incorrect;
  const accuracy = answered > 0 ? Math.round((correct / answered) * 100) : 0;
  const xpEarned = correct * 10 + incorrect * 2;

  return { correct, incorrect, answered, accuracy, xpEarned };
}
