import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, EyeOff, Image as ImageIcon, Info, LayoutGrid, RefreshCw, ShieldAlert, Wrench } from 'lucide-react';
import { motion } from 'motion/react';
import { API_BASE, adminHeaders } from '../../lib/adminApi';
import { C } from '../../lib/tokens';
import { type Question, type RepairQueueItem, type RepairQueuePaper } from '../../types';

interface AdminAuditPanelProps {
  questions: Question[];
  examName: string;
  year: number;
  expectedCount?: number;
  onAddPlaceholder?: (num: number) => void;
  onEditQuestion?: (question: Question) => void;
  onDeleteQuestion?: (id: string) => void;
}

function badgeStyle(bg: string, color: string) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 8px',
    borderRadius: 999,
    background: bg,
    color,
    fontSize: 11,
    fontWeight: 700 as const,
    border: `1px solid ${color}20`,
  };
}

function toneForSeverity(severity: string) {
  if (severity === 'critical') return { bg: C.dangerDim, fg: C.danger };
  if (severity === 'high') return { bg: C.warnDim, fg: C.warn };
  if (severity === 'medium') return { bg: C.accentDim, fg: C.accent };
  return { bg: C.surface, fg: C.textSec };
}

function iconForIssue(issueType: string) {
  if (issueType === 'image/manual review') return <ImageIcon size={14} />;
  if (issueType === 'structural manual review' || issueType === 'numbering/data repair') return <Wrench size={14} />;
  if (issueType === 'explanation regeneration') return <RefreshCw size={14} />;
  return <ShieldAlert size={14} />;
}

export function AdminAuditPanel({
  questions,
  examName,
  year,
  expectedCount = 150,
  onAddPlaceholder,
  onEditQuestion,
}: AdminAuditPanelProps) {
  const [queue, setQueue] = useState<RepairQueueItem[]>([]);
  const [paper, setPaper] = useState<RepairQueuePaper | null>(null);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);

  const stats = useMemo(() => {
    const loadedNumbers = new Set(
      questions
        .map(q => q.question_number)
        .filter((n): n is number => typeof n === 'number')
    );
    const queueMissingNumbers = Array.from(
      new Set(
        queue
          .filter(item => item.issue_type === 'numbering/data repair' && !item.question_id && typeof item.question_number === 'number')
          .map(item => item.question_number as number)
      )
    ).sort((a, b) => a - b);

    const gaps =
      loadedNumbers.size > 0
        ? Array.from({ length: expectedCount }, (_, idx) => idx + 1).filter(num => !loadedNumbers.has(num))
        : queueMissingNumbers;

    const suspicious = questions.length > 0
      ? questions.filter(q =>
          (q.question.length < 50) ||
          q.needs_review ||
          q.question.toLowerCase().includes('space for rough work') ||
          q.question.toLowerCase().includes('missing number in the given table')
        )
      : queue.filter(item => item.publish_blocker !== 'none');

    const coverage = ((expectedCount - gaps.length) / expectedCount) * 100;
    const paperPenalty = (paper?.paper_blocker_count || 0) * 12;
    const rowPenalty = (paper?.row_blocker_count || suspicious.length) * 2;
    const health = Math.max(0, coverage - paperPenalty - rowPenalty);
    return { gaps, suspicious, health };
  }, [questions, queue, paper, expectedCount]);

  const repairSig = `${questions.length}:${questions.filter(q => q.needs_review).length}`;

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const run = async () => {
      setQueueLoading(true);
      setQueueError(null);
      const timeout = window.setTimeout(() => controller.abort(), 15000);
      try {
        const params = new URLSearchParams({ exam_name: examName, exam_year: String(year) });
        const res = await fetch(`${API_BASE}/admin/repair-queue?${params.toString()}`, {
          headers: adminHeaders(),
          signal: controller.signal,
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          throw new Error(detail || `Failed to load repair queue (${res.status})`);
        }
        const data = await res.json();
        if (cancelled) return;
        setQueue(data.items || []);
        const foundPaper = (data.papers || []).find((p: RepairQueuePaper) => p.exam_name === examName && p.exam_year === year) || null;
        setPaper(foundPaper);
      } catch (e: any) {
        if (!cancelled) {
          const message = e?.name === 'AbortError'
            ? 'Repair queue is taking too long to load. The backend may still be on an older deploy or temporarily stuck.'
            : (e?.message || 'Failed to load repair queue');
          setQueueError(message);
        }
      } finally {
        window.clearTimeout(timeout);
        if (!cancelled) setQueueLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [examName, year, repairSig]);

  const groupedByIssue = useMemo(() => {
    const map = new Map<string, RepairQueueItem[]>();
    for (const item of queue) {
      const list = map.get(item.issue_type) || [];
      list.push(item);
      map.set(item.issue_type, list);
    }
    return Array.from(map.entries());
  }, [queue]);

  const mapQueueItemToQuestion = (item: RepairQueueItem): Question | null => {
    if (!item.question_id) return null;
    const canonical = questions.find(q => q.id === item.question_id);
    if (canonical) return canonical;
    if (typeof item.question_number === 'number') {
      const visibleByNumber = questions.find(q => q.question_number === item.question_number);
      if (visibleByNumber) return visibleByNumber;
    }
    return {
      id: item.question_id,
      question: item.question_text || '',
      question_number: item.question_number ?? undefined,
      options: {
        A: item.option_a || '',
        B: item.option_b || '',
        C: item.option_c || '',
        D: item.option_d || '',
      },
      answer: item.correct_answer || '',
      explanation: '',
      subject: item.subject || 'General Knowledge',
      topic: item.topic || 'General',
      subtopic: item.subtopic || '',
      difficulty: item.difficulty || 'Medium',
      concept: item.concept || '',
      type: item.question_type || 'mcq',
      year: item.exam_year,
      exam: item.exam_name,
      passage: item.passage || undefined,
      needs_review: item.needs_review ?? true,
      has_image: item.has_image ?? false,
      image_url: item.image_url || undefined,
    };
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-panel"
      style={{ padding: 24, borderRadius: 24, marginBottom: 32, border: `1px solid ${C.accent}20` }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: C.accentDim, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <LayoutGrid size={20} color={C.accent} />
          </div>
          <div>
            <h2 style={{ fontSize: 18, fontFamily: "'Fraunces', serif", color: C.text }}>Admin Repair Queue</h2>
            <p style={{ fontSize: 12, color: C.textSec, fontFamily: "'DM Mono', monospace" }}>{examName} · {year}</p>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: stats.health > 80 ? C.success : stats.health > 50 ? C.warn : C.danger, fontFamily: "'DM Mono', monospace" }}>
            {Math.round(stats.health)}%
          </div>
          <div style={{ fontSize: 10, color: C.textSec, textTransform: 'uppercase', letterSpacing: 1 }}>Health Score</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 20 }}>
        <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 16, padding: 16, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 11, color: C.textSec, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Paper Status</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: paper?.blocked ? C.danger : paper?.likely_publishable_with_hidden_rows ? C.warn : C.success }}>
            {paper?.blocked ? 'Blocked' : paper?.likely_publishable_with_hidden_rows ? 'Publishable With Hidden Rows' : 'Clean'}
          </div>
          <div style={{ fontSize: 12, color: C.textSec, marginTop: 6 }}>
            {paper ? `${paper.visible_question_count} visible · ${paper.hidden_question_count} hidden` : 'Loading status...'}
          </div>
        </div>
        <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 16, padding: 16, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 11, color: C.textSec, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Repair Rows</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>{queue.length}</div>
          <div style={{ fontSize: 12, color: C.textSec, marginTop: 6 }}>
            {paper ? `${paper.paper_blocker_count} paper blockers · ${paper.row_blocker_count} row blockers` : 'Classifying...'}
          </div>
        </div>
        <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 16, padding: 16, border: `1px solid ${stats.gaps.length > 0 ? C.warn + '30' : C.border}` }}>
          <div style={{ fontSize: 11, color: C.textSec, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Missing Numbers</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: stats.gaps.length > 0 ? C.warn : C.success }}>{stats.gaps.length}</div>
          <div style={{ fontSize: 12, color: C.textSec, marginTop: 6 }}>
            {stats.gaps.length > 0 ? stats.gaps.slice(0, 6).map(n => `Q${n}`).join(', ') : 'No numbering gaps'}
          </div>
        </div>
      </div>

      {stats.gaps.length > 0 && (
        <div style={{ marginBottom: 20, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {stats.gaps.slice(0, 20).map(num => (
            <button
              key={num}
              onClick={() => onAddPlaceholder?.(num)}
              style={{ padding: '4px 8px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11, color: C.text, cursor: 'pointer' }}
              className="hover-lift"
            >
              Add Q{num}
            </button>
          ))}
        </div>
      )}

      {queueError && (
        <div style={{ padding: 14, borderRadius: 12, background: C.dangerDim, border: `1px solid ${C.danger}30`, color: C.danger, fontSize: 12, marginBottom: 20 }}>
          {queueError}
        </div>
      )}

      {queueLoading ? (
        <div style={{ fontSize: 13, color: C.textSec }}>Loading repair queue…</div>
      ) : queue.length === 0 ? (
        <div style={{ fontSize: 13, color: C.successDim, display: 'flex', alignItems: 'center', gap: 8 }}>
          <CheckCircle2 size={14} /> No repair items detected for this paper.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {groupedByIssue.map(([issueType, items]) => (
            <div key={issueType} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 16, padding: 16, border: `1px solid ${C.border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                <div style={{ ...badgeStyle(C.surface, C.textSec) }}>
                  {iconForIssue(issueType)}
                  {issueType}
                </div>
                <span style={{ fontSize: 12, color: C.textSec }}>{items.length} row{items.length === 1 ? '' : 's'}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {items.slice(0, 40).map(item => {
                  const tone = toneForSeverity(item.severity);
                  const preview = item.question_text?.trim()
                    ? item.question_text.trim()
                    : item.question_id
                      ? 'Question row exists but content is broken or incomplete.'
                      : 'Missing numbered question. Add a repair draft and fill the content manually if extraction cannot recover it.';
                  return (
                    <div key={`${item.question_id || 'paper'}-${item.question_number || 'na'}-${item.issue_type}`} style={{ display: 'grid', gridTemplateColumns: '120px 1fr auto', gap: 10, alignItems: 'center', background: 'rgba(0,0,0,0.18)', padding: 10, borderRadius: 10 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>
                        Q{item.question_number ?? '?'}
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <span style={badgeStyle(tone.bg, tone.fg)}>{item.severity}</span>
                        <span style={badgeStyle(item.publish_blocker === 'paper' ? C.dangerDim : C.accentDim, item.publish_blocker === 'paper' ? C.danger : C.accent)}>
                          {item.publish_blocker === 'paper' ? 'Blocks paper' : item.publish_blocker === 'row' ? 'Hide row' : 'No block'}
                        </span>
                        {item.safe_to_hide && (
                          <span style={badgeStyle(C.surface, C.textSec)}>
                            <EyeOff size={12} /> safe to hide
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: C.textSec, fontFamily: "'DM Mono', monospace" }}>{item.priority}</div>
                      <div style={{ gridColumn: '1 / -1', fontSize: 12, color: C.text, lineHeight: 1.55, background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px' }}>
                        {item.passage && (
                          <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: `1px dashed ${C.border}` }}>
                            <span style={{ display: 'block', fontSize: 9, fontWeight: 800, color: C.textTert, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Passage</span>
                            <span style={{ color: C.textSec, fontFamily: "'Fraunces', Georgia, serif" }}>{item.passage}</span>
                          </div>
                        )}
                        {preview}
                        {(item.option_a || item.option_b || item.option_c || item.option_d) && (
                          <div style={{ display: 'grid', gap: 4, marginTop: 10, fontSize: 11, color: C.textSec }}>
                            {item.option_a && <div><span style={{ color: C.text, fontWeight: 700 }}>A.</span> {item.option_a}</div>}
                            {item.option_b && <div><span style={{ color: C.text, fontWeight: 700 }}>B.</span> {item.option_b}</div>}
                            {item.option_c && <div><span style={{ color: C.text, fontWeight: 700 }}>C.</span> {item.option_c}</div>}
                            {item.option_d && <div><span style={{ color: C.text, fontWeight: 700 }}>D.</span> {item.option_d}</div>}
                          </div>
                        )}
                      </div>
                      <div style={{ gridColumn: '1 / -1', fontSize: 11, color: C.textSec, lineHeight: 1.5 }}>
                        {item.reasons.join(' · ')}
                      </div>
                      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {item.question_id ? (
                          <button
                            onClick={() => {
                              const question = mapQueueItemToQuestion(item);
                              if (question) onEditQuestion?.(question);
                            }}
                            style={{ padding: '6px 10px', background: C.accentDim, border: `1px solid ${C.accent}40`, borderRadius: 8, fontSize: 11, color: C.accentText, cursor: 'pointer' }}
                            className="hover-lift"
                          >
                            Edit Repair Row
                          </button>
                        ) : (
                          <button
                            onClick={() => item.question_number && onAddPlaceholder?.(item.question_number)}
                            style={{ padding: '6px 10px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11, color: C.text, cursor: 'pointer' }}
                            className="hover-lift"
                          >
                            Add Repair Draft
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {items.length > 40 && (
                  <div style={{ fontSize: 11, color: C.textSec, textAlign: 'center' }}>
                    + {items.length - 40} more {issueType} rows
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 24, padding: '12px 16px', background: C.accentDim + '20', borderRadius: 12, border: `1px solid ${C.accent}20`, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <Info size={16} color={C.accent} style={{ marginTop: 2 }} />
        <p style={{ fontSize: 12, color: C.textSec, lineHeight: 1.5 }}>
          This queue is driven by the backend repair audit. Rows marked <span style={{ color: C.accent }}>Hide row</span> are safe to keep out of the public paper without blocking the whole exam. Rows marked <span style={{ color: C.danger }}>Blocks paper</span> need structural or numbering repair first.
        </p>
      </div>
    </motion.div>
  );
}
