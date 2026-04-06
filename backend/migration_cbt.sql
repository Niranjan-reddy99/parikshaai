-- ============================================================
-- MIGRATION: CBT shift metadata + needs_review column
-- Run this in Supabase SQL Editor ONCE before using cbt_pipeline.py
-- ============================================================

-- Shift/slot metadata (for multi-shift CBT exams like AP High Court, SSC)
ALTER TABLE questions ADD COLUMN IF NOT EXISTS shift_label  VARCHAR(100) DEFAULT NULL;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS test_date    VARCHAR(20)  DEFAULT NULL;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS test_time    VARCHAR(50)  DEFAULT NULL;

-- Exam section within the paper (e.g. "General Knowledge", "General English")
ALTER TABLE questions ADD COLUMN IF NOT EXISTS exam_section VARCHAR(100) DEFAULT NULL;

-- Flag for questions needing manual review (missing answer, bad OCR, etc.)
ALTER TABLE questions ADD COLUMN IF NOT EXISTS needs_review BOOLEAN DEFAULT FALSE;

-- Passage text for reading-comprehension questions (shared across Q-group)
ALTER TABLE questions ADD COLUMN IF NOT EXISTS passage TEXT DEFAULT NULL;

-- Index for filtering by shift
CREATE INDEX IF NOT EXISTS idx_q_shift ON questions(exam_name, exam_year, shift_label)
    WHERE is_active = TRUE;

-- Index for needs_review queue (admin dashboard use)
CREATE INDEX IF NOT EXISTS idx_q_needs_review ON questions(needs_review)
    WHERE needs_review = TRUE AND is_active = TRUE;
