import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Eye, FileText, RefreshCw } from 'lucide-react';
import { API_BASE, adminHeaders } from '../lib/api';
import { C } from '../lib/tokens';
import {
  type PatternBookClassificationPage,
  type PatternBookClassificationReport,
  type PatternNormalizedDraftQuestion,
  type PatternNormalizedDraftReport,
  type PatternBookRawReport,
  type PatternQuestionBlock,
  type PatternSolutionBlock,
} from '../types';

function cardStyle(): React.CSSProperties {
  return {
    background: 'rgba(255,255,255,0.03)',
    border: `1px solid ${C.border}`,
    borderRadius: 16,
    padding: 16,
  };
}

export function PatternDebugView() {
  const [classification, setClassification] = useState<PatternBookClassificationReport | null>(null);
  const [rawReport, setRawReport] = useState<PatternBookRawReport | null>(null);
  const [normalizedDraft, setNormalizedDraft] = useState<PatternNormalizedDraftReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPage, setSelectedPage] = useState<number | null>(null);
  const [draftPageFilter, setDraftPageFilter] = useState<string>('all');
  const [draftSourceTypeFilter, setDraftSourceTypeFilter] = useState<string>('all');
  const [draftStatusFilter, setDraftStatusFilter] = useState<'all' | 'success' | 'failed'>('all');
  const [expandedDraftId, setExpandedDraftId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [cRes, rRes, dRes] = await Promise.all([
        fetch(`${API_BASE}/admin/pattern-book/classification-report`, { headers: adminHeaders() }),
        fetch(`${API_BASE}/admin/pattern-book/raw-report`, { headers: adminHeaders() }),
        fetch(`${API_BASE}/admin/pattern-book/normalized-draft`, { headers: adminHeaders() }),
      ]);
      if (!cRes.ok) throw new Error(`Failed to load classification report (${cRes.status})`);
      if (!rRes.ok) throw new Error(`Failed to load raw report (${rRes.status})`);
      let draftData: PatternNormalizedDraftReport | null = null;
      if (dRes.ok) {
        draftData = await dRes.json();
      } else if (dRes.status === 404) {
        const buildRes = await fetch(`${API_BASE}/admin/pattern-book/build-normalized-draft`, {
          method: 'POST',
          headers: adminHeaders(),
        });
        if (!buildRes.ok) throw new Error(`Failed to build normalized draft (${buildRes.status})`);
        draftData = await buildRes.json();
      } else {
        throw new Error(`Failed to load normalized draft (${dRes.status})`);
      }
      const cData = await cRes.json();
      const rData = await rRes.json();
      setClassification(cData);
      setRawReport(rData);
      setNormalizedDraft(draftData);
      if (!selectedPage && cData.pages?.length) setSelectedPage(cData.pages[0].page_number);
    } catch (e: any) {
      setError(e?.message || 'Failed to load pattern-book debug data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const questionBlocksByPage = useMemo(() => {
    const map = new Map<number, PatternQuestionBlock[]>();
    for (const block of rawReport?.question_blocks || []) {
      const list = map.get(block.page_number) || [];
      list.push(block);
      map.set(block.page_number, list);
    }
    return map;
  }, [rawReport]);

  const solutionBlocksByPage = useMemo(() => {
    const map = new Map<number, PatternSolutionBlock[]>();
    for (const block of rawReport?.solution_blocks || []) {
      const list = map.get(block.page_number) || [];
      list.push(block);
      map.set(block.page_number, list);
    }
    return map;
  }, [rawReport]);

  const questionSummaryByPage = useMemo(() => {
    const map = new Map<number, NonNullable<PatternBookRawReport['question_page_summaries']>[number]>();
    for (const row of rawReport?.question_page_summaries || []) {
      map.set(row.page_number, row);
    }
    return map;
  }, [rawReport]);

  const mixedByPage = useMemo(() => {
    const map = new Map<number, NonNullable<PatternBookRawReport['mixed_pages']>[number]>();
    for (const row of rawReport?.mixed_pages || []) {
      map.set(row.page_number, row);
    }
    return map;
  }, [rawReport]);

  const selectedClassification = useMemo(
    () => classification?.pages.find((p) => p.page_number === selectedPage) || null,
    [classification, selectedPage]
  );

  const selectedQuestionBlocks = selectedPage ? questionBlocksByPage.get(selectedPage) || [] : [];
  const selectedSolutionBlocks = selectedPage ? solutionBlocksByPage.get(selectedPage) || [] : [];
  const selectedQuestionSummary = selectedPage ? questionSummaryByPage.get(selectedPage) || null : null;
  const selectedMixed = selectedPage ? mixedByPage.get(selectedPage) || null : null;

  const draftPageOptions = useMemo(
    () => Array.from(new Set((normalizedDraft?.normalized_questions || []).map((q) => q.source_page_number))).sort((a, b) => a - b),
    [normalizedDraft]
  );

  const draftSourceTypes = useMemo(
    () => Array.from(new Set((normalizedDraft?.normalized_questions || []).map((q) => q.source_page_type))).sort(),
    [normalizedDraft]
  );

  const filteredDraftQuestions = useMemo(() => {
    let items = normalizedDraft?.normalized_questions || [];
    if (draftPageFilter !== 'all') {
      items = items.filter((q) => String(q.source_page_number) === draftPageFilter);
    }
    if (draftSourceTypeFilter !== 'all') {
      items = items.filter((q) => q.source_page_type === draftSourceTypeFilter);
    }
    if (draftStatusFilter === 'success') {
      return items;
    }
    if (draftStatusFilter === 'failed') {
      return [];
    }
    return items;
  }, [normalizedDraft, draftPageFilter, draftSourceTypeFilter, draftStatusFilter]);

  const filteredDraftFailures = useMemo(() => {
    let items = normalizedDraft?.normalization_failures || [];
    if (draftPageFilter !== 'all') {
      items = items.filter((f) => String(f.page_number) === draftPageFilter);
    }
    if (draftStatusFilter === 'success') {
      return [];
    }
    return items;
  }, [normalizedDraft, draftPageFilter, draftStatusFilter]);

  if (loading) {
    return <div style={{ color: C.textSec, fontSize: 14 }}>Loading pattern-book debug report…</div>;
  }

  if (error || !classification || !rawReport || !normalizedDraft) {
    return (
      <div style={{ ...cardStyle(), color: C.danger, display: 'flex', alignItems: 'center', gap: 10 }}>
        <AlertCircle size={16} />
        <span>{error || 'Pattern-book debug data unavailable'}</span>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontFamily: "'Fraunces', serif", color: C.text }}>Pattern-Book Pilot Debug</h1>
          <p style={{ fontSize: 12, color: C.textSec, fontFamily: "'DM Mono', monospace" }}>{classification.pdf_path}</p>
        </div>
        <button
          onClick={() => void load()}
          className="hover-lift"
          style={{ padding: '8px 14px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, color: C.text, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
        <div style={cardStyle()}><div style={{ fontSize: 11, color: C.textSec }}>Total Pages</div><div style={{ fontSize: 22, fontWeight: 800, color: C.text }}>{classification.page_count}</div></div>
        <div style={cardStyle()}><div style={{ fontSize: 11, color: C.textSec }}>Question Pages</div><div style={{ fontSize: 22, fontWeight: 800, color: C.accent }}>{classification.counts.question_page || 0}</div></div>
        <div style={cardStyle()}><div style={{ fontSize: 11, color: C.textSec }}>Solution Pages</div><div style={{ fontSize: 22, fontWeight: 800, color: C.blue }}>{classification.counts.solution_page || 0}</div></div>
        <div style={cardStyle()}><div style={{ fontSize: 11, color: C.textSec }}>Mixed Pages</div><div style={{ fontSize: 22, fontWeight: 800, color: C.warn }}>{classification.counts.mixed_special_page || 0}</div></div>
        <div style={cardStyle()}><div style={{ fontSize: 11, color: C.textSec }}>Raw Question Blocks</div><div style={{ fontSize: 22, fontWeight: 800, color: C.text }}>{rawReport.summary.raw_question_blocks_extracted}</div></div>
        <div style={cardStyle()}><div style={{ fontSize: 11, color: C.textSec }}>Raw Solution Blocks</div><div style={{ fontSize: 22, fontWeight: 800, color: C.text }}>{rawReport.summary.raw_solution_blocks_extracted}</div></div>
        <div style={cardStyle()}><div style={{ fontSize: 11, color: C.textSec }}>Skipped / Manual Review</div><div style={{ fontSize: 22, fontWeight: 800, color: C.warn }}>{rawReport.summary.mixed_pages_skipped}</div></div>
      </div>

      <div style={{ ...cardStyle(), display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ fontSize: 18, color: C.text, fontFamily: "'Fraunces', serif" }}>Normalized Draft</h2>
            <div style={{ fontSize: 11, color: C.textSec }}>{normalizedDraft.report_path || 'Draft artifact loaded'}</div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <select value={draftPageFilter} onChange={(e) => setDraftPageFilter(e.target.value)} style={{ padding: '8px 10px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, color: C.text }}>
              <option value="all">All Pages</option>
              {draftPageOptions.map((page) => <option key={page} value={String(page)}>Page {page}</option>)}
            </select>
            <select value={draftSourceTypeFilter} onChange={(e) => setDraftSourceTypeFilter(e.target.value)} style={{ padding: '8px 10px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, color: C.text }}>
              <option value="all">All Source Types</option>
              {draftSourceTypes.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
            <select value={draftStatusFilter} onChange={(e) => setDraftStatusFilter(e.target.value as 'all' | 'success' | 'failed')} style={{ padding: '8px 10px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, color: C.text }}>
              <option value="all">All Draft Results</option>
              <option value="success">Successful Only</option>
              <option value="failed">Failures Only</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
          <div style={cardStyle()}><div style={{ fontSize: 11, color: C.textSec }}>Blocks Considered</div><div style={{ fontSize: 22, fontWeight: 800, color: C.text }}>{normalizedDraft.summary.blocks_considered_for_normalization}</div></div>
          <div style={cardStyle()}><div style={{ fontSize: 11, color: C.textSec }}>Normalized Successfully</div><div style={{ fontSize: 22, fontWeight: 800, color: C.success }}>{normalizedDraft.summary.normalized_blocks_count}</div></div>
          <div style={cardStyle()}><div style={{ fontSize: 11, color: C.textSec }}>Normalization Failures</div><div style={{ fontSize: 22, fontWeight: 800, color: C.warn }}>{normalizedDraft.summary.normalization_failures_count}</div></div>
        </div>

        {draftStatusFilter !== 'failed' && filteredDraftQuestions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 13, color: C.text, fontWeight: 700 }}>Normalized Questions</div>
            {filteredDraftQuestions.map((q) => {
              const expanded = expandedDraftId === q.source_block_id;
              return (
                <div key={q.source_block_id} style={{ ...cardStyle(), padding: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11, color: C.textSec }}>
                      <span>Q{q.question_number}</span>
                      <span>P{q.source_page_number}</span>
                      <span>{q.source_page_type}</span>
                      <span>Conf {q.extraction_confidence}</span>
                      <span>{q.source_block_id}</span>
                    </div>
                    <button
                      onClick={() => setExpandedDraftId(expanded ? null : q.source_block_id)}
                      style={{ padding: '6px 10px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.text, cursor: 'pointer' }}
                    >
                      {expanded ? 'Collapse' : 'Expand'}
                    </button>
                  </div>
                  <div style={{ marginTop: 10, fontSize: 13, color: C.text, fontWeight: 700 }}>
                    {q.question_text}
                  </div>
                  <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                    {(['A', 'B', 'C', 'D'] as const).map((label) => {
                      const value = q[`option_${label.toLowerCase()}` as keyof PatternNormalizedDraftQuestion] as string;
                      return (
                        <div key={label} style={{ fontSize: 12, color: C.textSec }}>
                          <span style={{ color: C.text, fontWeight: 700 }}>{label}.</span> {expanded ? value : `${value.slice(0, 180)}${value.length > 180 ? '…' : ''}`}
                        </div>
                      );
                    })}
                  </div>
                  {expanded && (
                    <div style={{ marginTop: 10, display: 'grid', gap: 6, fontSize: 11, color: C.textTert }}>
                      <div>Heading: {q.detected_pattern_heading || '—'}</div>
                      <div>bbox: {q.source_bbox ? JSON.stringify(q.source_bbox) : '—'}</div>
                      {!!q.normalization_notes?.length && <div>Notes: {q.normalization_notes.join(' · ')}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {(draftStatusFilter === 'failed' || filteredDraftFailures.length > 0) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, color: C.text, fontWeight: 700 }}>Normalization Failures</div>
            {filteredDraftFailures.length === 0 ? (
              <div style={{ fontSize: 12, color: C.textSec }}>No failures for the current filters.</div>
            ) : (
              filteredDraftFailures.map((failure) => (
                <div key={failure.source_block_id} style={{ ...cardStyle(), padding: 14 }}>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11, color: C.textSec, marginBottom: 8 }}>
                    <span>P{failure.page_number}</span>
                    <span>Q{failure.question_number_raw || '?'}</span>
                    <span>{failure.source_block_id}</span>
                  </div>
                  <div style={{ fontSize: 13, color: C.warn }}>Reason: {failure.reason}</div>
                  {!!failure.missing_option_labels?.length && (
                    <div style={{ marginTop: 6, fontSize: 12, color: C.textSec }}>
                      Missing options: {failure.missing_option_labels.join(', ')}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div style={{ ...cardStyle(), overflowX: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ fontSize: 18, color: C.text, fontFamily: "'Fraunces', serif" }}>Page Table</h2>
          <span style={{ fontSize: 11, color: C.textSec }}>{classification.report_path || rawReport.report_path}</span>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: C.textSec, textAlign: 'left', borderBottom: `1px solid ${C.border}` }}>
              <th style={{ padding: '8px 6px' }}>Page</th>
              <th style={{ padding: '8px 6px' }}>Type</th>
              <th style={{ padding: '8px 6px' }}>Source</th>
              <th style={{ padding: '8px 6px' }}>Text</th>
              <th style={{ padding: '8px 6px' }}>Vision</th>
              <th style={{ padding: '8px 6px' }}>Q Blocks</th>
              <th style={{ padding: '8px 6px' }}>Low Conf</th>
              <th style={{ padding: '8px 6px' }}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {classification.pages.map((page: PatternBookClassificationPage) => {
              const qSummary = questionSummaryByPage.get(page.page_number);
              const lowConf = rawReport.summary.low_confidence_pages.includes(page.page_number) || (qSummary?.low_confidence_block_count || 0) > 0;
              return (
                <tr
                  key={page.page_number}
                  onClick={() => setSelectedPage(page.page_number)}
                  style={{
                    borderBottom: `1px solid ${C.border}`,
                    cursor: 'pointer',
                    background: selectedPage === page.page_number ? C.surface2 : 'transparent',
                  }}
                >
                  <td style={{ padding: '10px 6px', color: C.text, fontWeight: 700 }}>{page.page_number}</td>
                  <td style={{ padding: '10px 6px', color: C.textSec }}>{page.page_type}</td>
                  <td style={{ padding: '10px 6px', color: C.textSec }}>{page.classification_source}</td>
                  <td style={{ padding: '10px 6px', color: C.textSec }}>{page.text_confidence}</td>
                  <td style={{ padding: '10px 6px', color: C.textSec }}>{page.vision_confidence}</td>
                  <td style={{ padding: '10px 6px', color: C.textSec }}>{qSummary?.raw_question_block_count || 0}</td>
                  <td style={{ padding: '10px 6px', color: lowConf ? C.warn : C.textSec }}>{lowConf ? 'Yes' : 'No'}</td>
                  <td style={{ padding: '10px 6px', color: C.textTert, maxWidth: 420 }}>
                    {(qSummary?.boundary_detection_notes?.slice(0, 2).join(' · ')) || page.classification_reasons.slice(0, 2).join(' · ')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(360px, 1fr) minmax(420px, 1.4fr)', gap: 16 }}>
        <div style={{ ...cardStyle(), display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <h2 style={{ fontSize: 18, color: C.text, fontFamily: "'Fraunces', serif" }}>Selected Page</h2>
            {selectedClassification ? (
              <div style={{ fontSize: 12, color: C.textSec, marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div>Page {selectedClassification.page_number} · {selectedClassification.page_type}</div>
                <div>Heading: {selectedClassification.detected_pattern_heading || '—'}</div>
                <div>OCR mode: {selectedClassification.ocr_mode_used}</div>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: C.textSec }}>Select a page</div>
            )}
          </div>

          {selectedQuestionSummary && (
            <div style={cardStyle()}>
              <div style={{ fontSize: 12, color: C.text, fontWeight: 700, marginBottom: 8 }}>Question Page Summary</div>
              <div style={{ fontSize: 12, color: C.textSec, display: 'grid', gap: 4 }}>
                <div>Blocks: {selectedQuestionSummary.raw_question_block_count}</div>
                <div>Merge suspects: {selectedQuestionSummary.suspected_merge_count}</div>
                <div>Low-confidence blocks: {selectedQuestionSummary.low_confidence_block_count}</div>
                <div>Anchor count: {selectedQuestionSummary.anchor_count ?? 0}</div>
                <div>Suppressed false anchors: {selectedQuestionSummary.suppressed_false_anchors ?? 0}</div>
                <div>Recovered anchors: {selectedQuestionSummary.recovered_anchors ?? 0}</div>
                <div>Accepted sequence: {(selectedQuestionSummary.final_accepted_anchor_sequence || []).join(', ') || '—'}</div>
              </div>
            </div>
          )}

          {selectedMixed && (
            <div style={{ ...cardStyle(), borderColor: `${C.warn}40` }}>
              <div style={{ fontSize: 12, color: C.warn, fontWeight: 700, marginBottom: 8 }}>Mixed / Withheld Page</div>
              <div style={{ fontSize: 12, color: C.textSec }}>{selectedMixed.note}</div>
              <div style={{ fontSize: 12, color: C.textTert, marginTop: 8 }}>
                {(selectedMixed.classification_reasons || []).slice(0, 6).join(' · ')}
              </div>
            </div>
          )}

          {selectedClassification && (
            <div style={cardStyle()}>
              <div style={{ fontSize: 12, color: C.text, fontWeight: 700, marginBottom: 8 }}>Classification Notes</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: C.textSec }}>
                {selectedClassification.classification_reasons.map((reason, idx) => (
                  <div key={`${selectedClassification.page_number}-${idx}`}>• {reason}</div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {selectedQuestionBlocks.length > 0 && (
            <div style={cardStyle()}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <Eye size={16} color={C.accent} />
                <h2 style={{ fontSize: 18, color: C.text, fontFamily: "'Fraunces', serif" }}>Question Block Viewer</h2>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {selectedQuestionBlocks.map((block, idx) => (
                  <div key={`${block.page_number}-${block.question_number_raw || idx}`} style={{ ...cardStyle(), padding: 14 }}>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                      <span style={{ fontSize: 11, color: C.textSec }}>P{block.page_number}</span>
                      <span style={{ fontSize: 11, color: C.textSec }}>Q{block.question_number_raw || '?'}</span>
                      <span style={{ fontSize: 11, color: C.textSec }}>Conf {block.extraction_confidence}</span>
                      <span style={{ fontSize: 11, color: block.extraction_confidence < 0.75 ? C.warn : C.success }}>
                        {block.extraction_confidence < 0.75 ? 'low confidence' : 'raw'}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: C.textTert, marginBottom: 6 }}>
                      {block.detected_pattern_heading || 'No heading'} {block.region_label ? `· ${block.region_label}` : ''}
                    </div>
                    <div style={{ fontSize: 13, color: C.text, whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{block.raw_block_text}</div>
                    {block.raw_options_text && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}`, fontSize: 12, color: C.textSec, whiteSpace: 'pre-wrap' }}>
                        {block.raw_options_text}
                      </div>
                    )}
                    {(block.bbox || block.source_region_bbox) && (
                      <div style={{ marginTop: 8, fontSize: 11, color: C.textTert, fontFamily: "'DM Mono', monospace" }}>
                        bbox: {JSON.stringify(block.bbox)} {block.source_region_bbox ? `· region: ${JSON.stringify(block.source_region_bbox)}` : ''}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {selectedSolutionBlocks.length > 0 && (
            <div style={cardStyle()}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <FileText size={16} color={C.blue} />
                <h2 style={{ fontSize: 18, color: C.text, fontFamily: "'Fraunces', serif" }}>Solution Block Viewer</h2>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {selectedSolutionBlocks.map((block, idx) => (
                  <div key={`${block.page_number}-${block.resolved_question_number || idx}`} style={{ ...cardStyle(), padding: 14 }}>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8, fontSize: 11, color: C.textSec }}>
                      <span>P{block.page_number}</span>
                      <span>Q{block.resolved_question_number || '?'}</span>
                      <span>Resolution {block.resolution_confidence}</span>
                      <span>{block.has_formula ? 'formula' : 'no formula'}</span>
                      <span>{block.has_diagram_note ? 'diagram note' : 'no diagram note'}</span>
                    </div>
                    <div style={{ fontSize: 13, color: C.text, whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{block.raw_solution_text}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {selectedQuestionBlocks.length === 0 && selectedSolutionBlocks.length === 0 && (
            <div style={cardStyle()}>
              <div style={{ fontSize: 14, color: C.textSec }}>No raw blocks available for this page.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
