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
  commissionMap, examLoading,
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
  // SECTION: Render Browse UI
  // =========================
  return (
    <div style={{ fontFamily: "'Inter', sans-serif" }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 3 }}>
            {selectedExamName || selectedExamType}
          </h2>
          <p style={{ fontSize: 12, color: C.textSec }}>
            {selectedYear} · {filteredQs.length} loaded of {totalCount} questions
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button onClick={handleShowPicker}
            style={{ padding: '7px 14px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, color: C.textSec, fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
            Change Exam <ChevronRight style={{ width: 13, height: 13 }} />
          </button>
          <button onClick={() => setView('exam-detail')}
            style={{ padding: '7px 14px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, color: C.textSec, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
            <ArrowLeft style={{ width: 13, height: 13 }} /> Back
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
