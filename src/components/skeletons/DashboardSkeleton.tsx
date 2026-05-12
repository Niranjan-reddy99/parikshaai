import React from 'react';
import { SkeletonPulse } from './SkeletonPulse';
import { C } from '../../lib/tokens';

export function DashboardSkeleton() {
  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 16px' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <SkeletonPulse w="220px" h="28px" r="8px" style={{ marginBottom: 10 }} />
        <SkeletonPulse w="160px" h="14px" r="4px" />
      </div>
      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{ padding: '20px 22px', borderRadius: 16, border: `1px solid ${C.border}`, background: 'var(--c-surface)' }}>
            <SkeletonPulse w="36px" h="36px" r="10px" style={{ marginBottom: 12 }} />
            <SkeletonPulse h="24px" w="60px" r="6px" style={{ marginBottom: 6 }} />
            <SkeletonPulse h="12px" w="80px" r="4px" />
          </div>
        ))}
      </div>
      {/* Exam rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} style={{ padding: '16px 20px', borderRadius: 14, border: `1px solid ${C.border}`, background: 'var(--c-surface)', display: 'flex', alignItems: 'center', gap: 16 }}>
            <SkeletonPulse w="40px" h="40px" r="10px" style={{ flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <SkeletonPulse h="15px" w="45%" r="4px" style={{ marginBottom: 6 }} />
              <SkeletonPulse h="11px" w="30%" r="4px" />
            </div>
            <SkeletonPulse w="70px" h="30px" r="8px" style={{ flexShrink: 0 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
