import { type CommissionMap } from '../../types';

export type BrowseCategoryTab = 'all' | 'civil' | 'state-psc' | 'state-police' | 'ssc' | 'other';

export const COMMISSION_COLORS: Record<string, string> = {
  UPSC: '#2563eb',
  APPSC: '#059669',
  TSPSC: '#7c3aed',
  TSLPRB: '#065f46',
  APSLPRB: '#1565c0',
  APHC: '#283593',
  TSHC: '#6a1b9a',
  SSC: '#b45309',
  IBPS: '#1e40af',
  RRB: '#991b1b',
  AP: '#0d9488',
  TS: '#7c3aed',
};

export const CATEGORY_MAP: Record<string, BrowseCategoryTab> = {
  UPSC: 'civil',
  APPSC: 'state-psc',
  TSPSC: 'state-psc',
  APHC: 'state-psc',
  TSHC: 'state-psc',
  TSLPRB: 'state-police',
  APSLPRB: 'state-police',
  SSC: 'ssc',
  IBPS: 'ssc',
  RRB: 'ssc',
  AP: 'other',
  TS: 'other',
};

export const COMMISSION_INFO: Record<string, { icon: string; name: string; desc: string }> = {
  UPSC: { icon: '🏛️', name: 'UPSC CSE', desc: 'Civil Services Examination' },
  APPSC: { icon: '🌿', name: 'APPSC', desc: 'Andhra Pradesh PSC' },
  TSPSC: { icon: '⚡', name: 'TSPSC', desc: 'Telangana State PSC' },
  TSLPRB: { icon: '🛡️', name: 'TSLPRB', desc: 'Telangana Police Recruitment' },
  APSLPRB: { icon: '🔵', name: 'APSLPRB', desc: 'AP Police Recruitment Board' },
  APHC: { icon: '⚖️', name: 'AP High Court', desc: 'AP High Court & Judiciary' },
  TSHC: { icon: '⚖️', name: 'TS High Court', desc: 'Telangana High Court' },
  AP: { icon: '🌊', name: 'AP Govt', desc: 'Andhra Pradesh Govt Exams' },
  TS: { icon: '🔷', name: 'TS Govt', desc: 'Telangana Govt Exams' },
  SSC: { icon: '📋', name: 'SSC', desc: 'Staff Selection Commission' },
  IBPS: { icon: '🏦', name: 'IBPS', desc: 'Banking Personnel Selection' },
  RRB: { icon: '🚂', name: 'RRB', desc: 'Railway Recruitment Board' },
};

export const CATEGORY_TABS: { id: BrowseCategoryTab; label: string }[] = [
  { id: 'all', label: 'All Exams' },
  { id: 'civil', label: 'Civil Services' },
  { id: 'state-psc', label: 'State PSC' },
  { id: 'state-police', label: 'State Police' },
  { id: 'ssc', label: 'SSC / Banking' },
  { id: 'other', label: 'Other Exams' },
];

export function getCommissionQuestionCount(commissionMap: CommissionMap, commission: string) {
  return Object.values(commissionMap[commission] || {}).reduce((total, examInfo) => total + examInfo.count, 0);
}

export function getCommissionPaperCount(commissionMap: CommissionMap, commission: string) {
  return Object.keys(commissionMap[commission] || {}).length;
}
