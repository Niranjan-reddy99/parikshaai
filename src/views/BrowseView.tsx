import React from 'react';
import { Search, ArrowLeft, X, Pencil } from 'lucide-react';
import { C, diffColor, diffBg } from '../lib/tokens';
import { type Question, type View } from '../types';

interface BrowseViewProps {
  examYearQs: Question[];
  filteredQs: Question[];
  selectedExamType: string;
  selectedYear: number;
  filterSubject: string;
  filterTopic: string;
  filterSubtopic: string;
  searchQuery: string;
  isAdmin: boolean;
  setSearchQuery: (v: string) => void;
  setFilterSubject: (v: string) => void;
  setFilterTopic: (v: string) => void;
  setFilterSubtopic: (v: string) => void;
  setSelectedQuestion: (q: Question | null) => void;
  setEditQuestion: (q: Question) => void;
  setView: (v: View) => void;
}

export function BrowseView({
  examYearQs, filteredQs, selectedExamType, selectedYear,
  filterSubject, filterTopic, filterSubtopic, searchQuery, isAdmin,
  setSearchQuery, setFilterSubject, setFilterTopic, setFilterSubtopic,
  setSelectedQuestion, setEditQuestion, setView,
}: BrowseViewProps) {
  const subjects = [...new Set(examYearQs.map(q => q.subject))].sort();
  const hasActiveFilters = filterTopic !== 'All' || filterSubtopic !== 'All';

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '28px 16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: C.text, marginBottom: 4 }}>Question Bank</h2>
          <p style={{ fontSize: 13, color: C.textSec }}>{selectedExamType} {selectedYear} — {filteredQs.length} questions</p>
        </div>
        <button onClick={() => setView('exam-detail')}
          style={{ padding: '8px 16px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, color: C.textSec, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <ArrowLeft style={{ width: 15, height: 15 }} /> Back
        </button>
      </div>

      {/* Active filters */}
      {hasActiveFilters && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 11, color: C.textTert, fontWeight: 600 }}>Filtered by:</span>
          {filterTopic !== 'All' && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: C.blueDim, color: C.blue, fontSize: 11, fontWeight: 700, borderRadius: 99, border: `1px solid ${C.blue}30` }}>
              Topic: {filterTopic}
              <button onClick={() => { setFilterTopic('All'); setFilterSubtopic('All'); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.blue, padding: 0, display: 'flex' }}>
                <X style={{ width: 12, height: 12 }} />
              </button>
            </span>
          )}
          {filterSubtopic !== 'All' && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: 'rgba(167,139,250,0.12)', color: '#a78bfa', fontSize: 11, fontWeight: 700, borderRadius: 99, border: '1px solid rgba(167,139,250,0.25)' }}>
              Subtopic: {filterSubtopic}
              <button onClick={() => setFilterSubtopic('All')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#a78bfa', padding: 0, display: 'flex' }}>
                <X style={{ width: 12, height: 12 }} />
              </button>
            </span>
          )}
          <button onClick={() => { setFilterSubject('All'); setFilterTopic('All'); setFilterSubtopic('All'); }}
            style={{ fontSize: 11, color: C.textTert, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
            Clear all
          </button>
        </div>
      )}

      {/* Search + Subject filter */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
        <div style={{ position: 'relative' }}>
          <Search style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16, color: C.textTert }} />
          <input type="text" placeholder="Search questions, topics..."
            value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            style={{ width: '100%', paddingLeft: 44, paddingRight: 16, paddingTop: 12, paddingBottom: 12, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, color: C.text, fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
        </div>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
          {['All', ...subjects].map(sub => {
            const count = sub === 'All' ? examYearQs.length : examYearQs.filter(q => q.subject === sub).length;
            const active = filterSubject === sub;
            return (
              <button key={sub} onClick={() => { setFilterSubject(sub); setFilterTopic('All'); setFilterSubtopic('All'); }}
                style={{ padding: '7px 14px', borderRadius: 10, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s', flexShrink: 0,
                  background: active ? C.accent : C.surface,
                  border: `1px solid ${active ? C.accent : C.border}`,
                  color: active ? '#000' : C.textSec }}>
                {sub}
                <span style={{ padding: '1px 6px', borderRadius: 6, fontSize: 9, fontWeight: 700,
                  background: active ? '#00000030' : C.bg, color: active ? '#000' : C.textTert }}>{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Question list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {filteredQs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', background: C.surface, borderRadius: 20, border: `1px dashed ${C.border}` }}>
            <Search style={{ width: 36, height: 36, color: C.textTert, margin: '0 auto 12px' }} />
            <p style={{ fontWeight: 700, color: C.textSec, fontSize: 15 }}>No questions found</p>
          </div>
        ) : filteredQs.map((q, idx) => (
          <div key={q.id}
            style={{ padding: '16px 18px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, display: 'flex', alignItems: 'flex-start', gap: 14, transition: 'border-color 0.15s' }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = C.blue + '60')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: C.bg, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: C.textSec, flexShrink: 0 }}>{idx + 1}</div>
            <div onClick={() => setSelectedQuestion(q)} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                <span style={{ padding: '3px 8px', background: '#0F1E3D', color: C.blue, fontSize: 10, fontWeight: 700, borderRadius: 6, textTransform: 'uppercase' }}>{q.subject}</span>
                {q.subtopic && <span style={{ padding: '3px 8px', background: C.bg, color: C.textTert, fontSize: 10, fontWeight: 500, borderRadius: 6, border: `1px solid ${C.border}` }}>{q.subtopic}</span>}
                <span style={{ padding: '3px 8px', background: diffBg[q.difficulty] || C.bg, color: diffColor[q.difficulty] || C.textSec, fontSize: 10, fontWeight: 700, borderRadius: 6 }}>{q.difficulty}</span>
              </div>
              <p style={{ color: C.text, fontWeight: 500, fontSize: 14, lineHeight: 1.6, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', marginBottom: 6 }}>{q.question}</p>
              <p style={{ fontSize: 11, color: C.textTert }}>{q.topic}</p>
            </div>
            {isAdmin && (
              <button onClick={e => { e.stopPropagation(); setEditQuestion(q); }}
                title="Edit question"
                style={{ padding: 7, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, cursor: 'pointer', color: C.textTert, display: 'flex', flexShrink: 0, transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.accent; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textTert; }}>
                <Pencil style={{ width: 14, height: 14 }} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
