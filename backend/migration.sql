-- ============================================================
-- MIGRATION: Add is_active and update schema
-- Run this in Supabase SQL Editor if you already ran the old schema
-- ============================================================

-- Step 1: Add is_active column
ALTER TABLE questions ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- Step 2: Set all existing questions as active
UPDATE questions SET is_active = TRUE WHERE is_active IS NULL;

-- Step 3: Drop old indexes (if they exist) and recreate
DROP INDEX IF EXISTS idx_questions_subject;
DROP INDEX IF EXISTS idx_questions_topic;
DROP INDEX IF EXISTS idx_questions_exam_year;
DROP INDEX IF EXISTS idx_questions_difficulty;
DROP INDEX IF EXISTS idx_questions_exam_name;
DROP INDEX IF EXISTS idx_questions_hash;
DROP INDEX IF EXISTS idx_questions_subject_year;
DROP INDEX IF EXISTS idx_questions_subject_topic;
DROP INDEX IF EXISTS idx_questions_subject_difficulty;
DROP INDEX IF EXISTS idx_explanations_question;

-- Step 4: Create new indexes
CREATE INDEX IF NOT EXISTS idx_q_subject ON questions(subject);
CREATE INDEX IF NOT EXISTS idx_q_topic ON questions(topic);
CREATE INDEX IF NOT EXISTS idx_q_year ON questions(exam_year);
CREATE INDEX IF NOT EXISTS idx_q_difficulty ON questions(difficulty);
CREATE INDEX IF NOT EXISTS idx_q_exam ON questions(exam_name);
CREATE INDEX IF NOT EXISTS idx_q_active ON questions(is_active);
CREATE INDEX IF NOT EXISTS idx_q_hash ON questions(question_hash);

-- Partial composite indexes (only scan active rows = faster)
CREATE INDEX IF NOT EXISTS idx_q_subject_year ON questions(subject, exam_year) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_q_subject_topic ON questions(subject, topic) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_q_subject_diff ON questions(subject, difficulty) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_q_exam_year ON questions(exam_name, exam_year) WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_exp_qid ON explanations(question_id);

-- Step 5: Auto-update trigger (safe to re-run)
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_questions_updated ON questions;
CREATE TRIGGER trigger_questions_updated
    BEFORE UPDATE ON questions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Step 6: RLS policies (drop old ones first to avoid conflicts)
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE explanations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Questions are publicly readable" ON questions;
DROP POLICY IF EXISTS "Public read active questions" ON questions;
DROP POLICY IF EXISTS "Only backend can insert questions" ON questions;
DROP POLICY IF EXISTS "Only backend can update questions" ON questions;
DROP POLICY IF EXISTS "Admin insert questions" ON questions;
DROP POLICY IF EXISTS "Admin update questions" ON questions;
DROP POLICY IF EXISTS "Admin delete questions" ON questions;

DROP POLICY IF EXISTS "Explanations are publicly readable" ON explanations;
DROP POLICY IF EXISTS "Public read explanations" ON explanations;
DROP POLICY IF EXISTS "Only backend can insert explanations" ON explanations;
DROP POLICY IF EXISTS "Admin insert explanations" ON explanations;
DROP POLICY IF EXISTS "Admin update explanations" ON explanations;

-- Users read only ACTIVE questions
CREATE POLICY "Public read active questions"
    ON questions FOR SELECT USING (is_active = TRUE);

CREATE POLICY "Admin insert questions"
    ON questions FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Admin update questions"
    ON questions FOR UPDATE USING (auth.role() = 'service_role');
CREATE POLICY "Admin delete questions"
    ON questions FOR DELETE USING (auth.role() = 'service_role');

CREATE POLICY "Public read explanations"
    ON explanations FOR SELECT USING (true);
CREATE POLICY "Admin insert explanations"
    ON explanations FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Admin update explanations"
    ON explanations FOR UPDATE USING (auth.role() = 'service_role');

-- Step 7b: Add question_number column (for answer-key injection)
ALTER TABLE questions ADD COLUMN IF NOT EXISTS question_number INTEGER DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_q_num ON questions(exam_name, exam_year, question_number) WHERE is_active = TRUE;

-- Step 7: RPC helper functions
CREATE OR REPLACE FUNCTION get_subject_counts()
RETURNS TABLE(subject TEXT, count BIGINT) AS $$
    SELECT subject::TEXT, COUNT(*) as count
    FROM questions
    WHERE is_active = TRUE
    GROUP BY subject
    ORDER BY count DESC;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION get_random_questions(
    p_subject TEXT DEFAULT NULL,
    p_topic TEXT DEFAULT NULL,
    p_difficulty TEXT DEFAULT NULL,
    p_count INT DEFAULT 10
)
RETURNS SETOF questions AS $$
    SELECT *
    FROM questions
    WHERE is_active = TRUE
      AND (p_subject IS NULL OR subject = p_subject)
      AND (p_topic IS NULL OR topic = p_topic)
      AND (p_difficulty IS NULL OR difficulty = p_difficulty)
    ORDER BY RANDOM()
    LIMIT p_count;
$$ LANGUAGE sql STABLE;
