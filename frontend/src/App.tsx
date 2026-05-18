import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Crop as CropIcon,
  FilePenLine,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Trash,
  Upload,
  X,
} from 'lucide-react';
import ReactCrop, { type Crop, type PixelCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import {
  GoogleAuthProvider,
  User,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { API_BASE, adminHeaders, hasAdminAuth, setAdminAuthToken } from './lib/adminApi';
import { auth } from './firebase';

type Phase = 'idle' | 'uploading' | 'processing' | 'done' | 'error';
type Mode = 'auto' | 'answer_key' | 'visual' | 'cbt' | 'pattern';

type UploadConflict = {
  type: 'file' | 'exam';
  message: string;
  existingExamName?: string;
  existingExamYear?: string;
};

type Job = {
  id: string;
  filename?: string;
  exam_name?: string;
  exam_year?: number;
  paper_id?: string | null;
  status?: string;
  progress?: number;
  error_log?: string;
  updated_at?: string;
};

type ReviewTarget = {
  examName: string;
  examYear: number;
};

type ExplanationCoverage = {
  generated: number;
  missing: number;
  coverage_pct: number;
  eligible_total: number;
  eligible_generated: number;
  eligible_missing: number;
  eligible_coverage_pct: number;
  unverified_or_invalid: number;
};

type RepairQueuePaper = {
  exam: string;
  exam_name: string;
  exam_year: number;
  publishable: boolean;
  likely_publishable_with_hidden_rows: boolean;
  blocked: boolean;
  reupload_needed?: boolean;
  visible_question_count: number;
  hidden_question_count: number;
  paper_blocker_count: number;
  row_blocker_count: number;
  verified_answer_count?: number;
  explanations?: ExplanationCoverage;
};

type RepairQueueItem = {
  exam: string;
  exam_name: string;
  exam_year: number;
  question_number?: number | null;
  question_id?: string | null;
  question_text?: string;
  option_a?: string;
  option_b?: string;
  option_c?: string;
  option_d?: string;
  correct_answer?: string;
  subject?: string;
  topic?: string;
  subtopic?: string;
  difficulty?: string;
  question_type?: string;
  concept?: string;
  passage?: string;
  has_image?: boolean;
  image_url?: string | null;
  is_active?: boolean;
  needs_review?: boolean;
  issue_type: string;
  severity: string;
  publish_blocker: string;
  repair_path: string;
  priority: string;
  safe_to_hide: boolean;
  reasons: string[];
};

type AdminQuestion = {
  id: string;
  question_text: string;
  question_number?: number | null;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: string;
  subject: string;
  topic: string;
  subtopic: string;
  difficulty: string;
  concept?: string;
  question_type?: string;
  passage?: string;
  exam_name: string;
  exam_year: number;
  is_active?: boolean;
  needs_review?: boolean;
  has_image?: boolean;
  image_url?: string | null;
  public_visibility?: string;
};

type ReviewWorkspace = {
  paper: RepairQueuePaper | null;
  repairItems: RepairQueueItem[];
  questions: AdminQuestion[];
};

type QuestionEditorModalProps = {
  question: AdminQuestion;
  onClose: () => void;
  onSaved: (question: AdminQuestion) => void;
};

const ACTIVE_JOB_KEY = 'pariksha_admin_active_upload_job';

type TagJobStatus = {
  running: boolean;
  tagged: number;
  total: number;
  errors: number;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  untagged_remaining: number;
};

function PatternTagSection({ visible }: { visible: boolean }) {
  const [status, setStatus] = React.useState<TagJobStatus | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [fetchError, setFetchError] = React.useState<string | null>(null);
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const startPolling = React.useCallback((fetchFn: () => Promise<void>) => {
    if (pollRef.current) return;
    pollRef.current = setInterval(() => void fetchFn(), 3000);
  }, []);

  const stopPolling = React.useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const fetchStatus = React.useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/tag-patterns-status`, { headers: await adminHeaders() });
      if (!res.ok) { setFetchError(`Status check failed: ${res.status}`); return; }
      const data: TagJobStatus = await res.json();
      setStatus(data);
      setFetchError(null);
      if (!data.running) stopPolling();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setFetchError(`Could not reach backend: ${msg}`);
    }
  }, [stopPolling]);

  React.useEffect(() => {
    if (!visible) return;
    void fetchStatus();
  }, [visible, fetchStatus]);

  React.useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const triggerTag = async (force: boolean) => {
    setLoading(true);
    setFetchError(null);
    // Optimistically mark running so the UI responds immediately
    setStatus(prev => ({
      running: true, tagged: prev?.tagged ?? 0, total: prev?.total ?? 0,
      errors: prev?.errors ?? 0, started_at: new Date().toISOString(),
      finished_at: null, error: null,
      untagged_remaining: prev?.untagged_remaining ?? -1,
    }));
    try {
      const res = await fetch(
        `${API_BASE}/admin/tag-patterns-all?limit=20000${force ? '&force=true' : ''}`,
        { method: 'POST', headers: await adminHeaders() },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        setFetchError(`Trigger failed (${res.status}): ${text}`);
        setStatus(prev => prev ? { ...prev, running: false } : null);
        return;
      }
      // Start polling immediately — don't wait for fetchStatus round-trip
      startPolling(fetchStatus);
      await fetchStatus();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setFetchError(`Network error: ${msg}`);
      setStatus(prev => prev ? { ...prev, running: false } : null);
    } finally {
      setLoading(false);
    }
  };

  if (!visible) return null;

  const untagged = status?.untagged_remaining ?? -1;
  const isRunning = status?.running ?? false;
  const allDone = untagged === 0;
  const pct = status?.total ? Math.min(100, Math.round((status.tagged / status.total) * 100)) : 0;

  return (
    <section className="panel" style={{ gridColumn: '1 / -1' }}>
      <div className="section-header">
        <div>
          <div className="section-kicker">Global tagging</div>
          <h2>Pattern tag all questions</h2>
        </div>
        {isRunning && (
          <div className="live-pill">
            <Loader2 size={14} className="spin" />
            Running
          </div>
        )}
      </div>

      <p style={{ fontSize: 13, color: 'var(--text-muted, #64748b)', marginBottom: 16, lineHeight: 1.5 }}>
        Tags every question with <strong>pattern</strong> (statement-based, assertion-reason…),{' '}
        <strong>trap</strong> (absolute-wording, negation…), <strong>skill</strong> (recall, elimination…), and <strong>style</strong>.
        Required for Pattern Practice in the learner app to work correctly.
      </p>

      <div className="stats-grid" style={{ marginBottom: 16 }}>
        <div className="stat-card">
          <span>Untagged questions</span>
          <strong style={{ color: allDone ? '#16a34a' : untagged > 0 ? '#d97706' : undefined }}>
            {untagged < 0 ? '…' : untagged.toLocaleString()}
          </strong>
        </div>
        {status?.finished_at && (
          <div className="stat-card">
            <span>Last run tagged</span>
            <strong>{status.tagged.toLocaleString()}</strong>
          </div>
        )}
        {status?.finished_at && (
          <div className="stat-card">
            <span>Last run errors</span>
            <strong style={{ color: status.errors > 0 ? '#dc2626' : '#16a34a' }}>{status.errors}</strong>
          </div>
        )}
      </div>

      {isRunning && (
        <div style={{ marginBottom: 16 }}>
          <div className="progress-wrap">
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="progress-meta">
              <span>{status?.tagged ?? 0} / {status?.total ?? '?'} tagged so far…</span>
              <strong>{pct}%</strong>
            </div>
          </div>
        </div>
      )}

      {status?.error && (
        <div className="alert-card alert-danger compact-alert" style={{ marginBottom: 12 }}>
          <AlertCircle size={16} />
          <div><strong>Tagger error</strong><p>{status.error}</p></div>
        </div>
      )}

      {fetchError && (
        <div className="alert-card alert-danger compact-alert" style={{ marginBottom: 12 }}>
          <AlertCircle size={16} />
          <div><strong>Request failed</strong><p>{fetchError}</p></div>
        </div>
      )}

      {!isRunning && status?.finished_at && !status.error && (
        <div className="alert-card alert-success compact-alert" style={{ marginBottom: 12 }}>
          <CheckCircle2 size={16} />
          <div>
            <strong>Last run complete</strong>
            <p>Tagged {status.tagged.toLocaleString()} questions with {status.errors} error(s). Finished {new Date(status.finished_at).toLocaleString('en-IN')}.</p>
          </div>
        </div>
      )}

      <div className="action-row">
        <button
          className="primary-button"
          onClick={() => void triggerTag(false)}
          disabled={isRunning || loading || allDone}
        >
          {isRunning ? (
            <><Loader2 size={16} className="spin" />Tagging in background…</>
          ) : allDone ? (
            <><CheckCircle2 size={16} />All questions tagged</>
          ) : (
            <><Upload size={16} />Tag all untagged ({untagged < 0 ? '?' : untagged.toLocaleString()})</>
          )}
        </button>
        <button
          className="secondary-button"
          onClick={() => void triggerTag(true)}
          disabled={isRunning || loading}
          title="Re-tag already tagged questions too"
        >
          Force re-tag everything
        </button>
        <button
          className="ghost-button"
          onClick={() => void fetchStatus()}
          disabled={isRunning}
        >
          <RefreshCw size={15} />
          Refresh count
        </button>
      </div>
    </section>
  );
}
const DIFFICULTIES = ['Easy', 'Medium', 'Hard'];
const ANSWERS = ['A', 'B', 'C', 'D'];

const MODES: { id: Mode; label: string; helper: string }[] = [
  {
    id: 'auto',
    label: 'Universal extractor',
    helper: 'Default mode for most question papers. Optional answer key PDF supported.',
  },
  {
    id: 'answer_key',
    label: 'Paper + answer key',
    helper: 'Use when you have a separate answer key PDF and want explicit matching.',
  },
  {
    id: 'visual',
    label: 'Visual final key',
    helper: 'Best for boxed or marked official final-key PDFs.',
  },
  {
    id: 'cbt',
    label: 'CBT color key',
    helper: 'Best for Telegram/TCS-style CBT answer PDFs with green and red marking.',
  },
  {
    id: 'pattern',
    label: 'SSC content / pattern book',
    helper: 'Imports chapter-style SSC content PDFs into Pattern Practice instead of the learner question bank.',
  },
];

function formatTimestamp(value?: string) {
  if (!value) return 'Just now';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function mapQuestion(raw: any): AdminQuestion {
  return {
    id: String(raw.id || ''),
    question_text: String(raw.question_text || ''),
    question_number: raw.question_number ?? null,
    option_a: String(raw.option_a || ''),
    option_b: String(raw.option_b || ''),
    option_c: String(raw.option_c || ''),
    option_d: String(raw.option_d || ''),
    correct_answer: String(raw.correct_answer || 'A'),
    subject: String(raw.subject || 'General Knowledge'),
    topic: String(raw.topic || 'General'),
    subtopic: String(raw.subtopic || ''),
    difficulty: String(raw.difficulty || 'Medium'),
    concept: raw.concept || '',
    question_type: raw.question_type || 'mcq',
    passage: raw.passage || '',
    exam_name: String(raw.exam_name || ''),
    exam_year: Number(raw.exam_year || 0),
    is_active: raw.is_active,
    needs_review: raw.needs_review,
    has_image: raw.has_image,
    image_url: raw.image_url || null,
    public_visibility: raw.public_visibility || '',
  };
}

function JobBadge({ status }: { status?: string }) {
  const normalized = String(status || 'pending');
  const className =
    normalized === 'completed'
      ? 'badge badge-success'
      : normalized === 'failed'
      ? 'badge badge-danger'
      : normalized === 'processing'
      ? 'badge badge-blue'
      : 'badge badge-warn';

  return <span className={className}>{normalized}</span>;
}

function PublishBadge({
  publishable,
  blocked,
  hiddenCount,
}: {
  publishable: boolean;
  blocked: boolean;
  hiddenCount: number;
}) {
  if (blocked) return <span className="badge badge-danger">Blocked</span>;
  if (publishable && hiddenCount > 0) {
    return <span className="badge badge-warn">Publishable with hidden rows</span>;
  }
  if (publishable) return <span className="badge badge-success">Publishable</span>;
  return <span className="badge badge-blue">Reviewing</span>;
}

function QuestionEditorModal({ question, onClose, onSaved }: QuestionEditorModalProps) {
  const [questionText, setQuestionText] = useState(question.question_text);
  const [passage, setPassage] = useState(question.passage || '');
  const [optionA, setOptionA] = useState(question.option_a);
  const [optionB, setOptionB] = useState(question.option_b);
  const [optionC, setOptionC] = useState(question.option_c);
  const [optionD, setOptionD] = useState(question.option_d);
  const [correctAnswer, setCorrectAnswer] = useState(question.correct_answer || 'A');
  const [subject, setSubject] = useState(question.subject || 'General Knowledge');
  const [topic, setTopic] = useState(question.topic || 'General');
  const [subtopic, setSubtopic] = useState(question.subtopic || '');
  const [difficulty, setDifficulty] = useState(question.difficulty || 'Medium');
  const [isActive, setIsActive] = useState(question.is_active !== false);
  const [needsReview, setNeedsReview] = useState(Boolean(question.needs_review));
  const [hasImage, setHasImage] = useState(Boolean(question.has_image || question.image_url));
  const [imageUrl, setImageUrl] = useState<string | null>(question.image_url || null);
  const [imageVersion, setImageVersion] = useState(() => Date.now());
  const [cropMode, setCropMode] = useState(false);
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop | null>(null);
  const [savingImage, setSavingImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const hiddenImageInputRef = useRef<HTMLInputElement | null>(null);
  const cropImageRef = useRef<HTMLImageElement | null>(null);

  const uploadImageDataUrl = async (base64Image: string) => {
    const res = await fetch(`${API_BASE}/admin/questions/${question.id}/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...await adminHeaders() },
      body: JSON.stringify({ base64_image: base64Image }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Image upload failed (${res.status})`);
    }
    const data = await res.json();
    setImageUrl(data.image_url || null);
    setImageVersion(Date.now());
    setHasImage(true);
    setCropMode(false);
  };

  const handleImageFileSelected = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      setSavingImage(true);
      setError('');
      const base64Image = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Could not read image file.'));
        reader.readAsDataURL(file);
      });
      await uploadImageDataUrl(base64Image);
    } catch (uploadError: any) {
      setError(uploadError?.message || 'Image upload failed.');
    } finally {
      setSavingImage(false);
    }
  };

  const handleDeleteImage = () => {
    setHasImage(false);
    setImageUrl(null);
    setCropMode(false);
    setCompletedCrop(null);
  };

  const handleApplyCrop = async () => {
    if (!completedCrop || !cropImageRef.current || !imageUrl) return;
    try {
      setSavingImage(true);
      setError('');

      const img = cropImageRef.current;
      const scaleX = img.naturalWidth / img.width;
      const scaleY = img.naturalHeight / img.height;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Crop canvas is unavailable.');

      canvas.width = Math.max(1, Math.round(completedCrop.width * scaleX));
      canvas.height = Math.max(1, Math.round(completedCrop.height * scaleY));
      ctx.drawImage(
        img,
        completedCrop.x * scaleX,
        completedCrop.y * scaleY,
        completedCrop.width * scaleX,
        completedCrop.height * scaleY,
        0,
        0,
        canvas.width,
        canvas.height
      );
      await uploadImageDataUrl(canvas.toDataURL('image/png'));
    } catch (cropError: any) {
      setError(cropError?.message || 'Crop upload failed.');
    } finally {
      setSavingImage(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/admin/questions/${question.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...await adminHeaders() },
        body: JSON.stringify({
          question_text: questionText.trim(),
          passage: passage.trim(),
          option_a: optionA.trim(),
          option_b: optionB.trim(),
          option_c: optionC.trim(),
          option_d: optionD.trim(),
          correct_answer: correctAnswer,
          subject: subject.trim(),
          topic: topic.trim(),
          subtopic: subtopic.trim(),
          difficulty,
          is_active: isActive,
          needs_review: needsReview,
          has_image: hasImage,
          image_url: imageUrl,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Save failed (${res.status})`);
      }
      onSaved({
        ...question,
        question_text: questionText.trim(),
        passage: passage.trim(),
        option_a: optionA.trim(),
        option_b: optionB.trim(),
        option_c: optionC.trim(),
        option_d: optionD.trim(),
        correct_answer: correctAnswer,
        subject: subject.trim(),
        topic: topic.trim(),
        subtopic: subtopic.trim(),
        difficulty,
        is_active: isActive,
        needs_review: needsReview,
        has_image: hasImage,
        image_url: imageUrl,
      });
    } catch (saveError: any) {
      setError(saveError?.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-panel">
        <div className="section-header">
          <div>
            <div className="section-kicker">Question editor</div>
            <h2>Q{question.question_number ?? '?'}</h2>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="editor-meta">
          <span className="badge badge-blue">{question.exam_name}</span>
          <span className="badge badge-warn">{question.exam_year}</span>
          {question.public_visibility ? <span className="badge badge-success">{question.public_visibility}</span> : null}
          {hasImage ? <span className="badge badge-blue">Image question</span> : null}
        </div>

        <div className="editor-grid">
          <label className="field field-span-full">
            <span>Passage</span>
            <textarea rows={3} value={passage} onChange={(event) => setPassage(event.target.value)} />
          </label>
          <label className="field field-span-full">
            <span>Question text</span>
            <textarea rows={5} value={questionText} onChange={(event) => setQuestionText(event.target.value)} />
          </label>

          <div className="field field-span-full">
            <span style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Question image</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              <label className="toggle-pill">
                <input
                  type="checkbox"
                  checked={hasImage}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    setHasImage(enabled);
                    if (!enabled) {
                      setImageUrl(null);
                      setCropMode(false);
                    }
                  }}
                />
                Mark as image-based
              </label>
              <button
                type="button"
                className="ghost-button"
                onClick={() => hiddenImageInputRef.current?.click()}
                disabled={savingImage}
              >
                {savingImage ? <Loader2 size={15} className="spin" /> : <Upload size={15} />}
                {imageUrl ? 'Replace image' : 'Upload image'}
              </button>
              {hasImage && imageUrl ? (
                <>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => setCropMode((prev) => !prev)}
                    disabled={savingImage}
                  >
                    <CropIcon size={15} />
                    {cropMode ? 'Cancel crop' : 'Crop image'}
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={handleDeleteImage}
                    disabled={savingImage}
                  >
                    <Trash size={15} />
                    Remove image
                  </button>
                </>
              ) : null}
            </div>
            <input
              ref={hiddenImageInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleImageFileSelected}
            />
            {hasImage && imageUrl ? (
              <div style={{ border: '1px solid var(--border)', borderRadius: 14, padding: 12, background: 'var(--panel-muted, rgba(148,163,184,0.06))' }}>
                {cropMode ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <ReactCrop
                      crop={crop}
                      onChange={(nextCrop) => setCrop(nextCrop)}
                      onComplete={(nextCrop) => setCompletedCrop(nextCrop)}
                    >
                      <img
                        ref={cropImageRef}
                        src={`${imageUrl}?v=${imageVersion}`}
                        alt="Crop question"
                        crossOrigin="anonymous"
                        style={{ maxWidth: '100%', maxHeight: 320, display: 'block', margin: '0 auto' }}
                      />
                    </ReactCrop>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        className="primary-button"
                        onClick={() => void handleApplyCrop()}
                        disabled={savingImage || !completedCrop?.width}
                      >
                        {savingImage ? <Loader2 size={15} className="spin" /> : <CropIcon size={15} />}
                        Apply crop
                      </button>
                    </div>
                  </div>
                ) : (
                  <img
                    src={`${imageUrl}?v=${imageVersion}`}
                    alt="Question preview"
                    style={{ maxWidth: '100%', maxHeight: 260, objectFit: 'contain', display: 'block', margin: '0 auto' }}
                  />
                )}
              </div>
            ) : hasImage ? (
              <div className="compact-helper">
                This question is marked as image-based, but no image is attached yet.
              </div>
            ) : null}
          </div>

          <label className="field">
            <span>Option A</span>
            <textarea rows={2} value={optionA} onChange={(event) => setOptionA(event.target.value)} />
          </label>
          <label className="field">
            <span>Option B</span>
            <textarea rows={2} value={optionB} onChange={(event) => setOptionB(event.target.value)} />
          </label>
          <label className="field">
            <span>Option C</span>
            <textarea rows={2} value={optionC} onChange={(event) => setOptionC(event.target.value)} />
          </label>
          <label className="field">
            <span>Option D</span>
            <textarea rows={2} value={optionD} onChange={(event) => setOptionD(event.target.value)} />
          </label>
          <label className="field">
            <span>Correct answer</span>
            <select value={correctAnswer} onChange={(event) => setCorrectAnswer(event.target.value)}>
              {ANSWERS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Difficulty</span>
            <select value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>
              {DIFFICULTIES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Subject</span>
            <input value={subject} onChange={(event) => setSubject(event.target.value)} />
          </label>
          <label className="field">
            <span>Topic</span>
            <input value={topic} onChange={(event) => setTopic(event.target.value)} />
          </label>
          <label className="field field-span-full">
            <span>Subtopic</span>
            <input value={subtopic} onChange={(event) => setSubtopic(event.target.value)} />
          </label>
        </div>

        <div className="toggle-row">
          <label className="toggle-pill">
            <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
            Keep active
          </label>
          <label className="toggle-pill">
            <input type="checkbox" checked={needsReview} onChange={(event) => setNeedsReview(event.target.checked)} />
            Needs review
          </label>
        </div>

        {error ? (
          <div className="alert-card alert-danger compact-alert">
            <AlertCircle size={16} />
            <div>
              <strong>Could not save</strong>
              <p>{error}</p>
            </div>
          </div>
        ) : null}

        <div className="action-row">
          <button className="primary-button" onClick={() => void handleSave()} disabled={saving}>
            {saving ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
            Save changes
          </button>
          <button className="ghost-button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [answerKeyFile, setAnswerKeyFile] = useState<File | null>(null);
  const [examName, setExamName] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [series, setSeries] = useState('');
  const [shiftLabel, setShiftLabel] = useState('');
  const [expectedCount, setExpectedCount] = useState('');
  const [mode, setMode] = useState<Mode>('auto');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('Waiting for the next upload.');
  const [error, setError] = useState('');
  const [debug, setDebug] = useState('');
  const [recentJobs, setRecentJobs] = useState<Job[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [conflict, setConflict] = useState<UploadConflict | null>(null);
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget | null>(null);
  const [reviewWorkspace, setReviewWorkspace] = useState<ReviewWorkspace>({
    paper: null,
    repairItems: [],
    questions: [],
  });
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [reviewWarning, setReviewWarning] = useState('');
  const [reviewActionMessage, setReviewActionMessage] = useState('');
  const [reviewActionTone, setReviewActionTone] = useState<'success' | 'danger'>('success');
  const [questionSearch, setQuestionSearch] = useState('');
  const [editorQuestion, setEditorQuestion] = useState<AdminQuestion | null>(null);
  const [creatingQuestionNumber, setCreatingQuestionNumber] = useState<number | null>(null);
  const [renameExamDraft, setRenameExamDraft] = useState('');
  const [publishingPaper, setPublishingPaper] = useState(false);
  const [renamingExam, setRenamingExam] = useState(false);
  const [generatingExplanations, setGeneratingExplanations] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const answerKeyInputRef = useRef<HTMLInputElement | null>(null);
  const pollRef = useRef<number | null>(null);
  const lastProgressRef = useRef(-1);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setAuthError('');
      setUser(nextUser);
      if (!nextUser) {
        setAdminAuthToken(null);
        setAuthLoading(false);
        return;
      }
      try {
        const token = await nextUser.getIdToken();
        setAdminAuthToken(token);
      } catch (tokenError: any) {
        setAdminAuthToken(null);
        setAuthError(tokenError?.message || 'Could not prepare the admin session.');
      } finally {
        setAuthLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  const canSubmit =
    !!file &&
    !!examName.trim() &&
    !!year.trim() &&
    phase !== 'uploading' &&
    phase !== 'processing' &&
    (mode !== 'answer_key' || !!answerKeyFile);

  const activeJob = useMemo(
    () => recentJobs.find((job) => job.id === currentJobId) || null,
    [currentJobId, recentJobs]
  );

  const filteredQuestions = useMemo(() => {
    const query = questionSearch.trim().toLowerCase();
    if (!query) return reviewWorkspace.questions;
    return reviewWorkspace.questions.filter((question) =>
      [
        question.question_number?.toString(),
        question.question_text,
        question.subject,
        question.topic,
        question.subtopic,
      ]
        .join(' ')
        .toLowerCase()
        .includes(query)
    );
  }, [questionSearch, reviewWorkspace.questions]);

  const missingItems = useMemo(
    () =>
      reviewWorkspace.repairItems.filter(
        (item) =>
          !item.question_id &&
          item.issue_type === 'numbering/data repair' &&
          typeof item.question_number === 'number'
      ),
    [reviewWorkspace.repairItems]
  );

  const clearPolling = useCallback(() => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const loadRecentJobs = useCallback(async () => {
    setJobsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/jobs?limit=8`, {
        headers: await adminHeaders(),
      });
      if (!res.ok) throw new Error(`Failed to load jobs (${res.status})`);
      const data = await res.json();
      setRecentJobs(Array.isArray(data.jobs) ? data.jobs : []);
    } catch (jobError: any) {
      setDebug(jobError?.message || 'Could not load recent jobs.');
    } finally {
      setJobsLoading(false);
    }
  }, []);

  const loadReviewWorkspace = useCallback(async (target: ReviewTarget) => {
    setReviewLoading(true);
    setReviewError('');
    setReviewWarning('');
    setReviewActionMessage('');
    try {
      const params = new URLSearchParams({
        exam_name: target.examName,
        exam_year: String(target.examYear),
      });
      const hdrs = await adminHeaders();
      const [repairRes, questionRes] = await Promise.all([
        fetch(`${API_BASE}/admin/repair-queue?${params}`, { headers: hdrs }).catch(() => null),
        fetch(`${API_BASE}/admin/questions?${params}&page_size=500&latest_only=true`, { headers: hdrs }),
      ]);
      if (!questionRes.ok) throw new Error(`Question list failed (${questionRes.status})`);

      const repairData = repairRes?.ok ? await repairRes.json() : null;
      const questionData = await questionRes.json();
      const paper = Array.isArray(repairData?.papers)
        ? (repairData.papers.find(
            (item: RepairQueuePaper) =>
              item.exam_name === target.examName && item.exam_year === target.examYear
          ) || repairData.papers[0] || null)
        : null;
      const repairItems = Array.isArray(repairData?.items) ? repairData.items : [];
      const questions = Array.isArray(questionData.questions)
        ? questionData.questions.map(mapQuestion)
        : [];
      const resolvedTarget = {
        examName:
          paper?.exam_name ||
          questions[0]?.examName ||
          target.examName,
        examYear:
          paper?.exam_year ||
          questions[0]?.examYear ||
          target.examYear,
      };

      setReviewWorkspace({ paper, repairItems, questions });
      setReviewTarget(resolvedTarget);
      setRenameExamDraft(resolvedTarget.examName);
      if (!repairRes?.ok) {
        setReviewWarning('Repair analysis unavailable — questions loaded, you can still publish below.');
      }
    } catch (workspaceError: any) {
      setReviewError(workspaceError?.message || 'Could not load publish status.');
    } finally {
      setReviewLoading(false);
    }
  }, []);

  const openReviewFor = useCallback(
    (examNameValue?: string, examYearValue?: number) => {
      if (!examNameValue || !examYearValue) return;
      void loadReviewWorkspace({
        examName: examNameValue,
        examYear: examYearValue,
      });
    },
    [loadReviewWorkspace]
  );

  const inferVisibleProgress = useCallback((job: Job) => {
    const raw = Number(job.progress || 0);
    const text = `${job.status || ''} ${job.error_log || ''}`;
    const match = text.match(/page\s+(\d+)\s+of\s+(\d+)/i);
    const currentPage = match ? parseInt(match[1], 10) : 0;
    const totalPages = match ? Math.max(parseInt(match[2], 10), 1) : 0;

    if (mode === 'cbt' && totalPages > 0) {
      if (/Locating target CBT pages/i.test(text)) return Math.max(raw, 5 + Math.floor((25 * currentPage) / totalPages));
      if (/Re-extracting targeted CBT page/i.test(text)) return Math.max(raw, 30 + Math.floor((45 * currentPage) / totalPages));
      if (/Deep recovery/i.test(text)) return Math.max(raw, 55 + Math.floor((30 * currentPage) / totalPages));
    }
    if ((job.status || '') === 'completed') return 100;
    return Math.min(100, raw);
  }, [mode]);

  const pollJob = useCallback(
    (jobId: string) => {
      clearPolling();
      setCurrentJobId(jobId);
      setPhase('processing');
      setError('');
      setStatusMessage('Upload queued. Waiting for the extractor to start...');
      lastProgressRef.current = -1;

      pollRef.current = window.setInterval(async () => {
        try {
          const res = await fetch(`${API_BASE}/admin/jobs/${jobId}`, {
            headers: await adminHeaders(),
          });
          if (!res.ok) {
            if (res.status === 404) {
              clearPolling();
              localStorage.removeItem(ACTIVE_JOB_KEY);
              setPhase('error');
              setError('The upload job could not be found anymore.');
            }
            return;
          }
          const job = (await res.json()) as Job;
          setRecentJobs((prev) => {
            const others = prev.filter((entry) => entry.id !== job.id);
            return [job, ...others].slice(0, 8);
          });
          if (job.paper_id && job.exam_name && job.exam_year) {
            setReviewTarget({ examName: job.exam_name, examYear: job.exam_year });
          }
          const visibleProgress = inferVisibleProgress(job);
          setProgress(visibleProgress);
          if (visibleProgress !== lastProgressRef.current) {
            lastProgressRef.current = visibleProgress;
          }

          if (job.status === 'completed') {
            clearPolling();
            localStorage.removeItem(ACTIVE_JOB_KEY);
            setPhase('done');
            setProgress(100);
            setStatusMessage(
              job.paper_id
                ? 'Upload finished. Open the review workspace below to publish-check the paper.'
                : 'SSC content import finished. Open Pattern Practice in the learner app to use it.'
            );
            setDebug(job.error_log || 'Completed successfully.');
            if (job.paper_id && job.exam_name && job.exam_year) {
              void loadReviewWorkspace({ examName: job.exam_name, examYear: job.exam_year });
            }
            void loadRecentJobs();
            return;
          }

          if (job.status === 'failed') {
            clearPolling();
            localStorage.removeItem(ACTIVE_JOB_KEY);
            setPhase('error');
            setError(job.error_log || 'The extractor reported a failure.');
            setDebug(job.error_log || '');
            void loadRecentJobs();
            return;
          }

          if (job.status === 'processing') {
            setStatusMessage(job.error_log || 'Processing pages and building questions...');
            setDebug(job.error_log || '');
          } else {
            setStatusMessage(job.error_log || 'Queued and waiting for an executor slot...');
          }
        } catch {
          // transient network hiccup; keep polling
        }
      }, 1000);
    },
    [clearPolling, inferVisibleProgress, loadRecentJobs, loadReviewWorkspace]
  );

  useEffect(() => {
    if (!user || !hasAdminAuth()) return;
    void loadRecentJobs();
    const savedJob = localStorage.getItem(ACTIVE_JOB_KEY);
    if (savedJob) {
      try {
        const parsed = JSON.parse(savedJob) as { jobId?: string; savedMode?: Mode };
        if (parsed.savedMode) setMode(parsed.savedMode);
        if (parsed.jobId) pollJob(parsed.jobId);
      } catch {
        localStorage.removeItem(ACTIVE_JOB_KEY);
      }
    }

    return () => {
      clearPolling();
    };
  }, [clearPolling, loadRecentJobs, pollJob, user]);

  const handleSubmit = useCallback(
    async (options?: { forceReplace?: boolean; replaceExisting?: boolean }) => {
      if (!file || !examName.trim() || !year.trim()) return;

      setConflict(null);
      setError('');
      setDebug('');
      setPhase('uploading');
      setProgress(0);
      setStatusMessage('Uploading PDF to the admin extractor...');

      const targetExamName =
        options?.replaceExisting && conflict?.existingExamName
          ? conflict.existingExamName
          : examName.trim();
      const targetExamYear =
        Number(
          options?.replaceExisting && conflict?.existingExamYear
            ? conflict.existingExamYear
            : year.trim()
        ) || Number(year.trim());

      const form = new FormData();
      form.append('file', file);
      form.append('exam_name', targetExamName);
      form.append('exam_year', String(targetExamYear));
      form.append('series', series.trim());
      form.append('use_vision', mode === 'visual' ? 'true' : 'false');
      form.append('is_cbt', mode === 'cbt' ? 'true' : 'false');
      if (mode !== 'pattern') {
        form.append('expected_count', expectedCount.trim() || '0');
      }
      if (mode !== 'pattern' && shiftLabel.trim()) form.append('shift_label_override', shiftLabel.trim());
      if ((mode === 'auto' || mode === 'answer_key') && answerKeyFile) {
        form.append('answer_key_file', answerKeyFile);
      }
      if (options?.forceReplace) form.append('force_replace', 'true');
      if (options?.replaceExisting) form.append('clear_cache', 'true');

      try {
        const endpoint = mode === 'pattern' ? `${API_BASE}/admin/upload-pattern-book` : `${API_BASE}/admin/upload-pdf`;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: await adminHeaders(),
          body: form,
        });
        const data = await res.json();

        if (!res.ok) {
          if (res.status === 409) {
            setPhase('idle');
            setConflict({
              type: data.error === 'duplicate_file' ? 'file' : 'exam',
              message: data.message || 'The backend found a conflict.',
              existingExamName: data.existing_exam_name,
              existingExamYear: data.existing_exam_year?.toString(),
            });
            return;
          }
          throw new Error(data.detail || data.message || `Upload failed (${res.status})`);
        }

        if (mode !== 'pattern') {
          setReviewTarget({ examName: targetExamName, examYear: targetExamYear });
        } else {
          setReviewTarget(null);
        }

        if (data.job_id) {
          localStorage.setItem(
            ACTIVE_JOB_KEY,
            JSON.stringify({ jobId: data.job_id, savedMode: mode })
          );
          setProgress(data.missing_reupload_mode ? 1 : 5);
          setStatusMessage(data.message || 'Upload queued.');
          setDebug(`Route: ${data.route_format || 'unknown'}`);
          pollJob(data.job_id);
          return;
        }

        setPhase('done');
        setProgress(100);
        setStatusMessage(mode === 'pattern' ? 'SSC content import finished.' : 'Upload finished.');
        if (mode !== 'pattern') {
          void loadReviewWorkspace({ examName: targetExamName, examYear: targetExamYear });
        }
        void loadRecentJobs();
      } catch (submitError: any) {
        localStorage.removeItem(ACTIVE_JOB_KEY);
        setPhase('error');
        setError(submitError?.message || 'Upload failed.');
      }
    },
    [
      answerKeyFile,
      conflict?.existingExamName,
      conflict?.existingExamYear,
      examName,
      expectedCount,
      file,
      loadRecentJobs,
      loadReviewWorkspace,
      mode,
      pollJob,
      series,
      shiftLabel,
      year,
    ]
  );

  const resetForm = useCallback(() => {
    clearPolling();
    localStorage.removeItem(ACTIVE_JOB_KEY);
    setFile(null);
    setAnswerKeyFile(null);
    setExamName('');
    setYear(String(new Date().getFullYear()));
    setSeries('');
    setShiftLabel('');
    setExpectedCount('');
    setPhase('idle');
    setProgress(0);
    setStatusMessage('Waiting for the next upload.');
    setError('');
    setDebug('');
    setCurrentJobId(null);
    setConflict(null);
  }, [clearPolling]);

  const createPlaceholderForMissing = useCallback(
    async (item: RepairQueueItem) => {
      if (typeof item.question_number !== 'number') return;
      setCreatingQuestionNumber(item.question_number);
      setReviewError('');
      try {
        const res = await fetch(`${API_BASE}/admin/add-blank-question`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...await adminHeaders() },
          body: JSON.stringify({
            exam_name: item.exam_name,
            exam_year: item.exam_year,
            question_number: item.question_number,
            question_text: item.question_text || `[Placeholder for Question #${item.question_number}]`,
            option_a: item.option_a || 'Option A',
            option_b: item.option_b || 'Option B',
            option_c: item.option_c || 'Option C',
            option_d: item.option_d || 'Option D',
            correct_answer: item.correct_answer || 'A',
            subject: item.subject || 'General Knowledge',
            topic: item.topic || 'General',
            subtopic: item.subtopic || '',
            difficulty: item.difficulty || 'Medium',
            needs_review: true,
            passage: item.passage || '',
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.detail || data.message || `Create failed (${res.status})`);
        }
        const rawQuestion = Array.isArray(data.data) ? data.data[0] : null;
        await loadReviewWorkspace({ examName: item.exam_name, examYear: item.exam_year });
        if (rawQuestion) {
          setEditorQuestion(mapQuestion(rawQuestion));
        }
      } catch (placeholderError: any) {
        setReviewError(placeholderError?.message || 'Could not create placeholder question.');
      } finally {
        setCreatingQuestionNumber(null);
      }
    },
    [loadReviewWorkspace]
  );

  const openQuestionEditor = useCallback(async (questionId: string) => {
    setReviewError('');
    try {
      const res = await fetch(`${API_BASE}/admin/questions/${questionId}`, {
        headers: await adminHeaders(),
      });
      if (!res.ok) throw new Error(`Question fetch failed (${res.status})`);
      const data = await res.json();
      setEditorQuestion(mapQuestion(data));
    } catch (questionError: any) {
      setReviewError(questionError?.message || 'Could not open question editor.');
    }
  }, []);

  const handleQuestionSaved = useCallback((updatedQuestion: AdminQuestion) => {
    setEditorQuestion(null);
    setReviewActionMessage('Question saved. Refreshing publish status...');
    setReviewActionTone('success');
    setReviewWorkspace((prev) => ({
      ...prev,
      questions: prev.questions.map((question) =>
        question.id === updatedQuestion.id ? updatedQuestion : question
      ),
    }));
    if (reviewTarget) {
      void loadReviewWorkspace(reviewTarget);
    }
  }, [loadReviewWorkspace, reviewTarget]);

  const handleRenameExam = useCallback(async () => {
    if (!reviewTarget) return;
    const trimmedName = renameExamDraft.trim();
    if (!trimmedName || trimmedName === reviewTarget.examName) return;

    setRenamingExam(true);
    setReviewError('');
    setReviewActionMessage('');
    try {
      const params = new URLSearchParams({
        old_name: reviewTarget.examName,
        new_name: trimmedName,
        exam_year: String(reviewTarget.examYear),
      });
      const res = await fetch(`${API_BASE}/admin/rename-exam?${params.toString()}`, {
        method: 'PATCH',
        headers: await adminHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.message || `Rename failed (${res.status})`);
      }

      const nextTarget = { examName: trimmedName, examYear: reviewTarget.examYear };
      setReviewActionTone('success');
      setReviewActionMessage(`Renamed paper to ${trimmedName}.`);
      await loadReviewWorkspace(nextTarget);
      void loadRecentJobs();
    } catch (renameError: any) {
      setReviewActionTone('danger');
      setReviewActionMessage(renameError?.message || 'Could not rename this exam.');
    } finally {
      setRenamingExam(false);
    }
  }, [loadRecentJobs, loadReviewWorkspace, renameExamDraft, reviewTarget]);

  const handlePublishPaper = useCallback(async () => {
    if (!reviewTarget) return;

    setPublishingPaper(true);
    setReviewError('');
    setReviewActionMessage('');
    try {
      const params = new URLSearchParams({
        exam_name: reviewTarget.examName,
        exam_year: String(reviewTarget.examYear),
      });
      const res = await fetch(`${API_BASE}/admin/publish-paper?${params.toString()}`, {
        method: 'POST',
        headers: await adminHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.message || `Publish failed (${res.status})`);
      }
      setReviewActionTone('success');
      setReviewActionMessage(data.message || 'Paper published to the learner app.');
      await loadReviewWorkspace(reviewTarget);
    } catch (publishError: any) {
      setReviewActionTone('danger');
      setReviewActionMessage(
        publishError?.message || 'Could not publish this paper to the learner app.'
      );
    } finally {
      setPublishingPaper(false);
    }
  }, [loadReviewWorkspace, reviewTarget]);

  const handleGenerateExplanations = useCallback(async () => {
    if (!reviewTarget) return;

    setGeneratingExplanations(true);
    setReviewError('');
    setReviewActionMessage('');
    try {
      const params = new URLSearchParams({
        exam_name: reviewTarget.examName,
        exam_year: String(reviewTarget.examYear),
      });
      const res = await fetch(`${API_BASE}/admin/generate-explanations?${params.toString()}`, {
        method: 'POST',
        headers: await adminHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.message || `Explanation generation failed (${res.status})`);
      }
      setReviewActionTone('success');
      setReviewActionMessage(
        data.message ||
          `Generated ${data.generated || 0} explanation(s) for verified questions.`
      );
      await loadReviewWorkspace(reviewTarget);
    } catch (generationError: any) {
      setReviewActionTone('danger');
      setReviewActionMessage(
        generationError?.message || 'Could not generate explanations for this paper.'
      );
    } finally {
      setGeneratingExplanations(false);
    }
  }, [loadReviewWorkspace, reviewTarget]);

  const handleAdminSignIn = useCallback(async () => {
    setAuthError('');
    setAuthLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const token = await result.user.getIdToken();
      setAdminAuthToken(token);
      setUser(result.user);
    } catch (signInError: any) {
      setAuthError(signInError?.message || 'Google sign-in failed.');
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const handleAdminSignOut = useCallback(async () => {
    setAuthError('');
    try {
      await signOut(auth);
      setAdminAuthToken(null);
      setUser(null);
      clearPolling();
      localStorage.removeItem(ACTIVE_JOB_KEY);
    } catch (signOutError: any) {
      setAuthError(signOutError?.message || 'Could not sign out.');
    }
  }, [clearPolling]);

  if (authLoading) {
    return (
      <div className="admin-shell">
        <div className="hero-card auth-card">
          <div>
            <div className="hero-kicker">Admin Access</div>
            <h1>Checking your admin session</h1>
            <p className="hero-copy">
              We are verifying your Google sign-in before exposing upload and publish tools.
            </p>
          </div>
          <div className="auth-status-pill">
            <Loader2 size={16} className="spin" />
            Preparing secure admin access
          </div>
        </div>
      </div>
    );
  }

  if (!user || !hasAdminAuth()) {
    return (
      <div className="admin-shell">
        <div className="hero-card auth-card">
          <div>
            <div className="hero-kicker">Private Admin Workspace</div>
            <h1>Sign in to continue</h1>
            <p className="hero-copy">
              The admin console now uses Firebase-authenticated access instead of a browser-exposed secret key.
            </p>
            {authError ? (
              <div className="alert-card alert-danger compact-alert" style={{ marginTop: 16 }}>
                <AlertCircle size={16} />
                <div>
                  <strong>Could not start admin session</strong>
                  <p>{authError}</p>
                </div>
              </div>
            ) : null}
          </div>
          <div className="auth-actions">
            <button className="primary-button" onClick={() => void handleAdminSignIn()}>
              <Shield size={16} />
              Sign in with Google
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <div className="hero-card">
        <div>
          <div className="hero-kicker">Private admin workspace</div>
          <h1>Pariksha paper upload console</h1>
          <p className="hero-copy">
            Upload the paper, then review whether it is actually safe to publish into the learner app.
            Missing numbers, hidden rows, and editable questions all live in one place here.
          </p>
        </div>
        <div className="hero-meta">
          <div className="meta-chip">
            <Shield size={15} />
            Admin API: {API_BASE}
          </div>
          <div className="meta-chip meta-chip-ok">
            <CheckCircle2 size={15} />
            Signed in as {user.email || 'admin user'}
          </div>
          <button className="ghost-button hero-signout" onClick={() => void handleAdminSignOut()}>
            Sign out
          </button>
          {authError ? (
            <div className="meta-chip meta-chip-danger">
              <AlertCircle size={15} />
              {authError}
            </div>
          ) : null}
        </div>
      </div>

      <div className="workspace-grid">
        <PatternTagSection visible={true} />

        <section className="panel">
          <div className="section-header">
            <div>
              <div className="section-kicker">Upload</div>
              <h2>Queue a new paper</h2>
            </div>
            {(phase === 'processing' || phase === 'uploading') && (
              <div className="live-pill">
                <Loader2 size={14} className="spin" />
                Live
              </div>
            )}
          </div>

          <div className="mode-grid">
            {MODES.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`mode-card ${mode === entry.id ? 'mode-card-active' : ''}`}
                onClick={() => setMode(entry.id)}
                disabled={phase === 'uploading' || phase === 'processing'}
              >
                <strong>{entry.label}</strong>
                <span>{entry.helper}</span>
              </button>
            ))}
          </div>

          <div className="field-grid">
            <label className="field">
              <span>Question paper PDF</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                onChange={(event) => setFile(event.target.files?.[0] || null)}
              />
                {file && <small>{file.name}</small>}
              </label>

            {(mode === 'auto' || mode === 'answer_key') && (
              <label className="field">
                <span>Answer key PDF {mode === 'auto' ? '(optional)' : ''}</span>
                <input
                  ref={answerKeyInputRef}
                  type="file"
                  accept=".pdf"
                  onChange={(event) => setAnswerKeyFile(event.target.files?.[0] || null)}
                />
                {answerKeyFile && <small>{answerKeyFile.name}</small>}
              </label>
            )}

            <label className="field">
              <span>{mode === 'pattern' ? 'Book title / exam target' : 'Exam name'}</span>
              <input
                type="text"
                value={examName}
                onChange={(event) => setExamName(event.target.value)}
                placeholder={mode === 'pattern' ? 'SSC CGL' : 'AP HIGH COURT EXAM SHIFT 3'}
              />
            </label>

            <label className="field">
              <span>Year</span>
              <input
                type="number"
                value={year}
                onChange={(event) => setYear(event.target.value)}
                placeholder="2025"
              />
            </label>

            <label className="field">
              <span>{mode === 'pattern' ? 'Chapter / pattern label' : 'Series'}</span>
              <input
                type="text"
                value={series}
                onChange={(event) => setSeries(event.target.value)}
                placeholder={mode === 'pattern' ? 'Percentages / Ratio & Proportion' : 'Set A / Paper 1'}
              />
            </label>

            {mode !== 'pattern' && (
              <label className="field">
                <span>Shift label</span>
                <input
                  type="text"
                  value={shiftLabel}
                  onChange={(event) => setShiftLabel(event.target.value)}
                  placeholder="Shift 3"
                />
              </label>
            )}

            {mode !== 'pattern' && (
              <label className="field">
                <span>Expected question count</span>
                <input
                  type="number"
                  value={expectedCount}
                  onChange={(event) => setExpectedCount(event.target.value)}
                  placeholder="0 for auto-detect"
                />
              </label>
            )}
          </div>

          {conflict ? (
            <div className="alert-card alert-warn">
              <AlertCircle size={16} />
              <div>
                <strong>{conflict.type === 'file' ? 'Duplicate PDF found' : 'Exam already exists'}</strong>
                <p>{conflict.message}</p>
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="alert-card alert-danger">
              <AlertCircle size={16} />
              <div>
                <strong>Upload failed</strong>
                <p>{error}</p>
              </div>
            </div>
          ) : null}

          <div className="action-row">
              <button className="primary-button" onClick={() => void handleSubmit()} disabled={!canSubmit}>
              {phase === 'uploading' || phase === 'processing' ? (
                <>
                  <Loader2 size={16} className="spin" />
                  Working...
                </>
              ) : (
                <>
                  <Upload size={16} />
                  {mode === 'pattern' ? 'Upload content PDF' : 'Upload paper'}
                </>
              )}
            </button>

            {conflict ? (
              <>
                <button
                  className="secondary-button"
                  onClick={() => void handleSubmit({ forceReplace: true })}
                >
                  {mode === 'pattern' ? 'Retry import' : 'Force replace'}
                </button>
                {conflict.existingExamName && mode !== 'pattern' ? (
                  <button
                    className="secondary-button"
                    onClick={() => void handleSubmit({ replaceExisting: true })}
                  >
                    Replace existing exam
                  </button>
                ) : null}
              </>
            ) : null}

            <button className="ghost-button" onClick={resetForm}>
              Reset
            </button>
            <button
              className="ghost-button"
              onClick={() => openReviewFor(examName.trim(), Number(year))}
              disabled={mode === 'pattern' || !examName.trim() || !year.trim()}
            >
              Load review workspace
            </button>
          </div>
        </section>

        <aside className="sidebar-stack">
          <section className="panel">
            <div className="section-header">
              <div>
                <div className="section-kicker">Status</div>
                <h2>Current upload</h2>
              </div>
              {activeJob ? <JobBadge status={activeJob.status} /> : null}
            </div>

            <div className="progress-wrap">
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <div className="progress-meta">
                <span>{statusMessage}</span>
                <strong>{progress}%</strong>
              </div>
            </div>

            <div className="status-list">
              <div className="status-item">
                <Clock3 size={15} />
                <span>{phase === 'done' ? 'Last upload completed' : phase === 'error' ? 'Needs attention' : 'Standing by'}</span>
              </div>
              {activeJob ? (
                <div className="status-item">
                  <FileText size={15} />
                  <span>
                    {activeJob.exam_name || 'Untitled exam'} {activeJob.exam_year || ''}
                  </span>
                </div>
              ) : null}
            </div>

            {debug ? <pre className="debug-card">{debug}</pre> : null}
          </section>

          <section className="panel">
            <div className="section-header">
              <div>
                <div className="section-kicker">Jobs</div>
                <h2>Recent uploads</h2>
              </div>
              <button className="icon-button" onClick={() => void loadRecentJobs()} disabled={jobsLoading}>
                <RefreshCw size={15} className={jobsLoading ? 'spin' : ''} />
              </button>
            </div>

            <div className="job-list">
              {recentJobs.map((job) => (
                <button
                  key={job.id}
                  type="button"
                  className={`job-card ${job.id === currentJobId ? 'job-card-active' : ''}`}
                  onClick={() => {
                    pollJob(job.id);
                    if (job.paper_id && job.exam_name && job.exam_year) {
                      openReviewFor(job.exam_name, job.exam_year);
                    }
                  }}
                >
                  <div className="job-card-top">
                    <strong>{job.exam_name || job.filename || 'Untitled job'}</strong>
                    <JobBadge status={job.status} />
                  </div>
                  <p>{job.exam_year || 'Year pending'} · {job.filename || 'No filename saved'}</p>
                  <small>{formatTimestamp(job.updated_at)}</small>
                </button>
              ))}
              {!recentJobs.length && !jobsLoading ? (
                <div className="empty-state">No upload jobs yet.</div>
              ) : null}
            </div>
          </section>
        </aside>
      </div>

      <div className="review-grid">
        <section className="panel review-panel">
          <div className="section-header">
            <div>
              <div className="section-kicker">Publish status</div>
              <h2>
                {reviewTarget
                  ? `${reviewTarget.examName} ${reviewTarget.examYear}`
                  : 'Choose a paper to review'}
              </h2>
            </div>
            {reviewTarget ? (
              <button className="icon-button" onClick={() => void loadReviewWorkspace(reviewTarget)} disabled={reviewLoading}>
                <RefreshCw size={15} className={reviewLoading ? 'spin' : ''} />
              </button>
            ) : null}
          </div>

          {reviewLoading ? (
            <div className="empty-state">
              <Loader2 size={18} className="spin" />
              <div>Loading publish status and question review workspace…</div>
            </div>
          ) : reviewTarget && reviewWorkspace.paper ? (
            <>
              <div className="stats-grid">
                <div className="stat-card">
                  <span>Status</span>
                  <strong>
                    <PublishBadge
                      publishable={reviewWorkspace.paper.publishable}
                      blocked={reviewWorkspace.paper.blocked}
                      hiddenCount={reviewWorkspace.paper.hidden_question_count}
                    />
                  </strong>
                </div>
                <div className="stat-card">
                  <span>Visible questions</span>
                  <strong>{reviewWorkspace.paper.visible_question_count}</strong>
                </div>
                <div className="stat-card">
                  <span>Hidden questions</span>
                  <strong>{reviewWorkspace.paper.hidden_question_count}</strong>
                </div>
                <div className="stat-card">
                  <span>Paper blockers</span>
                  <strong>{reviewWorkspace.paper.paper_blocker_count}</strong>
                </div>
                <div className="stat-card">
                  <span>Row blockers</span>
                  <strong>{reviewWorkspace.paper.row_blocker_count}</strong>
                </div>
                <div className="stat-card">
                  <span>Reupload needed</span>
                  <strong>{reviewWorkspace.paper.reupload_needed ? 'Yes' : 'No'}</strong>
                </div>
                <div className="stat-card">
                  <span>Verified answers</span>
                  <strong>{reviewWorkspace.paper.verified_answer_count ?? '—'}</strong>
                </div>
                <div className="stat-card">
                  <span>Explanation coverage</span>
                  <strong>
                    {reviewWorkspace.paper.explanations
                      ? `${reviewWorkspace.paper.explanations.eligible_generated}/${reviewWorkspace.paper.explanations.eligible_total}`
                      : '—'}
                  </strong>
                </div>
              </div>

              <div className="helper-note">
                {reviewWorkspace.paper.blocked
                  ? 'This paper is currently blocked from localhost:4000. Fix the missing or broken rows below, then refresh this workspace.'
                  : reviewWorkspace.paper.hidden_question_count > 0
                  ? 'This paper can go public, but some rows will stay hidden until you repair them.'
                  : 'This paper is clean enough for the learner app right now.'}
              </div>

              {reviewWorkspace.paper.explanations ? (
                <div className="helper-note">
                  {reviewWorkspace.paper.explanations.eligible_missing > 0
                    ? `${reviewWorkspace.paper.explanations.eligible_missing} verified question(s) still need explanations. ${reviewWorkspace.paper.explanations.unverified_or_invalid} question(s) are still unverified or missing a valid answer, so explanation coverage cannot reach 100% yet.`
                    : reviewWorkspace.paper.explanations.unverified_or_invalid > 0
                    ? `All verified questions already have explanations. ${reviewWorkspace.paper.explanations.unverified_or_invalid} question(s) are still unverified or missing a valid answer.`
                    : 'All verified questions already have explanations.'}
                </div>
              ) : null}

              <div className="panel-subsection">
                <div className="section-kicker">Paper actions</div>
                <div className="field-grid review-action-grid">
                  <label className="field">
                    <span>Exam name in frontend</span>
                    <input
                      value={renameExamDraft}
                      onChange={(event) => setRenameExamDraft(event.target.value)}
                      placeholder="Rename this exam"
                    />
                  </label>
                </div>
                <div className="action-row">
                  <button
                    className="secondary-button"
                    onClick={() => void handleRenameExam()}
                    disabled={
                      renamingExam ||
                      !reviewTarget ||
                      !renameExamDraft.trim() ||
                      renameExamDraft.trim() === reviewTarget.examName
                    }
                  >
                    {renamingExam ? <Loader2 size={16} className="spin" /> : <FilePenLine size={16} />}
                    Rename exam
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => void handleGenerateExplanations()}
                    disabled={generatingExplanations || !reviewTarget}
                  >
                    {generatingExplanations ? <Loader2 size={16} className="spin" /> : <FileText size={16} />}
                    Generate explanations
                  </button>
                  <button
                    className="primary-button"
                    onClick={() => void handlePublishPaper()}
                    disabled={publishingPaper || !reviewTarget}
                  >
                    {publishingPaper ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
                    Publish to frontend
                  </button>
                </div>
              </div>

              {reviewActionMessage ? (
                <div
                  className={`alert-card ${
                    reviewActionTone === 'success' ? 'alert-success' : 'alert-danger'
                  } compact-alert`}
                >
                  {reviewActionTone === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                  <div>
                    <strong>{reviewActionTone === 'success' ? 'Done' : 'Action failed'}</strong>
                    <p>{reviewActionMessage}</p>
                  </div>
                </div>
              ) : null}

              {reviewWarning ? (
                <div className="alert-card alert-warn compact-alert">
                  <AlertCircle size={16} />
                  <div>
                    <strong>Note</strong>
                    <p>{reviewWarning}</p>
                  </div>
                </div>
              ) : null}
              {reviewError ? (
                <div className="alert-card alert-danger compact-alert">
                  <AlertCircle size={16} />
                  <div>
                    <strong>Review error</strong>
                    <p>{reviewError}</p>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="empty-state">
              Select a recent job or click <strong>Load review workspace</strong> after entering the exam.
            </div>
          )}
        </section>

        <section className="panel review-panel">
          <div className="section-header">
            <div>
              <div className="section-kicker">Missing questions</div>
              <h2>Exact missing numbers</h2>
            </div>
          </div>

          {missingItems.length ? (
            <div className="missing-list">
              {missingItems.map((item) => (
                <div key={`${item.exam_name}-${item.exam_year}-${item.question_number}`} className="missing-card">
                  <div>
                    <strong>Q{item.question_number}</strong>
                    <p>{item.reasons.join(', ') || item.issue_type}</p>
                  </div>
                  <button
                    className="secondary-button"
                    onClick={() => void createPlaceholderForMissing(item)}
                    disabled={creatingQuestionNumber === item.question_number}
                  >
                    {creatingQuestionNumber === item.question_number ? (
                      <>
                        <Loader2 size={15} className="spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <Plus size={15} />
                        Create editable placeholder
                      </>
                    )}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">No missing question numbers detected for this paper.</div>
          )}
        </section>
      </div>

      <div className="review-grid">
        <section className="panel review-panel">
          <div className="section-header">
            <div>
              <div className="section-kicker">Repair queue</div>
              <h2>Rows that need attention</h2>
            </div>
          </div>

          {reviewWorkspace.repairItems.length ? (
            <div className="repair-list">
              {reviewWorkspace.repairItems.map((item, index) => (
                <div key={`${item.question_id || 'missing'}-${item.question_number || index}`} className="repair-card">
                  <div className="repair-card-top">
                    <strong>Q{item.question_number ?? '?'}</strong>
                    <span className={`badge ${item.publish_blocker === 'paper' ? 'badge-danger' : 'badge-warn'}`}>
                      {item.issue_type}
                    </span>
                  </div>
                  <p>{item.reasons.join(', ') || item.repair_path}</p>
                  <div className="repair-meta">
                    <span>{item.publish_blocker === 'paper' ? 'Blocks the paper' : 'Blocks this row'}</span>
                    <span>{item.priority}</span>
                  </div>
                  <div className="repair-actions">
                    {item.question_id ? (
                      <button className="ghost-button" onClick={() => void openQuestionEditor(String(item.question_id))}>
                        <FilePenLine size={15} />
                        Edit question
                      </button>
                    ) : typeof item.question_number === 'number' ? (
                      <button
                        className="ghost-button"
                        onClick={() => void createPlaceholderForMissing(item)}
                        disabled={creatingQuestionNumber === item.question_number}
                      >
                        <Plus size={15} />
                        Add placeholder
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">No repair queue items for this paper.</div>
          )}
        </section>

        <section className="panel review-panel">
          <div className="section-header">
            <div>
              <div className="section-kicker">Question bank</div>
              <h2>Edit existing questions</h2>
            </div>
            <label className="search-input admin-search">
              <Search size={15} />
              <input
                value={questionSearch}
                onChange={(event) => setQuestionSearch(event.target.value)}
                placeholder="Search by number, text, subject, topic..."
              />
            </label>
          </div>

          {filteredQuestions.length ? (
            <div className="question-list">
              {filteredQuestions.map((question) => (
                <div key={question.id} className="question-row">
                  <div className="question-row-main">
                    <div className="question-row-header">
                      <strong>Q{question.question_number ?? '?'}</strong>
                      <div className="question-badges">
                        <span className="badge badge-blue">{question.subject}</span>
                        <span className="badge badge-warn">{question.difficulty}</span>
                        {question.needs_review ? <span className="badge badge-danger">Needs review</span> : null}
                      </div>
                    </div>
                    <p>{question.question_text}</p>
                    <small>{question.topic}{question.subtopic ? ` · ${question.subtopic}` : ''}</small>
                  </div>
                  <button className="primary-button small-button" onClick={() => void openQuestionEditor(question.id)}>
                    <FilePenLine size={15} />
                    Edit
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">No questions loaded yet for this paper.</div>
          )}
        </section>
      </div>

      {editorQuestion ? (
        <QuestionEditorModal
          question={editorQuestion}
          onClose={() => setEditorQuestion(null)}
          onSaved={handleQuestionSaved}
        />
      ) : null}
    </div>
  );
}
