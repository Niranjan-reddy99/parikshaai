import { formatTime } from '../../lib/utils';
import { type CommissionMap, type ExamPaperManifest } from '../../types';

export function getExamInfo(commissionMap: CommissionMap, selectedCommission: string, selectedExamType: string) {
  return commissionMap[selectedCommission]?.[selectedExamType];
}

export function getAvailableYears(selectedYear: number, yearOptions?: number[]) {
  return yearOptions?.length ? yearOptions : [selectedYear].filter(Boolean).sort((leftYear, rightYear) => rightYear - leftYear);
}

export function getExamDurationLabel(examQuestionCount: number) {
  return formatTime(examQuestionCount * 72);
}

export function getAvailablePapers(examPaperManifest: ExamPaperManifest | null) {
  return examPaperManifest?.papers || [];
}

export function getSelectedPaperLabel(selectedShiftLabel: string | null, selectedPaperId: string | null) {
  return selectedShiftLabel || selectedPaperId || 'Main Paper';
}
