import React from 'react';
import { SkeletonPulse } from './SkeletonPulse';
import { C } from '../../lib/tokens';

export function ExplanationSkeleton() {
  return (
    <div style={{
      background: 'var(--c-bg)',
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      overflow: 'hidden',
      marginBottom: 20,
    }}>
      {/* Header bar */}
      <div style={{
        padding: '10px 16px',
        background: 'var(--c-surface3)',
        borderBottom: `1px solid ${C.border}`,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--c-surface3)', animation: 'pulse 1.5s ease-in-out infinite' }} />
        <SkeletonPulse w="80px" h="10px" r="4px" />
      </div>
      {/* Body lines */}
      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <SkeletonPulse h="13px" />
        <SkeletonPulse h="13px" w="92%" />
        <SkeletonPulse h="13px" w="78%" />
        <SkeletonPulse h="13px" w="85%" style={{ marginTop: 4 }} />
        <SkeletonPulse h="13px" w="60%" />
      </div>
    </div>
  );
}
