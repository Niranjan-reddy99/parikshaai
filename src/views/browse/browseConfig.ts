import { type CommissionMap } from '../../types';

export type BrowseCategoryTab = 'all' | 'civil' | 'state-psc' | 'state-police' | 'ssc' | 'other';

export const COMMISSION_COLORS: Record<string, string> = {
  UPSC: '#2563eb',    // royal blue
  APPSC: '#10b981',   // emerald
  TSPSC: '#8b5cf6',   // violet
  TSLPRB: '#ea580c',  // burnt orange
  APSLPRB: '#0284c7', // sky blue
  APHC: '#e11d48',    // rose
  TSHC: '#4338ca',    // indigo
  AP: '#14b8a6',      // teal
  TS: '#a21caf',      // fuchsia
  SSC: '#d97706',     // amber
  IBPS: '#0369a1',    // ocean blue
  RRB: '#dc2626',     // red
};

export const CARD_GRADIENTS: Record<string, string> = {
  UPSC:    'linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%)',  // royal blue
  APPSC:   'linear-gradient(135deg, #064e3b 0%, #10b981 100%)',  // emerald
  TSPSC:   'linear-gradient(135deg, #3b0764 0%, #8b5cf6 100%)',  // violet
  TSLPRB:  'linear-gradient(135deg, #7c2d12 0%, #ea580c 100%)',  // burnt orange
  APSLPRB: 'linear-gradient(135deg, #0c4a6e 0%, #0284c7 100%)', // sky blue
  APHC:    'linear-gradient(135deg, #881337 0%, #e11d48 100%)',  // rose
  TSHC:    'linear-gradient(135deg, #1e1b4b 0%, #4338ca 100%)', // indigo
  AP:      'linear-gradient(135deg, #134e4a 0%, #14b8a6 100%)', // teal
  TS:      'linear-gradient(135deg, #4a044e 0%, #a21caf 100%)', // fuchsia
  SSC:     'linear-gradient(135deg, #78350f 0%, #d97706 100%)', // amber
  IBPS:    'linear-gradient(135deg, #0c2340 0%, #0369a1 100%)', // ocean blue
  RRB:     'linear-gradient(135deg, #7f1d1d 0%, #dc2626 100%)', // red
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

export const COMMISSION_INFO: Record<string, { name: string; desc: string; category: string }> = {
  UPSC: { name: 'UPSC CSE', desc: 'Civil Services Examination', category: 'Civil Services' },
  APPSC: { name: 'APPSC', desc: 'Andhra Pradesh PSC', category: 'State PSC' },
  TSPSC: { name: 'TSPSC', desc: 'Telangana State PSC', category: 'State PSC' },
  TSLPRB: { name: 'TSLPRB', desc: 'Telangana Police Recruitment', category: 'State Police' },
  APSLPRB: { name: 'APSLPRB', desc: 'AP Police Recruitment Board', category: 'State Police' },
  APHC: { name: 'AP High Court', desc: 'AP High Court & Judiciary', category: 'State PSC' },
  TSHC: { name: 'TS High Court', desc: 'Telangana High Court', category: 'State PSC' },
  AP: { name: 'AP Govt', desc: 'Andhra Pradesh Govt Exams', category: 'Other' },
  TS: { name: 'TS Govt', desc: 'Telangana Govt Exams', category: 'Other' },
  SSC: { name: 'SSC', desc: 'Staff Selection Commission', category: 'SSC / Banking' },
  IBPS: { name: 'IBPS', desc: 'Banking Personnel Selection', category: 'SSC / Banking' },
  RRB: { name: 'RRB', desc: 'Railway Recruitment Board', category: 'SSC / Banking' },
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
