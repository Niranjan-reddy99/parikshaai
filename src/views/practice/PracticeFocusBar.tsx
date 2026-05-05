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
  practiceInitMessage,
  practiceLoadProgress,
  practiceSubject,
  practiceTopic,
  availableSubjects,
  availableTopics,
  selectedExamName,
  selectedYear,
  onBack,
  startPractice,
}: PracticeFocusBarProps) {
  const filterSelectors = [
    {
      value: practiceSubject,
      placeholder: 'All Subjects',
      options: ['All', ...availableSubjects],
      onChange: (nextSubject: string) => startPractice(selectedExamName, selectedYear, nextSubject, 'All'),
    },
    {
      value: practiceTopic,
      placeholder: 'All Topics',
      options: ['All', ...availableTopics],
      onChange: (nextTopic: string) => startPractice(selectedExamName, selectedYear, practiceSubject, nextTopic),
    },
  ];

  return (
    <div
      className="glass-panel"
      style={{
        borderRadius: 18,
        padding: '16px 20px',
        marginBottom: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        border: `1px solid ${C.borderHover}`,
      }}
    >
      <button
        onClick={onBack}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12,
          color: C.textSec,
          cursor: 'pointer',
          background: 'none',
          border: 'none',
          padding: '4px 0',
          fontFamily: 'inherit',
          transition: 'color 0.15s',
          flexShrink: 0,
        }}
        onMouseEnter={(event) => {
          event.currentTarget.style.color = C.text;
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.color = C.textSec;
        }}
      >
        <ArrowLeft style={{ width: 14, height: 14 }} /> Back
      </button>
      <div style={{ width: 1, height: 20, background: C.border }} />
      <span style={{ fontSize: 12, fontFamily: "'DM Mono', monospace", color: C.textSec, whiteSpace: 'nowrap', flexShrink: 0 }}>
        {practiceIndex + 1} of {practiceQueueLength}
      </span>
      <div style={{ flex: 1, height: 4, background: C.surface3, borderRadius: 4, overflow: 'hidden' }}>
        <motion.div
          style={{ height: '100%', background: '#2563eb', borderRadius: 4 }}
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#34D399', flexShrink: 0 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#34D399', boxShadow: '0 0 6px #34D39980' }} />
        Practice
      </div>

      {practiceInitLoading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.blue, flexShrink: 0 }}>
          <Loader2 style={{ width: 12, height: 12, animation: 'spin 1s linear infinite' }} />
          {practiceLoadProgress.total
            ? `Loading more (${practiceLoadProgress.loaded}/${practiceLoadProgress.total})`
            : 'Loading more'}
        </div>
      )}

      {practiceInitLoading && practiceInitMessage && (
        <div style={{ fontSize: 11, color: C.textTert, minWidth: 180 }}>{practiceInitMessage}</div>
      )}

      <div style={{ display: 'flex', gap: 8, marginLeft: 4 }}>
        {filterSelectors.map((selector, index) => (
          <select
            key={index}
            value={selector.value}
            onChange={(event) => selector.onChange(event.target.value)}
            style={{
              fontSize: 11,
              background: C.surface,
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              padding: '5px 10px',
              color: C.textSec,
              cursor: 'pointer',
              maxWidth: 120,
              fontFamily: 'inherit',
            }}
          >
            <option value="All">{selector.placeholder}</option>
            {selector.options
              .filter((optionLabel) => optionLabel !== 'All')
              .map((optionLabel, optionIndex) => (
                <option key={`${optionLabel}-${optionIndex}`} value={optionLabel}>
                  {optionLabel}
                </option>
              ))}
          </select>
        ))}
      </div>
    </div>
  );
}
