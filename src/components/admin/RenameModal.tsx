import React from 'react';
import { C } from '../../lib/tokens';

interface RenameModalProps {
  modal: { fullName: string; year: number };
  value: string;
  onChange: (val: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}

export function RenameModal({ modal, value, onChange, onConfirm, onCancel, busy }: RenameModalProps) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="glass-panel rounded-2xl p-6 w-full max-w-sm mx-4">
        <h3 className="font-bold mb-1" style={{ color: C.text }}>Rename Exam</h3>
        <p className="text-xs mb-4" style={{ color: C.textTert }}>
          Current: <span className="font-mono" style={{ color: C.textSec }}>{modal.fullName}</span> ({modal.year})
        </p>
        <input
          className="w-full rounded-xl px-3 py-2 text-sm font-medium focus:outline-none mb-4"
          style={{ border: `1px solid ${C.border}`, background: C.surface2, color: C.text }}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onConfirm()}
          placeholder="New name e.g. TSPSC Group 1"
          autoFocus
        />
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-4 py-2 rounded-xl text-sm" style={{ color: C.textSec, background: C.surface3 }}>Cancel</button>
          <button onClick={onConfirm} disabled={busy || !value.trim()} className="px-4 py-2 rounded-xl text-sm font-semibold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50">
            {busy ? 'Saving…' : 'Rename'}
          </button>
        </div>
      </div>
    </div>
  );
}
