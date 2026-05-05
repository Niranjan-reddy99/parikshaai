import { ChevronDown, ChevronUp, Play } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { C } from '../../lib/tokens';
import { COLORS } from '../../lib/examUtils';
import { type WeightageItem } from '../../types';

interface ExamDetailSubjectBreakdownProps {
  selectedCommission: string;
  selectedExamType: string;
  selectedYear: number;
  selectedExamName: string;
  weightage: WeightageItem[];
  expandedSubjects: Record<string, boolean>;
  setExpandedSubjects: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  browseWithFilters: (subject?: string, topic?: string, subtopic?: string) => void;
  startPractice: (examName: string, year: number, subject?: string, topic?: string) => void;
}

export function ExamDetailSubjectBreakdown({
  selectedCommission,
  selectedExamType,
  selectedYear,
  selectedExamName,
  weightage,
  expandedSubjects,
  setExpandedSubjects,
  browseWithFilters,
  startPractice,
}: ExamDetailSubjectBreakdownProps) {
  return (
    <div className="glass-panel" style={{ borderRadius: 20, overflow: 'hidden', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: `1px solid ${C.border}` }}>
        <div>
          <div style={{ fontSize: 16, fontFamily: "'Fraunces', Georgia, serif", color: C.text }}>Subject Breakdown</div>
          <div style={{ fontSize: 12, color: C.textSec, marginTop: 2 }}>
            {selectedCommission} {selectedExamType} {selectedYear}
          </div>
        </div>
        <button
          className="hover-lift"
          onClick={() => browseWithFilters()}
          style={{ padding: '8px 16px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 12, fontWeight: 600, color: C.textSec, cursor: 'pointer' }}
        >
          Browse All Questions →
        </button>
      </div>

      {weightage.length === 0 ? (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: C.textTert, fontSize: 13 }}>No data for selected year</div>
      ) : (
        <div>
          {weightage.map((subjectData, subjectIndex) => {
            const isExpanded = expandedSubjects[subjectData.subject];
            const subjectColor = COLORS[subjectIndex % COLORS.length];

            return (
              <div key={subjectData.subject} style={{ borderBottom: `1px solid ${C.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingRight: 16 }}>
                  <button
                    onClick={() =>
                      setExpandedSubjects((previousState) => ({
                        ...previousState,
                        [subjectData.subject]: !previousState[subjectData.subject],
                      }))
                    }
                    style={{ flex: 1, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 14, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                  >
                    <div style={{ width: 12, height: 12, borderRadius: '50%', background: subjectColor, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontWeight: 600, color: C.text, fontSize: 14 }}>{subjectData.subject}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: C.textSec, fontFamily: "'DM Mono', monospace" }}>{subjectData.count} Q</span>
                          <span style={{ fontSize: 11, fontWeight: 800, color: '#000', background: subjectColor, padding: '2px 8px', borderRadius: 6 }}>{subjectData.pct}%</span>
                          {isExpanded ? <ChevronUp style={{ width: 14, height: 14, color: C.textTert }} /> : <ChevronDown style={{ width: 14, height: 14, color: C.textTert }} />}
                        </div>
                      </div>
                      <div style={{ height: 4, background: C.border, borderRadius: 99, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${subjectData.pct}%`, background: subjectColor, borderRadius: 99 }} />
                      </div>
                    </div>
                  </button>

                  <button
                    onClick={() => startPractice(selectedExamName, selectedYear, subjectData.subject)}
                    style={{ padding: '6px 12px', background: C.accentDim, border: `1px solid ${C.accent}30`, borderRadius: 8, fontSize: 11, fontWeight: 700, color: C.accent, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}
                  >
                    <Play style={{ width: 10, height: 10 }} /> Practice
                  </button>
                </div>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      style={{ overflow: 'hidden', background: C.bg, borderTop: `1px solid ${C.border}` }}
                    >
                      {subjectData.topics.map((topicData) => (
                        <div key={topicData.topic} style={{ display: 'flex', alignItems: 'center', padding: '10px 20px 10px 48px', borderBottom: `1px solid ${C.border}`, gap: 12 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                              <span style={{ fontSize: 13, color: C.textSec, fontWeight: 500 }}>{topicData.topic}</span>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 11, color: C.textTert, fontFamily: "'DM Mono', monospace" }}>{topicData.count} Q</span>
                                <span style={{ fontSize: 10, fontWeight: 700, color: C.textTert, background: C.surface, padding: '1px 6px', borderRadius: 4 }}>{topicData.pct}%</span>
                              </div>
                            </div>
                            <div style={{ height: 3, background: C.border, borderRadius: 99, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${topicData.pct}%`, background: C.textTert, borderRadius: 99 }} />
                            </div>
                          </div>
                          <button
                            onClick={() => startPractice(selectedExamName, selectedYear, subjectData.subject, topicData.topic)}
                            style={{ padding: '4px 10px', background: 'none', border: `1px solid ${C.border}`, borderRadius: 7, fontSize: 10, fontWeight: 700, color: C.textSec, cursor: 'pointer', flexShrink: 0 }}
                          >
                            Practice
                          </button>
                        </div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
