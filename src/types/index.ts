export interface Question {
  id?: string;
  question: string;
  options: { A: string; B: string; C: string; D: string };
  answer?: string;
  explanation?: string;
  subject: string;
  topic: string;
  subtopic: string;
  difficulty: string;
  concept: string;
  type: string;
  year: number;
  exam: string;
  passage?: string;
  shift?: string;
}

export type View = 'dashboard' | 'home' | 'commission' | 'exam-detail' | 'practice' | 'mock' | 'results' | 'browse' | 'report' | 'feed' | 'badges' | 'leaderboard';

export interface ExamSession {
  questions: Question[];
  currentIndex: number;
  answers: Record<number, string>;
  startTime: number;
  duration: number;
  isFinished: boolean;
  examName: string;
  year: number;
}

export interface ExamInfo {
  years: number[];
  count: number;
  difficulty: Record<string, number>;
  fullName: string;
}

export type CommissionMap = Record<string, Record<string, ExamInfo>>;

export interface WeightageItem {
  subject: string;
  count: number;
  pct: number;
  topics: {
    topic: string;
    count: number;
    pct: number;
    subtopics: { subtopic: string; count: number; pct: number }[];
  }[];
}
