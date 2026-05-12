import React from 'react';
import { SkeletonPulse } from './SkeletonPulse';
import { C } from '../../lib/tokens';

export function QuestionCardSkeleton() {
  return (
    <div className="glass-panel" style={{ borderRadius: 24, padding: '36px 36px', marginBottom: 16, border: `1px solid ${C.borderHover}` }}>
      {/* Tags row */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <SkeletonPulse w="64px" h="22px" r="8px" />
        <SkeletonPulse w="80px" h="22px" r="8px" />
        <SkeletonPulse w="48px" h="22px" r="8px" />
      </div>
      {/* Question label */}
      <SkeletonPulse w="90px" h="10px" r="4px" style={{ marginBottom: 12 }} />
      {/* Question text */}
      <div style={{ marginBottom: 32 }}>
        <SkeletonPulse h="20px" style={{ marginBottom: 8 }} />
        <SkeletonPulse h="20px" w="88%" style={{ marginBottom: 8 }} />
        <SkeletonPulse h="20px" w="72%" />
      </div>
      {/* Options */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {[68, 80, 74, 60].map((w, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 10, border: `1px solid ${C.border}` }}>
            <SkeletonPulse w="26px" h="26px" r="6px" style={{ flexShrink: 0 }} />
            <SkeletonPulse h="14px" w={`${w}%`} />
          </div>
        ))}
      </div>
    </div>
  );
}
