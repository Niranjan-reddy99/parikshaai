import {
  type ExamOutline,
  type ExamPaperManifest,
  type Question,
} from '../types';

// ── Exam first-page cache (stale-while-revalidate) ──────────────────────────
// Keyed by the same buildQuestionSetKey string used by App.tsx examCache.
// TTL: 2 hours — questions almost never change during a user session.

const VERSION = 'qsv1';
const TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const OUTLINE_VERSION = 'eov1';
const OUTLINE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const MANIFEST_VERSION = 'epv1';
const MANIFEST_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export interface CachedFirstPage {
  questions: Question[];
  totalCount: number;
  hasMore: boolean;
  nextCursor: string | null;
  ts: number;
}

interface CachedExamOutline {
  data: ExamOutline;
  ts: number;
}

interface CachedExamManifest {
  data: ExamPaperManifest;
  ts: number;
}

function lsKey(questionSetKey: string): string {
  return `${VERSION}_${questionSetKey}`;
}

function outlineLsKey(questionSetKey: string): string {
  return `${OUTLINE_VERSION}_${questionSetKey}`;
}

function manifestLsKey(examName: string, year: number): string {
  return `${MANIFEST_VERSION}_${examName}::${year}`;
}

export function getCachedFirstPage(questionSetKey: string): CachedFirstPage | null {
  try {
    const raw = localStorage.getItem(lsKey(questionSetKey));
    if (!raw) return null;
    const data: CachedFirstPage = JSON.parse(raw);
    if (Date.now() - data.ts > TTL_MS) {
      localStorage.removeItem(lsKey(questionSetKey));
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function setCachedFirstPage(
  questionSetKey: string,
  data: Omit<CachedFirstPage, 'ts'>,
): void {
  try {
    localStorage.setItem(lsKey(questionSetKey), JSON.stringify({ ...data, ts: Date.now() }));
  } catch {
    // localStorage quota exceeded — silently skip, app still works
  }
}

export function getCachedExamOutline(questionSetKey: string): ExamOutline | null {
  try {
    const raw = localStorage.getItem(outlineLsKey(questionSetKey));
    if (!raw) return null;
    const cached: CachedExamOutline = JSON.parse(raw);
    if (Date.now() - cached.ts > OUTLINE_TTL_MS) {
      localStorage.removeItem(outlineLsKey(questionSetKey));
      return null;
    }
    return cached.data;
  } catch {
    return null;
  }
}

export function setCachedExamOutline(questionSetKey: string, data: ExamOutline): void {
  try {
    localStorage.setItem(
      outlineLsKey(questionSetKey),
      JSON.stringify({ data, ts: Date.now() } satisfies CachedExamOutline)
    );
  } catch {
    // ignore cache write failures
  }
}

export function getCachedExamManifest(
  examName: string,
  year: number
): ExamPaperManifest | null {
  try {
    const raw = localStorage.getItem(manifestLsKey(examName, year));
    if (!raw) return null;
    const cached: CachedExamManifest = JSON.parse(raw);
    if (Date.now() - cached.ts > MANIFEST_TTL_MS) {
      localStorage.removeItem(manifestLsKey(examName, year));
      return null;
    }
    return cached.data;
  } catch {
    return null;
  }
}

export function setCachedExamManifest(
  examName: string,
  year: number,
  data: ExamPaperManifest
): void {
  try {
    localStorage.setItem(
      manifestLsKey(examName, year),
      JSON.stringify({ data, ts: Date.now() } satisfies CachedExamManifest)
    );
  } catch {
    // ignore cache write failures
  }
}

export function invalidateCachedExam(examName: string, year: number): void {
  try {
    const toRemove: string[] = [];
    const questionPrefix = `${VERSION}_${examName}::${year}::`;
    const outlinePrefix = `${OUTLINE_VERSION}_${examName}::${year}::`;
    const manifestKey = `${MANIFEST_VERSION}_${examName}::${year}`;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (
        k?.startsWith(questionPrefix) ||
        k?.startsWith(outlinePrefix) ||
        k === manifestKey
      ) {
        toRemove.push(k);
      }
    }
    toRemove.forEach(k => localStorage.removeItem(k));
  } catch {
    // ignore
  }
}

// ── Topic session cache (stale-while-revalidate) ────────────────────────────
// Keyed by subject + topic. TTL: 30 minutes.
// Stores the first page of a topic practice session so repeat opens are instant.

const TOPIC_VERSION = 'tqv2';
const TOPIC_TTL_MS = 30 * 60 * 1000; // 30 minutes

export interface CachedTopicPage {
  questions: Question[];
  total: number;
  hasMore: boolean;
  nextOffset: number | null;
  ts: number;
}

function topicLsKey(subject: string, topic: string): string {
  return `${TOPIC_VERSION}_${subject}::${topic}`;
}

export function getCachedTopicPage(subject: string, topic: string): CachedTopicPage | null {
  try {
    const raw = localStorage.getItem(topicLsKey(subject, topic));
    if (!raw) return null;
    const data: CachedTopicPage = JSON.parse(raw);
    if (Date.now() - data.ts > TOPIC_TTL_MS) {
      localStorage.removeItem(topicLsKey(subject, topic));
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function setCachedTopicPage(
  subject: string,
  topic: string,
  data: Omit<CachedTopicPage, 'ts'>,
): void {
  try {
    localStorage.setItem(topicLsKey(subject, topic), JSON.stringify({ ...data, ts: Date.now() }));
  } catch {
    // quota exceeded — skip silently
  }
}
