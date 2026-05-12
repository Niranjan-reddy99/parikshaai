import React, { useMemo, useState } from 'react';
import { AlertCircle, FileText, RefreshCw, UploadCloud } from 'lucide-react';
import { API_BASE, adminHeaders } from '../lib/adminApi';
import { C } from '../lib/tokens';
import { type PatternStage12Question, type PatternStage12Report } from '../types';

function cardStyle(): React.CSSProperties {
  return {
    background: 'rgba(255,255,255,0.03)',
    border: `1px solid ${C.border}`,
    borderRadius: 16,
    padding: 16,
  };
}

type ResultFilter = 'all' | 'valid' | 'review' | 'invalid';

export function PatternBookIngestionView() {
  const [file, setFile] = useState<File | null>(null);
  const [chapterTitle, setChapterTitle] = useState('');
  const [sourceMeta, setSourceMeta] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<PatternStage12Report | null>(null);
  const [pageFilter, setPageFilter] = useState<string>('all');
  const [sourceTypeFilter, setSourceTypeFilter] = useState<string>('all');
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all');
  const [expandedQuestionId, setExpandedQuestionId] = useState<string | null>(null);

  const loadLatest = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/admin/pattern-book/gemini-stage12`, { headers: adminHeaders() });
      if (res.status === 404) {
        setReport(null);
        return;
      }
      if (!res.ok) throw new Error(`Failed to load staged extraction report (${res.status})`);
      const data = await res.json();
      setReport(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to load staged extraction report');
    } finally {
      setLoading(false);
    }
  };

  const runExtraction = async () => {
    if (!file) {
      setError('Choose a PDF first.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${API_BASE}/admin/pattern-book/gemini-stage12`, {
        method: 'POST',
        headers: adminHeaders(),
        body: form,
      });
      if (!res.ok) throw new Error(`Failed to run Stage 1/2 extraction (${res.status})`);
      const data = await res.json();
      setReport(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to run Stage 1/2 extraction');
    } finally {
      setLoading(false);
    }
  };

  const validQuestions = report?.valid_questions || [];
  const reviewBucket = report?.review_bucket || [];
  const invalidObjects = useMemo(
    () => reviewBucket.filter((item) => item.reasons?.includes('non_object_json_item')),
    [reviewBucket]
  );

  const pageOptions = useMemo(
    () => Array.from(new Set(validQuestions.map((q) => q.source_page_number).concat(reviewBucket.map((r) => r.page_number)))).sort((a, b) => a - b),
    [validQuestions, reviewBucket]
  );

  const sourcePageTypes = useMemo(
    () => Array.from(new Set(validQuestions.map((q) => q.source_page_type).concat(reviewBucket.map((r) => r.page_type)))).sort(),
    [validQuestions, reviewBucket]
  );

  const filteredValidQuestions = useMemo(() => {
    let items = validQuestions;
    if (pageFilter !== 'all') items = items.filter((q) => String(q.source_page_number) === pageFilter);
    if (sourceTypeFilter !== 'all') items = items.filter((q) => q.source_page_type === sourceTypeFilter);
    if (resultFilter === 'review' || resultFilter === 'invalid') return [];
    return items;
  }, [validQuestions, pageFilter, sourceTypeFilter, resultFilter]);

  const filteredReviewBucket = useMemo(() => {
    let items = reviewBucket;
    if (pageFilter !== 'all') items = items.filter((r) => String(r.page_number) === pageFilter);
    if (sourceTypeFilter !== 'all') items = items.filter((r) => r.page_type === sourceTypeFilter);
    if (resultFilter === 'valid') return [];
    if (resultFilter === 'invalid') return items.filter((r) => r.reasons?.includes('non_object_json_item'));
    if (resultFilter === 'review') return items.filter((r) => !r.reasons?.includes('non_object_json_item'));
    return items;
  }, [reviewBucket, pageFilter, sourceTypeFilter, resultFilter]);

  const filteredInvalidObjects = useMemo(
    () => filteredReviewBucket.filter((item) => item.reasons?.includes('non_object_json_item')),
    [filteredReviewBucket]
  );

  const filteredReviewOnly = useMemo(
    () => filteredReviewBucket.filter((item) => !item.reasons?.includes('non_object_json_item')),
    [filteredReviewBucket]
  );

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontFamily: "'Fraunces', serif", color: C.text }}>Scanned Book Ingestion</h1>
          <p style={{ fontSize: 12, color: C.textSec, fontFamily: "'DM Mono', monospace" }}>
            Separate admin-only Gemini Stage 1/2 workspace. Staging only, no canonical/public writes.
          </p>
        </div>
        <button
          onClick={() => void loadLatest()}
          className="hover-lift"
          style={{ padding: '8px 14px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, color: C.text, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <RefreshCw size={14} /> Load Latest
        </button>
      </div>

      <div style={{ ...cardStyle(), display: 'grid', gap: 14 }}>
        <div style={{ fontSize: 16, color: C.text, fontWeight: 700 }}>Upload Scanned / Pattern-Book PDF</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          <div style={{ display: 'grid', gap: 6 }}>
            <label style={{ fontSize: 12, color: C.textSec }}>PDF Upload</label>
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              style={{ padding: 10, borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, color: C.text }}
            />
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            <label style={{ fontSize: 12, color: C.textSec }}>Chapter / Book Title (Optional)</label>
            <input
              value={chapterTitle}
              onChange={(e) => setChapterTitle(e.target.value)}
              placeholder="SSC CGL Percentages"
              style={{ padding: 10, borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, color: C.text }}
            />
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            <label style={{ fontSize: 12, color: C.textSec }}>Source / Exam Metadata (Optional)</label>
            <input
              value={sourceMeta}
              onChange={(e) => setSourceMeta(e.target.value)}
              placeholder="SSC / Arithmetic / Pattern Book"
              style={{ padding: 10, borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, color: C.text }}
            />
          </div>
        </div>
        <div style={{ fontSize: 11, color: C.textTert }}>
          {chapterTitle || sourceMeta ? `Local metadata: ${chapterTitle || '—'} · ${sourceMeta || '—'}` : 'Optional metadata is kept only in this admin workspace for now.'}
        </div>
        <div>
          <button
            onClick={() => void runExtraction()}
            disabled={loading || !file}
            style={{ padding: '10px 16px', borderRadius: 10, border: `1px solid ${C.border}`, background: loading ? C.surface2 : C.accentDim, color: C.text, cursor: loading || !file ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}
          >
            <UploadCloud size={15} /> {loading ? 'Running Gemini Stage 1/2…' : 'Run Gemini Stage 1/2 Extraction'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ ...cardStyle(), color: C.danger, display: 'flex', alignItems: 'center', gap: 10 }}>
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {report && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
            <div style={cardStyle()}><div style={{ fontSize: 11, color: C.textSec }}>Pages Processed</div><div style={{ fontSize: 22, fontWeight: 800, color: C.text }}>{report.summary.pages_processed}</div></div>
            <div style={cardStyle()}><div style={{ fontSize: 11, color: C.textSec }}>Questions Extracted</div><div style={{ fontSize: 22, fontWeight: 800, color: C.text }}>{report.summary.total_questions_extracted}</div></div>
            <div style={cardStyle()}><div style={{ fontSize: 11, color: C.textSec }}>Valid Extracted</div><div style={{ fontSize: 22, fontWeight: 800, color: C.success }}>{report.summary.valid_extracted_questions}</div></div>
            <div style={cardStyle()}><div style={{ fontSize: 11, color: C.textSec }}>Review Bucket</div><div style={{ fontSize: 22, fontWeight: 800, color: C.warn }}>{report.summary.review_bucket_count}</div></div>
          </div>

          <div style={{ ...cardStyle(), display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 16, color: C.text, fontWeight: 700 }}>Staged MCQ Inspector</div>
              <div style={{ fontSize: 11, color: C.textSec }}>{report.report_path || report.pdf_path}</div>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <select value={pageFilter} onChange={(e) => setPageFilter(e.target.value)} style={{ padding: '8px 10px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, color: C.text }}>
                <option value="all">All Pages</option>
                {pageOptions.map((page) => <option key={page} value={String(page)}>Page {page}</option>)}
              </select>
              <select value={sourceTypeFilter} onChange={(e) => setSourceTypeFilter(e.target.value)} style={{ padding: '8px 10px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, color: C.text }}>
                <option value="all">All Source Types</option>
                {sourcePageTypes.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
              <select value={resultFilter} onChange={(e) => setResultFilter(e.target.value as ResultFilter)} style={{ padding: '8px 10px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, color: C.text }}>
                <option value="all">All Results</option>
                <option value="valid">Valid Only</option>
                <option value="review">Review Bucket Only</option>
                <option value="invalid">Invalid Objects Only</option>
              </select>
            </div>
          </div>

          <div style={cardStyle()}>
            <div style={{ fontSize: 16, color: C.text, fontWeight: 700, marginBottom: 12 }}>Page-wise Processing Summary</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ color: C.textSec, textAlign: 'left', borderBottom: `1px solid ${C.border}` }}>
                    <th style={{ padding: '8px 6px' }}>Page</th>
                    <th style={{ padding: '8px 6px' }}>Type</th>
                    <th style={{ padding: '8px 6px' }}>Heading</th>
                    <th style={{ padding: '8px 6px' }}>Source</th>
                    <th style={{ padding: '8px 6px' }}>Confidence</th>
                    <th style={{ padding: '8px 6px' }}>Valid</th>
                    <th style={{ padding: '8px 6px' }}>Review / Invalid</th>
                  </tr>
                </thead>
                <tbody>
                  {report.pages_processed.map((page) => (
                    <tr key={page.page_number} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: '8px 6px', color: C.text, fontWeight: 700 }}>{page.page_number}</td>
                      <td style={{ padding: '8px 6px', color: C.textSec }}>{page.page_type}</td>
                      <td style={{ padding: '8px 6px', color: C.textSec }}>{page.detected_pattern_heading || '—'}</td>
                      <td style={{ padding: '8px 6px', color: C.textSec }}>{page.classification_source || '—'}</td>
                      <td style={{ padding: '8px 6px', color: C.textSec }}>{page.classification_confidence ?? '—'}</td>
                      <td style={{ padding: '8px 6px', color: C.success }}>{page.questions_extracted}</td>
                      <td style={{ padding: '8px 6px', color: C.warn }}>{page.invalid_question_objects}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {resultFilter !== 'review' && resultFilter !== 'invalid' && (
            <div style={cardStyle()}>
              <div style={{ fontSize: 16, color: C.text, fontWeight: 700, marginBottom: 12 }}>Valid Extracted Questions</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {filteredValidQuestions.length === 0 ? (
                  <div style={{ fontSize: 13, color: C.textSec }}>No staged questions for the current filters.</div>
                ) : (
                  filteredValidQuestions.map((q) => {
                    const cardId = `${q.source_block_id}`;
                    const expanded = expandedQuestionId === cardId;
                    return (
                      <div key={cardId} style={{ ...cardStyle(), padding: 14 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11, color: C.textSec }}>
                            <span>Q{q.question_number}</span>
                            <span>P{q.source_page_number}</span>
                            <span>{q.source_page_type}</span>
                            <span>Conf {q.classification_confidence ?? '—'}</span>
                            <span>{q.source_block_id}</span>
                          </div>
                          <button
                            onClick={() => setExpandedQuestionId(expanded ? null : cardId)}
                            style={{ padding: '6px 10px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.text, cursor: 'pointer' }}
                          >
                            {expanded ? 'Collapse' : 'Expand'}
                          </button>
                        </div>
                        <div style={{ marginTop: 10, fontSize: 16, color: C.text, fontWeight: 700 }}>{q.question_text}</div>
                        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                          {([
                            ['A', q.option_a],
                            ['B', q.option_b],
                            ['C', q.option_c],
                            ['D', q.option_d],
                          ] as const).map(([label, value]) => (
                            <div key={label} style={{ fontSize: 13, color: C.textSec }}>
                              <span style={{ color: C.text, fontWeight: 700 }}>{label}.</span> {expanded ? value : `${value.slice(0, 200)}${value.length > 200 ? '…' : ''}`}
                            </div>
                          ))}
                        </div>
                        {expanded && (
                          <div style={{ marginTop: 10, display: 'grid', gap: 6, fontSize: 11, color: C.textTert }}>
                            <div>Heading: {q.detected_pattern_heading || '—'}</div>
                            <div>Classification source: {q.classification_source || '—'}</div>
                            <div>Validation status: valid</div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {resultFilter !== 'valid' && (
            <>
              <div style={cardStyle()}>
                <div style={{ fontSize: 16, color: C.text, fontWeight: 700, marginBottom: 12 }}>Review Bucket</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {filteredReviewOnly.length === 0 ? (
                    <div style={{ fontSize: 13, color: C.textSec }}>No review-bucket items for the current filters.</div>
                  ) : (
                    filteredReviewOnly.map((item) => (
                      <div key={`${item.page_number}-${item.object_index}`} style={{ ...cardStyle(), padding: 14 }}>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11, color: C.textSec, marginBottom: 8 }}>
                          <span>P{item.page_number}</span>
                          <span>{item.page_type}</span>
                          <span>Object #{item.object_index}</span>
                        </div>
                        <div style={{ fontSize: 12, color: C.warn, marginBottom: 8 }}>{item.reasons.join(' · ')}</div>
                        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12, color: C.textSec }}>{JSON.stringify(item.raw_item, null, 2)}</pre>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div style={cardStyle()}>
                <div style={{ fontSize: 16, color: C.text, fontWeight: 700, marginBottom: 12 }}>Invalid Question Objects</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {filteredInvalidObjects.length === 0 ? (
                    <div style={{ fontSize: 13, color: C.textSec }}>No invalid object items for the current filters.</div>
                  ) : (
                    filteredInvalidObjects.map((item) => (
                      <div key={`${item.page_number}-${item.object_index}-invalid`} style={{ ...cardStyle(), padding: 14 }}>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11, color: C.textSec, marginBottom: 8 }}>
                          <span>P{item.page_number}</span>
                          <span>{item.page_type}</span>
                          <span>Object #{item.object_index}</span>
                        </div>
                        <div style={{ fontSize: 12, color: C.danger, marginBottom: 8 }}>{item.reasons.join(' · ')}</div>
                        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12, color: C.textSec }}>{JSON.stringify(item.raw_item, null, 2)}</pre>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}

          <div style={cardStyle()}>
            <div style={{ fontSize: 16, color: C.text, fontWeight: 700, marginBottom: 12 }}>Sample MCQs</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(report.sample_extracted_mcqs || []).length === 0 ? (
                <div style={{ fontSize: 13, color: C.textSec }}>No sample MCQs available yet.</div>
              ) : (
                report.sample_extracted_mcqs!.map((q, idx) => (
                  <div key={`${q.source_block_id}-${idx}`} style={{ ...cardStyle(), padding: 14 }}>
                    <div style={{ fontSize: 12, color: C.textSec, marginBottom: 6 }}>Q{q.question_number} · Page {q.source_page_number}</div>
                    <div style={{ fontSize: 14, color: C.text, fontWeight: 700, marginBottom: 8 }}>{q.question_text}</div>
                    <div style={{ fontSize: 12, color: C.textSec, display: 'grid', gap: 4 }}>
                      <div>A. {q.option_a}</div>
                      <div>B. {q.option_b}</div>
                      <div>C. {q.option_c}</div>
                      <div>D. {q.option_d}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
