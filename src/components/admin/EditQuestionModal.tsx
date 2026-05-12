import React, { useState, useRef } from 'react';
import { motion } from 'motion/react';
import { X, Save, Loader2, Crop as CropIcon, Trash, Upload } from 'lucide-react';
import ReactCrop, { type Crop, type PixelCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { C } from '../../lib/tokens';
import { API_BASE, adminHeaders } from '../../lib/adminApi';
import { type Question } from '../../types';

interface EditQuestionModalProps {
  question: Question;
  onClose: () => void;
  onSaved: (updated: Question) => void | Promise<void>;
  onDeleted?: (question: Question) => void;
}

const DIFFICULTIES = ['Easy', 'Medium', 'Hard'];
const ANSWERS = ['A', 'B', 'C', 'D'];

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: C.bg,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  color: C.text,
  fontSize: 13,
  padding: '9px 12px',
  outline: 'none',
  boxSizing: 'border-box',
  resize: 'vertical' as const,
  fontFamily: 'inherit',
};

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: C.textTert,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: 5,
  display: 'block',
};

export function EditQuestionModal({ question, onClose, onSaved, onDeleted }: EditQuestionModalProps) {
  const [qText, setQText] = useState(question.question || '');
  const [passage, setPassage] = useState(question.passage || '');
  const [optA, setOptA] = useState(question.options?.A || '');
  const [optB, setOptB] = useState(question.options?.B || '');
  const [optC, setOptC] = useState(question.options?.C || '');
  const [optD, setOptD] = useState(question.options?.D || '');
  const [answer, setAnswer] = useState(question.answer || 'A');
  const [subject, setSubject] = useState(question.subject || 'General Knowledge');
  const [topic, setTopic] = useState(question.topic || 'General');
  const [difficulty, setDifficulty] = useState(question.difficulty || 'Medium');
  // Image handling
  const [hasImage, setHasImage] = useState((question as any).has_image || false);
  const [imageUrl, setImageUrl] = useState((question as any).image_url || undefined);
  const [cropMode, setCropMode] = useState(false);
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [savingImage, setSavingImage] = useState(false);
  const [imageVersion, setImageVersion] = useState(() => Date.now());

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDeleteImage = () => {
    // Stage deletion. The server will save this change when 'handleSave' is called.
    setHasImage(false);
    setImageUrl(undefined);
  };

  const handleApplyCrop = async () => {
    if (!completedCrop || !imgRef.current || !question.id || !imageUrl) return;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 30_000);
    try {
      setSavingImage(true);
      setError(null);

      const img = imgRef.current;
      const scaleX = img.naturalWidth / img.width;
      const scaleY = img.naturalHeight / img.height;

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('No 2d context');

      canvas.width = Math.max(1, completedCrop.width * scaleX);
      canvas.height = Math.max(1, completedCrop.height * scaleY);

      // Draw directly from the already-loaded <img> element (crossOrigin="anonymous" is set).
      // This avoids a second network fetch which can hang if Supabase CORS headers
      // weren't included in the browser's cached response.
      ctx.drawImage(
        img,
        completedCrop.x * scaleX,
        completedCrop.y * scaleY,
        completedCrop.width * scaleX,
        completedCrop.height * scaleY,
        0, 0,
        canvas.width, canvas.height,
      );

      let base64Image: string;
      try {
        base64Image = canvas.toDataURL('image/png');
      } catch {
        // Canvas tainted (image loaded without CORS before crossOrigin attr was set).
        // Hard-reload the image fresh with CORS then retry the draw.
        const blob = await fetch(imageUrl, { mode: 'cors', cache: 'reload', signal: abort.signal }).then(r => r.blob());
        const bmp = await createImageBitmap(blob);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bmp, completedCrop.x * scaleX, completedCrop.y * scaleY, completedCrop.width * scaleX, completedCrop.height * scaleY, 0, 0, canvas.width, canvas.height);
        base64Image = canvas.toDataURL('image/png');
      }

      const res = await fetch(`${API_BASE}/admin/questions/${question.id}/image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...adminHeaders() },
        body: JSON.stringify({ base64_image: base64Image }),
        signal: abort.signal,
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setImageUrl(data.image_url);
      setImageVersion(Date.now());
      setHasImage(true);
      setCropMode(false);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setError('Crop upload timed out. Check your connection and try again.');
      } else {
        setError(err.message || 'Crop upload failed');
      }
    } finally {
      clearTimeout(timer);
      setSavingImage(false);
    }
  };

  const handleDelete = async () => {
    if (!question.id) return;
    if (!confirm('Are you sure you want to delete this question forever?')) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/admin/questions/${question.id}`, {
        method: 'DELETE',
        headers: adminHeaders(),
      });
      if (!res.ok) throw new Error(await res.text());
      if (onDeleted) onDeleted(question);
      else onClose();
    } catch (e: any) {
      setError(e.message || 'Delete failed');
      setDeleting(false);
    }
  };

  const handleSave = async () => {
    if (!question.id) { setError('Question has no ID'); return; }
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 30_000);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/admin/questions/${question.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...adminHeaders() },
        body: JSON.stringify({
          question_text: qText.trim(),
          passage: passage.trim(),
          option_a: optA.trim(),
          option_b: optB.trim(),
          option_c: optC.trim(),
          option_d: optD.trim(),
          correct_answer: answer,
          subject: subject.trim(),
          topic: topic.trim(),
          subtopic: question.subtopic || '',
          difficulty,
          is_active: true,
          needs_review: false,
          has_image: hasImage,
          image_url: imageUrl || null
        }),
        signal: abort.signal,
      });
      if (!res.ok) throw new Error(await res.text());
      await Promise.resolve(onSaved({
        ...question,
        question: qText.trim(),
        passage: passage.trim() || undefined,
        options: { A: optA.trim(), B: optB.trim(), C: optC.trim(), D: optD.trim() },
        answer,
        subject: subject.trim(),
        topic: topic.trim(),
        difficulty,
        needs_review: false,
        has_image: hasImage,
        image_url: imageUrl || undefined,
      }));
      onClose();
    } catch (e: any) {
      if (e.name === 'AbortError') {
        setError('Save timed out after 30s. Check your connection and try again.');
      } else {
        setError(e.message || 'Save failed');
      }
    } finally {
      clearTimeout(timer);
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }} />

      <motion.div initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
        style={{ position: 'relative', width: '100%', maxWidth: 680, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 20, overflow: 'hidden', maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 80px rgba(0,0,0,0.7)' }}>

        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <p style={{ fontSize: 14, fontWeight: 800, color: C.text }}>Edit Question</p>
            <p style={{ fontSize: 11, color: C.textTert, marginTop: 2 }}>Admin — changes saved directly to DB</p>
          </div>
          <button onClick={onClose} style={{ padding: 8, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, cursor: 'pointer', color: C.textSec, display: 'flex' }}>
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Passage text */}
          <div>
            <label style={labelStyle}>Passage (Optional)</label>
            <textarea value={passage} onChange={e => setPassage(e.target.value)} rows={3} style={inputStyle} placeholder="Reading comprehension passage text..." />
          </div>

          {/* Question text */}
          <div>
            <label style={labelStyle}>Question Text</label>
            <textarea value={qText} onChange={e => setQText(e.target.value)} rows={4} style={inputStyle} />
          </div>

          {/* Attached Image Section */}
          {hasImage && imageUrl && (
            <div>
               <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                 <label style={{...labelStyle, marginBottom: 0}}>Attached Image</label>
                 {!cropMode && (
                   <div style={{ display: 'flex', gap: 6 }}>
                     <button onClick={() => setCropMode(true)} style={{ background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, color: C.textSec, fontSize: 11, padding: '4px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                       <CropIcon size={12} /> Crop
                     </button>
                     <button onClick={handleDeleteImage} style={{ background: 'transparent', border: `1px solid ${C.danger}40`, borderRadius: 6, color: C.danger, fontSize: 11, padding: '4px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                       <Trash size={12} /> Delete
                     </button>
                   </div>
                 )}
               </div>
               
               <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, background: '#111', padding: 8, overflow: 'hidden' }}>
                 {cropMode ? (
                   <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                     <ReactCrop 
                       crop={crop} 
                       onChange={(_, percentCrop) => setCrop(percentCrop)}
                       onComplete={(c) => setCompletedCrop(c)}
                     >
                       <img ref={imgRef} src={imageUrl} alt="crop src" style={{ maxHeight: 300, maxWidth: '100%' }} crossOrigin="anonymous"/>
                     </ReactCrop>
                     <div style={{ display: 'flex', gap: 8, width: '100%', justifyContent: 'flex-end' }}>
                       <button onClick={() => setCropMode(false)} style={{ padding: '6px 12px', background: 'transparent', color: C.textSec, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                       <button onClick={handleApplyCrop} disabled={savingImage || !completedCrop?.width} style={{ padding: '6px 12px', background: C.accent, color: '#000', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                         {savingImage ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} Apply Crop
                       </button>
                     </div>
                   </div>
                 ) : (
                   <img src={`${imageUrl}?v=${imageVersion}`} alt="Question" style={{ maxWidth: '100%', maxHeight: 200, objectFit: 'contain', margin: '0 auto', display: 'block', borderRadius: 6 }} />
                 )}
               </div>
            </div>
          )}

          {/* Options */}
          <div>
            <label style={labelStyle}>Options</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {([['A', optA, setOptA], ['B', optB, setOptB], ['C', optC, setOptC], ['D', optD, setOptD]] as [string, string, (v: string) => void][]).map(([key, val, setter]) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 800, fontSize: 12,
                    background: answer === key ? C.accent + '20' : C.bg,
                    border: `1.5px solid ${answer === key ? C.accent : C.border}`,
                    color: answer === key ? C.accent : C.textSec,
                  }}>{key}</div>
                  <input
                    type="text" value={val} onChange={e => setter(e.target.value)}
                    style={{ ...inputStyle, resize: 'none', flex: 1 }}
                    placeholder={`Option ${key}`}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Correct answer */}
          <div>
            <label style={labelStyle}>Correct Answer</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {ANSWERS.map(a => (
                <button key={a} onClick={() => setAnswer(a)}
                  style={{ flex: 1, padding: '9px 0', borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: 'pointer', transition: 'all 0.15s',
                    background: answer === a ? C.accent : C.bg,
                    border: `1.5px solid ${answer === a ? C.accent : C.border}`,
                    color: answer === a ? '#000' : C.textSec,
                  }}>{a}</button>
              ))}
            </div>
          </div>

          {/* Metadata row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Subject</label>
              <input type="text" value={subject} onChange={e => setSubject(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Topic</label>
              <input type="text" value={topic} onChange={e => setTopic(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Difficulty</label>
              <select value={difficulty} onChange={e => setDifficulty(e.target.value)}
                style={{ ...inputStyle, cursor: 'pointer', appearance: 'auto' }}>
                {DIFFICULTIES.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>

          {error && (
            <div style={{ padding: '10px 14px', background: '#2E0D0D', border: '1px solid #f43f5e40', borderRadius: 10, fontSize: 12, color: '#f87171' }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 20px', background: C.bg, borderTop: `1px solid ${C.border}`, display: 'flex', gap: 10, justifyContent: 'space-between', flexShrink: 0 }}>
          <button onClick={handleDelete} disabled={deleting || saving}
            style={{ padding: '9px 16px', background: 'transparent', border: `1px solid ${C.danger}50`, borderRadius: 10, fontSize: 13, fontWeight: 600, color: C.danger, cursor: (deleting || saving) ? 'not-allowed' : 'pointer' }}>
            {deleting ? 'Deleting...' : 'Delete Question'}
          </button>
          
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={onClose}
              style={{ padding: '9px 20px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 13, fontWeight: 600, color: C.textSec, cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving || deleting}
              style={{ padding: '9px 22px', background: saving ? C.border : C.accent, border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, color: saving ? C.textSec : '#000', cursor: saving ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              {saving ? <><Loader2 style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} /> Saving...</> : <><Save style={{ width: 14, height: 14 }} /> Save Changes</>}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
