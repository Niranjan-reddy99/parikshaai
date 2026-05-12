import React, { useState } from 'react';
import { C } from '../lib/tokens';
import { type Question, type CommissionMap, type ExamPaperManifest, type WeightageItem, type View } from '../types';
import { ExamDetailControls } from './exam-detail/ExamDetailControls';
import { ExamDetailHeader } from './exam-detail/ExamDetailHeader';
import { ExamDetailModeCards } from './exam-detail/ExamDetailModeCards';
import { ExamDetailSubjectBreakdown } from './exam-detail/ExamDetailSubjectBreakdown';
import {
  getAvailablePapers,
  getAvailableYears,
  getExamDurationLabel,
  getExamInfo,
  getSelectedPaperLabel,
} from './exam-detail/examDetailUtils';

interface ExamDetailViewProps {
  selectedCommission: string;
  selectedExamType: string;
  selectedExamName: string;
  selectedYear: number;
  setSelectedYear: (y: number) => void;
  commissionMap: CommissionMap;
  examYearQs: Question[];
  examLoading: boolean;
  examPaperManifest: ExamPaperManifest | null;
  examPaperLoading: boolean;
  selectedPaperId: string | null;
  selectedShiftLabel: string | null;
  setSelectedPaperId: (v: string | null) => void;
  setSelectedShiftLabel: (v: string | null) => void;
  weightage: WeightageItem[];
  examQuestionCount: number;
  startPractice: (examName: string, year: number, subject?: string, topic?: string) => void;
  startMockExam: (examName: string, year: number) => void;
  browseWithFilters: (subject?: string, topic?: string, subtopic?: string) => void;
  setView: (v: View) => void;
  isLocked: (examName: string, year: number, commission?: string) => boolean;
  onLockedClick: () => void;
}

export function ExamDetailView({
  selectedCommission, selectedExamType, selectedExamName, selectedYear, setSelectedYear,
  commissionMap, examYearQs, examLoading, examPaperManifest, examPaperLoading,
  selectedPaperId, selectedShiftLabel, setSelectedPaperId, setSelectedShiftLabel, weightage, examQuestionCount,
  startPractice, startMockExam, browseWithFilters, setView,
  isLocked, onLockedClick,
}: ExamDetailViewProps) {
  // =========================
  // SECTION: State Management
  // =========================
  const [expandedSubjects, setExpandedSubjects] = useState<Record<string, boolean>>({});
  const examInfo = getExamInfo(commissionMap, selectedCommission, selectedExamType);
  const availableYears = getAvailableYears(selectedYear, examInfo?.years);
  const examDuration = getExamDurationLabel(examQuestionCount);
  const availablePapers = getAvailablePapers(examPaperManifest);
  const selectedPaperLabel = getSelectedPaperLabel(
    availablePapers,
    selectedShiftLabel,
    selectedPaperId
  );
  const yearLocked = isLocked(selectedExamName, selectedYear, selectedCommission);

  // =========================
  // SECTION: Render Exam Detail
  // =========================
  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <ExamDetailHeader
        selectedCommission={selectedCommission}
        selectedExamType={selectedExamType}
        selectedExamName={selectedExamName}
        selectedYear={selectedYear}
        examLoading={examLoading}
        examQuestionCount={examQuestionCount}
        selectedPaperLabel={selectedPaperLabel}
        availablePaperCount={availablePapers.length}
        onBack={() => setView('commission')}
      />

      <ExamDetailControls
        availableYears={availableYears}
        selectedYear={selectedYear}
        examQuestionCount={examQuestionCount}
        yearCounts={examInfo?.yearCounts}
        selectedCommission={selectedCommission}
        selectedExamName={selectedExamName}
        isLocked={isLocked}
        onLockedClick={onLockedClick}
        setSelectedYear={setSelectedYear}
        examPaperLoading={examPaperLoading}
        availablePapers={availablePapers}
        selectedPaperId={selectedPaperId}
        selectedShiftLabel={selectedShiftLabel}
        setSelectedPaperId={setSelectedPaperId}
        setSelectedShiftLabel={setSelectedShiftLabel}
      />

      <ExamDetailModeCards
        selectedExamName={selectedExamName}
        selectedYear={selectedYear}
        examQuestionCount={examQuestionCount}
        examDuration={examDuration}
        yearLocked={yearLocked}
        onLockedClick={onLockedClick}
        startPractice={startPractice}
        startMockExam={startMockExam}
      />

      <ExamDetailSubjectBreakdown
        selectedCommission={selectedCommission}
        selectedExamType={selectedExamType}
        selectedYear={selectedYear}
        selectedExamName={selectedExamName}
        weightage={weightage}
        expandedSubjects={expandedSubjects}
        setExpandedSubjects={setExpandedSubjects}
        browseWithFilters={browseWithFilters}
        startPractice={startPractice}
      />
    </div>
  );
}
