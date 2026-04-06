import React from 'react';

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
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4">
        <h3 className="font-bold text-slate-800 mb-1">Rename Exam</h3>
        <p className="text-xs text-slate-400 mb-4">
          Current: <span className="font-mono text-slate-600">{modal.fullName}</span> ({modal.year})
        </p>
        <input
          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-400 mb-4"
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onConfirm()}
          placeholder="New name e.g. TSPSC Group 1"
          autoFocus
        />
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-4 py-2 rounded-xl text-sm text-slate-500 hover:bg-slate-100">Cancel</button>
          <button onClick={onConfirm} disabled={busy || !value.trim()} className="px-4 py-2 rounded-xl text-sm font-semibold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50">
            {busy ? 'Saving…' : 'Rename'}
          </button>
        </div>
      </div>
    </div>
  );
}
