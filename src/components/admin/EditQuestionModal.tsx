import React, { useState } from 'react';
import { motion } from 'motion/react';
import { X, Save, Loader2 } from 'lucide-react';
import { C } from '../../lib/tokens';
import { type Question } from '../../types';

interface EditQuestionModalProps {
  question: Question;
  onClose: () => void;
  onSaved: (updated: Question) => void;
  onDeleted?: (questionId: string) => void;
}

const ADMIN_KEY = import.meta.env.VITE_ADMIN_KEY || 'upsc-admin-secret-key-change-me';

const DIFFICULTIES = ['Easy', 'Medium', 'Hard'];
const ANSWERS = ['A', 'B', 'C', 'D'];

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: C.bg,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  color: C.text,
  fontSize: 13,
  padding: '9px 12px',
  outline: 'none',
  boxSizing: 'border-box',
  resize: 'vertical' as const,
  fontFamily: 'inherit',
};

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: C.textTert,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: 5,
  display: 'block',
};

export function EditQuestionModal({ question, onClose, onSaved, onDeleted }: EditQuestionModalProps) {
  const [qText, setQText] = useState(question.question);
  const [optA, setOptA] = useState(question.options.A);
  const [optB, setOptB] = useState(question.options.B);
  const [optC, setOptC] = useState(question.options.C);
  const [optD, setOptD] = useState(question.options.D);
  const [answer, setAnswer] = useState(question.answer || 'A');
  const [subject, setSubject] = useState(question.subject);
  const [topic, setTopic] = useState(question.topic);
  const [difficulty, setDifficulty] = useState(question.difficulty);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!question.id) return;
    if (!confirm('Are you sure you want to delete this question forever?')) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`http://localhost:8000/admin/questions/${question.id}`, {
        method: 'DELETE',
        headers: { 'x-admin-key': ADMIN_KEY },
      });
      if (!res.ok) throw new Error(await res.text());
      if (onDeleted) onDeleted(question.id);
      else onClose();
    } catch (e: any) {
      setError(e.message || 'Delete failed');
      setDeleting(false);
    }
  };

  const handleSave = async () => {
    if (!question.id) { setError('Question has no ID'); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`http://localhost:8000/admin/questions/${question.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
        body: JSON.stringify({
          question_text: qText.trim(),
          option_a: optA.trim(),
          option_b: optB.trim(),
          option_c: optC.trim(),
          option_d: optD.trim(),
          correct_answer: answer,
          subject: subject.trim(),
          topic: topic.trim(),
          difficulty,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      onSaved({
        ...question,
        question: qText.trim(),
        options: { A: optA.trim(), B: optB.trim(), C: optC.trim(), D: optD.trim() },
        answer,
        subject: subject.trim(),
        topic: topic.trim(),
        difficulty,
      });
    } catch (e: any) {
      setError(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }} />

      <motion.div initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
        style={{ position: 'relative', width: '100%', maxWidth: 680, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 20, overflow: 'hidden', maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 80px rgba(0,0,0,0.7)' }}>

        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <p style={{ fontSize: 14, fontWeight: 800, color: C.text }}>Edit Question</p>
            <p style={{ fontSize: 11, color: C.textTert, marginTop: 2 }}>Admin — changes saved directly to DB</p>
          </div>
          <button onClick={onClose} style={{ padding: 8, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, cursor: 'pointer', color: C.textSec, display: 'flex' }}>
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Question text */}
          <div>
            <label style={labelStyle}>Question Text</label>
            <textarea value={qText} onChange={e => setQText(e.target.value)} rows={4} style={inputStyle} />
          </div>

          {/* Options */}
          <div>
            <label style={labelStyle}>Options</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {([['A', optA, setOptA], ['B', optB, setOptB], ['C', optC, setOptC], ['D', optD, setOptD]] as [string, string, (v: string) => void][]).map(([key, val, setter]) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 800, fontSize: 12,
                    background: answer === key ? C.accent + '20' : C.bg,
                    border: `1.5px solid ${answer === key ? C.accent : C.border}`,
                    color: answer === key ? C.accent : C.textSec,
                  }}>{key}</div>
                  <input
                    type="text" value={val} onChange={e => setter(e.target.value)}
                    style={{ ...inputStyle, resize: 'none', flex: 1 }}
                    placeholder={`Option ${key}`}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Correct answer */}
          <div>
            <label style={labelStyle}>Correct Answer</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {ANSWERS.map(a => (
                <button key={a} onClick={() => setAnswer(a)}
                  style={{ flex: 1, padding: '9px 0', borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: 'pointer', transition: 'all 0.15s',
                    background: answer === a ? C.accent : C.bg,
                    border: `1.5px solid ${answer === a ? C.accent : C.border}`,
                    color: answer === a ? '#000' : C.textSec,
                  }}>{a}</button>
              ))}
            </div>
          </div>

          {/* Metadata row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Subject</label>
              <input type="text" value={subject} onChange={e => setSubject(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Topic</label>
              <input type="text" value={topic} onChange={e => setTopic(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Difficulty</label>
              <select value={difficulty} onChange={e => setDifficulty(e.target.value)}
                style={{ ...inputStyle, cursor: 'pointer', appearance: 'auto' }}>
                {DIFFICULTIES.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>

          {error && (
            <div style={{ padding: '10px 14px', background: '#2E0D0D', border: '1px solid #f43f5e40', borderRadius: 10, fontSize: 12, color: '#f87171' }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 20px', background: C.bg, borderTop: `1px solid ${C.border}`, display: 'flex', gap: 10, justifyContent: 'space-between', flexShrink: 0 }}>
          <button onClick={handleDelete} disabled={deleting || saving}
            style={{ padding: '9px 16px', background: 'transparent', border: `1px solid ${C.danger}50`, borderRadius: 10, fontSize: 13, fontWeight: 600, color: C.danger, cursor: (deleting || saving) ? 'not-allowed' : 'pointer' }}>
            {deleting ? 'Deleting...' : 'Delete Question'}
          </button>
          
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={onClose}
              style={{ padding: '9px 20px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 13, fontWeight: 600, color: C.textSec, cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving || deleting}
              style={{ padding: '9px 22px', background: saving ? C.border : C.accent, border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, color: saving ? C.textSec : '#000', cursor: saving ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              {saving ? <><Loader2 style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} /> Saving...</> : <><Save style={{ width: 14, height: 14 }} /> Save Changes</>}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
