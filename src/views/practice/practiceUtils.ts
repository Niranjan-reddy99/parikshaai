import { C } from '../../lib/tokens';
import {
  formatAcceptedAnswerLabels,
  isAcceptedAnswer,
  isDeletedQuestion,
} from '../../lib/questionAnswers';
import { type ExamOutline, type Question } from '../../types';

export const BLOCKED_EXPLANATION =
  'Explanation withheld until the correct answer is verified for this question.';
export const UNAVAILABLE_EXPLANATION =
  'Explanation is not available for this question yet.';
export const DELETED_QUESTION_NOTE =
  'This question was deleted in the official final key.';
export const MULTIPLE_ANSWERS_NOTE =
  'The official key accepts more than one answer for this question.';

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

  if (isDeletedQuestion(question)) {
    return practiceSelectedOption === optionKey ? 'selected' : 'dim';
  }
  if (isAcceptedAnswer(question, optionKey)) return 'correct';
  if (practiceSelectedOption === optionKey) return 'wrong';
  return 'dim';
}

export function getPracticeAnswerSummary(question: Question) {
  if (isDeletedQuestion(question)) {
    return DELETED_QUESTION_NOTE;
  }
  return formatAcceptedAnswerLabels(question) || '—';
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
      border: '1px solid rgba(37,99,235,0.35)',
      background: 'var(--blue-soft)',
      keyBg: 'var(--blue)',
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

export function getPracticeSessionStats(sessionAnswers: (null | { selected: string; correct: boolean; ignored?: boolean })[]) {
  const scored = sessionAnswers.filter((answer) => answer && !answer.ignored);
  const correct = scored.filter((answer) => answer?.correct).length;
  const incorrect = scored.filter((answer) => answer && !answer.correct).length;
  const answered = correct + incorrect;
  const accuracy = answered > 0 ? Math.round((correct / answered) * 100) : 0;
  const xpEarned = correct * 10 + incorrect * 2;

  return { correct, incorrect, answered, accuracy, xpEarned };
}
