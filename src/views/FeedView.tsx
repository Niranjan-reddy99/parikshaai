import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { C } from '../lib/tokens';
import { type QuestionMeta, type View } from '../types/index';
import {
  cleanBucketLabel,
  normalizeLooseLabel,
} from '../lib/topicTaxonomy';

interface FeedViewProps {
  questions: QuestionMeta[];
  setView: (v: View) => void;
  startPractice?: (examName: string, year: number, subject?: string, topic?: string) => void;
  startTopicPractice?: (subject: string, topic: string) => void;
}

type SubtopicNode = {
  subtopic: string;
  count: number;
  years: Set<number>;
  latestExam: string;
  latestYear: number;
};

type TopicNode = {
  topic: string;
  count: number;
  years: Set<number>;
  latestExam: string;
  latestYear: number;
  subtopics: Record<string, SubtopicNode>;
};

type SubjectNode = {
  subject: string;
  count: number;
  exams: Set<string>;
  years: Set<number>;
  latestExam: string;
  latestYear: number;
  topics: Record<string, TopicNode>;
};

export function FeedView({ questions, setView, startPractice, startTopicPractice }: FeedViewProps) {
  const [expandedSubjects, setExpandedSubjects] = useState<Record<string, boolean>>({});
  const [expandedTopics, setExpandedTopics] = useState<Record<string, boolean>>({});

  const subjectFeed = useMemo(() => {
    const subjectMap: Record<string, SubjectNode> = {};

    for (const q of questions) {
      // `/questions/meta` is already canonicalized by the backend. Re-mapping it
      // again in the client causes feed counts to diverge from `/topic-questions`.
      const subject = normalizeLooseLabel(cleanBucketLabel(q.subject, 'General Awareness'));
      const topic = normalizeLooseLabel(cleanBucketLabel(q.topic, 'General'));
      const subtopic = normalizeLooseLabel(cleanBucketLabel(q.subtopic, topic));

      if (!subjectMap[subject]) {
        subjectMap[subject] = {
          subject,
          count: 0,
          exams: new Set(),
          years: new Set(),
          latestExam: q.exam,
          latestYear: q.year,
          topics: {},
        };
      }

      const subjectNode = subjectMap[subject];
      subjectNode.count++;
      subjectNode.exams.add(q.exam.split(' ')[0]);
      subjectNode.years.add(q.year);
      if (q.year > subjectNode.latestYear) {
        subjectNode.latestYear = q.year;
        subjectNode.latestExam = q.exam;
      }

      if (!subjectNode.topics[topic]) {
        subjectNode.topics[topic] = {
          topic,
          count: 0,
          years: new Set(),
          latestExam: q.exam,
          latestYear: q.year,
          subtopics: {},
        };
      }

      const topicNode = subjectNode.topics[topic];
      topicNode.count++;
      topicNode.years.add(q.year);
      if (q.year > topicNode.latestYear) {
        topicNode.latestYear = q.year;
        topicNode.latestExam = q.exam;
      }

      if (!topicNode.subtopics[subtopic]) {
        topicNode.subtopics[subtopic] = {
          subtopic,
          count: 0,
          years: new Set(),
          latestExam: q.exam,
          latestYear: q.year,
        };
      }

      const subtopicNode = topicNode.subtopics[subtopic];
      subtopicNode.count++;
      subtopicNode.years.add(q.year);
      if (q.year > subtopicNode.latestYear) {
        subtopicNode.latestYear = q.year;
        subtopicNode.latestExam = q.exam;
      }
    }

    return Object.values(subjectMap)
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        if (b.years.size !== a.years.size) return b.years.size - a.years.size;
        return a.subject.localeCompare(b.subject);
      })
      .map(subject => ({
        ...subject,
        topicList: Object.values(subject.topics)
          .sort((a, b) => {
            if (b.count !== a.count) return b.count - a.count;
            if (b.years.size !== a.years.size) return b.years.size - a.years.size;
            return a.topic.localeCompare(b.topic);
          })
          .map(topic => ({
            ...topic,
            subtopicList: Object.values(topic.subtopics)
              .sort((a, b) => {
                if (b.count !== a.count) return b.count - a.count;
                if (b.years.size !== a.years.size) return b.years.size - a.years.size;
                return a.subtopic.localeCompare(b.subtopic);
              }),
          })),
      }));
  }, [questions]);

  const totalQuestions = useMemo(
    () => subjectFeed.reduce((sum, subject) => sum + subject.count, 0),
    [subjectFeed]
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 980, margin: '0 auto' }}>
      <div className="glass-panel" style={{ borderRadius: 16, padding: '24px 28px', borderLeft: `4px solid ${C.accent}` }}>
        <div style={{ fontSize: 18, fontFamily: "'Fraunces', Georgia, serif", color: C.text, marginBottom: 4, letterSpacing: '-0.3px' }}>
          PYQ Intelligence Feed
        </div>
        <div style={{ fontSize: 13, color: C.textSec }}>
          Subject-first view of your question bank with topic and subtopic drilldown across the full database
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
          <span style={{ fontSize: 11, color: C.textSec, background: C.bg, border: `1px solid ${C.border}`, padding: '4px 10px', borderRadius: 99 }}>
            {subjectFeed.length} subjects
          </span>
          <span style={{ fontSize: 11, color: C.textSec, background: C.bg, border: `1px solid ${C.border}`, padding: '4px 10px', borderRadius: 99 }}>
            {totalQuestions} tagged questions
          </span>
        </div>
      </div>

      {subjectFeed.length === 0 ? (
        <div className="glass-panel" style={{ borderRadius: 16, padding: 60, textAlign: 'center', color: C.textSec }}>
          No question data yet. Add exams to see the intelligence feed.
        </div>
      ) : (
        <div className="glass-panel" style={{ borderRadius: 20, overflow: 'hidden' }}>
          {subjectFeed.map((subject) => {
            const subjectOpen = !!expandedSubjects[subject.subject];
            return (
              <div key={subject.subject} style={{ borderBottom: `1px solid ${C.border}` }}>
                <button
                  onClick={() => setExpandedSubjects(prev => ({ ...prev, [subject.subject]: !prev[subject.subject] }))}
                  style={{
                    width: '100%',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '18px 22px',
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                  }}
                >
                  {subjectOpen ? <ChevronDown size={16} color={C.textTert} /> : <ChevronRight size={16} color={C.textTert} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{subject.subject}</span>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: C.accent, background: C.accentDim, border: `1px solid ${C.accent}30`, padding: '3px 10px', borderRadius: 99 }}>
                          {subject.count}Q
                        </span>
                        <span style={{ fontSize: 11, color: C.textSec, background: C.bg, border: `1px solid ${C.border}`, padding: '3px 10px', borderRadius: 99 }}>
                          {subject.years.size} year{subject.years.size !== 1 ? 's' : ''}
                        </span>
                        <span style={{ fontSize: 11, color: C.textSec, background: C.bg, border: `1px solid ${C.border}`, padding: '3px 10px', borderRadius: 99 }}>
                          {Object.keys(subject.topics).length} topics
                        </span>
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: C.textSec }}>
                      Last seen in {subject.latestYear} · {Array.from(subject.exams).slice(0, 4).join(' · ')}
                    </div>
                  </div>
                </button>

                {subjectOpen && (
                  <div style={{ padding: '0 22px 18px 44px', display: 'grid', gap: 10 }}>
                    {subject.topicList.map((topic) => {
                      const topicKey = `${subject.subject}::${topic.topic}`;
                      const topicOpen = !!expandedTopics[topicKey];
                      return (
                        <div key={topicKey} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14 }}>
                          <button
                            onClick={() => setExpandedTopics(prev => ({ ...prev, [topicKey]: !prev[topicKey] }))}
                            style={{
                              width: '100%',
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              padding: '14px 16px',
                              textAlign: 'left',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 12,
                            }}
                          >
                            {topicOpen ? <ChevronDown size={15} color={C.textTert} /> : <ChevronRight size={15} color={C.textTert} />}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 3 }}>
                                <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{topic.topic}</span>
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                  <span style={{ fontSize: 10, fontWeight: 700, color: C.blue, background: C.blueDim, border: `1px solid ${C.blue}30`, padding: '3px 8px', borderRadius: 99 }}>
                                    {topic.count}Q
                                  </span>
                                  <span style={{ fontSize: 10, color: C.textSec, background: C.bg, border: `1px solid ${C.border}`, padding: '3px 8px', borderRadius: 99 }}>
                                    {topic.subtopicList.length} subtopics
                                  </span>
                                </div>
                              </div>
                              <div style={{ fontSize: 10, color: C.textSec }}>
                                Last seen in {topic.latestYear}
                              </div>
                            </div>
                            {(startTopicPractice || startPractice) && (
                              <span
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (startTopicPractice) {
                                    startTopicPractice(subject.subject, topic.topic);
                                    return;
                                  }
                                  startPractice?.(topic.latestExam, topic.latestYear, subject.subject, topic.topic);
                                }}
                                style={{
                                  padding: '7px 10px',
                                  background: C.accentDim,
                                  border: `1px solid ${C.accent}40`,
                                  borderRadius: 10,
                                  fontSize: 10,
                                  fontWeight: 700,
                                  color: C.accentText,
                                  flexShrink: 0,
                                }}
                              >
                                Practice
                              </span>
                            )}
                          </button>

                          {topicOpen && (
                            <div style={{ padding: '0 16px 14px 43px', display: 'grid', gap: 8 }}>
                              {topic.subtopicList.map((subtopic) => (
                                <div
                                  key={`${topicKey}::${subtopic.subtopic}`}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: 12,
                                    padding: '10px 12px',
                                    background: C.bg,
                                    border: `1px solid ${C.border}`,
                                    borderRadius: 10,
                                  }}
                                >
                                  <div style={{ minWidth: 0, flex: 1 }}>
                                    <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 2 }}>
                                      {subtopic.subtopic}
                                    </div>
                                    <div style={{ fontSize: 10, color: C.textSec }}>
                                      {subtopic.count}Q · {subtopic.years.size} year{subtopic.years.size !== 1 ? 's' : ''} · last {subtopic.latestYear}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
