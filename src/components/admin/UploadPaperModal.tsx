import React, { useState, useRef, useCallback } from 'react';
import { motion } from 'motion/react';
import { X, Upload, FileText, Loader2, CheckCircle2, AlertCircle, Key } from 'lucide-react';
import { C } from '../../lib/tokens';

interface UploadPaperModalProps {
  onClose: () => void;
  onComplete: () => void;
}

const ADMIN_KEY = import.meta.env.VITE_ADMIN_KEY || 'upsc-admin-secret-key-change-me';

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
  { id: 'auto',       label: 'Auto-detect',     icon: '⚡', desc: 'Regex → hybrid → vision. System picks the best approach automatically.' },
  { id: 'answer_key', label: '+ Answer Key PDF', icon: '🗝️', desc: 'Upload question paper + a separate answer key PDF (text or scanned).' },
  { id: 'visual',     label: 'Visual Final Key', icon: '👁️', desc: 'PDF with boxes/circles drawn on correct answers (APPSC Final Key style).' },
  { id: 'cbt',        label: 'CBT Color Key',    icon: '🟢', desc: 'Telegram CBT PDF — green ✓ = correct, red ✗ = wrong. Detects shifts automatically.' },
];

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
  const fileRef   = useRef<HTMLInputElement>(null);
  const akFileRef = useRef<HTMLInputElement>(null);
  const pollRef   = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleDrop = useCallback((e: React.DragEvent, which: 'main' | 'ak') => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f?.name.endsWith('.pdf')) {
      which === 'main' ? setFile(f) : setAkFile(f);
    }
  }, []);

  const pollJob = (jobId: string) => {
    setPhase('processing');
    setStatusMsg('Processing — reading the paper...');
    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts++;
      if (attempts > 360) { // 6 min timeout
        clearInterval(pollRef.current!);
        setPhase('error');
        setError('Processing timed out. Check backend logs.');
        return;
      }
      try {
        const r = await fetch(`http://localhost:8000/admin/jobs/${jobId}`, {
          headers: { 'x-admin-key': ADMIN_KEY },
        });
        if (!r.ok) return;
        const job = await r.json();
        setProgress(job.progress || 0);
        const p = job.progress || 0;
        if (job.status === 'completed') {
          clearInterval(pollRef.current!);
          setPhase('done');
          setStatusMsg('');
          setProgress(100);
        } else if (job.status === 'failed') {
          clearInterval(pollRef.current!);
          setPhase('error');
          setError(job.error_log || 'Processing failed');
        } else if (job.status === 'processing') {
          if (mode === 'cbt') {
            if (p < 10)       setStatusMsg('Detecting exam shifts...');
            else if (p < 30)  setStatusMsg('Extracting question text (free)...');
            else if (p < 80)  setStatusMsg('Vision: detecting correct answers per page...');
            else if (p < 90)  setStatusMsg('Tagging subjects & topics with AI...');
            else              setStatusMsg('Storing to database...');
          } else {
            if (p < 15)       setStatusMsg('Extracting text from PDF...');
            else if (p < 25)  setStatusMsg('Parsing questions with regex...');
            else if (p < 50)  setStatusMsg('Vision recovery for missing questions...');
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

  const handleSubmit = async () => {
    if (!file || !examName.trim() || !year) return;
    if (mode === 'answer_key' && !akFile) return;
    setError('');
    setPhase('uploading');
    setStatusMsg('Uploading PDF...');
    setProgress(0);

    const form = new FormData();
    form.append('file', file);
    form.append('exam_name', examName.trim());
    form.append('exam_year', year);
    form.append('series', series.trim());
    form.append('use_vision', mode === 'visual' ? 'true' : 'false');
    form.append('is_cbt', mode === 'cbt' ? 'true' : 'false');
    if (mode === 'cbt' && shiftLabel.trim()) {
      form.append('shift_label_override', shiftLabel.trim());
    }
    if (mode === 'answer_key' && akFile) {
      form.append('answer_key_file', akFile);
    }

    try {
      const res = await fetch('http://localhost:8000/admin/upload-pdf', {
        method: 'POST',
        headers: { 'x-admin-key': ADMIN_KEY },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || JSON.stringify(data));
      setProgress(5);
      pollJob(data.job_id);
    } catch (e: any) {
      setPhase('error');
      setError(e.message || 'Upload failed');
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

            {mode === 'answer_key' && (
              <div>
                <label style={labelStyle}>Answer Key PDF</label>
                <FileZone
                  f={akFile}
                  onDrop={e => handleDrop(e, 'ak')}
                  onClick={() => akFileRef.current?.click()}
                  label="Drop answer key PDF here"
                  hint="Text or scanned — any format supported"
                />
              </div>
            )}
          </div>

          {/* Form fields */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Exam Name</label>
              <input type="text" value={examName} onChange={e => setExamName(e.target.value)}
                placeholder='e.g. "APPSC Group II Mains Paper I"'
                style={inputStyle} disabled={phase !== 'idle'} />
            </div>
            <div>
              <label style={labelStyle}>Year</label>
              <input type="number" value={year} onChange={e => setYear(e.target.value)}
                style={inputStyle} disabled={phase !== 'idle'} min={2000} max={2035} />
            </div>
            <div>
              <label style={labelStyle}>Series (optional)</label>
              <input type="text" value={series} onChange={e => setSeries(e.target.value)}
                placeholder="A / B / C" style={inputStyle} disabled={phase !== 'idle'} />
            </div>

            {mode === 'cbt' && (
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Shift Label Override (optional)</label>
                <input type="text" value={shiftLabel} onChange={e => setShiftLabel(e.target.value)}
                  placeholder='e.g. "Shift 1" or "24/08/2025 Morning" — leave blank for auto-detect'
                  style={inputStyle} disabled={phase !== 'idle'} />
              </div>
            )}
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
              <button onClick={onClose} disabled={phase === 'uploading' || phase === 'processing'}
                style={{ padding: '9px 20px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 13, fontWeight: 600, color: C.textSec, cursor: 'pointer', opacity: (phase === 'uploading' || phase === 'processing') ? 0.4 : 1 }}>
                Cancel
              </button>
              <button onClick={handleSubmit} disabled={!canSubmit}
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
