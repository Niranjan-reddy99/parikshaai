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
        borderRadius: 18,
        padding: '14px 16px',
        marginBottom: 16,
        border: `1px solid var(--border)`,
        boxShadow: '0 16px 30px -28px rgba(15,23,42,0.18)',
      }}
    >
      {/* Row 1: back + exam name + mode */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--green)', flexShrink: 0, padding: '4px 9px', borderRadius: 999, background: 'var(--green-soft)', fontWeight: 700 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 5px rgba(15,159,140,0.35)' }} />
          Practice
        </div>
      </div>

      {/* Row 2: counter + progress bar + filters */}
      <div className="focus-bar-row2" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div className="focus-bar-progress-row" style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 140 }}>
          <span style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", color: C.textTert, flexShrink: 0, minWidth: 42 }}>
            {practiceIndex + 1}/{practiceQueueLength}
          </span>
          <div style={{ flex: 1, height: 5, background: 'var(--bg-canvas)', borderRadius: 4, overflow: 'hidden' }}>
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
        </div>
        <div className="focus-bar-selects" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginLeft: 'auto' }}>
          {[
            { value: practiceSubject, placeholder: 'All Subjects', options: ['All', ...availableSubjects], onChange: (v: string) => startPractice(selectedExamName, selectedYear, v, 'All') },
            { value: practiceTopic, placeholder: 'All Topics', options: ['All', ...availableTopics], onChange: (v: string) => startPractice(selectedExamName, selectedYear, practiceSubject, v) },
          ].map((sel, i) => (
            <select
              key={i}
              value={sel.value}
              onChange={e => sel.onChange(e.target.value)}
              style={{ fontSize: 11.5, background: 'var(--bg-alt)', border: `1px solid var(--border)`, borderRadius: 10, padding: '7px 10px', color: C.textSec, cursor: 'pointer', maxWidth: 132, fontFamily: 'inherit' }}
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
