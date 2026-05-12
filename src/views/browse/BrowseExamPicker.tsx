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
  const shortMark = commission.length <= 5 ? commission : info.name.split(' ').map((part) => part[0]).join('').slice(0, 4).toUpperCase();
  const questionLabel = questionCount.toLocaleString();

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
        transform: hov ? 'translateY(-4px)' : 'none',
        boxShadow: hov
          ? `0 18px 38px ${accentColor}22`
          : '0 10px 24px rgba(15,23,42,0.08)',
        border: `1px solid ${hov ? `${accentColor}40` : '#dbe5f0'}`,
        userSelect: 'none',
        minHeight: 300,
        position: 'relative',
      }}
    >
      <div style={{ position: 'absolute', top: 16, left: 16 }}>
        <div style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          border: '1.5px solid #9fb0c9',
          color: '#90a1bd',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 15,
          fontWeight: 700,
          background: '#fff',
        }}>
          i
        </div>
      </div>

      <div style={{ padding: '28px 24px 20px', minHeight: 300, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div
          style={{
            width: 110,
            height: 110,
            borderRadius: 28,
            marginTop: 8,
            marginBottom: 20,
            background: `radial-gradient(circle at 30% 25%, #ffffff 0%, #ffffff 28%, ${accentColor}16 29%, ${accentColor}10 52%, transparent 53%), linear-gradient(135deg, ${accentColor}10, rgba(255,255,255,0.92))`,
            border: `1px solid ${accentColor}22`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.9), 0 10px 22px ${accentColor}14`,
          }}
        >
          <div
            style={{
              width: 74,
              height: 74,
              borderRadius: '50%',
              background: '#ffffff',
              border: `2px solid ${accentColor}30`,
              color: accentColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: shortMark.length > 3 ? 22 : 26,
              fontWeight: 900,
              letterSpacing: '-0.04em',
              boxShadow: `0 8px 18px ${accentColor}18`,
            }}
          >
            {shortMark}
          </div>
        </div>

        <div style={{
          fontSize: 15,
          color: '#94a3b8',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: 10,
        }}>
          {info.category}
        </div>

        <div style={{
          fontSize: 22,
          fontWeight: 800,
          color: '#334155',
          lineHeight: 1.2,
          textAlign: 'center',
          letterSpacing: '-0.03em',
          marginBottom: 8,
        }}>
          {info.name}
        </div>

        <div style={{
          fontSize: 15,
          color: '#64748b',
          marginBottom: 18,
          textAlign: 'center',
        }}>
          {paperCount} {paperCount === 1 ? 'exam' : 'exams'}
        </div>

        <div
          style={{
            marginTop: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 16px',
            borderRadius: 999,
            border: '1px solid #b7f2dc',
            background: 'linear-gradient(180deg, #f1fff8 0%, #dcfce7 100%)',
            color: '#0f766e',
            fontWeight: 800,
            fontSize: 14,
            boxShadow: '0 8px 20px rgba(16,185,129,0.14)',
          }}
        >
          <span
            style={{
              width: 18,
              height: 18,
              borderRadius: '50%',
              background: '#ffffff',
              border: '1px solid #86efac',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              color: '#0f766e',
              fontWeight: 900,
            }}
          >
            ✓
          </span>
          {questionLabel} Questions
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
              borderTop: 'none', borderLeft: 'none', borderRight: 'none',
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
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
          gap: 18,
          marginBottom: 24,
        }}>
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
