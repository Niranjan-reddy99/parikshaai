# UPSC AI Strategy Engine

An AI-powered preparation platform for India's civil services examinations. Aggregates question banks across commissions and years, surfaces concept patterns, and generates personalised study strategy reports using Gemini.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (React SPA)                       │
│  React 19 · TypeScript · Vite · Tailwind · Firebase Auth        │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP / fetch
           ┌─────────────────┴─────────────────┐
           ▼                                   ▼
┌──────────────────────┐           ┌───────────────────────┐
│   Express Server     │           │   FastAPI Backend      │
│   server.ts :4000    │           │   backend/main.py :8000│
│                      │           │                        │
│  · Serves Vite build │           │  · Question CRUD       │
│  · /api/generate-    │           │  · User attempts       │
│    report (Gemini)   │           │  · PDF ingestion       │
│  · /api/chat         │           │  · Explanation gen     │
│  · PDF proxy / OCR   │           │  · Admin management    │
└──────────────────────┘           └──────────┬────────────┘
                                              │
                             ┌────────────────┴────────────────┐
                             ▼                                  ▼
                  ┌─────────────────────┐         ┌────────────────────┐
                  │  Supabase Postgres  │         │  Firebase          │
                  │                     │         │                    │
                  │  · questions        │         │  · Firestore       │
                  │  · explanations     │         │    (user profiles) │
                  │  · jobs (async)     │         │  · Auth (Google    │
                  │  · repair_queue     │         │    OAuth + JWT)    │
                  └─────────────────────┘         └────────────────────┘
```

### Data Flow: PDF → Question Bank

```
PDF Upload (admin only)
  → Stage 1: Pre-processing   deskew · denoise · contrast
  → Stage 2: OCR              Tesseract + PyMuPDF hybrid
  → Stage 3: Layout Analysis  columns · tables · match-the-following
  → Stage 4: Question Parser  regex + structural heuristics
  → Stage 5: AI Tagging       subject / topic / difficulty  (gemini-flash-8b, batched)
  → Stage 6: Validation       completeness checks
  → Stage 7: Auto-Repair      retry at 600 DPI · AI fallback · needs_review flag
  → Stage 8: DB Insert        idempotent via SHA-256 question_hash
```

---

## Technology Stack

| Layer | Technologies |
|---|---|
| Frontend | React 19, TypeScript, Vite 7, Tailwind CSS 4, Motion (Framer), Recharts |
| Server | Node.js / Express 4, tsx, Firebase Admin SDK |
| Backend | Python 3.13, FastAPI, Pydantic v2, httpx |
| AI | Gemini 2.0 Flash (reports/chat), Gemini Flash 8b (tagging/explanations) |
| OCR | Tesseract 5 + PyMuPDF (hybrid) |
| Database | Supabase PostgreSQL (RLS), Firebase Firestore |
| Auth | Firebase Authentication (Google OAuth → JWT) |
| Deployment | Railway (Dockerfile per service), GitHub Actions (CI) |

---

## Repository Structure

```
upsc-ai-strategy-engine/
│
├── src/                          # React frontend
│   ├── App.tsx                   # Root — all shared state + view router
│   ├── main.tsx                  # React entry point (PWA enabled)
│   ├── index.css                 # Global styles + responsive breakpoints
│   │
│   ├── views/                    # One file per screen
│   │   ├── LandingPage.tsx       # Public marketing page
│   │   ├── DashboardView.tsx     # Personalised stats + performance
│   │   ├── HomeView.tsx          # Commission / exam picker
│   │   ├── CommissionView.tsx    # Commission-level overview
│   │   ├── ExamDetailView.tsx    # Exam metadata, subject breakdown
│   │   │   └── exam-detail/      # Sub-components (header, tabs, etc.)
│   │   ├── PracticeView.tsx      # Adaptive practice session
│   │   │   └── practice/         # PracticeFocusBar, PracticeNavRow
│   │   ├── MockView.tsx          # Timed mock exam simulator
│   │   │   └── mock/             # MockTopBar, MockNavRow
│   │   ├── ResultsView.tsx       # Post-session results + breakdown
│   │   ├── ReportView.tsx        # AI-generated strategy report
│   │   ├── BrowseView.tsx        # Browse all questions by topic
│   │   ├── FeedView.tsx          # Trending subtopics + recency feed
│   │   ├── BadgesView.tsx        # Achievement system
│   │   ├── BookmarksView.tsx     # Saved questions
│   │   ├── ProfileView.tsx       # User profile + performance history
│   │   ├── PatternPracticeView.tsx  # Pattern-tagged targeted practice
│   │   └── LeaderboardView.tsx   # Ranking + referral
│   │
│   ├── components/
│   │   ├── Navbar.tsx            # Top navigation bar
│   │   ├── QuestionModal.tsx     # Question detail overlay
│   │   ├── OnboardingModal.tsx   # First-run setup flow
│   │   ├── PremiumGateModal.tsx  # Feature gate
│   │   ├── FlagQuestionModal.tsx # User-reported issue
│   │   ├── Toast.tsx             # Notification toasts
│   │   ├── ErrorBoundary.tsx     # React error boundary
│   │   └── admin/                # Admin-only modals
│   │       ├── EditQuestionModal.tsx
│   │       ├── UploadPaperModal.tsx
│   │       ├── DeleteExamModal.tsx
│   │       ├── RenameModal.tsx
│   │       ├── CostModal.tsx
│   │       ├── AdminFlagsModal.tsx
│   │       └── AdminAuditPanel.tsx
│   │
│   ├── lib/
│   │   ├── api.ts                # Public API calls to FastAPI backend
│   │   ├── adminApi.ts           # Admin endpoints (requires API key)
│   │   ├── utils.ts              # cn(), normalizeSubject(), shared helpers
│   │   ├── examUtils.ts          # Exam name parsing + commission mapping
│   │   ├── stats.ts              # localStorage-backed session statistics
│   │   ├── tokens.ts             # Design token constants (colors, spacing)
│   │   ├── questionCache.ts      # In-memory question cache
│   │   ├── questionAnswers.ts    # Answer persistence helpers
│   │   ├── bookmarks.ts          # Bookmark read/write
│   │   ├── topicTaxonomy.ts      # Subject → topic → subtopic tree
│   │   ├── QuestionText.tsx      # Renders question text with LaTeX/formatting
│   │   ├── firebase.ts           # Firebase Auth instance
│   │   └── firebaseConfig.ts     # Firebase SDK config
│   │
│   └── types/
│       └── index.ts              # Canonical TypeScript types
│                                 # (Question, View, ExamSession, CommissionMap…)
│
├── backend/                      # Python FastAPI backend
│   ├── main.py                   # API server — all endpoints
│   ├── models.py                 # Pydantic schemas (request/response)
│   ├── config.py                 # Supabase + Firebase Admin SDK setup
│   ├── ai_models.py              # Gemini client wrappers
│   │
│   ├── extractor/
│   │   ├── universal_extractor.py   # PRIMARY: vision-based PDF extractor
│   │   ├── answer_key_parser.py     # Standalone answer-key PDF parser
│   │   └── vision_extractor.py      # Legacy fallback vision extractor
│   │
│   ├── pipeline.py               # Legacy PDF pipeline (replaced by extractor/)
│   ├── generate_all_explanations.py  # Bulk-generate missing explanations
│   ├── repair_explanations.py    # Re-generate bad explanations
│   ├── parse_and_ingest.py       # Import clean text files → questions
│   ├── inject_answers.py         # AI-infer missing correct answers
│   ├── repair_missing.py         # Re-extract missing question numbers
│   ├── canonical_taxonomy.py     # Subject/topic normalisation rules
│   ├── pattern_classifier.py     # Tag questions with cognitive patterns
│   ├── row_quality.py            # Per-row quality scoring
│   │
│   ├── cache/                    # SHA-256-keyed extraction cache (free re-runs)
│   ├── snapshots/                # Point-in-time DB snapshots
│   ├── archive/                  # Dead/one-off scripts (do not import)
│   └── schema.sql                # Supabase table definitions
│
├── server.ts                     # Express: Vite middleware + /api/* routes
├── vite.config.ts                # Vite + React + Tailwind + PWA
├── Dockerfile                    # Python FastAPI service
├── Dockerfile.student            # Node.js student frontend
├── Dockerfile.admin              # Node.js admin panel
├── railway.toml                  # Railway deployment config
└── package.json                  # Node dependencies + npm scripts
```

---

## API Reference

### Public Endpoints (no auth)

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | API status + version |
| `GET` | `/questions` | Paginated questions — filter by `exam`, `year`, `subject`, `topic`, `difficulty` |
| `GET` | `/questions/{id}` | Single question with answer |
| `GET` | `/explanation/{id}` | Lazy-loaded explanation (generated on first request) |
| `GET` | `/practice` | Random questions for practice session |
| `GET` | `/stats` | Aggregate dashboard statistics |

### Auth Required (Firebase JWT → `Authorization: Bearer <token>`)

| Method | Path | Description |
|---|---|---|
| `POST` | `/attempt` | Record a user's answer attempt |

### Admin Only (`X-Admin-Key: <ADMIN_API_KEY>`)

| Method | Path | Description |
|---|---|---|
| `POST` | `/admin/upload-pdf` | Upload PDF → trigger ingestion pipeline |
| `GET` | `/admin/questions` | All questions including inactive |
| `PATCH` | `/admin/questions/{id}` | Edit question / toggle `is_active` |
| `DELETE` | `/admin/questions/{id}` | Hard delete |

### Express Server (`/api/*`)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/generate-report` | Generate AI strategy report (Gemini 2.0 Flash) |
| `POST` | `/api/chat` | Streaming chat (Gemini 2.0 Flash) |

---

## Local Development

### Prerequisites

- Node.js 20+
- Python 3.11+
- Tesseract 5 (`brew install tesseract` on macOS)

### Frontend + Express

```bash
# Install dependencies
npm install

# Start dev server (http://localhost:4000)
npm run dev

# Type check
npm run lint

# Production build
npm run build
```

### Python Backend

```bash
cd backend

# Create and activate virtual environment
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Start FastAPI (http://localhost:8000)
uvicorn main:app --reload --port 8000
```

---

## Environment Variables

### `.env.local` (frontend + Express server)

```bash
GEMINI_API_KEY=          # Gemini API key for report generation and chat
APP_URL=                 # Public app URL (e.g. http://localhost:4000)
```

### `backend/.env` (FastAPI)

```bash
SUPABASE_URL=            # Supabase project URL
SUPABASE_SERVICE_KEY=    # Service-role key (bypasses RLS — keep secret)
FIREBASE_PROJECT_ID=     # Firebase project ID for token verification
ADMIN_API_KEY=           # Secret key required for all /admin/* endpoints

# Vertex AI (required for all Gemini calls in Python)
GOOGLE_CLOUD_PROJECT=    # GCP project ID
GOOGLE_CLOUD_LOCATION=   # GCP region (default: us-central1)
GOOGLE_APPLICATION_CREDENTIALS=  # Path to GCP service account JSON
```

> Never hardcode secrets. Use `os.getenv("KEY")` in Python, `process.env.KEY` in Node.

---

## Database Schema (Supabase)

Key tables — see [`backend/schema.sql`](backend/schema.sql) for full definitions.

| Table | Purpose |
|---|---|
| `questions` | Primary question store — all metadata, options, answer, tags |
| `explanations` | Lazy-generated explanations (separate to avoid bloating question rows) |
| `jobs` | Async PDF processing job queue |
| `repair_queue` | Questions flagged for manual or automated repair |
| `attempts` | Per-user answer attempts (linked via Firebase UID) |

Deduplication key: `question_hash` (SHA-256 of normalised question text + exam + year). All ingestion is idempotent.

---

## Key Design Decisions

**Inline styles + CSS class overrides** — React components use inline styles for component-level tokens. Responsive overrides in `src/index.css` use named CSS classes with `!important` to win specificity at `@media (max-width: 640px)`. This avoids rebuilding every component with prop-based responsive logic while keeping tokens centrally managed.

**Lazy explanations** — Explanations are generated by Gemini only when a user first views them, not during PDF ingestion. This keeps ingestion cost near zero and caps explanation cost to demand.

**SHA-256 deduplication** — Every question is hashed before insert. Re-running the pipeline on the same PDF is free and idempotent.

**Admin-only writes** — No public upload surface. All PDF processing is gated behind `X-Admin-Key`. The extraction cache in `backend/cache/` means repeated admin runs cost nothing.

**Question types** — The parser handles MCQ, Match-the-Following (stored as structured JSON), Assertion-Reason, Statement-based, and passage-linked questions. Each type has its own validation and repair path.

---

## Deployment (Railway)

Three separate Railway services, each with its own Dockerfile:

| Service | Dockerfile | Port |
|---|---|---|
| Python API | `Dockerfile` | `$PORT` (default 8000) |
| Student frontend | `Dockerfile.student` | `$PORT` (default 3000) |
| Admin panel | `Dockerfile.admin` | `$PORT` (default 3000) |

Deploys trigger automatically on push to `main`. No manual steps required after `git push`.

---

## Navigation Flow

```
Landing → Dashboard
                └── Home (commission picker)
                         └── Commission overview
                                  └── Exam Detail
                                           ├── Practice (adaptive)
                                           ├── Mock (timed)
                                           └── Browse (topic view)
                                                    └── Results → Report (AI)
```

Side routes accessible from Navbar: Feed · Badges · Bookmarks · Profile · Leaderboard
