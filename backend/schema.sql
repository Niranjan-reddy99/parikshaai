-- ============================================================
-- UPSC AI Strategy Engine — Supabase PostgreSQL Schema
-- Admin-Only Architecture: Data managed centrally, users consume
-- ============================================================
-- Run this in Supabase SQL Editor
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. PAPERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS papers (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    exam_name               VARCHAR(200) NOT NULL,
    exam_year               INTEGER NOT NULL,
    display_name            VARCHAR(200) DEFAULT NULL,
    paper_key               VARCHAR(255) NOT NULL,
    source_filename         VARCHAR(500) DEFAULT NULL,
    source_file_hash        VARCHAR(64) DEFAULT NULL,
    source_pdf_path         TEXT DEFAULT NULL,
    extractor_type          VARCHAR(50) DEFAULT NULL,
    upload_version          INTEGER NOT NULL DEFAULT 1,
    lifecycle_status        VARCHAR(30) NOT NULL DEFAULT 'pending',
    publish_status          VARCHAR(40) NOT NULL DEFAULT 'draft',
    question_count          INTEGER NOT NULL DEFAULT 0,
    visible_question_count  INTEGER NOT NULL DEFAULT 0,
    hidden_question_count   INTEGER NOT NULL DEFAULT 0,
    structural_issue_count  INTEGER NOT NULL DEFAULT 0,
    supersedes_paper_id     UUID DEFAULT NULL REFERENCES papers(id) ON DELETE SET NULL,
    replacement_paper_id    UUID DEFAULT NULL REFERENCES papers(id) ON DELETE SET NULL,
    last_job_id             UUID DEFAULT NULL,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(exam_name, exam_year, upload_version)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_papers_key_version ON papers(paper_key, upload_version);
CREATE INDEX IF NOT EXISTS idx_papers_exam ON papers(exam_name, exam_year);
CREATE INDEX IF NOT EXISTS idx_papers_status ON papers(lifecycle_status, publish_status);

-- ============================================================
-- 2. QUESTIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS questions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    paper_id         UUID DEFAULT NULL REFERENCES papers(id) ON DELETE SET NULL,
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
    canonical_subject VARCHAR(100) DEFAULT NULL,
    canonical_topic_family VARCHAR(200) DEFAULT NULL,
    canonical_subtopic_family VARCHAR(200) DEFAULT NULL,
    difficulty      VARCHAR(10) NOT NULL DEFAULT 'Medium' CHECK (difficulty IN ('Easy', 'Medium', 'Hard')),
    question_type   VARCHAR(50) DEFAULT 'MCQ',
    concept         VARCHAR(300) DEFAULT NULL,
    pattern_tag     VARCHAR(100) DEFAULT NULL,
    trap_tag        VARCHAR(100) DEFAULT NULL,
    skill_tag       VARCHAR(100) DEFAULT NULL,
    question_style  VARCHAR(100) DEFAULT NULL,
    pattern_confidence INTEGER DEFAULT NULL,
    pattern_source  VARCHAR(30) DEFAULT NULL,
    pattern_reason  TEXT DEFAULT NULL,
    solve_hint      TEXT DEFAULT NULL,
    pattern_tagged_at TIMESTAMPTZ DEFAULT NULL,
    
    -- Exam metadata
    exam_name       VARCHAR(200) NOT NULL,
    exam_year       INTEGER NOT NULL,
    source_pdf      VARCHAR(500) DEFAULT NULL,
    
    -- Admin control
    is_active       BOOLEAN DEFAULT TRUE,  -- Deactivate bad questions without deleting
    structural_status VARCHAR(30) DEFAULT 'valid',
    answer_status     VARCHAR(30) DEFAULT 'unknown',
    explanation_status VARCHAR(30) DEFAULT 'missing',
    tagging_status    VARCHAR(30) DEFAULT 'weak',
    review_required   BOOLEAN DEFAULT TRUE,
    confidence_score  INTEGER DEFAULT 0,
    public_visibility VARCHAR(30) DEFAULT 'visible',
    practice_ready    BOOLEAN DEFAULT FALSE,
    primary_issue_code VARCHAR(100) DEFAULT NULL,
    issue_codes      JSONB DEFAULT '[]'::jsonb,
    
    -- Deduplication
    question_hash   VARCHAR(64) UNIQUE NOT NULL,
    
    -- Timestamps
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3. EXPLANATIONS TABLE (lazy-loaded, saves bandwidth)
-- ============================================================
CREATE TABLE IF NOT EXISTS explanations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    question_id     UUID NOT NULL UNIQUE REFERENCES questions(id) ON DELETE CASCADE,
    explanation     TEXT NOT NULL,
    source          VARCHAR(500) DEFAULT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 4. INDEXES (optimized for 3-5 lakh questions)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_q_subject ON questions(subject);
CREATE INDEX IF NOT EXISTS idx_q_topic ON questions(topic);
CREATE INDEX IF NOT EXISTS idx_q_pattern_tag ON questions(pattern_tag) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_q_trap_tag ON questions(trap_tag) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_q_skill_tag ON questions(skill_tag) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_q_canonical_subject ON questions(canonical_subject);
CREATE INDEX IF NOT EXISTS idx_q_canonical_topic_family ON questions(canonical_topic_family);
CREATE INDEX IF NOT EXISTS idx_q_canonical_subtopic_family ON questions(canonical_subtopic_family);
CREATE INDEX IF NOT EXISTS idx_q_year ON questions(exam_year);
CREATE INDEX IF NOT EXISTS idx_q_difficulty ON questions(difficulty);
CREATE INDEX IF NOT EXISTS idx_q_exam ON questions(exam_name);
CREATE INDEX IF NOT EXISTS idx_q_paper ON questions(paper_id);
CREATE INDEX IF NOT EXISTS idx_q_active ON questions(is_active);
CREATE INDEX IF NOT EXISTS idx_q_hash ON questions(question_hash);
CREATE INDEX IF NOT EXISTS idx_q_structural_status ON questions(structural_status);
CREATE INDEX IF NOT EXISTS idx_q_answer_status ON questions(answer_status);
CREATE INDEX IF NOT EXISTS idx_q_explanation_status ON questions(explanation_status);
CREATE INDEX IF NOT EXISTS idx_q_tagging_status ON questions(tagging_status);
CREATE INDEX IF NOT EXISTS idx_q_review_required ON questions(review_required);
CREATE INDEX IF NOT EXISTS idx_q_confidence_score ON questions(confidence_score);
CREATE INDEX IF NOT EXISTS idx_q_public_visibility ON questions(public_visibility);
CREATE INDEX IF NOT EXISTS idx_q_practice_ready ON questions(practice_ready);

-- Composite indexes for common filter combos
CREATE INDEX IF NOT EXISTS idx_q_subject_year ON questions(subject, exam_year) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_q_subject_topic ON questions(subject, topic) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_q_canonical_subject_year ON questions(canonical_subject, exam_year) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_q_canonical_subject_topic ON questions(canonical_subject, canonical_topic_family) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_q_subject_diff ON questions(subject, difficulty) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_q_exam_year ON questions(exam_name, exam_year) WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_exp_qid ON explanations(question_id);

-- ============================================================
-- 5. AUTO-UPDATE TRIGGER
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

DROP TRIGGER IF EXISTS trigger_papers_updated ON papers;
CREATE TRIGGER trigger_papers_updated
    BEFORE UPDATE ON papers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 6. ROW LEVEL SECURITY
-- Public read (only active questions), service_role write
-- ============================================================
ALTER TABLE papers ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE explanations ENABLE ROW LEVEL SECURITY;

-- Users can only read ACTIVE questions
CREATE POLICY "Public read active questions"
    ON questions FOR SELECT USING (is_active = TRUE);

CREATE POLICY "Public read explanations"
    ON explanations FOR SELECT USING (true);

CREATE POLICY "Admin access papers"
    ON papers FOR ALL USING (auth.role() = 'service_role');

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
-- 7. HELPER: get_subject_counts RPC
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
-- 8. HELPER: get_random_questions RPC (fast random fetch)
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
-- 9. QUESTIONS TABLE — ADDITIONAL COLUMNS (added via migration)
-- ============================================================
-- These columns are added by migration.sql after initial schema creation:
--   question_number  INTEGER  — position in the original exam paper (1-based)
--   needs_review     BOOLEAN  — TRUE = AI-guessed answer (can be overridden)
--                               FALSE = verified from uploaded answer key (immutable)
--
-- ALTER TABLE questions ADD COLUMN IF NOT EXISTS question_number INTEGER;
-- ALTER TABLE questions ADD COLUMN IF NOT EXISTS needs_review BOOLEAN DEFAULT TRUE;

-- ============================================================
-- 10. ANSWER KEYS TABLE (persisted answer key for replay)
-- ============================================================
CREATE TABLE IF NOT EXISTS answer_keys (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    exam_name   VARCHAR(200) NOT NULL,
    exam_year   INTEGER NOT NULL,
    answer_map  JSONB NOT NULL,          -- {"1": "A", "2": "C", ...} — int keys as strings
    source      VARCHAR(500) DEFAULT 'user_upload',
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(exam_name, exam_year)
);

CREATE TRIGGER trigger_answer_keys_updated
    BEFORE UPDATE ON answer_keys
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE answer_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin access answer_keys" ON answer_keys FOR ALL USING (auth.role() = 'service_role');

-- ============================================================
-- 11. QUESTION REPAIRS TABLE (AUDITABLE AI REPAIR PROPOSALS)
-- ============================================================
CREATE TABLE IF NOT EXISTS question_repairs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    question_id     UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    paper_id        UUID DEFAULT NULL REFERENCES papers(id) ON DELETE SET NULL,
    repair_type     VARCHAR(50) NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'proposed',
    proposed_patch  JSONB NOT NULL,
    evidence        JSONB DEFAULT '{}'::jsonb,
    source          VARCHAR(100) DEFAULT 'explanation_ai',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_question_repairs_question ON question_repairs(question_id);
CREATE INDEX IF NOT EXISTS idx_question_repairs_status ON question_repairs(status, repair_type);

DROP TRIGGER IF EXISTS trigger_question_repairs_updated ON question_repairs;
CREATE TRIGGER trigger_question_repairs_updated
    BEFORE UPDATE ON question_repairs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE question_repairs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin access question_repairs"
    ON question_repairs FOR ALL USING (auth.role() = 'service_role');

-- ============================================================
-- 12. JOBS TABLE (ASYNC QUEUE)
-- ============================================================
CREATE TABLE IF NOT EXISTS jobs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    paper_id         UUID DEFAULT NULL REFERENCES papers(id) ON DELETE SET NULL,
    filename        VARCHAR(500) NOT NULL,
    file_hash       VARCHAR(64) UNIQUE NOT NULL,
    exam_name       VARCHAR(200) NOT NULL,
    exam_year       INTEGER NOT NULL,
    pdf_path        TEXT DEFAULT NULL,
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

CREATE INDEX IF NOT EXISTS idx_jobs_paper ON jobs(paper_id);

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin access jobs" ON jobs FOR ALL USING (auth.role() = 'service_role');
