import React, { useState } from 'react';
import { X, Flag, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { C } from '../lib/tokens';
import { API_BASE } from '../lib/api';
import { type Question } from '../types';

interface FlagQuestionModalProps {
  question: Question;
  userId?: string;
  onClose: () => void;
}

const FLAG_OPTIONS = [
  { value: 'wrong_answer',  label: 'Wrong answer',  desc: 'The marked correct answer appears to be incorrect' },
  { value: 'poor_quality',  label: 'Poor quality',  desc: 'Question is badly phrased, ambiguous, or incomplete' },
  { value: 'outdated',      label: 'Outdated',       desc: 'Question or answer is no longer relevant/accurate' },
  { value: 'duplicate',     label: 'Duplicate',      desc: 'This question appears elsewhere in the bank' },
] as const;

export function FlagQuestionModal({ question, userId, onClose }: FlagQuestionModalProps) {
  const [flagType, setFlagType] = useState<string>('');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error' | 'already'>('idle');

  const submit = async () => {
    if (!flagType) return;
    setStatus('loading');
    try {
      const res = await fetch(`${API_BASE}/questions/${question.id}/flag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flag_type: flagType, note: note.trim() || null, user_id: userId || null }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setStatus(data.status === 'already_flagged' ? 'already' : 'success');
    } catch {
      setStatus('error');
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 20, padding: '28px 28px', width: '100%', maxWidth: 480, boxShadow: '0 24px 64px rgba(0,0,0,0.3)' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: C.warnDim, border: `1px solid ${C.warn}30`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Flag style={{ width: 15, height: 15, color: C.warn }} />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Flag this question</div>
              <div style={{ fontSize: 11, color: C.textTert }}>Help us improve the question bank</div>
            </div>
          </div>
          <button onClick={onClose}
            style={{ padding: 6, background: 'none', border: 'none', cursor: 'pointer', color: C.textTert, borderRadius: 6 }}
            onMouseEnter={e => e.currentTarget.style.color = C.text}
            onMouseLeave={e => e.currentTarget.style.color = C.textTert}>
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>

        {/* Question preview */}
        <div style={{ padding: '10px 14px', borderRadius: 10, background: C.bg, border: `1px solid ${C.border}`, marginBottom: 20, fontSize: 12, color: C.textSec, lineHeight: 1.5 }}>
          {(question.question || '').slice(0, 120)}{(question.question || '').length > 120 ? '…' : ''}
        </div>

        {status === 'success' ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.accent, marginBottom: 6 }}>Flag submitted</div>
            <div style={{ fontSize: 13, color: C.textSec, marginBottom: 20 }}>Our team will review this question. Thank you!</div>
            <button onClick={onClose}
              style={{ padding: '9px 24px', background: C.accent, border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, color: '#0a1a18', cursor: 'pointer' }}>
              Done
            </button>
          </div>
        ) : status === 'already' ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🔔</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.textSec, marginBottom: 6 }}>Already flagged</div>
            <div style={{ fontSize: 13, color: C.textSec, marginBottom: 20 }}>You've already flagged this question.</div>
            <button onClick={onClose}
              style={{ padding: '9px 24px', background: C.surface3, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontWeight: 600, color: C.textSec, cursor: 'pointer' }}>
              Close
            </button>
          </div>
        ) : (
          <>
            {/* Flag type selection */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.textTert, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Issue type</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {FLAG_OPTIONS.map(opt => (
                  <button key={opt.value} onClick={() => setFlagType(opt.value)}
                    style={{ padding: '11px 14px', borderRadius: 10, border: `1.5px solid ${flagType === opt.value ? C.warn : C.border}`,
                      background: flagType === opt.value ? C.warnDim : 'transparent', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                      display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 16, height: 16, borderRadius: '50%', border: `2px solid ${flagType === opt.value ? C.warn : C.border}`,
                      background: flagType === opt.value ? C.warn : 'transparent', flexShrink: 0, transition: 'all 0.15s' }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: flagType === opt.value ? C.warn : C.text }}>{opt.label}</div>
                      <div style={{ fontSize: 11, color: C.textTert, marginTop: 2 }}>{opt.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Optional note */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.textTert, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                Additional note <span style={{ fontWeight: 400, color: C.textTert }}>(optional)</span>
              </div>
              <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Describe the issue in more detail..."
                rows={2}
                style={{ width: '100%', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 12, padding: '9px 12px',
                  outline: 'none', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box', lineHeight: 1.5 }} />
            </div>

            {status === 'error' && (
              <div style={{ fontSize: 12, color: C.danger, marginBottom: 12 }}>Failed to submit flag. Please try again.</div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={onClose}
                style={{ padding: '9px 18px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontWeight: 600, color: C.textSec, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={submit} disabled={!flagType || status === 'loading'}
                style={{ padding: '9px 20px', background: flagType ? C.warn : C.surface3, border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700,
                  color: flagType ? '#fff' : C.textTert, cursor: flagType ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 8,
                  opacity: status === 'loading' ? 0.7 : 1, transition: 'all 0.15s' }}>
                {status === 'loading' && <Loader2 style={{ width: 13, height: 13, animation: 'spin 1s linear infinite' }} />}
                Submit flag
              </button>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}
