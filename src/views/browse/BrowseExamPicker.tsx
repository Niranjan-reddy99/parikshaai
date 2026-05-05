import {
  CATEGORY_MAP,
  CATEGORY_TABS,
  COMMISSION_COLORS,
  COMMISSION_INFO,
  getCommissionPaperCount,
  getCommissionQuestionCount,
  type BrowseCategoryTab,
} from './browseConfig';
import { type CommissionMap } from '../../types';

interface BrowseExamPickerProps {
  categoryTab: BrowseCategoryTab;
  commissionMap: CommissionMap;
  commissions: string[];
  setCategoryTab: (value: BrowseCategoryTab) => void;
  onPickCommission: (commission: string) => void;
}

export function BrowseExamPicker({
  categoryTab,
  commissionMap,
  commissions,
  setCategoryTab,
  onPickCommission,
}: BrowseExamPickerProps) {
  const visibleCommissions = commissions.filter(
    (commission) => categoryTab === 'all' || (CATEGORY_MAP[commission] || 'other') === categoryTab
  );

  return (
    <div style={{ fontFamily: "'Inter', sans-serif" }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)', margin: '0 0 4px', letterSpacing: '-0.3px' }}>
          Question Bank
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-sec)', margin: 0 }}>
          Select an exam board and year to browse and practice previous year questions
        </p>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 20, gap: 0, overflowX: 'auto' }}>
        {CATEGORY_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setCategoryTab(tab.id)}
            style={{
              padding: '9px 18px',
              fontSize: 13.5,
              fontWeight: categoryTab === tab.id ? 700 : 500,
              color: categoryTab === tab.id ? '#2563eb' : 'var(--text-sec)',
              background: 'none',
              border: 'none',
              borderBottom: `2px solid ${categoryTab === tab.id ? '#2563eb' : 'transparent'}`,
              cursor: 'pointer',
              fontFamily: 'inherit',
              whiteSpace: 'nowrap',
              transition: 'color 0.1s, border-color 0.1s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {visibleCommissions.length === 0 ? (
        <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--text-tert)', fontSize: 13 }}>
          No exams in this category yet.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14, marginBottom: 24 }}>
          {visibleCommissions.map((commission) => {
            const info = COMMISSION_INFO[commission] || { icon: '📄', name: commission, desc: commission };
            const questionCount = getCommissionQuestionCount(commissionMap, commission);
            const paperCount = getCommissionPaperCount(commissionMap, commission);
            const accentColor = COMMISSION_COLORS[commission] || '#475569';

            return (
              <div
                key={commission}
                onClick={() => onPickCommission(commission)}
                style={{
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  borderRadius: 14,
                  padding: '18px 20px',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s, background 0.15s',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.background = 'var(--bg-alt)';
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.background = 'var(--bg)';
                }}
              >
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 12,
                    background: `${accentColor}15`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 24,
                  }}
                >
                  {info.icon}
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 3 }}>{info.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-sec)' }}>{info.desc}</div>
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 12,
                    color: '#2563eb',
                    fontWeight: 600,
                  }}
                >
                  <span>
                    {questionCount.toLocaleString()} Questions · {paperCount} Papers
                  </span>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M5 12h14" />
                    <path d="m12 5 7 7-7 7" />
                  </svg>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
