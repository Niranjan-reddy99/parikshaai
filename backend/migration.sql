-- ============================================================
-- MIGRATION: Add is_active and update schema
-- Run this in Supabase SQL Editor if you already ran the old schema
-- ============================================================

-- Step 1: Add is_active column
ALTER TABLE questions ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS paper_id UUID;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS structural_status VARCHAR(30) DEFAULT 'valid';
ALTER TABLE questions ADD COLUMN IF NOT EXISTS answer_status VARCHAR(30) DEFAULT 'unknown';
ALTER TABLE questions ADD COLUMN IF NOT EXISTS explanation_status VARCHAR(30) DEFAULT 'missing';
ALTER TABLE questions ADD COLUMN IF NOT EXISTS public_visibility VARCHAR(30) DEFAULT 'visible';
ALTER TABLE questions ADD COLUMN IF NOT EXISTS primary_issue_code VARCHAR(100) DEFAULT NULL;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS issue_codes JSONB DEFAULT '[]'::jsonb;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS tagging_status VARCHAR(30) DEFAULT 'weak';
ALTER TABLE questions ADD COLUMN IF NOT EXISTS review_required BOOLEAN DEFAULT TRUE;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS confidence_score INTEGER DEFAULT 0;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS canonical_subject VARCHAR(100);
ALTER TABLE questions ADD COLUMN IF NOT EXISTS canonical_topic_family VARCHAR(200);
ALTER TABLE questions ADD COLUMN IF NOT EXISTS canonical_subtopic_family VARCHAR(200);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS paper_id UUID;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pdf_path TEXT;

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

-- Partial composite indexes (only scan active rows = faster)
CREATE INDEX IF NOT EXISTS idx_q_subject_year ON questions(subject, exam_year) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_q_subject_topic ON questions(subject, topic) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_q_canonical_subject_year ON questions(canonical_subject, exam_year) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_q_canonical_subject_topic ON questions(canonical_subject, canonical_topic_family) WHERE is_active = TRUE;
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
    supersedes_paper_id     UUID DEFAULT NULL,
    replacement_paper_id    UUID DEFAULT NULL,
    last_job_id             UUID DEFAULT NULL,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(exam_name, exam_year, upload_version)
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'papers_supersedes_fk') THEN
        ALTER TABLE papers
            ADD CONSTRAINT papers_supersedes_fk
            FOREIGN KEY (supersedes_paper_id) REFERENCES papers(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'papers_replacement_fk') THEN
        ALTER TABLE papers
            ADD CONSTRAINT papers_replacement_fk
            FOREIGN KEY (replacement_paper_id) REFERENCES papers(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'questions_paper_fk') THEN
        ALTER TABLE questions
            ADD CONSTRAINT questions_paper_fk
            FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_paper_fk') THEN
        ALTER TABLE jobs
            ADD CONSTRAINT jobs_paper_fk
            FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_papers_key_version ON papers(paper_key, upload_version);
CREATE INDEX IF NOT EXISTS idx_papers_exam ON papers(exam_name, exam_year);
CREATE INDEX IF NOT EXISTS idx_papers_status ON papers(lifecycle_status, publish_status);
CREATE INDEX IF NOT EXISTS idx_jobs_paper ON jobs(paper_id);

ALTER TABLE papers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin access papers" ON papers;
CREATE POLICY "Admin access papers" ON papers FOR ALL USING (auth.role() = 'service_role');

DROP TRIGGER IF EXISTS trigger_papers_updated ON papers;
CREATE TRIGGER trigger_papers_updated
    BEFORE UPDATE ON papers
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

INSERT INTO papers (
    exam_name,
    exam_year,
    display_name,
    paper_key,
    source_filename,
    upload_version,
    lifecycle_status,
    publish_status,
    question_count,
    visible_question_count,
    hidden_question_count,
    structural_issue_count,
    created_at,
    updated_at
)
SELECT
    grouped.exam_name,
    grouped.exam_year,
    grouped.exam_name,
    lower(regexp_replace(grouped.exam_name, '\s+', ' ', 'g')) || '::' || grouped.exam_year::text,
    grouped.source_filename,
    1,
    CASE WHEN grouped.question_count > 0 THEN 'ingested' ELSE 'pending' END,
    CASE WHEN grouped.hidden_question_count > 0 THEN 'publishable_with_hidden_rows'
         WHEN grouped.question_count > 0 THEN 'publishable'
         ELSE 'draft'
    END,
    grouped.question_count,
    grouped.visible_question_count,
    grouped.hidden_question_count,
    grouped.hidden_question_count,
    grouped.created_at,
    NOW()
FROM (
    SELECT
        q.exam_name,
        q.exam_year,
        MAX(q.source_pdf) AS source_filename,
        COUNT(*) AS question_count,
        COUNT(*) FILTER (WHERE q.is_active = TRUE) AS visible_question_count,
        COUNT(*) FILTER (WHERE q.is_active = FALSE) AS hidden_question_count,
        MIN(q.created_at) AS created_at
    FROM questions q
    GROUP BY q.exam_name, q.exam_year
    UNION
    SELECT
        j.exam_name,
        j.exam_year,
        MAX(j.filename) AS source_filename,
        0 AS question_count,
        0 AS visible_question_count,
        0 AS hidden_question_count,
        MIN(j.created_at) AS created_at
    FROM jobs j
    GROUP BY j.exam_name, j.exam_year
) grouped
ON CONFLICT (exam_name, exam_year, upload_version) DO NOTHING;

UPDATE questions q
SET paper_id = p.id
FROM papers p
WHERE q.paper_id IS NULL
  AND p.exam_name = q.exam_name
  AND p.exam_year = q.exam_year
  AND p.upload_version = 1;

UPDATE questions
SET
    structural_status = CASE
        WHEN question_text IS NULL OR length(trim(question_text)) < 15 THEN 'broken'
        WHEN coalesce(option_a, '') = '' OR coalesce(option_b, '') = '' OR coalesce(option_c, '') = '' OR coalesce(option_d, '') = '' THEN 'broken'
        ELSE 'valid'
    END,
    answer_status = CASE
        WHEN upper(coalesce(correct_answer, '')) NOT IN ('A', 'B', 'C', 'D') THEN 'invalid'
        WHEN needs_review = TRUE THEN 'ai_inferred'
        ELSE 'verified'
    END,
    explanation_status = CASE
        WHEN EXISTS (
            SELECT 1 FROM explanations e WHERE e.question_id = questions.id
        ) THEN 'generated'
        ELSE 'missing'
    END,
    tagging_status = CASE
        WHEN coalesce(subject, '') IN ('', 'Unclassified', 'General Knowledge')
          OR coalesce(topic, '') IN ('', 'Unclassified', 'General')
          THEN 'weak'
        WHEN coalesce(subtopic, '') = '' THEN 'partial'
        ELSE 'strong'
    END,
    review_required = CASE
        WHEN is_active = FALSE THEN TRUE
        WHEN question_text IS NULL OR length(trim(question_text)) < 15 THEN TRUE
        WHEN coalesce(option_a, '') = '' OR coalesce(option_b, '') = '' OR coalesce(option_c, '') = '' OR coalesce(option_d, '') = '' THEN TRUE
        WHEN upper(coalesce(correct_answer, '')) NOT IN ('A', 'B', 'C', 'D') THEN TRUE
        WHEN needs_review = TRUE THEN TRUE
        WHEN coalesce(subject, '') IN ('', 'Unclassified', 'General Knowledge') THEN TRUE
        WHEN coalesce(topic, '') IN ('', 'Unclassified', 'General') THEN TRUE
        ELSE FALSE
    END,
    confidence_score = GREATEST(0, LEAST(100,
        100
        - CASE WHEN question_text IS NULL OR length(trim(question_text)) < 15 THEN 35 ELSE 0 END
        - CASE WHEN coalesce(option_a, '') = '' OR coalesce(option_b, '') = '' OR coalesce(option_c, '') = '' OR coalesce(option_d, '') = '' THEN 35 ELSE 0 END
        - CASE WHEN upper(coalesce(correct_answer, '')) NOT IN ('A', 'B', 'C', 'D') THEN 30 ELSE 0 END
        - CASE WHEN needs_review = TRUE THEN 8 ELSE 0 END
        - CASE WHEN coalesce(subject, '') IN ('', 'Unclassified', 'General Knowledge') THEN 8 ELSE 0 END
        - CASE WHEN coalesce(topic, '') IN ('', 'Unclassified', 'General') THEN 6 ELSE 0 END
        - CASE WHEN coalesce(subtopic, '') = '' THEN 3 ELSE 0 END
    )),
    public_visibility = CASE
        WHEN is_active = FALSE THEN 'hidden_admin'
        WHEN question_text IS NULL OR length(trim(question_text)) < 15 THEN 'hidden_structural'
        WHEN coalesce(option_a, '') = '' OR coalesce(option_b, '') = '' OR coalesce(option_c, '') = '' OR coalesce(option_d, '') = '' THEN 'hidden_structural'
        ELSE 'visible'
    END,
    primary_issue_code = CASE
        WHEN question_text IS NULL OR length(trim(question_text)) < 15 THEN 'short-or-empty-text'
        WHEN coalesce(option_a, '') = '' OR coalesce(option_b, '') = '' OR coalesce(option_c, '') = '' OR coalesce(option_d, '') = '' THEN 'incomplete-options'
        WHEN needs_review = TRUE THEN 'answer-review'
        WHEN upper(coalesce(correct_answer, '')) NOT IN ('A', 'B', 'C', 'D') THEN 'invalid-answer'
        ELSE NULL
    END,
    issue_codes = CASE
        WHEN question_text IS NULL OR length(trim(question_text)) < 15 THEN '["short-or-empty-text"]'::jsonb
        WHEN coalesce(option_a, '') = '' OR coalesce(option_b, '') = '' OR coalesce(option_c, '') = '' OR coalesce(option_d, '') = '' THEN '["incomplete-options"]'::jsonb
        WHEN needs_review = TRUE THEN '["answer-review"]'::jsonb
        WHEN upper(coalesce(correct_answer, '')) NOT IN ('A', 'B', 'C', 'D') THEN '["invalid-answer"]'::jsonb
        ELSE '[]'::jsonb
    END;

UPDATE jobs j
SET paper_id = p.id
FROM papers p
WHERE j.paper_id IS NULL
  AND p.exam_name = j.exam_name
  AND p.exam_year = j.exam_year
  AND p.upload_version = 1;

-- Step 7b: Add question_number column (for answer-key injection)
ALTER TABLE questions ADD COLUMN IF NOT EXISTS question_number INTEGER DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_q_num ON questions(exam_name, exam_year, question_number) WHERE is_active = TRUE;

-- Step 7c: Add needs_review column (TRUE = AI-guessed, FALSE = verified from answer key)
ALTER TABLE questions ADD COLUMN IF NOT EXISTS needs_review BOOLEAN DEFAULT TRUE;

-- Step 7d: Create answer_keys table (persists uploaded answer keys for replay)
CREATE TABLE IF NOT EXISTS answer_keys (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    exam_name   VARCHAR(200) NOT NULL,
    exam_year   INTEGER NOT NULL,
    answer_map  JSONB NOT NULL,
    source      VARCHAR(500) DEFAULT 'user_upload',
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(exam_name, exam_year)
);

DROP TRIGGER IF EXISTS trigger_answer_keys_updated ON answer_keys;
CREATE TRIGGER trigger_answer_keys_updated
    BEFORE UPDATE ON answer_keys
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE answer_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin access answer_keys" ON answer_keys;
CREATE POLICY "Admin access answer_keys" ON answer_keys FOR ALL USING (auth.role() = 'service_role');

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

ALTER TABLE question_repairs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin access question_repairs" ON question_repairs;
CREATE POLICY "Admin access question_repairs" ON question_repairs FOR ALL USING (auth.role() = 'service_role');

DROP TRIGGER IF EXISTS trigger_question_repairs_updated ON question_repairs;
CREATE TRIGGER trigger_question_repairs_updated
    BEFORE UPDATE ON question_repairs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

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


-- Step 8: Add has_image and image_url columns for visual question support
-- Also create Supabase Storage bucket 'question-images' with public access via the dashboard
ALTER TABLE questions ADD COLUMN IF NOT EXISTS has_image BOOLEAN DEFAULT FALSE;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS image_url TEXT;
CREATE INDEX IF NOT EXISTS idx_q_has_image ON questions(has_image) WHERE has_image = TRUE AND is_active = TRUE;

-- Step 9: Scanned PDFs & Multi-Correct (JEE/NEET)
ALTER TABLE questions ADD COLUMN IF NOT EXISTS student_answer TEXT;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS has_key BOOLEAN DEFAULT TRUE;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS correct_answers TEXT[];
ALTER TABLE questions ADD COLUMN IF NOT EXISTS question_type_v2 TEXT; -- MCQ | MULTI | NAT | DESCRIPTIVE
