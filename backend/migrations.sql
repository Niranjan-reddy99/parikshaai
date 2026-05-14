-- ── Pariksha — Trust Layer Migrations ────────────────────────────────────────
-- Run these in your Supabase SQL editor (Dashboard → SQL Editor → New query)
-- All statements are idempotent: safe to re-run.

-- ── 1. Question flags table ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS question_flags (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  question_id uuid REFERENCES questions(id) ON DELETE CASCADE,
  user_id     text,
  flag_type   text CHECK (flag_type IN ('wrong_answer', 'poor_quality', 'outdated', 'duplicate')),
  note        text,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS question_flags_question_id_idx ON question_flags(question_id);
CREATE INDEX IF NOT EXISTS question_flags_user_id_idx    ON question_flags(user_id);

-- ── 2. Questions table — new columns ─────────────────────────────────────────
ALTER TABLE questions ADD COLUMN IF NOT EXISTS source           text;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS flag_count       int  DEFAULT 0;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS quality_score    float;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS trap_type        text;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS trap_confidence  float;

-- ── 3. Deduplication — trigram similarity (Priority 3 prep) ──────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS questions_trgm_idx ON questions USING gin(question_text gin_trgm_ops);

-- ── 4. Performance indexes ────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_questions_exam_year
  ON questions(exam_name, exam_year) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_questions_subject
  ON questions(subject) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_explanations_question_id
  ON explanations(question_id);

CREATE INDEX IF NOT EXISTS idx_srs_user_due
  ON srs_schedule(firebase_uid, due_date);
