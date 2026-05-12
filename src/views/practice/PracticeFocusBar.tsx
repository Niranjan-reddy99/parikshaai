import { ArrowLeft, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { C } from '../../lib/tokens';

interface PracticeFocusBarProps {
  practiceIndex: number;
  practiceQueueLength: number;
  progress: number;
  practiceInitLoading: boolean;
  practiceInitMessage: string;
  practiceLoadProgress: { loaded: number; total: number | null };
  practiceSubject: string;
  practiceTopic: string;
  availableSubjects: string[];
  availableTopics: string[];
  selectedExamName: string;
  selectedYear: number;
  backViewLabel: string;
  onBack: () => void;
  startPractice: (examName: string, year: number, subject?: string, topic?: string) => void;
}

export function PracticeFocusBar({
  practiceIndex,
  practiceQueueLength,
  progress,
  practiceInitLoading,
  practiceSubject,
  practiceTopic,
  availableSubjects,
  availableTopics,
  selectedExamName,
  selectedYear,
  onBack,
  startPractice,
}: PracticeFocusBarProps) {
  const displayName = selectedExamName.length > 34 ? selectedExamName.slice(0, 32) + '…' : selectedExamName;

  return (
    <div
      style={{
        background: 'var(--bg)',
        borderRadius: 14,
        padding: '12px 16px',
        marginBottom: 16,
        border: `1px solid var(--border)`,
      }}
    >
      {/* Row 1: back + exam name + mode */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <button
          onClick={onBack}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            fontSize: 12, color: C.textSec, cursor: 'pointer',
            background: 'none', border: 'none', padding: 0,
            fontFamily: 'inherit', flexShrink: 0,
          }}
          onMouseEnter={e => (e.currentTarget.style.color = C.text)}
          onMouseLeave={e => (e.currentTarget.style.color = C.textSec)}
        >
          <ArrowLeft style={{ width: 13, height: 13 }} /> Back
        </button>
        <span style={{ width: 1, height: 14, background: 'var(--border)', flexShrink: 0 }} />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: C.text, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {displayName}{selectedYear > 0 ? ` · ${selectedYear}` : ''}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#34D399', flexShrink: 0 }}>
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#34D399', boxShadow: '0 0 5px #34D39960' }} />
          Practice
        </div>
      </div>

      {/* Row 2: counter + progress bar + filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", color: C.textTert, flexShrink: 0, minWidth: 42 }}>
          {practiceIndex + 1}/{practiceQueueLength}
        </span>
        <div style={{ flex: 1, height: 4, background: 'var(--bg-canvas)', borderRadius: 4, overflow: 'hidden' }}>
          <motion.div
            style={{ height: '100%', background: '#2563eb', borderRadius: 4 }}
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
        {practiceInitLoading && (
          <Loader2 style={{ width: 12, height: 12, animation: 'spin 1s linear infinite', color: C.blue, flexShrink: 0 }} />
        )}
        <div style={{ display: 'flex', gap: 6 }}>
          {[
            { value: practiceSubject, placeholder: 'All Subjects', options: ['All', ...availableSubjects], onChange: (v: string) => startPractice(selectedExamName, selectedYear, v, 'All') },
            { value: practiceTopic, placeholder: 'All Topics', options: ['All', ...availableTopics], onChange: (v: string) => startPractice(selectedExamName, selectedYear, practiceSubject, v) },
          ].map((sel, i) => (
            <select
              key={i}
              value={sel.value}
              onChange={e => sel.onChange(e.target.value)}
              style={{ fontSize: 11, background: 'var(--bg-alt)', border: `1px solid var(--border)`, borderRadius: 6, padding: '4px 8px', color: C.textSec, cursor: 'pointer', maxWidth: 112, fontFamily: 'inherit' }}
            >
              <option value="All">{sel.placeholder}</option>
              {sel.options.filter(o => o !== 'All').map((o, oi) => <option key={`${o}-${oi}`} value={o}>{o}</option>)}
            </select>
          ))}
        </div>
      </div>
    </div>
  );
}
