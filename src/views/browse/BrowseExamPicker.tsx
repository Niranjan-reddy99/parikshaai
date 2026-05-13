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
        background: hov
          ? 'linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)'
          : 'linear-gradient(180deg, #ffffff 0%, #fcfdff 100%)',
        borderRadius: 22,
        cursor: 'pointer',
        overflow: 'hidden',
        transition: 'transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease',
        transform: hov ? 'translateY(-3px)' : 'none',
        boxShadow: hov ? `0 18px 34px ${accentColor}18` : '0 12px 24px rgba(15,23,42,0.08)',
        border: `1px solid ${hov ? `${accentColor}40` : '#dbe5f0'}`,
        userSelect: 'none',
        minHeight: 216,
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: '0 0 auto 0',
          height: 4,
          background: `linear-gradient(90deg, ${accentColor}, ${accentColor}70)`,
          opacity: hov ? 1 : 0.86,
        }}
      />

      <div style={{ padding: '18px 18px 16px', minHeight: 216, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
            <div
              style={{
                width: 60,
                height: 60,
                borderRadius: 18,
                background: `linear-gradient(135deg, ${accentColor}18, rgba(255,255,255,0.96))`,
                border: `1px solid ${accentColor}20`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: `inset 0 1px 0 rgba(255,255,255,0.9), 0 10px 22px ${accentColor}12`,
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  minWidth: 38,
                  height: 38,
                  padding: '0 10px',
                  borderRadius: 999,
                  background: '#ffffff',
                  border: `1px solid ${accentColor}24`,
                  color: accentColor,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: shortMark.length > 3 ? 16 : 18,
                  fontWeight: 900,
                  letterSpacing: '-0.04em',
                  boxShadow: `0 8px 18px ${accentColor}14`,
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
                  gap: 6,
                  padding: '4px 9px',
                  borderRadius: 999,
                  background: `${accentColor}10`,
                  color: accentColor,
                  fontSize: 10.5,
                  fontWeight: 800,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  marginBottom: 10,
                }}
              >
                {info.category}
              </div>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 800,
                  color: '#243447',
                  lineHeight: 1.05,
                  letterSpacing: '-0.04em',
                  marginBottom: 6,
                }}
              >
                {info.name}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: '#64748b',
                  lineHeight: 1.45,
                  maxWidth: 240,
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
              gap: 6,
              padding: '6px 10px',
              borderRadius: 999,
              background: '#f8fbff',
              border: `1px solid ${accentColor}22`,
              color: '#52657b',
              fontSize: 11.5,
              fontWeight: 700,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: accentColor,
                opacity: 0.85,
              }}
            />
            Open
          </div>
        </div>

        <div style={{ marginTop: 'auto', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
          <div
            style={{
              padding: '11px 12px',
              borderRadius: 14,
              border: '1px solid rgba(148,163,184,0.18)',
              background: 'rgba(248,250,252,0.92)',
            }}
          >
            <div style={{ fontSize: 10.5, fontWeight: 700, color: '#7b8ca1', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
              Exam sets
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#203246', letterSpacing: '-0.03em' }}>
              {examLabel}
            </div>
          </div>

          <div
            style={{
              padding: '11px 12px',
              borderRadius: 14,
              border: `1px solid ${accentColor}18`,
              background: `linear-gradient(180deg, ${accentColor}08 0%, ${accentColor}12 100%)`,
            }}
          >
            <div style={{ fontSize: 10.5, fontWeight: 700, color: '#7b8ca1', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
              Question bank
            </div>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                color: accentColor,
                fontWeight: 800,
                fontSize: 16,
                letterSpacing: '-0.03em',
              }}
            >
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  background: '#ffffff',
                  border: `1px solid ${accentColor}22`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 900,
                }}
              >
                ✓
              </span>
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
    <div style={{ fontFamily: "'Inter', sans-serif" }}>
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
