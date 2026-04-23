import React from 'react';
import { motion } from 'motion/react';
import { X, Play, Brain } from 'lucide-react';
import { C, diffColor, diffBg } from '../lib/tokens';
import { QuestionText } from '../lib/QuestionText';
import { type Question } from '../types';

interface QuestionModalProps {
  question: Question;
  onClose: () => void;
  onStartPractice: () => void;
}

export function QuestionModal({ question, onClose, onStartPractice }: QuestionModalProps) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }} />

      <motion.div initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 16 }}
        style={{ position: 'relative', width: '100%', maxWidth: 640, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 20, overflow: 'hidden', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 80px rgba(0,0,0,0.6)' }}>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ padding: '4px 10px', background: '#0F1E3D', color: C.blue, fontSize: 10, fontWeight: 700, borderRadius: 8, textTransform: 'uppercase' }}>{question.subject}</span>
            <span style={{ padding: '4px 10px', background: diffBg[question.difficulty] || C.bg, color: diffColor[question.difficulty] || C.textSec, fontSize: 10, fontWeight: 700, borderRadius: 8 }}>{question.difficulty}</span>
            {question.subtopic && <span style={{ padding: '4px 10px', background: C.bg, color: C.textTert, fontSize: 10, fontWeight: 500, borderRadius: 8, border: `1px solid ${C.border}` }}>{question.subtopic}</span>}
          </div>
          <button onClick={onClose} style={{ padding: 8, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, cursor: 'pointer', display: 'flex', color: C.textSec }}>
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
          {question.passage && (
            <div style={{ padding: '12px 14px', borderRadius: 10, background: '#0A1628', border: `1px solid #1E3A5F`, marginBottom: 14 }}>
              <p style={{ fontSize: 9, fontWeight: 700, color: C.blue, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Passage</p>
              <p style={{ fontSize: 12, color: C.textSec, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{question.passage}</p>
            </div>
          )}
          <div style={{ fontSize: 16, fontWeight: 600, color: C.text, marginBottom: 20 }}>
            <QuestionText text={question.question} hasImage={(question as any).has_image} style={{ fontSize: 16, fontWeight: 600 }} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
            {Object.entries(question.options).map(([key, val]) => (
              <div key={key} style={{ padding: '12px 14px', borderRadius: 12, border: `1px solid ${C.border}`, background: C.bg, display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: C.surface, border: `1px solid ${C.borderLight}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12, color: C.textSec, flexShrink: 0 }}>{key}</div>
                <span style={{ fontSize: 14, color: C.text, lineHeight: 1.5 }}>{val}</span>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {[
              { label: 'Difficulty', value: question.difficulty },
              { label: 'Topic', value: question.topic },
              { label: 'Subtopic', value: question.subtopic || 'N/A' },
            ].map(({ label, value }) => (
              <div key={label} style={{ padding: '10px 12px', background: C.bg, borderRadius: 10, border: `1px solid ${C.border}` }}>
                <p style={{ fontSize: 9, fontWeight: 700, color: C.textTert, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{label}</p>
                <p style={{ fontWeight: 600, color: C.text, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 20px', background: C.bg, borderTop: `1px solid ${C.border}`, display: 'flex', gap: 10, justifyContent: 'flex-end', flexShrink: 0 }}>
          <button onClick={onClose}
            style={{ padding: '9px 18px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 13, fontWeight: 600, color: C.textSec, cursor: 'pointer' }}>
            Close
          </button>
          <button onClick={onStartPractice}
            style={{ padding: '9px 18px', background: C.accent, border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, color: '#000', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Play style={{ width: 14, height: 14 }} /> Practice Mode
          </button>
        </div>
      </motion.div>
    </div>
  );
}
