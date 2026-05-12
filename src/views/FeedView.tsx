import { useMemo, useState } from 'react';
import { type FeedSubjectSummary, type View } from '../types/index';
import { CARD_GRADIENTS, COMMISSION_COLORS } from './browse/browseConfig';

interface FeedViewProps {
  subjects: FeedSubjectSummary[];
  setView: (v: View) => void;
  startPractice?: (examName: string, year: number, subject?: string, topic?: string) => void;
  startTopicPractice?: (subject: string, topic: string) => void;
}

type FeedTab = 'by-topic' | 'by-exam';
type SortMode = 'count' | 'az';

interface TopicItem {
  subject: string;
  topic: string;
  yearCount: number;
  count: number;
  latestExam: string;
  latestYear: number;
}

interface ExamEntry {
  name: string;
  topicCount: number;
  latestYear: number;
}

const SUBJECT_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  'Polity':                { bg: '#dbeafe', text: '#1e40af', dot: '#2563eb' },
  'History':               { bg: '#fef3c7', text: '#92400e', dot: '#d97706' },
  'Geography':             { bg: '#d1fae5', text: '#065f46', dot: '#059669' },
  'Economy':               { bg: '#ede9fe', text: '#6d28d9', dot: '#7c3aed' },
  'Environment':           { bg: '#dcfce7', text: '#166534', dot: '#16a34a' },
  'Science & Technology':  { bg: '#e0f2fe', text: '#0369a1', dot: '#0ea5e9' },
  'Current Affairs':       { bg: '#fce7f3', text: '#9d174d', dot: '#ec4899' },
  'Logical Reasoning':     { bg: '#f3e8ff', text: '#6b21a8', dot: '#9333ea' },
  'Quantitative Aptitude': { bg: '#ccfbf1', text: '#0f766e', dot: '#0d9488' },
  'English Language':      { bg: '#fee2e2', text: '#991b1b', dot: '#dc2626' },
  'General Awareness':     { bg: '#f0fdf4', text: '#166534', dot: '#22c55e' },
};

const COMMISSION_META: Record<string, { label: string; desc: string; category: string }> = {
  'UPSC':    { label: 'UPSC',      desc: 'Union Public Service Commission',   category: 'Civil Services' },
  'TSPSC':   { label: 'TSPSC',     desc: 'Telangana State PSC',               category: 'State PSC' },
  'APPSC':   { label: 'APPSC',     desc: 'Andhra Pradesh PSC',                category: 'State PSC' },
  'AP':      { label: 'AP Courts', desc: 'AP High Court & Subordinate Courts', category: 'Judiciary' },
  'TSLPRB':  { label: 'TSLPRB',   desc: 'Telangana Police Recruitment',       category: 'State Police' },
  'APSLPRB': { label: 'APSLPRB',  desc: 'AP Police Recruitment Board',        category: 'State Police' },
};

function getSubjectStyle(subject: string) {
  return SUBJECT_COLORS[subject] ?? { bg: '#f3f4f6', text: '#374151', dot: '#6b7280' };
}

function commissionOf(examName: string): string {
  return examName.split(' ')[0]?.toUpperCase() ?? 'OTHER';
}

function RepBadge({ yearCount }: { yearCount: number }) {
  if (yearCount >= 5)
    return <span style={{ fontSize: 10, fontWeight: 600, color: '#16a34a', background: '#dcfce7', padding: '2px 6px', borderRadius: 99 }}>High Rep</span>;
  if (yearCount >= 2)
    return <span style={{ fontSize: 10, fontWeight: 600, color: '#d97706', background: '#fef3c7', padding: '2px 6px', borderRadius: 99 }}>Med Rep</span>;
  return null;
}

function ChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function ChevronLeft() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'none', border: '1px solid var(--border)', borderRadius: 7,
        padding: '5px 12px', cursor: 'pointer', fontSize: 12.5,
        color: 'var(--text-sec)', display: 'flex', alignItems: 'center',
        gap: 4, fontFamily: 'inherit',
      }}
    >
      <ChevronLeft /> {label}
    </button>
  );
}

function TopicCard({ item, onClick }: { item: TopicItem; onClick: () => void }) {
  const [hov, setHov] = useState(false);
  const { bg, text, dot } = getSubjectStyle(item.subject);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: hov ? 'var(--bg-alt)' : 'var(--bg)',
        border: `1px solid ${hov ? '#2563eb50' : 'var(--border)'}`,
        borderRadius: 10, padding: '13px 16px', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 13,
        transition: 'border-color 0.13s, background 0.13s',
      }}
    >
      <div style={{ width: 34, height: 34, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: bg }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: dot, display: 'block' }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)', marginBottom: 5, lineHeight: 1.3 }}>
          {item.topic}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: text, background: bg, padding: '2px 7px', borderRadius: 99 }}>
            {item.subject}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-tert)' }}>{item.count} Qs in PYQs</span>
          <RepBadge yearCount={item.yearCount} />
        </div>
      </div>
      <span style={{ color: 'var(--text-tert)', flexShrink: 0 }}><ChevronRight /></span>
    </div>
  );
}

function SubjectPills({ subjects, selected, onChange }: {
  subjects: string[]; selected: string; onChange: (s: string) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 18 }}>
      {['All', ...subjects].map(s => {
        const active = s === selected;
        const { bg, text } = getSubjectStyle(s);
        return (
          <button
            key={s}
            onClick={() => onChange(s)}
            style={{
              padding: '5px 13px', fontSize: 12.5,
              fontWeight: active ? 700 : 500,
              color: active ? text : 'var(--text-sec)',
              background: active ? bg : 'var(--bg)',
              border: `1.5px solid ${active ? text + '60' : 'var(--border)'}`,
              borderRadius: 99, cursor: 'pointer', fontFamily: 'inherit',
              transition: 'all 0.12s',
            }}
          >
            {s}
          </button>
        );
      })}
    </div>
  );
}

// ─── Commission card (gradient) ─────────────────────────────────────────────
function CommissionCard({ commission, examCount, topicCount, onPick }: {
  commission: string;
  examCount: number;
  topicCount: number;
  onPick: () => void;
}) {
  const [hov, setHov] = useState(false);
  const meta = COMMISSION_META[commission];
  const label = meta?.label ?? commission;
  const desc = meta?.desc ?? commission;
  const category = meta?.category ?? 'Exam';
  const gradient = CARD_GRADIENTS[commission] || 'linear-gradient(135deg, #374151, #6b7280)';
  const accentColor = COMMISSION_COLORS[commission] || '#475569';

  return (
    <div
      onClick={onPick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: gradient,
        borderRadius: 14,
        cursor: 'pointer',
        overflow: 'hidden',
        transition: 'transform 0.18s ease, box-shadow 0.18s ease',
        transform: hov ? 'translateY(-3px)' : 'none',
        boxShadow: hov ? `0 12px 32px ${accentColor}45` : '0 2px 8px rgba(0,0,0,0.12)',
        userSelect: 'none',
      }}
    >
      <div style={{ padding: '20px 20px 16px' }}>
        <div style={{
          display: 'inline-block',
          background: 'rgba(255,255,255,0.18)',
          color: 'rgba(255,255,255,0.9)',
          fontSize: 10, fontWeight: 700,
          padding: '3px 9px', borderRadius: 99,
          marginBottom: 14,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}>
          {category}
        </div>
        <div style={{
          fontSize: 22, fontWeight: 800,
          color: 'white', lineHeight: 1.15,
          marginBottom: 5, letterSpacing: '-0.3px',
        }}>
          {label}
        </div>
        <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.65)', lineHeight: 1.4 }}>
          {desc}
        </div>
      </div>
      <div style={{
        background: 'rgba(0,0,0,0.22)',
        padding: '11px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', gap: 20 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'white', lineHeight: 1 }}>{examCount}</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', marginTop: 2, fontWeight: 500 }}>Papers</div>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'white', lineHeight: 1 }}>{topicCount}</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', marginTop: 2, fontWeight: 500 }}>Topics</div>
          </div>
        </div>
        <svg
          width="18" height="18" viewBox="0 0 24 24" fill="none"
          stroke="rgba(255,255,255,0.75)" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round"
          style={{ transition: 'transform 0.15s', transform: hov ? 'translateX(3px)' : 'none' }}
        >
          <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
        </svg>
      </div>
    </div>
  );
}

// ─── Exam row ────────────────────────────────────────────────────────────────
function ExamRow({ exam, accentColor, onPick }: { exam: ExamEntry; accentColor: string; onPick: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onClick={onPick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 16px',
        background: hov ? 'var(--bg-alt)' : 'var(--bg)',
        border: `1px solid ${hov ? accentColor + '40' : 'var(--border)'}`,
        borderRadius: 10, cursor: 'pointer',
        transition: 'border-color 0.13s, background 0.13s, box-shadow 0.13s',
        boxShadow: hov ? `inset 3px 0 0 ${accentColor}` : `inset 3px 0 0 ${accentColor}80`,
        gap: 12,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)', lineHeight: 1.3 }}>{exam.name}</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-tert)', marginTop: 3 }}>
          {exam.topicCount} topic{exam.topicCount !== 1 ? 's' : ''} covered
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{
          fontSize: 12, fontWeight: 700, color: accentColor,
          background: accentColor + '18', padding: '4px 10px', borderRadius: 7,
        }}>
          {exam.latestYear}
        </span>
        <span style={{ color: 'var(--text-tert)' }}><ChevronRight /></span>
      </div>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────
export function FeedView({ subjects, startPractice, startTopicPractice }: FeedViewProps) {
  const [tab, setTab] = useState<FeedTab>('by-topic');
  const [sortMode, setSortMode] = useState<SortMode>('count');
  const [filterSubject, setFilterSubject] = useState('All');

  const [selectedCommission, setSelectedCommission] = useState<string | null>(null);
  const [selectedExam, setSelectedExam] = useState<string | null>(null);
  const [examSubject, setExamSubject] = useState('All');

  const allTopics: TopicItem[] = useMemo(() => {
    const items: TopicItem[] = [];
    for (const sub of subjects) {
      for (const t of sub.topics) {
        items.push({
          subject: sub.subject, topic: t.topic,
          yearCount: t.year_count, count: t.count,
          latestExam: t.latest_exam, latestYear: t.latest_year,
        });
      }
    }
    return items;
  }, [subjects]);

  const subjectNames = useMemo(() => subjects.map(s => s.subject), [subjects]);

  const topicItems = useMemo(() => {
    let items = filterSubject === 'All' ? allTopics : allTopics.filter(i => i.subject === filterSubject);
    if (sortMode === 'az') return [...items].sort((a, b) => a.topic.localeCompare(b.topic));
    return [...items].sort((a, b) => b.count - a.count || b.yearCount - a.yearCount);
  }, [allTopics, filterSubject, sortMode]);

  // Build exam map — key by name, track unique topics only
  const examMap = useMemo(() => {
    const map = new Map<string, ExamEntry>();
    for (const item of allTopics) {
      if (!item.latestExam) continue;
      const e = map.get(item.latestExam) ?? { name: item.latestExam, topicCount: 0, latestYear: 0 };
      e.topicCount += 1;
      e.latestYear = Math.max(e.latestYear, item.latestYear);
      map.set(item.latestExam, e);
    }
    return map;
  }, [allTopics]);

  // Commission list — show paper count and unique topic count
  const commissions = useMemo(() => {
    const cMap = new Map<string, { examCount: number; topicCount: number }>();
    for (const [name, entry] of examMap) {
      const key = commissionOf(name);
      const c = cMap.get(key) ?? { examCount: 0, topicCount: 0 };
      c.examCount += 1;
      c.topicCount += entry.topicCount;
      cMap.set(key, c);
    }
    return Array.from(cMap.entries())
      .map(([key, data]) => ({ key, ...data }))
      .sort((a, b) => b.topicCount - a.topicCount);
  }, [examMap]);

  const commissionExams = useMemo(() => {
    if (!selectedCommission) return [];
    return Array.from(examMap.values())
      .filter(e => commissionOf(e.name) === selectedCommission)
      .sort((a, b) => b.latestYear - a.latestYear || b.topicCount - a.topicCount);
  }, [examMap, selectedCommission]);

  const examTopics = useMemo(() => {
    if (!selectedExam) return [];
    let items = allTopics.filter(i => i.latestExam === selectedExam);
    if (examSubject !== 'All') items = items.filter(i => i.subject === examSubject);
    return [...items].sort((a, b) => b.count - a.count);
  }, [allTopics, selectedExam, examSubject]);

  const examSubjectNames = useMemo(() => {
    if (!selectedExam) return [];
    const set = new Set(allTopics.filter(i => i.latestExam === selectedExam).map(i => i.subject));
    return Array.from(set).sort();
  }, [allTopics, selectedExam]);

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '9px 20px', fontSize: 13.5,
    fontWeight: active ? 700 : 500,
    color: active ? '#2563eb' : 'var(--text-sec)',
    background: 'none',
    borderTop: 'none', borderLeft: 'none', borderRight: 'none',
    borderBottom: `2px solid ${active ? '#2563eb' : 'transparent'}`,
    cursor: 'pointer', fontFamily: 'inherit',
    transition: 'color 0.1s, border-color 0.1s',
    whiteSpace: 'nowrap' as const,
  });

  function renderByExam() {
    // Step 3: topics for selected exam
    if (selectedExam) {
      const accentColor = COMMISSION_COLORS[selectedCommission ?? ''] || '#2563eb';
      return (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <BackButton label={COMMISSION_META[selectedCommission ?? '']?.label ?? 'Back'} onClick={() => { setSelectedExam(null); setExamSubject('All'); }} />
            <span style={{ fontSize: 12, color: 'var(--text-tert)' }}>›</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedExam}</span>
          </div>
          {/* Context banner */}
          <div style={{
            background: accentColor + '0d', border: `1px solid ${accentColor}25`,
            borderRadius: 9, padding: '10px 14px', marginBottom: 18,
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={accentColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span style={{ fontSize: 12, color: 'var(--text-sec)' }}>
              Showing topics this exam covers. Question counts reflect PYQ frequency across all exams — useful for spotting high-value areas.
            </span>
          </div>
          <SubjectPills subjects={examSubjectNames} selected={examSubject} onChange={setExamSubject} />
          <div style={{ fontSize: 12, color: 'var(--text-tert)', marginBottom: 14 }}>
            {examTopics.length} topic{examTopics.length !== 1 ? 's' : ''}{examSubject !== 'All' ? ` in ${examSubject}` : ''}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {examTopics.length === 0
              ? <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-tert)', fontSize: 13 }}>No topics found.</div>
              : examTopics.map((item, i) => (
                <TopicCard
                  key={`${item.subject}::${item.topic}::${i}`}
                  item={item}
                  onClick={() => startPractice?.(item.latestExam, item.latestYear, item.subject, item.topic)}
                />
              ))
            }
          </div>
        </>
      );
    }

    // Step 2: exam list for selected commission
    if (selectedCommission) {
      const accentColor = COMMISSION_COLORS[selectedCommission] || '#2563eb';
      const commLabel = COMMISSION_META[selectedCommission]?.label ?? selectedCommission;
      return (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
            <BackButton label="All Commissions" onClick={() => setSelectedCommission(null)} />
            <span style={{ fontSize: 12, color: 'var(--text-tert)' }}>›</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: accentColor }}>{commLabel}</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-sec)', marginBottom: 16 }}>
            {commissionExams.length} paper{commissionExams.length !== 1 ? 's' : ''} — select one to see which topics it covers
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {commissionExams.map(exam => (
              <ExamRow
                key={exam.name}
                exam={exam}
                accentColor={accentColor}
                onPick={() => { setSelectedExam(exam.name); setExamSubject('All'); }}
              />
            ))}
          </div>
        </>
      );
    }

    // Step 1: commission grid
    return (
      <>
        <div style={{ fontSize: 13, color: 'var(--text-sec)', marginBottom: 20 }}>
          Pick a commission to explore its exam papers and topic patterns.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 16 }}>
          {commissions.map(c => (
            <CommissionCard
              key={c.key}
              commission={c.key}
              examCount={c.examCount}
              topicCount={c.topicCount}
              onPick={() => setSelectedCommission(c.key)}
            />
          ))}
        </div>
      </>
    );
  }

  return (
    <div style={{ fontFamily: "'Inter', sans-serif" }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px', color: 'var(--text)', letterSpacing: '-0.3px' }}>
          PYQ Feed
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-sec)', margin: 0 }}>
          Browse topics and patterns from previous year questions.
        </p>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 22 }}>
        <button style={tabStyle(tab === 'by-topic')} onClick={() => { setTab('by-topic'); setFilterSubject('All'); }}>
          By Topic
        </button>
        <button style={tabStyle(tab === 'by-exam')} onClick={() => { setTab('by-exam'); setSelectedCommission(null); setSelectedExam(null); setExamSubject('All'); }}>
          By Exam
        </button>
      </div>

      {subjects.length === 0 ? (
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '60px 32px', textAlign: 'center', color: 'var(--text-sec)', fontSize: 14 }}>
          No question data yet. Add exams to see the PYQ feed.
        </div>
      ) : tab === 'by-topic' ? (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
            <SubjectPills subjects={subjectNames} selected={filterSubject} onChange={setFilterSubject} />
            <div style={{ display: 'flex', gap: 6, flexShrink: 0, paddingTop: 2 }}>
              {(['count', 'az'] as SortMode[]).map(m => (
                <button
                  key={m}
                  onClick={() => setSortMode(m)}
                  style={{
                    padding: '5px 11px', fontSize: 11.5,
                    fontWeight: sortMode === m ? 700 : 500,
                    color: sortMode === m ? '#2563eb' : 'var(--text-tert)',
                    background: sortMode === m ? '#eff6ff' : 'var(--bg)',
                    border: `1px solid ${sortMode === m ? '#2563eb40' : 'var(--border)'}`,
                    borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit',
                    transition: 'all 0.12s',
                  }}
                >
                  {m === 'count' ? 'Most Questions' : 'A–Z'}
                </button>
              ))}
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-tert)', marginBottom: 14 }}>
            {topicItems.length} topics{filterSubject !== 'All' ? ` in ${filterSubject}` : ' across all exams'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {topicItems.length === 0
              ? <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-tert)', fontSize: 13 }}>No topics found.</div>
              : topicItems.map((item, i) => (
                <TopicCard
                  key={`${item.subject}::${item.topic}::${i}`}
                  item={item}
                  onClick={() => {
                    if (startTopicPractice) startTopicPractice(item.subject, item.topic);
                    else startPractice?.(item.latestExam, item.latestYear, item.subject, item.topic);
                  }}
                />
              ))
            }
          </div>
        </>
      ) : renderByExam()}
    </div>
  );
}
