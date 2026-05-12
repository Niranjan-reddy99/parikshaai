import React, { useState, useEffect } from 'react';
import { X, Flag, Loader2, CheckCircle2, EyeOff, ChevronDown, ChevronRight } from 'lucide-react';
import { motion } from 'motion/react';
import { C } from '../../lib/tokens';
import { API_BASE, adminHeaders } from '../../lib/adminApi';

interface FlagEntry {
  id: string;
  user_id: string | null;
  flag_type: string;
  note: string | null;
  created_at: string;
}

interface FlaggedQuestion {
  question_id: string;
  question_text: string;
  exam_name: string;
  exam_year: number;
  subject: string;
  topic: string;
  flag_count: number;
  is_active: boolean;
  needs_review: boolean;
  flags: FlagEntry[];
}

const FLAG_LABELS: Record<string, string> = {
  wrong_answer: 'Wrong answer',
  poor_quality:  'Poor quality',
  outdated:      'Outdated',
  duplicate:     'Duplicate',
};

interface AdminFlagsModalProps {
  onClose: () => void;
}

export function AdminFlagsModal({ onClose }: AdminFlagsModalProps) {
  const [data, setData] = useState<FlaggedQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [resolving, setResolving] = useState<Record<string, boolean>>({});

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/flags?min_flags=1&limit=200`, { headers: adminHeaders() });
      if (res.ok) {
        const d = await res.json();
        setData(d.flags || []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const resolveFlag = async (flagId: string, questionId: string, action: 'dismiss' | 'hide') => {
    setResolving(prev => ({ ...prev, [flagId]: true }));
    try {
      await fetch(`${API_BASE}/admin/flags/${flagId}/resolve?action=${action}`, {
        method: 'POST', headers: adminHeaders(),
      });
      await load();
    } finally {
      setResolving(prev => { const n = { ...prev }; delete n[flagId]; return n; });
    }
  };

  const dismissAll = async (questionId: string) => {
    setResolving(prev => ({ ...prev, [questionId]: true }));
    try {
      await fetch(`${API_BASE}/admin/flags/dismiss-all/${questionId}`, {
        method: 'POST', headers: adminHeaders(),
      });
      await load();
    } finally {
      setResolving(prev => { const n = { ...prev }; delete n[questionId]; return n; });
    }
  };

  const toggle = (id: string) => setExpanded(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 20px', overflowY: 'auto' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
        style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 20, width: '100%', maxWidth: 760, boxShadow: '0 24px 64px rgba(0,0,0,0.35)', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: C.warnDim, border: `1px solid ${C.warn}30`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Flag style={{ width: 15, height: 15, color: C.warn }} />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Flagged Questions</div>
              <div style={{ fontSize: 11, color: C.textTert }}>{data.length} question{data.length !== 1 ? 's' : ''} with flags · sorted by flag count</div>
            </div>
          </div>
          <button onClick={onClose} style={{ padding: 6, background: 'none', border: 'none', cursor: 'pointer', color: C.textTert, borderRadius: 6 }}>
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>

        {/* Body */}
        <div style={{ maxHeight: '70vh', overflowY: 'auto', padding: '16px 24px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: C.textSec }}>
              <Loader2 style={{ width: 24, height: 24, margin: '0 auto 12px', animation: 'spin 1s linear infinite', color: C.accent }} />
              <div style={{ fontSize: 13 }}>Loading flagged questions...</div>
            </div>
          ) : data.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <CheckCircle2 style={{ width: 36, height: 36, margin: '0 auto 12px', color: C.accent }} />
              <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 6 }}>All clear</div>
              <div style={{ fontSize: 13, color: C.textSec }}>No flagged questions at the moment.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {data.map(q => {
                const isExpanded = expanded.has(q.question_id);
                const isBusy = resolving[q.question_id];
                return (
                  <div key={q.question_id} style={{ border: `1px solid ${q.flag_count >= 3 ? C.danger + '60' : C.border}`, borderRadius: 12, overflow: 'hidden' }}>
                    {/* Question row */}
                    <button onClick={() => toggle(q.question_id)}
                      style={{ width: '100%', padding: '13px 16px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                      <div style={{ flexShrink: 0, marginTop: 2 }}>
                        {isExpanded
                          ? <ChevronDown style={{ width: 14, height: 14, color: C.textTert }} />
                          : <ChevronRight style={{ width: 14, height: 14, color: C.textTert }} />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: C.text, lineHeight: 1.5, marginBottom: 6 }}>
                          {q.question_text}{q.question_text.length >= 200 ? '…' : ''}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                          <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: C.warnDim, color: C.warn }}>
                            {q.flag_count} flag{q.flag_count !== 1 ? 's' : ''}
                          </span>
                          {!q.is_active && (
                            <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: C.dangerDim, color: C.danger }}>
                              Hidden
                            </span>
                          )}
                          <span style={{ fontSize: 10, color: C.textTert }}>{q.exam_name} · {q.exam_year}</span>
                          <span style={{ fontSize: 10, color: C.textTert }}>{q.subject} › {q.topic}</span>
                        </div>
                      </div>
                      {/* Quick actions */}
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                        <button onClick={() => dismissAll(q.question_id)} disabled={isBusy}
                          title="Dismiss all flags (keep visible)"
                          style={{ padding: '5px 10px', fontSize: 11, fontWeight: 600, background: C.accentDim, border: `1px solid ${C.accent}30`, borderRadius: 7, color: C.accent, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, opacity: isBusy ? 0.5 : 1 }}>
                          <CheckCircle2 style={{ width: 11, height: 11 }} /> Dismiss all
                        </button>
                      </div>
                    </button>

                    {/* Expanded: individual flags */}
                    {isExpanded && (
                      <div style={{ borderTop: `1px solid ${C.border}`, background: C.bg, padding: '12px 16px 12px 42px' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: C.textTert, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Individual reports</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {q.flags.map(f => (
                            <div key={f.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 8, background: C.surface, border: `1px solid ${C.border}` }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                                  <span style={{ padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700, background: C.warnDim, color: C.warn }}>
                                    {FLAG_LABELS[f.flag_type] || f.flag_type}
                                  </span>
                                  <span style={{ fontSize: 10, color: C.textTert }}>{new Date(f.created_at).toLocaleDateString()}</span>
                                </div>
                                {f.note && <div style={{ fontSize: 12, color: C.textSec, lineHeight: 1.5 }}>{f.note}</div>}
                              </div>
                              <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                                <button onClick={() => resolveFlag(f.id, q.question_id, 'dismiss')} disabled={!!resolving[f.id]}
                                  title="Dismiss this flag"
                                  style={{ padding: '4px 8px', fontSize: 10, fontWeight: 600, background: C.accentDim, border: `1px solid ${C.accent}30`, borderRadius: 6, color: C.accent, cursor: 'pointer', opacity: resolving[f.id] ? 0.5 : 1 }}>
                                  Dismiss
                                </button>
                                <button onClick={() => resolveFlag(f.id, q.question_id, 'hide')} disabled={!!resolving[f.id]}
                                  title="Hide question"
                                  style={{ padding: '4px 8px', fontSize: 10, fontWeight: 600, background: C.dangerDim, border: `1px solid ${C.danger}30`, borderRadius: 6, color: C.danger, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, opacity: resolving[f.id] ? 0.5 : 1 }}>
                                  <EyeOff style={{ width: 10, height: 10 }} /> Hide Q
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
