import React from 'react';

interface SkeletonPulseProps {
  w?: string;
  h?: string;
  r?: string;
  style?: React.CSSProperties;
}

export function SkeletonPulse({ w = '100%', h = '16px', r = '6px', style }: SkeletonPulseProps) {
  return (
    <div style={{
      width: w,
      height: h,
      borderRadius: r,
      background: 'var(--c-surface3)',
      animation: 'pulse 1.5s ease-in-out infinite',
      flexShrink: 0,
      ...style,
    }} />
  );
}
