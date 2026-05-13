import { Search, X } from 'lucide-react';
import { QuestionCardSkeleton } from '../../components/skeletons/QuestionCardSkeleton';
import { C, diffBg, diffColor } from '../../lib/tokens';
import { type Question } from '../../types';

interface BrowseQuestionListProps {
  examYearQs: Question[];
  filteredQs: Question[];
  filterSubject: string;
  filterTopic: string;
  filterSubtopic: string;
  searchQuery: string;
  hasMore: boolean;
  loadingMore: boolean;
  loadError: string | null;
  setSearchQuery: (value: string) => void;
  setFilterSubject: (value: string) => void;
  setFilterTopic: (value: string) => void;
  setFilterSubtopic: (value: string) => void;
  setSelectedQuestion: (question: Question | null) => void;
  loadMoreQuestions: () => void;
}

export function BrowseQuestionList({
  examYearQs,
  filteredQs,
  filterSubject,
  filterTopic,
  filterSubtopic,
  searchQuery,
  hasMore,
  loadingMore,
  loadError,
  setSearchQuery,
  setFilterSubject,
  setFilterTopic,
  setFilterSubtopic,
  setSelectedQuestion,
  loadMoreQuestions,
}: BrowseQuestionListProps) {
  const subjects = [...new Set(examYearQs.map((question) => question.subject))].sort();
  const hasActiveFilters = filterTopic !== 'All' || filterSubtopic !== 'All';

  return (
    <div className="browse-list-shell">
      {hasActiveFilters && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontSize: 11, color: C.textTert, fontWeight: 600 }}>Filtered by:</span>
          {filterTopic !== 'All' && (
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                background: C.accentDim,
                color: C.accent,
                fontSize: 11,
                fontWeight: 700,
                borderRadius: 99,
                border: `1px solid ${C.accent}30`,
              }}
            >
              Topic: {filterTopic}
              <button
                onClick={() => {
                  setFilterTopic('All');
                  setFilterSubtopic('All');
                }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.accent, padding: 0, display: 'flex' }}
              >
                <X style={{ width: 12, height: 12 }} />
              </button>
            </span>
          )}
          {filterSubtopic !== 'All' && (
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                background: 'rgba(167,139,250,0.12)',
                color: '#a78bfa',
                fontSize: 11,
                fontWeight: 700,
                borderRadius: 99,
                border: '1px solid rgba(167,139,250,0.25)',
              }}
            >
              Subtopic: {filterSubtopic}
              <button
                onClick={() => setFilterSubtopic('All')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#a78bfa', padding: 0, display: 'flex' }}
              >
                <X style={{ width: 12, height: 12 }} />
              </button>
            </span>
          )}
          <button
            onClick={() => {
              setFilterSubject('All');
              setFilterTopic('All');
              setFilterSubtopic('All');
            }}
            style={{ fontSize: 11, color: C.textTert, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
          >
            Clear all
          </button>
        </div>
      )}

      <div className="browse-filter-row">
        <div style={{ position: 'relative' }}>
          <Search
            style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', width: 15, height: 15, color: C.textTert }}
          />
          <input
            type="text"
            placeholder="Search questions, topics…"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            style={{
              width: '100%',
              paddingLeft: 42,
              paddingRight: 16,
              paddingTop: 10,
              paddingBottom: 10,
              background: C.surface,
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              color: C.text,
              fontSize: 13.5,
              outline: 'none',
              boxSizing: 'border-box',
              fontFamily: 'inherit',
            }}
          />
        </div>

        {subjects.length > 1 && (
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
            {['All', ...subjects].map((subjectName) => {
              const questionCount =
                subjectName === 'All' ? examYearQs.length : examYearQs.filter((question) => question.subject === subjectName).length;
              const isActive = filterSubject === subjectName;

              return (
                <button
                  key={subjectName}
                  onClick={() => {
                    setFilterSubject(subjectName);
                    setFilterTopic('All');
                    setFilterSubtopic('All');
                  }}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 8,
                    fontSize: 11,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    flexShrink: 0,
                    background: isActive ? '#2563eb' : C.surface,
                    border: `1px solid ${isActive ? '#2563eb' : C.border}`,
                    color: isActive ? 'white' : C.textSec,
                    transition: 'all 0.12s',
                  }}
                >
                  {subjectName}
                  <span
                    style={{
                      padding: '1px 5px',
                      borderRadius: 4,
                      fontSize: 9,
                      fontWeight: 700,
                      background: isActive ? 'rgba(255,255,255,0.2)' : C.bg,
                      color: isActive ? 'white' : C.textTert,
                    }}
                  >
                    {questionCount}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {filteredQs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 20px', background: C.surface, borderRadius: 12, border: `1px dashed ${C.border}` }}>
          <Search style={{ width: 28, height: 28, color: C.textTert, margin: '0 auto 10px' }} />
          <p style={{ fontWeight: 600, color: C.textSec, fontSize: 14, marginBottom: 4 }}>No questions match</p>
          <p style={{ fontSize: 12, color: C.textTert }}>Try adjusting the search or clearing filters.</p>
        </div>
      ) : (
        filteredQs.map((question, index) => (
          <div
            key={question.id}
            className="browse-question-card"
            onMouseEnter={(event) => {
              event.currentTarget.style.borderColor = '#93c5fd';
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.borderColor = C.border;
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: C.bg,
                border: `1px solid ${C.border}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                fontWeight: 700,
                color: C.textTert,
                flexShrink: 0,
                fontFamily: 'monospace',
              }}
            >
              {index + 1}
            </div>
            <div onClick={() => setSelectedQuestion(question)} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 7 }}>
                <span
                  style={{
                    padding: '2px 7px',
                    background: 'rgba(37,99,235,0.08)',
                    color: '#2563eb',
                    fontSize: 10,
                    fontWeight: 700,
                    borderRadius: 5,
                    textTransform: 'uppercase',
                  }}
                >
                  {question.subject}
                </span>
                {question.subtopic && (
                  <span
                    style={{
                      padding: '2px 7px',
                      background: 'transparent',
                      border: `1px solid ${C.border}`,
                      color: C.textTert,
                      fontSize: 10,
                      borderRadius: 5,
                    }}
                  >
                    {question.subtopic}
                  </span>
                )}
                <span
                  style={{
                    padding: '2px 7px',
                    background: diffBg[question.difficulty] || C.bg,
                    color: diffColor[question.difficulty] || C.textSec,
                    fontSize: 10,
                    fontWeight: 600,
                    borderRadius: 5,
                  }}
                >
                  {question.difficulty}
                </span>
              </div>
              {question.passage && (
                <div style={{ marginBottom: 7, paddingLeft: 10, borderLeft: '2px solid #93c5fd' }}>
                  <span
                    style={{
                      display: 'block',
                      fontSize: 9,
                      fontWeight: 700,
                      color: C.textTert,
                      textTransform: 'uppercase',
                      letterSpacing: 1,
                      marginBottom: 2,
                    }}
                  >
                    Passage
                  </span>
                  <p
                    style={{
                      color: C.textSec,
                      fontSize: 12,
                      lineHeight: 1.5,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {question.passage}
                  </p>
                </div>
              )}
              <p
                style={{
                  color: C.text,
                  fontWeight: 500,
                  fontSize: 13.5,
                  lineHeight: 1.6,
                  overflow: 'hidden',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  marginBottom: 4,
                }}
              >
                {question.question}
              </p>
              <p style={{ fontSize: 11, color: C.textTert }}>{question.topic}</p>
            </div>
          </div>
        ))
      )}

      {loadingMore && <QuestionCardSkeleton />}

      {loadError && (
        <div
          style={{
            padding: '12px 14px',
            background: C.warnDim,
            border: `1px solid ${C.warn}40`,
            borderRadius: 10,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div style={{ fontSize: 12, color: C.textSec }}>Could not load more questions.</div>
          <button
            onClick={loadMoreQuestions}
            style={{ padding: '6px 12px', borderRadius: 7, border: `1px solid ${C.border}`, background: C.surface, color: C.text, cursor: 'pointer', fontSize: 12 }}
          >
            Retry
          </button>
        </div>
      )}

      {hasMore && !loadingMore && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}>
          <button
            onClick={loadMoreQuestions}
            style={{ padding: '9px 18px', borderRadius: 8, background: C.surface, border: `1px solid ${C.border}`, color: C.text, cursor: 'pointer', fontSize: 13, fontWeight: 500 }}
          >
            Load next 20 questions
          </button>
        </div>
      )}
    </div>
  );
}
