import React, { useMemo } from 'react';
import { C } from '../lib/tokens';
import { type Question, type View } from '../types/index';

interface FeedViewProps {
  questions: Question[];
  setView: (v: View) => void;
  startPractice?: (examName: string, year: number, subject?: string, topic?: string) => void;
}

export function FeedView({ questions, setView, startPractice }: FeedViewProps) {
  const feedItems = useMemo(() => {
    // Count topic frequency across all years and exams
    const topicMap: Record<string, {
      subject: string;
      count: number;
      exams: Set<string>;
      years: Set<number>;
      latestExam: string;
      latestYear: number;
    }> = {};

    for (const q of questions) {
      const key = `${q.subject}::${q.topic}`;
      if (!topicMap[key]) {
        topicMap[key] = { subject: q.subject, count: 0, exams: new Set(), years: new Set(), latestExam: q.exam, latestYear: q.year };
      }
      const entry = topicMap[key];
      entry.count++;
      entry.exams.add(q.exam.split(' ')[0]); // commission short name
      entry.years.add(q.year);
      if (q.year > entry.latestYear) { entry.latestYear = q.year; entry.latestExam = q.exam; }
    }

    // Compute raw scores first, then normalize to 40–99 range
    const rawItems = Object.entries(topicMap).map(([key, v]) => ({
      topic: key.split('::')[1],
      subject: v.subject,
      appearances: v.count,
      exams: [...v.exams].slice(0, 3),
      examCount: v.exams.size,
      yearCount: v.years.size,
      latestExam: v.latestExam,
      latestYear: v.latestYear,
      raw: v.count * 4 + v.years.size * 6 + v.exams.size * 5,
      trend: v.years.size >= 3 ? 'stable' : v.count >= 3 ? 'rising' : ('rising' as string),
    }));

    const maxRaw = Math.max(...rawItems.map(x => x.raw), 1);
    const minRaw = Math.min(...rawItems.map(x => x.raw), 0);
    const range = maxRaw - minRaw || 1;

    return rawItems
      .map(item => ({
        ...item,
        predictionScore: Math.round(40 + ((item.raw - minRaw) / range) * 59),
      }))
      .sort((a, b) => b.predictionScore - a.predictionScore)
      .slice(0, 10);
  }, [questions]);

  const trendIcon: Record<string, string> = { rising: '↑', stable: '→', declining: '↓' };
  const trendColor: Record<string, string> = { rising: C.accent, stable: C.textSec, declining: C.danger };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: '16px 20px' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 2 }}>PYQ Intelligence Feed</div>
        <div style={{ fontSize: 12, color: C.textSec }}>
          Topics ranked by frequency, cross-exam appearances, and year spread — from your question bank
        </div>
      </div>

      {feedItems.length === 0 ? (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 40, textAlign: 'center', color: C.textSec }}>
          No question data yet. Add exams to see the intelligence feed.
        </div>
      ) : feedItems.map((item, i) => (
        <div key={i} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{item.topic}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: trendColor[item.trend] }}>{trendIcon[item.trend]}</span>
              </div>
              <div style={{ fontSize: 11, color: C.textSec }}>{item.subject}</div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: C.accent, fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>{item.predictionScore}</div>
              <div style={{ fontSize: 10, color: C.textSec }}>prediction score</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            {item.exams.map(e => (
              <span key={e} style={{ fontSize: 10, fontWeight: 600, color: C.blue, background: C.blueDim, border: `1px solid ${C.blue}30`, padding: '3px 10px', borderRadius: 99 }}>{e}</span>
            ))}
            <span style={{ fontSize: 10, color: C.textSec, background: C.bg, border: `1px solid ${C.border}`, padding: '3px 10px', borderRadius: 99 }}>
              {item.appearances}× across {item.yearCount} year{item.yearCount !== 1 ? 's' : ''}
            </span>
            <span style={{ fontSize: 10, color: C.textTert, background: C.bg, border: `1px solid ${C.border}`, padding: '3px 10px', borderRadius: 99 }}>
              Last: {item.latestYear}
            </span>
          </div>

          <div style={{ height: 4, background: C.border, borderRadius: 99, marginBottom: 12 }}>
            <div style={{ height: '100%', width: `${item.predictionScore}%`, background: `linear-gradient(90deg, ${C.accent}, #00FFAA)`, borderRadius: 99 }} />
          </div>

          {startPractice && (
            <button
              onClick={() => startPractice(item.latestExam, item.latestYear, item.subject, item.topic)}
              style={{ padding: '9px 18px', background: C.accentDim, border: `1px solid ${C.accent}30`, borderRadius: 10, fontSize: 12, fontWeight: 700, color: C.accent, cursor: 'pointer' }}>
              Practice this topic →
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
