import { API_BASE } from './api';

export interface RecentAttempt {
  q: string;
  correct: boolean;
  subject: string;
  topic: string;
  subtopic?: string;
  pattern_tag?: string;
  time: string;
}

export interface UserStats {
  bySubject: Record<string, { correct: number; total: number }>;
  byTopic: Record<string, { subject: string; topic: string; subtopic: string; correct: number; total: number }>;
  byPattern: Record<string, { correct: number; total: number }>;
  streak: number;
  lastActiveDate: string;
  xp: number;
  totalAnswered: number;
  recentAttempts: RecentAttempt[];
  dailyActivity: Record<string, number>; // ISO date → questions answered
}

const KEY = (uid: string) => `pyq_stats_${uid}`;

const EMPTY: UserStats = {
  bySubject: {}, byTopic: {}, byPattern: {}, streak: 0, lastActiveDate: '', xp: 0,
  totalAnswered: 0, recentAttempts: [], dailyActivity: {},
};

export function getStats(uid: string): UserStats {
  try {
    const raw = localStorage.getItem(KEY(uid));
    if (raw) return { ...EMPTY, ...JSON.parse(raw) };
  } catch {}
  return { ...EMPTY };
}

export function updateStats(
  uid: string,
  subject: string,
  topic: string,
  questionText: string,
  correct: boolean,
  startTimeMs: number,
  subtopic?: string,
  pattern_tag?: string,
): UserStats {
  const stats = getStats(uid);
  if (!stats.byTopic) stats.byTopic = {};
  if (!stats.byPattern) stats.byPattern = {};

  // Subject accuracy
  if (!stats.bySubject[subject]) stats.bySubject[subject] = { correct: 0, total: 0 };
  stats.bySubject[subject].total++;
  if (correct) stats.bySubject[subject].correct++;
  stats.totalAnswered++;

  // Topic accuracy
  const topicKey = `${subject}::${topic}`;
  if (!stats.byTopic[topicKey]) stats.byTopic[topicKey] = { subject, topic, subtopic: subtopic || '', correct: 0, total: 0 };
  stats.byTopic[topicKey].total++;
  if (correct) stats.byTopic[topicKey].correct++;

  // Pattern accuracy
  if (pattern_tag) {
    if (!stats.byPattern[pattern_tag]) stats.byPattern[pattern_tag] = { correct: 0, total: 0 };
    stats.byPattern[pattern_tag].total++;
    if (correct) stats.byPattern[pattern_tag].correct++;
  }

  // Streak
  const today = new Date().toISOString().split('T')[0];
  if (stats.lastActiveDate !== today) {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().split('T')[0];
    stats.streak = stats.lastActiveDate === yesterday ? stats.streak + 1 : 1;
    stats.lastActiveDate = today;
  }

  // Daily activity heatmap
  if (!stats.dailyActivity) stats.dailyActivity = {};
  stats.dailyActivity[today] = (stats.dailyActivity[today] || 0) + 1;

  // XP
  stats.xp += correct ? 10 : 2;

  // Recent attempts (keep last 20)
  const secs = Math.round((Date.now() - startTimeMs) / 1000);
  const timeStr = secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;
  stats.recentAttempts.unshift({
    q: questionText.slice(0, 90),
    correct, subject, topic,
    subtopic: subtopic || undefined,
    pattern_tag: pattern_tag || undefined,
    time: timeStr,
  });
  stats.recentAttempts = stats.recentAttempts.slice(0, 20);

  localStorage.setItem(KEY(uid), JSON.stringify(stats));

  return stats;
}

/** Bulk-sync localStorage stats to Supabase on login or after each update. */
export async function syncStatsToApi(uid: string, stats?: UserStats, token?: string): Promise<void> {
  const s = stats ?? getStats(uid);
  if (!s.totalAnswered || !token) return;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  await fetch(`${API_BASE}/user/sync-local`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify({
      by_subject: s.bySubject,
      streak: s.streak,
      last_active_date: s.lastActiveDate,
      xp: s.xp,
      total_answered: s.totalAnswered,
      daily_activity: s.dailyActivity,
    }),
  });
}

export function xpToLevel(xp: number): { level: number; levelName: string; xpNext: number } {
  const thresholds = [0, 500, 1200, 2500, 5000, 10000, 20000];
  const names = ['Novice', 'Aspirant', 'Scholar', 'Expert', 'Master', 'Legend', 'Champion'];
  let level = 0;
  for (let i = 0; i < thresholds.length - 1; i++) {
    if (xp >= thresholds[i]) level = i;
  }
  return { level: level + 1, levelName: names[level], xpNext: thresholds[level + 1] ?? xp + 1000 };
}
