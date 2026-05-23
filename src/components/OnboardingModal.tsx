import { motion } from 'motion/react';
import { C } from '../lib/tokens';

interface OnboardingModalProps {
  userName: string;
  onComplete: (prefs: { commissions: string[]; dailyGoal: number }) => void;
}

export function OnboardingModal({ userName, onComplete }: OnboardingModalProps) {
  const firstName = (userName ?? 'Aspirant').split(' ')[0];

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
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
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

        <button
          onClick={() => onComplete({ commissions: [], dailyGoal: 25 })}
          style={{
            width: '100%', padding: '13px 0',
            background: C.accent, border: 'none', borderRadius: 10,
            fontSize: 14, fontWeight: 700, color: '#0a1a18',
            cursor: 'pointer', transition: 'all 0.15s',
          }}
        >
          Let's go →
        </button>
      </motion.div>
    </div>
  );
}
