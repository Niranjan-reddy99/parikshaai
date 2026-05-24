import { useState } from 'react';
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
  searchQuery: string;
  setCategoryTab: (value: BrowseCategoryTab) => void;
  onPickCommission: (commission: string) => void;
}

function CommissionCard({
  commission,
  commissionMap,
  onPick,
}: {
  commission: string;
  commissionMap: CommissionMap;
  onPick: () => void;
}) {
  const [hov, setHov] = useState(false);
  const info = COMMISSION_INFO[commission] || { name: commission, desc: commission, category: 'Exam' };
  const questionCount = getCommissionQuestionCount(commissionMap, commission);
  const paperCount = getCommissionPaperCount(commissionMap, commission);
  const accentColor = COMMISSION_COLORS[commission] || '#475569';
  const shortMark =
    commission.length <= 5
      ? commission
      : info.name
          .split(' ')
          .map((part) => part[0])
          .join('')
          .slice(0, 4)
          .toUpperCase();
  const questionLabel = questionCount.toLocaleString();
  const examLabel = `${paperCount} ${paperCount === 1 ? 'exam' : 'exams'}`;

  return (
    <div
      onClick={onPick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: hov ? 'var(--bg-alt)' : 'var(--bg)',
        borderRadius: 18,
        cursor: 'pointer',
        overflow: 'hidden',
        transition: 'transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease',
        transform: hov ? 'translateY(-3px)' : 'none',
        boxShadow: hov ? `0 16px 32px ${accentColor}20` : '0 2px 8px rgba(0,0,0,0.06)',
        border: `1px solid ${hov ? `${accentColor}50` : 'var(--border)'}`,
        userSelect: 'none',
        minHeight: 200,
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: '0 0 auto 0',
          height: 3,
          background: `linear-gradient(90deg, ${accentColor}, ${accentColor}80)`,
        }}
      />

      <div style={{ padding: '16px 16px 14px', minHeight: 200, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 14,
                background: `${accentColor}18`,
                border: `1px solid ${accentColor}28`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  minWidth: 34,
                  height: 34,
                  padding: '0 8px',
                  borderRadius: 999,
                  background: `${accentColor}22`,
                  color: accentColor,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: shortMark.length > 3 ? 14 : 16,
                  fontWeight: 900,
                  letterSpacing: '-0.04em',
                }}
              >
                {shortMark}
              </div>
            </div>

            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '3px 8px',
                  borderRadius: 999,
                  background: `${accentColor}14`,
                  color: accentColor,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  marginBottom: 8,
                }}
              >
                {info.category}
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: 'var(--text)',
                  lineHeight: 1.05,
                  letterSpacing: '-0.03em',
                  marginBottom: 4,
                }}
              >
                {info.name}
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: 'var(--text-tert)',
                  lineHeight: 1.4,
                  maxWidth: 220,
                }}
              >
                {info.desc}
              </div>
            </div>
          </div>

          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 9px',
              borderRadius: 999,
              background: 'rgba(22,163,74,0.1)',
              border: '1px solid rgba(22,163,74,0.2)',
              color: '#16a34a',
              fontSize: 10.5,
              fontWeight: 700,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#16a34a' }} />
            Active
          </div>
        </div>

        <div style={{ marginTop: 'auto', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
          <div
            style={{
              padding: '10px 11px',
              borderRadius: 12,
              border: '1px solid var(--border)',
              background: 'var(--bg-canvas)',
            }}
          >
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              Papers
            </div>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.02em' }}>
              {examLabel}
            </div>
          </div>

          <div
            style={{
              padding: '10px 11px',
              borderRadius: 12,
              border: `1px solid ${accentColor}22`,
              background: `${accentColor}0a`,
            }}
          >
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              Questions
            </div>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                color: accentColor,
                fontWeight: 800,
                fontSize: 15,
                letterSpacing: '-0.02em',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 900 }}>✓</span>
              {questionLabel}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function BrowseExamPicker({
  categoryTab,
  commissionMap,
  commissions,
  searchQuery,
  setCategoryTab,
  onPickCommission,
}: BrowseExamPickerProps) {
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const visibleCommissions = commissions.filter((commission) => {
    const matchesCategory =
      categoryTab === 'all' || (CATEGORY_MAP[commission] || 'other') === categoryTab;
    if (!matchesCategory) return false;
    if (!normalizedSearch) return true;

    const info = COMMISSION_INFO[commission] || { name: commission, desc: commission, category: 'Exam' };
    const examTexts = Object.entries(commissionMap[commission] || {}).flatMap(([examType, examInfo]) => [
      examType,
      examInfo.fullName,
      ...(examInfo.years || []).map(String),
    ]);
    const haystack = [
      commission,
      info.name,
      info.desc,
      info.category,
      ...examTexts,
    ]
      .join(' ')
      .toLowerCase();

    return haystack.includes(normalizedSearch);
  });

  return (
    <div style={{ fontFamily: 'var(--font-sans)' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)', margin: '0 0 4px', letterSpacing: '-0.3px' }}>
          Question Bank
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-sec)', margin: 0 }}>
          Select an exam board to browse and practice previous year questions
        </p>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 24, gap: 0, overflowX: 'auto' }}>
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
              borderTop: 'none',
              borderLeft: 'none',
              borderRight: 'none',
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
          {normalizedSearch
            ? `No exam boards or papers match "${searchQuery}".`
            : 'No exams in this category yet.'}
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 16,
            marginBottom: 24,
          }}
        >
          {visibleCommissions.map((commission) => (
            <CommissionCard
              key={commission}
              commission={commission}
              commissionMap={commissionMap}
              onPick={() => onPickCommission(commission)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
