import React from 'react';
import { Loader2 } from 'lucide-react';
import { C } from '../../lib/tokens';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, React.CSSProperties> = {
  primary:   { background: C.accent,      color: '#000',      border: 'none' },
  secondary: { background: C.surface,     color: C.text,      border: `1px solid ${C.border}` },
  outline:   { background: 'transparent', color: C.textSec,   border: `1px solid ${C.border}` },
  ghost:     { background: 'transparent', color: C.textSec,   border: 'none' },
  danger:    { background: '#7f1d1d',      color: '#fca5a5',   border: `1px solid #991b1b` },
};

export const Button = ({
  children, onClick, variant = 'primary', style, disabled, icon: Icon, loading,
}: {
  children: React.ReactNode;
  onClick?: (e?: any) => void;
  variant?: Variant;
  style?: React.CSSProperties;
  disabled?: boolean;
  icon?: any;
  loading?: boolean;
}) => (
  <button
    onClick={onClick}
    disabled={disabled || loading}
    style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      padding: '9px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600,
      cursor: disabled || loading ? 'not-allowed' : 'pointer',
      opacity: disabled || loading ? 0.5 : 1,
      transition: 'opacity 0.15s, transform 0.1s',
      fontFamily: "'DM Sans', system-ui, sans-serif",
      whiteSpace: 'nowrap',
      ...VARIANTS[variant],
      ...style,
    }}
  >
    {loading ? <Loader2 style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} /> : Icon && <Icon style={{ width: 14, height: 14 }} />}
    {children}
  </button>
);
