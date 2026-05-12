import { type Question } from '../types';

const VALID_ANSWER = new Set(['A', 'B', 'C', 'D']);

function normalizeAnswerArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => String(item || '').trim().toUpperCase())
        .filter((item) => VALID_ANSWER.has(item))
    )
  );
}

export function getAcceptedAnswers(question: Partial<Question> | null | undefined): string[] {
  const fromArray = normalizeAnswerArray(question?.answers);
  if (fromArray.length) return fromArray;
  const single = String(question?.answer || '').trim().toUpperCase();
  return VALID_ANSWER.has(single) ? [single] : [];
}

export function getPrimaryAcceptedAnswer(question: Partial<Question> | null | undefined): string {
  return getAcceptedAnswers(question)[0] || '';
}

export function hasMultipleAcceptedAnswers(question: Partial<Question> | null | undefined): boolean {
  return getAcceptedAnswers(question).length > 1;
}

export function isDeletedQuestion(question: Partial<Question> | null | undefined): boolean {
  return String(question?.answerStatus || '').trim().toLowerCase() === 'deleted';
}

export function isAcceptedAnswer(question: Partial<Question> | null | undefined, optionKey: string): boolean {
  return getAcceptedAnswers(question).includes(String(optionKey || '').trim().toUpperCase());
}

export function formatAcceptedAnswerLabels(question: Partial<Question> | null | undefined): string {
  return getAcceptedAnswers(question).join(', ');
}

export function formatAcceptedAnswerDetails(question: Partial<Question> | null | undefined): string {
  const answers = getAcceptedAnswers(question);
  if (!answers.length) return '—';
  const options = question?.options || { A: '', B: '', C: '', D: '' };
  return answers
    .map((key) => `${key}: ${options[key as keyof typeof options] || ''}`.trim())
    .join('  |  ');
}
