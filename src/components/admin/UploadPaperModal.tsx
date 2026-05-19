import React, { useState, useRef, useCallback } from 'react';
import { motion } from 'motion/react';
import { X, Upload, FileText, Loader2, CheckCircle2, AlertCircle, Key } from 'lucide-react';
import { C } from '../../lib/tokens';
import { API_BASE, adminHeaders } from '../../lib/adminApi';

interface UploadPaperModalProps {
  onClose: () => void;
  onComplete: () => void;
}


type Phase = 'idle' | 'uploading' | 'processing' | 'done' | 'error';
type Mode  = 'auto' | 'answer_key' | 'visual' | 'cbt';

const inputStyle: React.CSSProperties = {
  width: '100%', background: C.bg, border: `1px solid ${C.border}`,
  borderRadius: 10, color: C.text, fontSize: 13, padding: '9px 12px',
  outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
};

const labelStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: C.textTert,
  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5, display: 'block',
};

const MODES: { id: Mode; label: string; desc: string; icon: string }[] = [
  { id: 'auto',       label: 'Universal (Vision)', icon: '⚡', desc: 'Gemini AI reads every page directly — handles MCQ, Match-the-following, tables, charts, images, bilingual PDFs. Works on any paper format.' },
  { id: 'answer_key', label: '+ Answer Key PDF',  icon: '🗝️', desc: 'Upload question paper + a separate answer key PDF. Auto-detects multi-set keys (Set A/B/C/D) and matches the correct set.' },
  { id: 'visual',     label: 'Visual Final Key',  icon: '👁️', desc: 'PDF with boxes/circles drawn on correct answers (APPSC Final Key style).' },
  { id: 'cbt',        label: 'CBT Color Key',     icon: '🟢', desc: 'Telegram CBT PDF — green ✓ = correct, red ✗ = wrong. Detects shifts automatically.' },
];

const ACTIVE_JOB_KEY = 'upsc_active_upload_job';

export function UploadPaperModal({ onClose, onComplete }: UploadPaperModalProps) {
  const [file, setFile]             = useState<File | null>(null);
  const [akFile, setAkFile]         = useState<File | null>(null);
  const [examName, setExamName]     = useState('');
  const [year, setYear]             = useState(new Date().getFullYear().toString());
  const [series, setSeries]         = useState('');
  const [shiftLabel, setShiftLabel] = useState('');
  const [mode, setMode]             = useState<Mode>('auto');
  const [phase, setPhase]           = useState<Phase>('idle');
  const [progress, setProgress]     = useState(0);
  const [statusMsg, setStatusMsg]   = useState('');
  const [error, setError]           = useState('');
  const [expectedCount, setExpectedCount] = useState<string | number>(''); // Empty for Auto
  const [showConflict, setShowConflict] = useState<{
    type: 'file' | 'exam';
    msg: string;
    existingName?: string;       // display label e.g. "TSPSC GROUP 1 PRELIMS 2022"
    existingExamName?: string;   // raw exam_name for re-submission
    existingExamYear?: string;   // raw exam_year for re-submission
  } | null>(null);

  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [stuckSecs, setStuckSecs]       = useState(0);
  const [jobDebug, setJobDebug]         = useState('');

  const liveRepairSummary = React.useMemo(() => {
    if (!jobDebug) return null;
    const recoveredMatch = jobDebug.match(/recovered\s+(\d+)\/(\d+)\s+targets/i);
    const partialMatch = jobDebug.match(/partial\/incomplete:\s*\[([^\]]*)\]/i);
    const unresolvedMatch = jobDebug.match(/unresolved:\s*\[([^\]]*)\]/i);
    if (!recoveredMatch && !partialMatch && !unresolvedMatch) return null;
    return {
      recovered: recoveredMatch ? `${recoveredMatch[1]}/${recoveredMatch[2]}` : null,
      partial: partialMatch ? partialMatch[1].trim() : '',
      unresolved: unresolvedMatch ? unresolvedMatch[1].trim() : '',
    };
  }, [jobDebug]);

  const stuckMessage = React.useMemo(() => {
    if (liveRepairSummary) {
      const parts: string[] = [];
      if (liveRepairSummary.recovered) parts.push(`Recovered ${liveRepairSummary.recovered} targets so far.`);
      if (liveRepairSummary.partial) parts.push(`Partial rows: ${liveRepairSummary.partial}.`);
      if (liveRepairSummary.unresolved) parts.push(`Still unresolved: ${liveRepairSummary.unresolved}.`);
      return parts.join(' ');
    }
    if (progress < 15) {
      return `Still at ${progress}% for ${Math.floor(stuckSecs / 60)}m. The extractor is likely doing the initial paper scan or shift detection. If this is a repair upload, it may still be identifying the exact target pages.`;
    }
    if (progress < 70) {
      return `Still at ${progress}% for ${Math.floor(stuckSecs / 60)}m. The extractor may be scanning page images or rebuilding difficult rows, which can take time without smooth visible movement.`;
    }
    return `Still at ${progress}% for ${Math.floor(stuckSecs / 60)}m. The extractor hit Gemini's rate limit and is pausing 60–120s before resuming — this is normal. It will continue automatically.`;
  }, [liveRepairSummary, progress, stuckSecs]);

  const fileRef   = useRef<HTMLInputElement>(null);
  const akFileRef = useRef<HTMLInputElement>(null);
  const pollRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastProgressRef = useRef<number>(-1);
  const stuckSecsRef    = useRef<number>(0);
  const lastHeartbeatRef = useRef<string>('');

  const inferVisibleProgress = React.useCallback((job: any) => {
    const raw = Number(job?.progress || 0);
    const status = String(job?.status || '');
    const errorLog = String(job?.error_log || '');
    const text = `${status} ${errorLog}`;
    const m = text.match(/page\s+(\d+)\s+of\s+(\d+)/i);
    const cur = m ? parseInt(m[1], 10) : 0;
    const total = m ? Math.max(parseInt(m[2], 10), 1) : 0;

    let inferred = raw;
    if (mode === 'cbt') {
      if (/Locating target CBT pages/i.test(text) && total) {
        inferred = Math.max(raw, 5 + Math.floor(25 * cur / total));
      } else if (/Re-extracting targeted CBT page/i.test(text) && total) {
        inferred = Math.max(raw, 30 + Math.floor(45 * cur / total));
      } else if (/Deep recovery/i.test(text) && total) {
        inferred = Math.max(raw, 55 + Math.floor(30 * cur / total));
      } else if (/Scanning Shift|single-shift CBT scan|Reading text layer/i.test(text) && total) {
        inferred = Math.max(raw, 12 + Math.floor(58 * cur / total));
      } else if (/Recovered \d+ target CBT rows/i.test(text)) {
        inferred = Math.max(raw, 70);
      } else if (/Tagging repaired CBT rows/i.test(text)) {
        inferred = Math.max(raw, 75);
      } else if (/Saving repaired CBT rows/i.test(text)) {
        inferred = Math.max(raw, 88);
      } else if (/Refreshing explanations/i.test(text)) {
        inferred = Math.max(raw, 95);
      } else if (job?.status === 'completed') {
        inferred = 100;
      }
    }
    return Math.min(100, inferred);
  }, [mode]);

  // On mount: resume polling if there's an active job from a previous session
  React.useEffect(() => {
    const saved = localStorage.getItem(ACTIVE_JOB_KEY);
    if (saved) {
      try {
        const { jobId, savedMode } = JSON.parse(saved);
        if (jobId) {
          if (savedMode) setMode(savedMode as Mode);
          // Check job status immediately before starting poll interval
          fetch(`${API_BASE}/admin/jobs/${jobId}`, { headers: adminHeaders() })
            .then(r => r.ok ? r.json() : null)
            .then(job => {
              if (!job) { localStorage.removeItem(ACTIVE_JOB_KEY); return; }
              if (job.status === 'completed') {
                localStorage.removeItem(ACTIVE_JOB_KEY);
                setPhase('done'); setProgress(100);
                setJobDebug('');
                onComplete(); // auto-refresh questions list
              } else if (job.status === 'failed') {
                localStorage.removeItem(ACTIVE_JOB_KEY);
                setPhase('error'); setError(job.error_log || 'Processing failed');
              } else {
                pollJob(jobId); // still running — resume polling
              }
            })
            .catch(() => { localStorage.removeItem(ACTIVE_JOB_KEY); });
        }
      } catch { localStorage.removeItem(ACTIVE_JOB_KEY); }
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, which: 'main' | 'ak') => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f?.name.endsWith('.pdf')) {
      which === 'main' ? setFile(f) : setAkFile(f);
    }
  }, []);

  const handleRetry = async (jobId: string) => {
    try {
      const r = await fetch(`${API_BASE}/admin/retry-job/${jobId}`, {
        method: 'POST', headers: adminHeaders(),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.detail || 'Retry failed');
        return;
      }
      // Reset stuck counter and resume polling
      stuckSecsRef.current = 0;
      setStuckSecs(0);
      lastProgressRef.current = -1;
      pollJob(jobId);
    } catch {
      setError('Retry request failed — check backend is running');
    }
  };

  const pollJob = (jobId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    setCurrentJobId(jobId);
    stuckSecsRef.current = 0;
    setStuckSecs(0);
    lastProgressRef.current = -1;
    setPhase('processing');
    setStatusMsg('Queued — waiting for worker to start...');
    let attempts = 0;
    let consecutiveErrors = 0;
    pollRef.current = setInterval(async () => {
      attempts++;
      // Wait up to 45 minutes (2700 seconds) for large PDFs
      if (attempts > 2700) {
        if (pollRef.current) clearInterval(pollRef.current);
        setPhase('error');
        setError('Processing timed out. This often happens with very large papers. Check the Dashboard in 5-10 minutes to see if it finished.');
        return;
      }
      try {
        const r = await fetch(`${API_BASE}/admin/jobs/${jobId}`, {
          headers: adminHeaders(),
        });
        if (!r.ok) {
          if (r.status === 404) {
            if (pollRef.current) clearInterval(pollRef.current);
            if (currentJobId === jobId || !currentJobId) {
              localStorage.removeItem(ACTIVE_JOB_KEY);
            }
            setPhase('idle');
            setStatusMsg('');
            setJobDebug('');
            setError('This upload job was superseded by a newer run. Reopen the latest upload status or retry once if needed.');
            return;
          }
          // Transient server error (500, 502, etc.) — retry up to 5 times before giving up
          consecutiveErrors++;
          if (consecutiveErrors >= 5) {
            if (pollRef.current) clearInterval(pollRef.current);
            if (currentJobId === jobId || !currentJobId) {
              localStorage.removeItem(ACTIVE_JOB_KEY);
            }
            setPhase('error');
            setError(`Upload status check failed (${r.status}) after ${consecutiveErrors} retries. Please retry the upload.`);
          }
          return;
        }
        consecutiveErrors = 0;
        const job = await r.json();
        const p = inferVisibleProgress(job);
        setProgress(p);

        const heartbeat = `${job.updated_at || ''}|${job.error_log || ''}|${job.status || ''}`;

        // Stuck detection: only count as stuck if neither visible progress nor backend heartbeat changed
        if (p === lastProgressRef.current && heartbeat === lastHeartbeatRef.current) {
          stuckSecsRef.current += 1;
          setStuckSecs(stuckSecsRef.current);
        } else {
          stuckSecsRef.current = 0;
          setStuckSecs(0);
          lastProgressRef.current = p;
          lastHeartbeatRef.current = heartbeat;
        }
        if (job.status === 'completed') {
          if (pollRef.current) clearInterval(pollRef.current);
          localStorage.removeItem(ACTIVE_JOB_KEY);
          setPhase('done');
          setStatusMsg('');
          setJobDebug('');
          setProgress(100);
        } else if (job.status === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current);
          localStorage.removeItem(ACTIVE_JOB_KEY);
          setPhase('error');
          setError(job.error_log || 'Processing failed');
        } else if (job.status === 'queued' || job.status === 'pending') {
          setStatusMsg(job.error_log || 'Queued — waiting for worker to start...');
          setJobDebug(`Job status: ${job.status}`);
        } else if (job.status === 'processing') {
          if (job.error_log) setJobDebug(job.error_log);
          if (mode === 'cbt') {
            if (p < 80)       setStatusMsg(job.error_log || 'Processing CBT paper...');
            else if (p < 90)  setStatusMsg('Tagging subjects & topics with AI...');
            else              setStatusMsg('Storing to database...');
          } else {
            if (p < 15)       setStatusMsg('Preparing extractor...');
            else if (p < 72)  setStatusMsg(job.error_log || 'Extracting questions page by page...');
            else if (p < 80)  setStatusMsg(job.error_log || 'Recovering difficult pages with deeper extraction...');
            else if (p < 85)  setStatusMsg('Tagging subjects & topics with AI...');
            else if (p < 95)  setStatusMsg('Injecting answers & storing in database...');
            else              setStatusMsg('Generating explanations...');
          }
        }
      } catch {
        // network blip — keep polling
      }
    }, 1000);
  };

  const handleCancel = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    localStorage.removeItem(ACTIVE_JOB_KEY);
    setPhase('idle');
    setProgress(0);
    setStatusMsg('');
    setJobDebug('');
    setError('');
  };

  // replaceExisting=true → archive old exam, clear PDF cache, re-extract under existing name
  const handleSubmit = async (isForced = false, replaceExisting = false) => {
    if (!file || !examName.trim() || !year) return;
    if (mode === 'answer_key' && !akFile) return;
    const conflict = showConflict;
    if (pollRef.current) clearInterval(pollRef.current);
    localStorage.removeItem(ACTIVE_JOB_KEY);
    setCurrentJobId(null);
    setError('');
    setJobDebug('');
    setShowConflict(null);
    setPhase('uploading');
    setStatusMsg('Uploading PDF...');
    setProgress(0);

    const form = new FormData();
    form.append('file', file);
    // For replace: use the existing exam's name/year so we overwrite the right record
    const targetName = replaceExisting && conflict?.existingExamName
      ? conflict.existingExamName
      : examName.trim();
    const targetYear = replaceExisting && conflict?.existingExamYear
      ? conflict.existingExamYear
      : year;
    form.append('exam_name', targetName);
    form.append('exam_year', targetYear);
    form.append('series', series.trim());
    form.append('use_vision', mode === 'visual' ? 'true' : 'false');
    form.append('is_cbt', mode === 'cbt' ? 'true' : 'false');
    if (mode === 'cbt' && shiftLabel.trim()) {
      form.append('shift_label_override', shiftLabel.trim());
    }
    if ((mode === 'answer_key' || mode === 'auto') && akFile) {
      form.append('answer_key_file', akFile);
    }
    // Convert expectedCount to number or 0 (0 = Auto)
    const countVal = !expectedCount ? 0 : parseInt(expectedCount.toString());
    form.append('expected_count', (countVal || 0).toString());

    if (isForced) form.append('force_replace', 'true');
    if (replaceExisting) form.append('clear_cache', 'true');

    try {
      const res = await fetch(`${API_BASE}/admin/upload-pdf`, {
        method: 'POST',
        headers: adminHeaders(),
        body: form,
      });
      const data = await res.json();
      
      if (!res.ok) {
        if (res.status === 409) {
          const type = data.error === 'duplicate_file' ? 'file' : 'exam';
          const existingName = data.existing_exam_name
            ? `${data.existing_exam_name} ${data.existing_exam_year || ''}`.trim()
            : undefined;
          setShowConflict({
            type,
            msg: data.message,
            existingName,
            existingExamName: data.existing_exam_name,
            existingExamYear: data.existing_exam_year?.toString(),
          });
          setPhase('idle');
          return;
        }
        throw new Error(data.detail || data.message || JSON.stringify(data));
      }
      
      if (data.job_id) {
        if (data.missing_reupload_mode) {
          const targets = Array.isArray(data.target_missing_numbers) ? data.target_missing_numbers.join(', ') : '';
          const cacheMsg = data.clear_cache_applied ? 'Cache cleared.' : 'Cache reused.';
          setStatusMsg(`Repair queued for existing paper. ${cacheMsg}`);
          setJobDebug(`Mode: repair · Route: ${data.route_format || 'unknown'} · Targets: ${targets || 'unknown'}`);
        } else {
          setStatusMsg(data.message || 'Upload queued');
          setJobDebug(`Mode: fresh upload · Route: ${data.route_format || 'unknown'}`);
        }
        localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify({ jobId: data.job_id, savedMode: mode }));
        setProgress(data.missing_reupload_mode ? 1 : 5);
        pollJob(data.job_id);
      } else if (data.inserted !== undefined) {
        setPhase('done');
        setProgress(100);
      }
    } catch (e: any) {
      localStorage.removeItem(ACTIVE_JOB_KEY);
      setPhase('error');
      // Handle FastAPI's detail objects or lists accurately
      let msg = 'Upload failed';
      if (e.message) msg = e.message;
      if (typeof msg === 'object') msg = JSON.stringify(msg);
      setError(msg);
    }
  };

  const canSubmit = !!file && !!examName.trim() && !!year && phase === 'idle'
    && (mode !== 'answer_key' || !!akFile);

  const FileZone = ({
    f, onDrop, onClick, label, hint,
  }: {
    f: File | null; onDrop: (e: React.DragEvent) => void;
    onClick: () => void; label: string; hint?: string;
  }) => (
    <div
      onDrop={onDrop}
      onDragOver={e => e.preventDefault()}
      onClick={() => phase === 'idle' && onClick()}
      style={{
        border: `2px dashed ${f ? C.accent : C.border}`, borderRadius: 14,
        padding: '18px 16px', textAlign: 'center',
        cursor: phase === 'idle' ? 'pointer' : 'default',
        background: f ? C.accentDim : C.bg, transition: 'all 0.2s',
      }}
    >
      {f ? (
        <>
          <FileText style={{ width: 24, height: 24, color: C.accent, margin: '0 auto 6px' }} />
          <p style={{ fontSize: 12, fontWeight: 700, color: C.accent }}>{f.name}</p>
          <p style={{ fontSize: 11, color: C.textTert, marginTop: 2 }}>{(f.size / 1024 / 1024).toFixed(1)} MB</p>
        </>
      ) : (
        <>
          <Upload style={{ width: 24, height: 24, color: C.textTert, margin: '0 auto 6px' }} />
          <p style={{ fontSize: 12, fontWeight: 600, color: C.textSec }}>{label}</p>
          {hint && <p style={{ fontSize: 11, color: C.textTert, marginTop: 3 }}>{hint}</p>}
        </>
      )}
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={() => { if (phase === 'idle' || phase === 'done' || phase === 'error') onClose(); }}
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }} />

      <motion.div initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
        style={{ position: 'relative', width: '100%', maxWidth: 540, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 20, overflow: 'hidden', boxShadow: '0 24px 80px rgba(0,0,0,0.7)' }}>

        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontSize: 14, fontWeight: 800, color: C.text }}>Upload Exam Paper</p>
            <p style={{ fontSize: 11, color: C.textTert, marginTop: 2 }}>PDF → Auto-extract → Tag → Supabase</p>
          </div>
          <button onClick={onClose} style={{ padding: 8, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, cursor: 'pointer', color: C.textSec, display: 'flex' }}>
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '75vh', overflowY: 'auto' }}>

          {/* Mode selector */}
          <div>
            <label style={labelStyle}>Extraction Mode</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {MODES.map(m => (
                <label key={m.id}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10, cursor: phase === 'idle' ? 'pointer' : 'default',
                    padding: '10px 12px', borderRadius: 10, transition: 'all 0.15s',
                    background: mode === m.id ? C.accentDim : C.bg,
                    border: `1px solid ${mode === m.id ? C.accent + '50' : C.border}`,
                  }}
                >
                  <input type="radio" name="mode" value={m.id} checked={mode === m.id}
                    onChange={() => phase === 'idle' && setMode(m.id as Mode)}
                    disabled={phase !== 'idle'}
                    style={{ marginTop: 2, accentColor: C.accent }} />
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 600, color: mode === m.id ? C.accent : C.text }}>
                      {m.icon} {m.label}
                    </p>
                    <p style={{ fontSize: 11, color: C.textTert, marginTop: 2, lineHeight: 1.5 }}>{m.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* File zones */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input ref={fileRef} type="file" accept=".pdf" style={{ display: 'none' }}
              onChange={e => e.target.files?.[0] && setFile(e.target.files[0])} />
            <input ref={akFileRef} type="file" accept=".pdf" style={{ display: 'none' }}
              onChange={e => e.target.files?.[0] && setAkFile(e.target.files[0])} />

            <div>
              <label style={labelStyle}>
                {mode === 'visual' ? 'Final Key PDF (with visual marks)' : mode === 'cbt' ? 'CBT Answer Key PDF (green/red)' : 'Question Paper PDF'}
              </label>
              <FileZone
                f={file}
                onDrop={e => handleDrop(e, 'main')}
                onClick={() => fileRef.current?.click()}
                label="Drop PDF here or click to browse"
                hint="Max 100 MB"
              />
            </div>

            {(mode === 'answer_key' || mode === 'auto') && (
              <div>
                <label style={labelStyle}>
                  Answer Key PDF
                  {mode === 'auto' && <span style={{ color: C.textTert, fontWeight: 400, textTransform: 'none', fontSize: 10 }}> — optional</span>}
                </label>
                <FileZone
                  f={akFile}
                  onDrop={e => handleDrop(e, 'ak')}
                  onClick={() => akFileRef.current?.click()}
                  label={mode === 'auto' ? 'Drop answer key PDF here (optional)' : 'Drop answer key PDF here'}
                  hint="Text or scanned — auto-detects Set A/B/C/D"
                />
              </div>
            )}
          </div>

          {/* Settings */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Expected Total Questions</label>
              <input type="number" value={expectedCount} onChange={e => setExpectedCount(e.target.value)}
                placeholder="Leave blank for Auto"
                style={inputStyle} disabled={phase !== 'idle'} min={1} max={250} />
              <p style={{ fontSize: 10, color: C.textTert, marginTop: 4 }}>
                Helps detect gaps (e.g. 100 for UPSC, 150 for States)
              </p>
            </div>
            <div>
              <label style={labelStyle}>Series (optional)</label>
              <input type="text" value={series} onChange={e => setSeries(e.target.value)}
                placeholder="A / B / C" style={inputStyle} disabled={phase !== 'idle'} />
            </div>
          </div>

          {/* Form fields */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={labelStyle}>Exam Name</label>
              <input type="text" value={examName} onChange={e => setExamName(e.target.value)}
                placeholder='e.g. "APPSC Group II Mains Paper I"'
                style={inputStyle} disabled={phase !== 'idle'} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>Year</label>
                <input type="number" value={year} onChange={e => setYear(e.target.value)}
                  style={inputStyle} disabled={phase !== 'idle'} min={2000} max={2035} />
              </div>
              {mode === 'cbt' && (
                <div>
                  <label style={labelStyle}>Shift Label</label>
                  <input type="text" value={shiftLabel} onChange={e => setShiftLabel(e.target.value)}
                    placeholder='e.g. "Shift 1"'
                    style={inputStyle} disabled={phase !== 'idle'} />
                </div>
              )}
            </div>
          </div>

          {/* Progress */}
          {(phase === 'uploading' || phase === 'processing') && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12, color: C.blue }}>
                <Loader2 style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} />
                {statusMsg}
              </div>
              <div style={{ height: 6, background: C.border, borderRadius: 99, overflow: 'hidden' }}>
                <motion.div style={{ height: '100%', background: `linear-gradient(90deg, ${C.blue}, ${C.accent})`, borderRadius: 99 }}
                  animate={{ width: `${progress}%` }} transition={{ duration: 0.5 }} />
              </div>
              <p style={{ fontSize: 11, color: C.textTert, marginTop: 4, textAlign: 'right' }}>{progress}%</p>
              {jobDebug && (
                <div style={{ marginTop: 8, padding: '8px 10px', background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 11, color: C.textSec, lineHeight: 1.5 }}>
                  {jobDebug}
                </div>
              )}
              {liveRepairSummary && (
                <div style={{ marginTop: 8, padding: '10px 12px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 10, fontSize: 11, color: C.textSec, lineHeight: 1.6 }}>
                  <div style={{ fontWeight: 700, color: C.text, marginBottom: 4 }}>Live Repair Summary</div>
                  {liveRepairSummary.recovered && <div>Recovered so far: <strong>{liveRepairSummary.recovered}</strong></div>}
                  {liveRepairSummary.partial && <div>Partial rows: {liveRepairSummary.partial}</div>}
                  {liveRepairSummary.unresolved && <div>Still unresolved: {liveRepairSummary.unresolved}</div>}
                </div>
              )}

              {/* Stuck detection — keep the user informed, but don't allow live retries.
                  Retrying an active job can mix pipelines and corrupt the run. */}
              {stuckSecs >= 180 && currentJobId && (
                <div style={{ marginTop: 10, padding: '10px 14px', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ fontSize: 12, color: '#FBBF24' }}>
                    {stuckMessage}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Done */}
          {phase === 'done' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: '#0D2E1A', border: '1px solid #22c55e40', borderRadius: 12, fontSize: 13, fontWeight: 700, color: '#22c55e' }}>
              <CheckCircle2 style={{ width: 18, height: 18, flexShrink: 0 }} />
              Paper ingested! Refresh to see the new exam card.
            </div>
          )}

          {/* Error */}
          {(phase === 'error' || error) && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', background: '#2E0D0D', border: '1px solid #f43f5e40', borderRadius: 12, fontSize: 12, color: '#f87171' }}>
              <AlertCircle style={{ width: 16, height: 16, flexShrink: 0, marginTop: 1 }} />
              {error}
            </div>
          )}

          {/* Conflict Warning */}
          {showConflict && (
            <div style={{ padding: '16px', background: C.accentDim, border: `1px solid ${C.accent}40`, borderRadius: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: C.accent, marginBottom: 10 }}>
                <AlertCircle style={{ width: 18, height: 18 }} />
                <p style={{ fontSize: 13, fontWeight: 700 }}>
                  {showConflict.type === 'file' ? 'Duplicate PDF Detected' : 'Exam Already Exists'}
                </p>
              </div>
              {showConflict.type === 'file' && showConflict.existingName ? (
                <>
                  <p style={{ fontSize: 12, color: C.textSec, lineHeight: 1.6, marginBottom: 16 }}>
                    This PDF was already uploaded as <strong style={{ color: C.text }}>"{showConflict.existingName}"</strong>.
                    Choose how to proceed:
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
                    <div style={{ padding: '10px 12px', background: '#0D2218', border: '1px solid #22c55e30', borderRadius: 10 }}>
                      <p style={{ fontSize: 12, fontWeight: 700, color: '#22c55e', marginBottom: 3 }}>Replace Existing</p>
                      <p style={{ fontSize: 11, color: C.textSec, lineHeight: 1.5 }}>
                        Deletes old questions for <strong style={{ color: C.text }}>"{showConflict.existingName}"</strong>, clears PDF cache, and re-extracts fresh. Use this to fix extraction errors.
                      </p>
                    </div>
                    <div style={{ padding: '10px 12px', background: C.accentDim, border: `1px solid ${C.accent}30`, borderRadius: 10 }}>
                      <p style={{ fontSize: 12, fontWeight: 700, color: C.accent, marginBottom: 3 }}>Add as New Exam</p>
                      <p style={{ fontSize: 11, color: C.textSec, lineHeight: 1.5 }}>
                        Keeps <strong style={{ color: C.text }}>"{showConflict.existingName}"</strong> intact and adds a separate entry as <strong style={{ color: C.text }}>"{examName} {year}"</strong>.
                      </p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setShowConflict(null)}
                      style={{ padding: '8px 14px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8, color: C.textSec, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                      Cancel
                    </button>
                    <button onClick={() => handleSubmit(true, true)}
                      style={{ flex: 1, padding: '8px', background: '#22c55e', border: 'none', borderRadius: 8, color: '#000', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                      Replace Existing
                    </button>
                    <button onClick={() => handleSubmit(true, false)}
                      style={{ flex: 1, padding: '8px', background: C.accent, border: 'none', borderRadius: 8, color: '#000', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                      Add as New Exam
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p style={{ fontSize: 12, color: C.textSec, lineHeight: 1.5, marginBottom: 16 }}>
                    {showConflict.msg}<br/>
                    Do you want to replace the existing data? Old questions will be archived.
                  </p>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button onClick={() => setShowConflict(null)}
                      style={{ flex: 1, padding: '8px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8, color: C.textSec, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                      Cancel
                    </button>
                    <button onClick={() => handleSubmit(true)}
                      style={{ flex: 1, padding: '8px', background: C.accent, border: 'none', borderRadius: 8, color: '#000', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                      Yes, Replace Data
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 20px', background: C.bg, borderTop: `1px solid ${C.border}`, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          {phase === 'done' ? (
            <button onClick={() => { onComplete(); onClose(); }}
              style={{ padding: '9px 22px', background: C.accent, border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, color: '#000', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircle2 style={{ width: 14, height: 14 }} /> Done — Refresh Questions
            </button>
          ) : (
            <>
              <button
                onClick={phase === 'uploading' || phase === 'processing' ? handleCancel : onClose}
                style={{ padding: '9px 20px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 13, fontWeight: 600, color: C.textSec, cursor: 'pointer' }}>
                {phase === 'uploading' || phase === 'processing' ? 'Stop & Reset' : 'Cancel'}
              </button>
              <button onClick={() => handleSubmit(false)} disabled={!canSubmit}
                style={{ padding: '9px 22px', background: canSubmit ? C.accent : C.border, border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, color: canSubmit ? '#000' : C.textSec, cursor: canSubmit ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Upload style={{ width: 14, height: 14 }} /> Upload & Process
              </button>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
