-- ============================================================
-- UPSC AI Strategy Engine — Supabase PostgreSQL Schema
-- Admin-Only Architecture: Data managed centrally, users consume
-- ============================================================
-- Run this in Supabase SQL Editor
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. QUESTIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS questions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    question_text   TEXT NOT NULL,
    option_a        TEXT NOT NULL,
    option_b        TEXT NOT NULL,
    option_c        TEXT NOT NULL,
    option_d        TEXT NOT NULL,
    correct_answer  CHAR(1) NOT NULL CHECK (correct_answer IN ('A', 'B', 'C', 'D')),
    
    -- Classification (AI-tagged)
    subject         VARCHAR(100) NOT NULL,
    topic           VARCHAR(200) NOT NULL DEFAULT 'General',
    subtopic        VARCHAR(200) DEFAULT NULL,
    difficulty      VARCHAR(10) NOT NULL DEFAULT 'Medium' CHECK (difficulty IN ('Easy', 'Medium', 'Hard')),
    question_type   VARCHAR(50) DEFAULT 'MCQ',
    concept         VARCHAR(300) DEFAULT NULL,
    
    -- Exam metadata
    exam_name       VARCHAR(200) NOT NULL,
    exam_year       INTEGER NOT NULL,
    source_pdf      VARCHAR(500) DEFAULT NULL,
    
    -- Admin control
    is_active       BOOLEAN DEFAULT TRUE,  -- Deactivate bad questions without deleting
    
    -- Deduplication
    question_hash   VARCHAR(64) UNIQUE NOT NULL,
    
    -- Timestamps
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 2. EXPLANATIONS TABLE (lazy-loaded, saves bandwidth)
-- ============================================================
CREATE TABLE IF NOT EXISTS explanations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    question_id     UUID NOT NULL UNIQUE REFERENCES questions(id) ON DELETE CASCADE,
    explanation     TEXT NOT NULL,
    source          VARCHAR(500) DEFAULT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3. INDEXES (optimized for 3-5 lakh questions)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_q_subject ON questions(subject);
CREATE INDEX IF NOT EXISTS idx_q_topic ON questions(topic);
CREATE INDEX IF NOT EXISTS idx_q_year ON questions(exam_year);
CREATE INDEX IF NOT EXISTS idx_q_difficulty ON questions(difficulty);
CREATE INDEX IF NOT EXISTS idx_q_exam ON questions(exam_name);
CREATE INDEX IF NOT EXISTS idx_q_active ON questions(is_active);
CREATE INDEX IF NOT EXISTS idx_q_hash ON questions(question_hash);

-- Composite indexes for common filter combos
CREATE INDEX IF NOT EXISTS idx_q_subject_year ON questions(subject, exam_year) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_q_subject_topic ON questions(subject, topic) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_q_subject_diff ON questions(subject, difficulty) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_q_exam_year ON questions(exam_name, exam_year) WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_exp_qid ON explanations(question_id);

-- ============================================================
-- 4. AUTO-UPDATE TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_questions_updated
    BEFORE UPDATE ON questions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 5. ROW LEVEL SECURITY
-- Public read (only active questions), service_role write
-- ============================================================
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE explanations ENABLE ROW LEVEL SECURITY;

-- Users can only read ACTIVE questions
CREATE POLICY "Public read active questions"
    ON questions FOR SELECT USING (is_active = TRUE);

CREATE POLICY "Public read explanations"
    ON explanations FOR SELECT USING (true);

-- Only backend (service_role) can write
CREATE POLICY "Admin insert questions"
    ON questions FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Admin update questions"
    ON questions FOR UPDATE USING (auth.role() = 'service_role');
CREATE POLICY "Admin delete questions"
    ON questions FOR DELETE USING (auth.role() = 'service_role');
CREATE POLICY "Admin insert explanations"
    ON explanations FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Admin update explanations"
    ON explanations FOR UPDATE USING (auth.role() = 'service_role');

-- ============================================================
-- 6. HELPER: get_subject_counts RPC
-- ============================================================
CREATE OR REPLACE FUNCTION get_subject_counts()
RETURNS TABLE(subject TEXT, count BIGINT) AS $$
    SELECT subject::TEXT, COUNT(*) as count
    FROM questions
    WHERE is_active = TRUE
    GROUP BY subject
    ORDER BY count DESC;
$$ LANGUAGE sql STABLE;

-- ============================================================
-- 7. HELPER: get_random_questions RPC (fast random fetch)
-- ============================================================
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

-- ============================================================
-- 8. JOBS TABLE (ASYNC QUEUE)
-- ============================================================
CREATE TABLE IF NOT EXISTS jobs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    filename        VARCHAR(500) NOT NULL,
    file_hash       VARCHAR(64) UNIQUE NOT NULL,
    exam_name       VARCHAR(200) NOT NULL,
    exam_year       INTEGER NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    progress        INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    error_log       TEXT DEFAULT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger for updated_at
CREATE TRIGGER trigger_jobs_updated
    BEFORE UPDATE ON jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin access jobs" ON jobs FOR ALL USING (auth.role() = 'service_role');
