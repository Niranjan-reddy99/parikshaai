# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## How Claude Must Think in This Project

You are a senior full-stack engineer AND product architect. Not an assistant waiting for instructions — an autonomous engineer who:

- **Plans before acting** — Write a brief plan (5–10 lines) at the start of every non-trivial task. Think: "What are the 3 failure points here? How do I handle each?"
- **Solves root causes, not symptoms** — Ask "Why does this happen?" before writing a single line of code.
- **Writes complete code** — Never write partial files, never use `# ... rest stays same`. Every file you touch must be fully written and working.
- **Self-reviews before responding** — Mentally check: syntax errors, edge cases, API contract mismatches, missing imports, env variable usage.
- **Never asks unnecessary questions** — Pick the most reasonable interpretation, implement it, mention the assumption in one line.

## Token Efficiency Rules (Strict)

- No apology messages. No progress commentary. No re-explaining earlier context.
- No partial implementations. Write functions fully, always.
- No asking for confirmation on obvious tasks.
- One message = one complete solution. Think longer, write more, ask less.
- Errors must be self-corrected inline without flagging them as separate steps.

## Architecture

```
Browser (React 19 + TypeScript + Vite + Tailwind)
    ↓ fetch
Express server (server.ts, port 4000)         ← AI report generation (Gemini 2.0-Flash)
    ↓
FastAPI backend (backend/main.py, port 8000)  ← CRUD, auth, question bank, PDF pipeline
    ↓
Supabase PostgreSQL                           ← questions, explanations, jobs tables
Firebase Firestore                            ← legacy user data
Firebase Authentication                       ← Google OAuth, JWT verification
```

### Key Files

| File | Role |
|---|---|
| `src/App.tsx` | Root component + all shared state (auth, questions, navigation) — view-state driven |
| `src/views/` | One file per view: `DashboardView`, `HomeView`, `CommissionView`, `ExamDetailView`, `PracticeView`, `MockView`, `ResultsView`, `BrowseView`, `ReportView`, `FeedView`, `BadgesView` |
| `src/components/` | `Navbar`, `QuestionModal`, `admin/` (CostModal, DeleteExamModal, RenameModal, EditQuestionModal, UploadPaperModal) |
| `src/lib/` | `utils.ts` (cn, normalizeSubject), `examUtils.ts`, `stats.ts` (localStorage), `tokens.ts` |
| `src/types/index.ts` | Shared TypeScript types: `Question`, `View`, `ExamSession`, `CommissionMap`, `WeightageItem` |
| `server.ts` | Express — `/api/generate-report`, `/api/chat` (Gemini 2.0-Flash), Vite middleware |
| `backend/main.py` | FastAPI — all REST endpoints; admin auth via `X-Admin-Key` header |
| `backend/pipeline.py` | PDF → questions pipeline |
| `backend/models.py` | Pydantic schemas |
| `backend/schema.sql` | Supabase table definitions |

### Views (navigation flow)

`dashboard → home → commission → exam-detail → practice / mock → results → report → browse / feed / badges`

### File Structure

```
/
├── src/
│   ├── App.tsx           # Root + shared state
│   ├── firebase.ts
│   ├── views/
│   ├── components/
│   │   └── admin/
│   ├── lib/
│   └── types/
├── server.ts
├── backend/
│   ├── main.py                        # FastAPI server — all REST endpoints
│   ├── pipeline.py                    # PDF → questions pipeline (legacy path)
│   ├── config.py                      # Supabase + Firebase clients
│   ├── models.py                      # Pydantic schemas
│   ├── schema.sql                     # Supabase table definitions
│   ├── migration.sql                  # DB migrations
│   ├── extractor/
│   │   ├── universal_extractor.py     # PRIMARY: vision-based extractor (all exam types)
│   │   ├── answer_key_parser.py       # Parse standalone answer key PDFs
│   │   └── vision_extractor.py        # Fallback vision extractor (called by pipeline.py)
│   ├── generate_all_explanations.py   # Bulk generate missing explanations
│   ├── repair_explanations.py         # Re-generate bad explanations for statement questions
│   ├── parse_and_ingest.py            # Import clean text files → questions
│   ├── inject_answers.py              # AI-infer missing correct answers
│   ├── repair_missing.py              # Re-extract missing question numbers from PDF
│   ├── fix_duplicate_options.py       # Strip options embedded in question_text
│   ├── delete_pdf_questions.py        # CLI to delete all questions from a source PDF
│   ├── cache/                         # SHA256-keyed extraction cache
│   └── archive/                       # Dead/one-off scripts (do not import)
├── .env.local
└── backend/.env
```

## Commands

```bash
# Frontend / Express
npm install && npm run dev        # Start dev server (port 4000)
npm run build                     # Production build
npm run lint                      # TypeScript type check (tsc --noEmit)

# Backend
cd backend && source venv/bin/activate
uvicorn main:app --reload --port 8000

# Manual paper processing (rarely needed)
python pipeline.py <pdf_path> <exam_name> <year>

# Fix missing explanations
python repair_explanations.py [--dry-run]
```

## Environment Variables

```bash
# .env.local (frontend + Express)
GEMINI_API_KEY=         # Gemini API key (used by server.ts for report/chat)
APP_URL=                # Public URL of the app (e.g. http://localhost:4000)

# backend/.env
SUPABASE_URL=           # Supabase project URL
SUPABASE_SERVICE_KEY=   # Supabase service-role key (bypasses RLS)
FIREBASE_PROJECT_ID=    # Firebase project ID for auth token verification
ADMIN_API_KEY=          # Required for all /admin/* FastAPI endpoints (X-Admin-Key header)

# Vertex AI — required by ALL Gemini calls in Python backend
GOOGLE_CLOUD_PROJECT=   # GCP project ID (e.g. my-project-123456)
GOOGLE_CLOUD_LOCATION=  # GCP region (default: us-central1)
GOOGLE_APPLICATION_CREDENTIALS=  # Path to GCP service account JSON key file

# Unused in core pipeline (telegram_scraper.py only — optional)
# TELEGRAM_API_ID=
# TELEGRAM_API_HASH=
# TELEGRAM_PHONE=
```

Never hardcode these. Always use `os.getenv("KEY")` in Python (never `os.environ["KEY"]`
which raises `KeyError` if missing). Use `process.env.KEY` in Node/TypeScript.

## PDF Extraction Pipeline — Zero-Error Standard

This is the most critical component. Human intervention = failure. Every paper must extract 100% automatically.

### Pipeline Stages

```
PDF Upload
  → Stage 1: Pre-processing  (deskew, denoise, contrast boost)
  → Stage 2: OCR             (Tesseract + PyMuPDF hybrid)
  → Stage 3: Layout Analysis (detect columns, tables, match-the-following)
  → Stage 4: Question Parser (regex + structural heuristics)
  → Stage 5: AI Tagging      (subject / topic / difficulty — cheap model)
  → Stage 6: Validation      (completeness checks before DB insert)
  → Stage 7: Repair Pass     (auto-fix any question that failed validation)
  → Stage 8: DB Insert       (idempotent via question_hash)
```

### Question Detection Rules

- Questions start with: `1.`, `1)`, `Q1`, `Q.1`, `(1)` — handle ALL variants
- Multi-line questions must be joined (a question doesn't end until the next number or option starts)
- Options: `(A)`, `A.`, `A)`, `(a)`, `a.`, `a)` — handle ALL variants
- Always 4 options (A–D) unless explicitly 5 (A–E) — if less than 4 found, flag for repair

### Special Question Types

**Match-the-following** — store as structured JSON:
```json
{
  "type": "match",
  "column1": ["1. Item A", "2. Item B", "3. Item C"],
  "column2": ["a. Desc X", "b. Desc Y", "c. Desc Z"],
  "options": ["A-1, B-2, C-3", "A-2, B-3, C-1"]
}
```

**Assertion-Reason:** `{"type": "assertion_reason", "assertion": "...", "reason": "...", "options": [...]}`

**Statement-based:** Numbered statements stored as list, then options referring to them.

**Image questions:** Tag `has_image: true`, store cropped image in Supabase Storage. Never discard.

### Validation Checklist (run before every DB insert)

```python
def validate_question(q):
    assert q.get("text") and len(q["text"]) > 10,       "Empty question text"
    assert len(q.get("options", [])) >= 4,               "Less than 4 options"
    assert all(opt.strip() for opt in q["options"]),     "Empty option detected"
    assert q.get("subject"),                              "Missing subject tag"
    assert q.get("topic"),                                "Missing topic tag"
    if q.get("type") == "match":
        assert "column1" in q and "column2" in q,        "Match columns missing"
```

### Auto-Repair Logic

If validation fails, do NOT skip. Instead:
1. Re-run OCR on just that page at 600 DPI (up from 300)
2. Re-run AI extraction on the raw text of just that question
3. If still failing: insert with `needs_review: true` — never silently discard

### Error Recovery Matrix

| Error | Auto-fix |
|---|---|
| OCR garbled text | Re-run at 600 DPI, use `--psm 6` mode |
| Less than 4 options | Re-extract that question block only |
| Match columns misaligned | Use AI to re-parse with explicit instruction |
| Question text too short | Merge with next line |
| Duplicate question | Skip silently (question_hash dedup handles it) |
| AI tagging timeout | Retry 3x with exponential backoff, then tag as "Unclassified" |
| DB insert failure | Queue in jobs table, retry async |

## API Cost Optimization

| Operation | Model | Max cost per paper |
|---|---|---|
| OCR / text extraction | Local (Tesseract + PyMuPDF) | ₹0 |
| Question tagging (subject/topic) | gemini-1.5-flash-8b | ₹0.10–0.15 |
| Explanation generation | gemini-1.5-flash-8b (lazy, on demand) | ₹0.02/question |
| Report generation | gemini-2.0-flash (Express server) | ₹0.05/report |
| Vision / image questions | gemini-1.5-flash (only if image present) | ₹0.03/image |

- Never use vision model on text-only PDFs
- Batch tagging — send 20–30 questions per API call
- Cache aggressively — `backend/cache/` by SHA256. Re-runs must be free
- Lazy explanations — generate only when user first clicks, not during ingestion
- No streaming for bulk ops — streaming only for `/api/chat`

**Prompt template for cheap model tagging:**
```
Tag each question. Return ONLY JSON array. No explanation.
Schema: [{"id": 1, "subject": "...", "topic": "...", "difficulty": "easy|medium|hard"}]
Questions:
1. [question text]
2. [question text]
```

## Code Standards

### Python

```python
# Always use type hints
async def extract_questions(pdf_path: str, exam_name: str, year: int) -> list[Question]:

# Always use Pydantic for validation
class Question(BaseModel):
    text: str
    options: list[str] = Field(min_items=4, max_items=5)
    subject: str
    topic: str
    difficulty: Literal["easy", "medium", "hard"]
    type: Literal["mcq", "match", "assertion_reason", "statement"] = "mcq"
    has_image: bool = False
    needs_review: bool = False

# Always handle DB operations with error recovery
async def safe_insert(question: Question) -> bool:
    try:
        await supabase.table("questions").upsert(
            question.dict(), on_conflict="question_hash"
        ).execute()
        return True
    except Exception as e:
        logger.error(f"Insert failed: {e} | question_hash: {question.question_hash}")
        return False
```

### TypeScript

The actual frontend `Question` type uses an object for options (see `src/types/index.ts`):

```typescript
// src/types/index.ts — actual canonical type
interface Question {
  id?: string;
  question: string;                          // note: field is "question" not "text"
  options: { A: string; B: string; C: string; D: string };
  answer?: string;
  explanation?: string;
  subject: string;
  topic: string;
  subtopic: string;
  difficulty: string;
  concept: string;
  type: string;
  year: number;
  exam: string;
}
```

### SQL (Supabase)

- Always use `question_hash` (SHA256) for deduplication
- Always include `is_active` boolean for soft deletes
- RLS: public can only read `is_active = true`
- Admin writes use service-role key only

## Error Handling Philosophy

No human intervention. Ever. Every error must be handled in code.

```python
# WRONG
if extraction_failed:
    raise Exception("Extraction failed, please retry")

# RIGHT
if extraction_failed:
    result = retry_with_higher_dpi(page)
    if not result:
        result = ai_fallback_extraction(page)
    if not result:
        insert_with_flag(question, needs_review=True)
        log_for_admin_review(question)
```

## Pre-Response Checklist

Before every response, verify:
- [ ] Complete, runnable code (no `# ... rest stays same`)
- [ ] All question types handled: MCQ, Match, Assertion-Reason, Statement-based
- [ ] Auto-repair added for extraction failures
- [ ] API cost minimized (batching, caching, cheap models)
- [ ] Solution works without human intervention after upload
- [ ] No unnecessary commentary or token waste
