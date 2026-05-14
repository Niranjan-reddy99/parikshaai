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
ALTER TABLE questions ADD COLUMN IF NOT EXISTS practice_ready BOOLEAN DEFAULT FALSE;
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
CREATE INDEX IF NOT EXISTS idx_q_practice_ready ON questions(practice_ready);

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

-- Step 5b: Normalize and deduplicate legacy paper rows before adding unique indexes.
-- Older environments may already contain duplicate `(paper_key, upload_version)` rows
-- from pre-normalized uploads or repeated migration attempts.
UPDATE papers
SET paper_key = lower(regexp_replace(coalesce(exam_name, ''), '\s+', ' ', 'g')) || '::' || exam_year::text
WHERE coalesce(paper_key, '') = ''
   OR paper_key <> lower(regexp_replace(coalesce(exam_name, ''), '\s+', ' ', 'g')) || '::' || exam_year::text;

WITH ranked_papers AS (
    SELECT
        id,
        paper_key,
        upload_version,
        ROW_NUMBER() OVER (
            PARTITION BY paper_key, upload_version
            ORDER BY
                COALESCE(question_count, 0) DESC,
                COALESCE(visible_question_count, 0) DESC,
                COALESCE(hidden_question_count, 0) DESC,
                COALESCE(updated_at, created_at, NOW()) DESC,
                created_at DESC,
                id DESC
        ) AS rank_in_group
    FROM papers
),
paper_dupes AS (
    SELECT
        ranked.id AS duplicate_id,
        keeper.id AS keeper_id
    FROM ranked_papers ranked
    JOIN ranked_papers keeper
      ON keeper.paper_key = ranked.paper_key
     AND keeper.upload_version = ranked.upload_version
     AND keeper.rank_in_group = 1
    WHERE ranked.rank_in_group > 1
)
UPDATE questions q
SET paper_id = d.keeper_id
FROM paper_dupes d
WHERE q.paper_id = d.duplicate_id;

WITH ranked_papers AS (
    SELECT
        id,
        paper_key,
        upload_version,
        ROW_NUMBER() OVER (
            PARTITION BY paper_key, upload_version
            ORDER BY
                COALESCE(question_count, 0) DESC,
                COALESCE(visible_question_count, 0) DESC,
                COALESCE(hidden_question_count, 0) DESC,
                COALESCE(updated_at, created_at, NOW()) DESC,
                created_at DESC,
                id DESC
        ) AS rank_in_group
    FROM papers
),
paper_dupes AS (
    SELECT
        ranked.id AS duplicate_id,
        keeper.id AS keeper_id
    FROM ranked_papers ranked
    JOIN ranked_papers keeper
      ON keeper.paper_key = ranked.paper_key
     AND keeper.upload_version = ranked.upload_version
     AND keeper.rank_in_group = 1
    WHERE ranked.rank_in_group > 1
)
UPDATE jobs j
SET paper_id = d.keeper_id
FROM paper_dupes d
WHERE j.paper_id = d.duplicate_id;

WITH ranked_papers AS (
    SELECT
        id,
        paper_key,
        upload_version,
        ROW_NUMBER() OVER (
            PARTITION BY paper_key, upload_version
            ORDER BY
                COALESCE(question_count, 0) DESC,
                COALESCE(visible_question_count, 0) DESC,
                COALESCE(hidden_question_count, 0) DESC,
                COALESCE(updated_at, created_at, NOW()) DESC,
                created_at DESC,
                id DESC
        ) AS rank_in_group
    FROM papers
),
paper_dupes AS (
    SELECT
        ranked.id AS duplicate_id,
        keeper.id AS keeper_id
    FROM ranked_papers ranked
    JOIN ranked_papers keeper
      ON keeper.paper_key = ranked.paper_key
     AND keeper.upload_version = ranked.upload_version
     AND keeper.rank_in_group = 1
    WHERE ranked.rank_in_group > 1
)
UPDATE papers p
SET supersedes_paper_id = d.keeper_id
FROM paper_dupes d
WHERE p.supersedes_paper_id = d.duplicate_id;

WITH ranked_papers AS (
    SELECT
        id,
        paper_key,
        upload_version,
        ROW_NUMBER() OVER (
            PARTITION BY paper_key, upload_version
            ORDER BY
                COALESCE(question_count, 0) DESC,
                COALESCE(visible_question_count, 0) DESC,
                COALESCE(hidden_question_count, 0) DESC,
                COALESCE(updated_at, created_at, NOW()) DESC,
                created_at DESC,
                id DESC
        ) AS rank_in_group
    FROM papers
),
paper_dupes AS (
    SELECT
        ranked.id AS duplicate_id,
        keeper.id AS keeper_id
    FROM ranked_papers ranked
    JOIN ranked_papers keeper
      ON keeper.paper_key = ranked.paper_key
     AND keeper.upload_version = ranked.upload_version
     AND keeper.rank_in_group = 1
    WHERE ranked.rank_in_group > 1
)
UPDATE papers p
SET replacement_paper_id = d.keeper_id
FROM paper_dupes d
WHERE p.replacement_paper_id = d.duplicate_id;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'question_repairs'
    ) THEN
        WITH ranked_papers AS (
            SELECT
                id,
                paper_key,
                upload_version,
                ROW_NUMBER() OVER (
                    PARTITION BY paper_key, upload_version
                    ORDER BY
                        COALESCE(question_count, 0) DESC,
                        COALESCE(visible_question_count, 0) DESC,
                        COALESCE(hidden_question_count, 0) DESC,
                        COALESCE(updated_at, created_at, NOW()) DESC,
                        created_at DESC,
                        id DESC
                ) AS rank_in_group
            FROM papers
        ),
        paper_dupes AS (
            SELECT
                ranked.id AS duplicate_id,
                keeper.id AS keeper_id
            FROM ranked_papers ranked
            JOIN ranked_papers keeper
              ON keeper.paper_key = ranked.paper_key
             AND keeper.upload_version = ranked.upload_version
             AND keeper.rank_in_group = 1
            WHERE ranked.rank_in_group > 1
        )
        UPDATE question_repairs qr
        SET paper_id = d.keeper_id
        FROM paper_dupes d
        WHERE qr.paper_id = d.duplicate_id;
    END IF;
END $$;

WITH ranked_papers AS (
    SELECT
        id,
        paper_key,
        upload_version,
        ROW_NUMBER() OVER (
            PARTITION BY paper_key, upload_version
            ORDER BY
                COALESCE(question_count, 0) DESC,
                COALESCE(visible_question_count, 0) DESC,
                COALESCE(hidden_question_count, 0) DESC,
                COALESCE(updated_at, created_at, NOW()) DESC,
                created_at DESC,
                id DESC
        ) AS rank_in_group
    FROM papers
)
DELETE FROM papers p
USING ranked_papers ranked
WHERE p.id = ranked.id
  AND ranked.rank_in_group > 1;

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

-- ============================================================
-- Step 10: PATTERN INTELLIGENCE LAYER (Priority 2 — USP)
-- ============================================================
ALTER TABLE questions ADD COLUMN IF NOT EXISTS pattern_type TEXT;        -- e.g. "fact_recall", "elimination", "conceptual", "current_affairs"
ALTER TABLE questions ADD COLUMN IF NOT EXISTS examiner_trap TEXT;       -- e.g. "close_dates", "similar_names", "negation"
ALTER TABLE questions ADD COLUMN IF NOT EXISTS syllabus_link TEXT;       -- e.g. "GS-I: Ancient History > Indus Valley"
ALTER TABLE questions ADD COLUMN IF NOT EXISTS why_asked TEXT;           -- one-line examiner intent
ALTER TABLE questions ADD COLUMN IF NOT EXISTS pattern_cluster_id UUID;  -- FK → pattern_clusters
ALTER TABLE questions ADD COLUMN IF NOT EXISTS trend_direction TEXT;     -- "rising" | "stable" | "falling"
ALTER TABLE questions ADD COLUMN IF NOT EXISTS pattern_tagged_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_q_pattern_type ON questions(pattern_type) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_q_pattern_cluster ON questions(pattern_cluster_id) WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS pattern_clusters (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_type               TEXT,
    subject                 TEXT,
    pattern_name            TEXT NOT NULL,
    pattern_description     TEXT,
    question_count          INTEGER DEFAULT 0,
    representative_question_id UUID REFERENCES questions(id) ON DELETE SET NULL,
    created_at              TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE pattern_clusters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read pattern_clusters" ON pattern_clusters;
CREATE POLICY "Public read pattern_clusters" ON pattern_clusters FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admin write pattern_clusters" ON pattern_clusters;
CREATE POLICY "Admin write pattern_clusters" ON pattern_clusters FOR ALL USING (auth.role() = 'service_role');

-- ============================================================
-- Step 11: USER PROGRESS PERSISTENCE (Priority 3)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_attempts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firebase_uid    TEXT NOT NULL,
    question_id     UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    selected_answer CHAR(1),
    is_correct      BOOLEAN NOT NULL,
    time_taken_s    INTEGER DEFAULT 0,
    exam_name       TEXT,
    subject         TEXT,
    topic           TEXT,
    attempted_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ua_uid ON user_attempts(firebase_uid, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_ua_qid ON user_attempts(question_id);

ALTER TABLE user_attempts ENABLE ROW LEVEL SECURITY;
-- Users can only read/write their own rows
DROP POLICY IF EXISTS "Users read own attempts" ON user_attempts;
CREATE POLICY "Users read own attempts" ON user_attempts FOR SELECT USING (true);
DROP POLICY IF EXISTS "Users insert own attempts" ON user_attempts;
CREATE POLICY "Users insert own attempts" ON user_attempts FOR INSERT WITH CHECK (true);

-- Materialised stats cache (updated on each attempt)
CREATE TABLE IF NOT EXISTS user_stats_cache (
    firebase_uid    TEXT PRIMARY KEY,
    by_subject      JSONB DEFAULT '{}'::jsonb,
    streak          INTEGER DEFAULT 0,
    last_active     DATE,
    xp              INTEGER DEFAULT 0,
    total_answered  INTEGER DEFAULT 0,
    daily_activity  JSONB DEFAULT '{}'::jsonb,
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_stats_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own stats cache" ON user_stats_cache;
CREATE POLICY "Users read own stats cache" ON user_stats_cache FOR SELECT USING (true);
DROP POLICY IF EXISTS "Users write own stats cache" ON user_stats_cache;
CREATE POLICY "Users write own stats cache" ON user_stats_cache FOR ALL USING (true);

-- ============================================================
-- Step 12: SRS SCHEDULE TABLE (Priority 4)
-- ============================================================
CREATE TABLE IF NOT EXISTS srs_schedule (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firebase_uid    TEXT NOT NULL,
    question_id     UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    due_date        DATE NOT NULL DEFAULT CURRENT_DATE,
    interval_days   INTEGER DEFAULT 1,
    ease_factor     FLOAT DEFAULT 2.5,
    repetitions     INTEGER DEFAULT 0,
    last_quality    INTEGER,        -- SM-2 quality rating 0-5
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(firebase_uid, question_id)
);

CREATE INDEX IF NOT EXISTS idx_srs_uid_due ON srs_schedule(firebase_uid, due_date);
CREATE INDEX IF NOT EXISTS idx_srs_qid ON srs_schedule(question_id);

DROP TRIGGER IF EXISTS trigger_srs_updated ON srs_schedule;
CREATE TRIGGER trigger_srs_updated
    BEFORE UPDATE ON srs_schedule
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE srs_schedule ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users access own srs" ON srs_schedule;
CREATE POLICY "Users access own srs" ON srs_schedule FOR ALL USING (true);

-- ============================================================
-- Step 13: BOOKMARKS TABLE (Priority 5)
-- ============================================================
CREATE TABLE IF NOT EXISTS bookmarks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firebase_uid    TEXT NOT NULL,
    question_id     UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    note            TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(firebase_uid, question_id)
);

CREATE INDEX IF NOT EXISTS idx_bm_uid ON bookmarks(firebase_uid, created_at DESC);

ALTER TABLE bookmarks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users access own bookmarks" ON bookmarks;
CREATE POLICY "Users access own bookmarks" ON bookmarks FOR ALL USING (true);

-- ============================================================
-- Step 14: PATTERN TAGGING FOUNDATION (Phase 2)
-- ============================================================

-- Pattern tag columns on questions
ALTER TABLE questions ADD COLUMN IF NOT EXISTS pattern_tag    VARCHAR(100) DEFAULT NULL;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS trap_tag       VARCHAR(100) DEFAULT NULL;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS skill_tag      VARCHAR(100) DEFAULT NULL;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS question_style VARCHAR(100) DEFAULT NULL;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS pattern_confidence INTEGER DEFAULT NULL;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS pattern_source VARCHAR(30) DEFAULT NULL;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS pattern_reason TEXT DEFAULT NULL;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS solve_hint TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_q_pattern_tag ON questions(pattern_tag) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_q_trap_tag    ON questions(trap_tag)    WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_q_skill_tag   ON questions(skill_tag)   WHERE is_active = TRUE;

-- Weakness-tracking columns on user_attempts
ALTER TABLE user_attempts ADD COLUMN IF NOT EXISTS subtopic    TEXT DEFAULT NULL;
ALTER TABLE user_attempts ADD COLUMN IF NOT EXISTS pattern_tag TEXT DEFAULT NULL;
ALTER TABLE user_attempts ADD COLUMN IF NOT EXISTS mode        VARCHAR(20) DEFAULT 'practice';

CREATE INDEX IF NOT EXISTS idx_ua_pattern ON user_attempts(firebase_uid, pattern_tag);
CREATE INDEX IF NOT EXISTS idx_ua_topic   ON user_attempts(firebase_uid, topic, subtopic);
