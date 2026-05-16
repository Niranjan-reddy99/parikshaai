import { useState } from 'react';
import { ArrowLeft, ChevronRight, Loader2 } from 'lucide-react';
import { C } from '../lib/tokens';
import { type CommissionMap, type Question, type View } from '../types';
import { BrowseExamPicker } from './browse/BrowseExamPicker';
import { BrowseQuestionList } from './browse/BrowseQuestionList';
import { type BrowseCategoryTab } from './browse/browseConfig';

interface BrowseViewProps {
  examYearQs: Question[];
  filteredQs: Question[];
  totalCount: number;
  hasMore: boolean;
  loadingMore: boolean;
  loadError: string | null;
  selectedExamName: string;
  selectedExamType: string;
  selectedYear: number;
  showPicker: boolean;
  setShowPicker: (value: boolean) => void;
  catalogSearchQuery: string;
  filterSubject: string;
  filterTopic: string;
  filterSubtopic: string;
  searchQuery: string;
  commissionMap: CommissionMap;
  examLoading: boolean;
  examIsLocked?: boolean;
  onLockedClick?: () => void;
  setSearchQuery: (v: string) => void;
  setFilterSubject: (v: string) => void;
  setFilterTopic: (v: string) => void;
  setFilterSubtopic: (v: string) => void;
  setSelectedQuestion: (q: Question | null) => void;
  loadMoreQuestions: () => void;
  setView: (v: View) => void;
  onPickCommission: (commission: string) => void;
}

export function BrowseView({
  examYearQs, filteredQs, totalCount, hasMore, loadingMore, loadError,
  selectedExamName, selectedExamType, selectedYear,
  showPicker, setShowPicker, catalogSearchQuery,
  filterSubject, filterTopic, filterSubtopic, searchQuery,
  commissionMap, examLoading, examIsLocked, onLockedClick,
  setSearchQuery, setFilterSubject, setFilterTopic, setFilterSubtopic,
  setSelectedQuestion, loadMoreQuestions, setView, onPickCommission,
}: BrowseViewProps) {
  const [categoryTab, setCategoryTab] = useState<BrowseCategoryTab>('all');

  // =========================
  // SECTION: Derived Data
  // =========================
  const commissions = Object.keys(commissionMap).sort();

  // =========================
  // SECTION: Event Handlers
  // =========================
  const handleShowPicker = () => {
    setShowPicker(true);
  };

  // =========================
  // SECTION: Render Loading
  // =========================
  if (examLoading && examYearQs.length === 0) {
    return (
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '28px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: C.textSec, fontSize: 14, padding: '40px 0' }}>
          <Loader2 style={{ width: 18, height: 18, animation: 'spin 1s linear infinite' }} />
          Loading questions…
        </div>
      </div>
    );
  }

  // =========================
  // SECTION: Render Exam Picker
  // =========================
  if (!selectedYear || showPicker) {
    return (
      <BrowseExamPicker
        categoryTab={categoryTab}
        commissionMap={commissionMap}
        commissions={commissions}
        searchQuery={catalogSearchQuery}
        setCategoryTab={setCategoryTab}
        onPickCommission={onPickCommission}
      />
    );
  }

  // =========================
  // SECTION: Render Locked Gate
  // =========================
  if (examIsLocked) {
    return (
      <div className="browse-shell">
        <div className="browse-header">
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 3 }}>
              {selectedExamName || selectedExamType}
            </h2>
            <p style={{ fontSize: 12, color: C.textSec }}>{selectedYear}</p>
          </div>
          <button onClick={() => setView('exam-detail')}
            style={{ padding: '7px 14px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, color: C.textSec, fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
            <ArrowLeft style={{ width: 13, height: 13 }} /> Back to exam
          </button>
        </div>
        <div style={{
          background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 16,
          padding: '64px 32px', textAlign: 'center', marginTop: 16,
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'linear-gradient(135deg,#f59e0b,#d97706)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 18px',
            boxShadow: '0 8px 24px rgba(245,158,11,0.25)',
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>Premium Paper</div>
          <div style={{ fontSize: 13.5, color: 'var(--text-sec)', maxWidth: 340, margin: '0 auto 22px', lineHeight: 1.7 }}>
            Questions for this paper are available on the Premium plan. Upgrade to browse and practice all papers.
          </div>
          <button
            onClick={onLockedClick}
            style={{
              padding: '11px 28px', background: 'linear-gradient(135deg,#f59e0b,#d97706)',
              border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700,
              color: 'white', cursor: 'pointer', fontFamily: 'inherit',
              boxShadow: '0 4px 14px rgba(245,158,11,0.3)',
            }}
          >
            Unlock Premium Access
          </button>
        </div>
      </div>
    );
  }

  // =========================
  // SECTION: Render Browse UI
  // =========================
  return (
    <div className="browse-shell">
      <div className="browse-header">
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 3 }}>
            {selectedExamName || selectedExamType}
          </h2>
          <p style={{ fontSize: 12, color: C.textSec }}>
            {selectedYear} · {filteredQs.length} loaded of {totalCount} questions
          </p>
        </div>
        <div className="browse-header-actions">
          <button onClick={() => setView('exam-detail')}
            style={{ padding: '7px 14px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, color: C.textSec, fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
            <ArrowLeft style={{ width: 13, height: 13 }} /> Back to exam
          </button>
          <button onClick={handleShowPicker}
            style={{ padding: '7px 14px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, color: C.textSec, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
            Change question bank <ChevronRight style={{ width: 13, height: 13 }} />
          </button>
        </div>
      </div>
      <BrowseQuestionList
        examYearQs={examYearQs}
        filteredQs={filteredQs}
        filterSubject={filterSubject}
        filterTopic={filterTopic}
        filterSubtopic={filterSubtopic}
        searchQuery={searchQuery}
        hasMore={hasMore}
        loadingMore={loadingMore}
        loadError={loadError}
        setSearchQuery={setSearchQuery}
        setFilterSubject={setFilterSubject}
        setFilterTopic={setFilterTopic}
        setFilterSubtopic={setFilterSubtopic}
        setSelectedQuestion={setSelectedQuestion}
        loadMoreQuestions={loadMoreQuestions}
      />
    </div>
  );
}
