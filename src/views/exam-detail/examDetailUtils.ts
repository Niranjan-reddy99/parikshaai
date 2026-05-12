import { formatTime } from '../../lib/utils';
import {
  type CommissionMap,
  type ExamPaperManifest,
  type ExamPaperManifestItem,
} from '../../types';

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

export function getPaperDisplayLabel(
  paper: ExamPaperManifestItem | null | undefined,
  index = 0
) {
  if (!paper) return 'Main Paper';
  return paper.shift_label || `Paper ${index + 1}`;
}

export function getSelectedPaperLabel(
  availablePapers: ExamPaperManifestItem[],
  selectedShiftLabel: string | null,
  selectedPaperId: string | null
) {
  const selected = availablePapers.find(
    (paper) =>
      (paper.paper_id || null) === selectedPaperId &&
      (paper.shift_label || null) === selectedShiftLabel
  );
  if (selected) {
    return getPaperDisplayLabel(selected, availablePapers.indexOf(selected));
  }
  if (selectedShiftLabel) return selectedShiftLabel;
  if (availablePapers.length === 1) return getPaperDisplayLabel(availablePapers[0], 0);
  return 'Main Paper';
}
