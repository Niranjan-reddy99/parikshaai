import { ArrowLeft, ChevronRight } from 'lucide-react';
import { QuestionText } from '../../lib/QuestionText';
import { C, diffBg, diffColor } from '../../lib/tokens';
import { type Question } from '../../types';

interface MockQuestionPanelProps {
  question: Question;
  currentIndex: number;
  loadedCount: number;
  hasMore: boolean;
  loadingMoreQuestions: boolean;
  selectedAnswer: string | undefined;
  onSelectAnswer: (answerKey: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  onLoadMoreQuestions: () => void;
}

export function MockQuestionPanel({
  question,
  currentIndex,
  loadedCount,
  hasMore,
  loadingMoreQuestions,
  selectedAnswer,
  onSelectAnswer,
  onPrevious,
  onNext,
  onLoadMoreQuestions,
}: MockQuestionPanelProps) {
  return (
    <div className="glass-panel" style={{ borderRadius: 24, padding: '24px 20px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
        <span style={{ padding: '4px 12px', background: C.blueDim, color: C.blue, fontSize: 10, fontWeight: 700, borderRadius: 99, textTransform: 'uppercase' }}>{question.subject}</span>
        <span style={{ padding: '4px 12px', background: diffBg[question.difficulty] || C.bg, color: diffColor[question.difficulty] || C.textSec, fontSize: 10, fontWeight: 700, borderRadius: 99 }}>{question.difficulty}</span>
        {question.subtopic && <span style={{ padding: '4px 12px', background: C.bg, color: C.textTert, fontSize: 10, borderRadius: 99, border: `1px solid ${C.border}` }}>{question.subtopic}</span>}
      </div>

      {question.passage && (
        <div style={{ padding: '16px 20px', borderRadius: 12, background: C.surface3, border: `1px solid ${C.border}`, marginBottom: 20 }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: C.textSec, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Passage</p>
          <p style={{ fontSize: 14, color: C.textSec, lineHeight: 1.8, whiteSpace: 'pre-wrap', fontFamily: "'Fraunces', Georgia, serif" }}>{question.passage}</p>
        </div>
      )}

      <div style={{ fontSize: 18, fontWeight: 400, color: C.text, lineHeight: 1.7, marginBottom: 32, fontFamily: "'Fraunces', Georgia, serif" }}>
        <QuestionText
          text={question.question}
          hasImage={(question as any).has_image}
          imageUrl={(question as any).image_url}
          style={{ fontSize: 18, fontWeight: 400, fontFamily: "'Fraunces', Georgia, serif", lineHeight: 1.7 }}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 32 }}>
        {Object.entries(question.options).map(([optionKey, optionValue]) => {
          const isSelected = selectedAnswer === optionKey;

          return (
            <button
              key={optionKey}
              onClick={() => onSelectAnswer(optionKey)}
              style={{ width: '100%', padding: '16px 20px', borderRadius: 14, border: `1.5px solid ${isSelected ? C.blue : C.border}`, background: isSelected ? C.blueDim : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left', transition: 'all 0.15s' }}
              onMouseEnter={(event) => {
                if (!isSelected) event.currentTarget.style.borderColor = `${C.blue}60`;
              }}
              onMouseLeave={(event) => {
                if (!isSelected) event.currentTarget.style.borderColor = C.border;
              }}
            >
              <div style={{ width: 32, height: 32, borderRadius: 8, background: isSelected ? `${C.blue}30` : C.surface3, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 12, color: isSelected ? C.blue : C.textSec, flexShrink: 0, fontFamily: "'DM Mono', monospace" }}>
                {optionKey}
              </div>
              <span style={{ flex: 1, fontSize: 14, fontWeight: 400, color: isSelected ? C.text : C.textSec, lineHeight: 1.5 }}>{optionValue}</span>
            </button>
          );
        })}
      </div>

      <div className="mock-nav-row" style={{ paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
        <button
          disabled={currentIndex === 0}
          onClick={onPrevious}
          style={{ padding: '9px 18px', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 13, fontWeight: 600, color: C.textSec, cursor: currentIndex === 0 ? 'not-allowed' : 'pointer', opacity: currentIndex === 0 ? 0.4 : 1, display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <ArrowLeft style={{ width: 14, height: 14 }} /> Previous
        </button>

        {currentIndex < loadedCount - 1 ? (
          <button
            onClick={onNext}
            style={{ padding: '9px 18px', background: C.accent, border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, color: '#0a1a18', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
          >
            Next <ChevronRight style={{ width: 14, height: 14 }} />
          </button>
        ) : hasMore ? (
          <button
            onClick={onLoadMoreQuestions}
            disabled={loadingMoreQuestions}
            style={{ padding: '9px 18px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 13, fontWeight: 700, color: C.text, cursor: loadingMoreQuestions ? 'default' : 'pointer', opacity: loadingMoreQuestions ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: 8 }}
          >
            {loadingMoreQuestions ? 'Loading…' : 'Load Next 20'}
          </button>
        ) : (
          <button
            disabled
            style={{ padding: '9px 18px', background: C.accent, border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, color: '#0a1a18', cursor: 'not-allowed', opacity: 0.4, display: 'flex', alignItems: 'center', gap: 8 }}
          >
            Next <ChevronRight style={{ width: 14, height: 14 }} />
          </button>
        )}
      </div>
    </div>
  );
}
