import React from 'react';
import { C } from '../../lib/tokens';

export const Card = ({ children, className, style, ...props }: { children: React.ReactNode; className?: string; style?: React.CSSProperties; [key: string]: any }) => (
  <div
    style={{ background: C.surface, borderRadius: 16, border: `1px solid ${C.border}`, overflow: 'hidden', ...style }}
    {...props}
  >
    {children}
  </div>
);
