export const KNOWN_COMMISSIONS = ['TSPSC', 'APPSC', 'UPSC', 'UPPSC', 'MPPSC', 'BPSC', 'RPSC', 'MPSC', 'KPSC', 'TNPSC', 'SSC', 'IBPS', 'RRB', 'NABARD'];

export const COMMISSION_FULL_NAMES: Record<string, string> = {
  TSPSC: 'Telangana State PSC',
  APPSC: 'Andhra Pradesh PSC',
  UPSC: 'Union Public Service Commission',
  UPPSC: 'Uttar Pradesh PSC',
  MPPSC: 'Madhya Pradesh PSC',
  BPSC: 'Bihar Public Service Commission',
  RPSC: 'Rajasthan Public Service Commission',
  MPSC: 'Maharashtra PSC',
  KPSC: 'Karnataka PSC',
  TNPSC: 'Tamil Nadu PSC',
  SSC: 'Staff Selection Commission',
  IBPS: 'Institute of Banking Personnel Selection',
  RRB: 'Railway Recruitment Board',
  NABARD: 'NABARD',
};

export const COMMISSION_COLORS: Record<string, string> = {
  TSPSC: 'from-indigo-500 to-purple-600',
  APPSC: 'from-blue-500 to-cyan-600',
  UPSC: 'from-amber-500 to-orange-600',
  SSC: 'from-emerald-500 to-teal-600',
  IBPS: 'from-rose-500 to-pink-600',
  RRB: 'from-violet-500 to-purple-600',
};

export const COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f59e0b', '#10b981', '#06b6d4', '#84cc16', '#f97316', '#14b8a6'];

export function parseExamName(examName: string): { commission: string; examType: string } {
  const trimmed = (examName || '').trim();
  const upper = trimmed.toUpperCase();
  for (const c of KNOWN_COMMISSIONS) {
    if (upper.startsWith(c)) {
      const rest = trimmed.slice(c.length).trim();
      return { commission: c, examType: rest || 'General' };
    }
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length > 1) {
    return { commission: parts[0].toUpperCase(), examType: parts.slice(1).join(' ') };
  }
  return { commission: trimmed.toUpperCase(), examType: 'General' };
}
