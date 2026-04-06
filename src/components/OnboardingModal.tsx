import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { C } from '../lib/tokens';

interface OnboardingModalProps {
  userName: string;
  onComplete: (prefs: { commissions: string[]; dailyGoal: number }) => void;
}

const COMMISSIONS = [
  { id: 'UPSC',  label: 'UPSC', sub: 'Union Public Service Commission', color: '#F5A623' },
  { id: 'APPSC', label: 'APPSC', sub: 'Andhra Pradesh PSC',              color: '#2BBFFF' },
  { id: 'TSPSC', label: 'TSPSC', sub: 'Telangana State PSC',             color: '#7C6EF5' },
];

const GOALS = [
  { value: 10,  label: '10 / day',  desc: 'Light — 10 min' },
  { value: 25,  label: '25 / day',  desc: 'Regular — 25 min' },
  { value: 50,  label: '50 / day',  desc: 'Intensive — 50 min' },
];

export function OnboardingModal({ userName, onComplete }: OnboardingModalProps) {
  const [step, setStep] = useState(0);
  const [selectedCommissions, setSelectedCommissions] = useState<string[]>([]);
  const [dailyGoal, setDailyGoal] = useState(25);

  const firstName = (userName ?? 'Aspirant').split(' ')[0];

  const toggleCommission = (id: string) => {
    setSelectedCommissions(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  };

  const canNext = step === 1 ? selectedCommissions.length > 0 : true;

  const steps = [
    // Step 0: Welcome
    <motion.div key="welcome" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.25 }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        {/* Logo */}
        <div style={{ width: 64, height: 64, borderRadius: 18, background: C.accentDim, border: `1.5px solid ${C.accent}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', boxShadow: `0 0 40px ${C.accent}20` }}>
          <svg viewBox="0 0 14 14" fill="none" width="30" height="30">
            <path d="M7 1L12.5 4.25V10.75L7 14L1.5 10.75V4.25L7 1Z" stroke="#2dd4bf" strokeWidth="1.2" strokeLinejoin="round"/>
            <path d="M7 4L9.6 5.5V8.5L7 10L4.4 8.5V5.5L7 4Z" fill="#2dd4bf" opacity=".5"/>
          </svg>
        </div>
        <h2 style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 26, fontWeight: 400, color: C.text, marginBottom: 8, letterSpacing: '-0.3px' }}>
          Welcome, <em style={{ fontStyle: 'italic', color: C.headingEm }}>{firstName}</em>
        </h2>
        <p style={{ fontSize: 14, color: C.textSec, lineHeight: 1.65, maxWidth: 340, margin: '0 auto' }}>
          Pariksha helps you master previous year questions with AI-powered insights — let's set you up in 30 seconds.
        </p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[
          { icon: '📚', title: 'Real PYQ Papers', desc: 'UPSC, APPSC & TSPSC question banks' },
          { icon: '🤖', title: 'AI Explanations', desc: 'Gemini-powered, generated on demand' },
          { icon: '📊', title: 'Subject Analytics', desc: 'Track accuracy, streaks & weak areas' },
          { icon: '⏱', title: 'Timed Mock Tests', desc: 'Full-paper simulation with result review' },
        ].map(({ icon, title, desc }) => (
          <div key={title} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 14px', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: C.accentDim, border: `1px solid ${C.accent}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>{icon}</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{title}</div>
              <div style={{ fontSize: 11, color: C.textTert, marginTop: 1 }}>{desc}</div>
            </div>
          </div>
        ))}
      </div>
    </motion.div>,

    // Step 1: Pick commissions
    <motion.div key="commissions" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.25 }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 22, fontWeight: 400, color: C.text, marginBottom: 6, letterSpacing: '-0.3px' }}>
          Which exam are you <em style={{ fontStyle: 'italic', color: C.headingEm }}>preparing for?</em>
        </h2>
        <p style={{ fontSize: 13, color: C.textTert }}>Select one or more — you can always practice from all.</p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {COMMISSIONS.map(c => {
          const selected = selectedCommissions.includes(c.id);
          return (
            <button key={c.id}
              onClick={() => toggleCommission(c.id)}
              style={{
                width: '100%', textAlign: 'left', padding: '16px 18px',
                background: selected ? c.color + '12' : C.bg,
                border: `1.5px solid ${selected ? c.color + '60' : C.border}`,
                borderRadius: 12, cursor: 'pointer', transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', gap: 14,
              }}>
              <div style={{
                width: 40, height: 40, borderRadius: 10,
                background: c.color + '18', border: `1px solid ${c.color}40`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 900, fontSize: 13, color: c.color, fontFamily: "'DM Mono', monospace",
                flexShrink: 0,
              }}>
                {c.label.slice(0, 2)}<span style={{ fontSize: 8 }}>{c.label.slice(2)}</span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: selected ? c.color : C.text }}>{c.label}</div>
                <div style={{ fontSize: 11, color: C.textTert, marginTop: 2 }}>{c.sub}</div>
              </div>
              <div style={{
                width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                background: selected ? c.color : 'transparent',
                border: `2px solid ${selected ? c.color : C.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.15s',
              }}>
                {selected && <svg viewBox="0 0 10 10" fill="none" width="10" height="10"><path d="M2 5L4.5 7.5L8 3" stroke="#0a1a18" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </div>
            </button>
          );
        })}
      </div>
    </motion.div>,

    // Step 2: Daily goal
    <motion.div key="goal" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.25 }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 22, fontWeight: 400, color: C.text, marginBottom: 6, letterSpacing: '-0.3px' }}>
          Set your <em style={{ fontStyle: 'italic', color: C.headingEm }}>daily goal</em>
        </h2>
        <p style={{ fontSize: 13, color: C.textTert }}>Consistent practice beats cramming. How many questions a day?</p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
        {GOALS.map(g => {
          const selected = dailyGoal === g.value;
          return (
            <button key={g.value}
              onClick={() => setDailyGoal(g.value)}
              style={{
                width: '100%', textAlign: 'left', padding: '16px 20px',
                background: selected ? C.accentDim : C.bg,
                border: `1.5px solid ${selected ? C.accent + '60' : C.border}`,
                borderRadius: 12, cursor: 'pointer', transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: selected ? C.accent : C.text, fontFamily: "'DM Mono', monospace" }}>{g.label}</div>
                <div style={{ fontSize: 11, color: C.textTert, marginTop: 3 }}>{g.desc}</div>
              </div>
              <div style={{
                width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                background: selected ? C.accent : 'transparent',
                border: `2px solid ${selected ? C.accent : C.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.15s',
              }}>
                {selected && <svg viewBox="0 0 10 10" fill="none" width="10" height="10"><path d="M2 5L4.5 7.5L8 3" stroke="#0a1a18" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </div>
            </button>
          );
        })}
      </div>
      <div style={{ padding: '14px 18px', background: C.accentDim, border: `1px solid ${C.accent}30`, borderRadius: 12, fontSize: 12, color: C.textSec, lineHeight: 1.6 }}>
        💡 <strong style={{ color: C.text }}>Tip:</strong> A {dailyGoal}-question daily habit for 30 days = {dailyGoal * 30} questions solved. That's a real edge.
      </div>
    </motion.div>,
  ];

  const totalSteps = steps.length;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        style={{
          width: '100%', maxWidth: 480,
          background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: 24, padding: '36px 32px 28px',
          boxShadow: '0 32px 64px rgba(0,0,0,0.5)',
          maxHeight: '90vh', overflowY: 'auto',
        }}
      >
        {/* Step dots */}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 32 }}>
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div key={i} style={{
              width: i === step ? 20 : 6, height: 6, borderRadius: 3,
              background: i <= step ? C.accent : C.border,
              transition: 'all 0.3s',
            }} />
          ))}
        </div>

        {/* Step content */}
        <AnimatePresence mode="wait">
          {steps[step]}
        </AnimatePresence>

        {/* CTA */}
        <div style={{ marginTop: 28, display: 'flex', gap: 10 }}>
          {step > 0 && (
            <button
              onClick={() => setStep(s => s - 1)}
              style={{ padding: '12px 20px', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 13, fontWeight: 600, color: C.textSec, cursor: 'pointer' }}>
              Back
            </button>
          )}
          <button
            onClick={() => {
              if (step < totalSteps - 1) { setStep(s => s + 1); }
              else { onComplete({ commissions: selectedCommissions, dailyGoal }); }
            }}
            disabled={!canNext}
            style={{
              flex: 1, padding: '12px 0', background: canNext ? C.accent : C.border,
              border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700,
              color: canNext ? '#0a1a18' : C.textTert, cursor: canNext ? 'pointer' : 'default',
              transition: 'all 0.15s',
            }}>
            {step === totalSteps - 1 ? "Let's go →" : 'Continue →'}
          </button>
        </div>

        {/* Skip */}
        {step === 0 && (
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <span onClick={() => onComplete({ commissions: [], dailyGoal: 25 })} style={{ fontSize: 12, color: C.textTert, cursor: 'pointer', textDecoration: 'underline' }}>
              Skip setup
            </span>
          </div>
        )}
      </motion.div>
    </div>
  );
}
