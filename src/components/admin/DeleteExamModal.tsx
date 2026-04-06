import React from 'react';

interface DeleteExamModalProps {
  target: { fullName: string; year: number };
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteExamModal({ target, busy, onConfirm, onCancel }: DeleteExamModalProps) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4">
        <h3 className="font-bold text-red-600 mb-1">Delete Exam</h3>
        <p className="text-sm text-slate-600 mb-4">
          This will permanently delete all questions for{' '}
          <span className="font-semibold">{target.fullName} {target.year}</span>. You can re-upload the PDF after.
        </p>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-4 py-2 rounded-xl text-sm text-slate-500 hover:bg-slate-100">Cancel</button>
          <button onClick={onConfirm} disabled={busy} className="px-4 py-2 rounded-xl text-sm font-semibold bg-red-500 text-white hover:bg-red-600 disabled:opacity-50">
            {busy ? 'Deleting…' : 'Delete All Questions'}
          </button>
        </div>
      </div>
    </div>
  );
}
