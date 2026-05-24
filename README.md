# Pariksha — PYQ Intelligence Platform

AI-powered exam preparation for UPSC, TSPSC, APPSC, and other Indian PSC exams. Aggregates official PYQ question banks, surfaces topic patterns, and tracks your preparation progress.

**Live:** [parikshaai.vercel.app](https://parikshaai.vercel.app)

---

## Architecture

```
Browser (React 19 + TypeScript + Vite + Tailwind)
    │
    ├── /api/* ──► Vercel Serverless Functions (AI report, chat)
    │               uses Gemini 2.0 Flash
    │
    └── API_BASE ──► FastAPI Backend (Render.com)
                     backend/main.py
                         │
                         ├── Supabase PostgreSQL  ← questions, papers, jobs
                         └── Firebase Auth        ← user identity, JWT verification
```

---

## Repository Structure

```
/
├── src/                          # React frontend
│   ├── App.tsx                   # Root — shared state, auth, navigation
│   ├── views/                    # One file per page/view
│   ├── components/               # Shared UI components
│   │   ├── admin/                # Admin-only modals and panels
│   │   ├── skeletons/            # Loading state components
│   │   └── ui/                   # Reusable primitives (Button, Card…)
│   ├── contexts/                 # Auth, Catalog, Exam React contexts
│   ├── lib/                      # Utilities (api.ts, stats.ts, tokens.ts…)
│   └── types/                    # Shared TypeScript types
│
├── api/                          # Vercel serverless functions
│   ├── generate-report.ts        # POST /api/generate-report (Gemini)
│   ├── chat.ts                   # POST /api/chat (Gemini)
│   ├── health.ts                 # GET /api/health
│   └── _lib/auth.ts              # Shared Firebase token verification
│
├── backend/                      # FastAPI Python backend
│   ├── main.py                   # All REST endpoints (~6000 lines)
│   ├── pipeline.py               # PDF → questions extraction pipeline
│   ├── config.py                 # Supabase + Firebase clients
│   ├── models.py                 # Pydantic schemas
│   ├── papers.py                 # Paper/exam metadata helpers
│   ├── canonical_taxonomy.py     # Subject/topic normalisation rules
│   ├── pattern_classifier.py     # ML pattern classification
│   ├── public_metadata_helpers.py # Feed/catalog builders
│   ├── public_metadata_queries.py # Supabase query helpers
│   ├── row_quality.py            # Data quality scoring
│   ├── ai_models.py              # Vertex AI / Gemini client init
│   ├── extractor/                # PDF extraction modules
│   ├── scripts/                  # One-off repair, backfill, audit scripts
│   └── schema.sql                # Supabase table definitions
│
├── frontend/                     # Admin frontend (local only, port 4001)
│   └── src/App.tsx               # Paper upload, job tracking, editing
│
├── server.ts                     # Legacy Express server (dev only)
├── vercel.json                   # Vercel deployment config
└── render.yaml                   # Render.com deployment config
```

---

## Local Development

### Prerequisites
- Node.js 20+
- Python 3.11+
- A `.env.local` (frontend) and `backend/.env` (see `.env.example` files)

### Frontend (student app)
```bash
npm install
npm run dev          # http://localhost:4000
```

### Admin Frontend
```bash
npm run dev:admin    # http://localhost:4001
```

### Backend
```bash
cd backend
python -m venv venv && source venv/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

---

## Deployment

| Service | Platform | URL |
|---|---|---|
| Student frontend | Vercel | parikshaai.vercel.app |
| FastAPI backend | Render.com | parikshaai.onrender.com |
| Admin frontend | Localhost only | 127.0.0.1:4001 |

### Vercel Environment Variables
| Variable | Purpose |
|---|---|
| `VITE_API_URL` | FastAPI backend URL |
| `VITE_FIREBASE_PROJECT_ID` | Firebase project |
| `FIREBASE_PROJECT_ID` | Used by serverless functions |
| `GEMINI_API_KEY` | Gemini API (report/chat features) |

### Render Environment Variables
| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |
| `FIREBASE_PROJECT_ID` | Firebase project ID |
| `ADMIN_API_KEY` | Protects all `/admin/*` endpoints |
| `GOOGLE_CLOUD_PROJECT` | GCP project for Vertex AI |
| `GOOGLE_CLOUD_LOCATION` | GCP region (us-central1) |
| `PUBLIC_INCLUDE_ALL_QUESTIONS` | `1` = serve all questions |
| `DISABLE_EXAM_GATING` | `true` = disable paywall |

---

## PDF Upload Workflow (Admin)

All paper ingestion is done locally — data persists in Supabase and becomes immediately available to public users via Render.

```
1. Start local backend:  cd backend && uvicorn main:app --reload --port 8000
2. Start admin frontend: npm run dev:admin
3. Open http://localhost:4001 → upload PDF → pipeline extracts questions → saved to Supabase
4. Public users on Vercel see new questions automatically (no redeployment needed)
```

---

## Security

- All question endpoints require Firebase JWT (`Authorization: Bearer <token>`)
- Admin endpoints require `X-Admin-Key` header (never deployed publicly)
- Per-UID rate limiting: 200 requests / 10 min — scraper detection logged to stdout
- CORS restricted to `*.vercel.app` and `*.onrender.com`
- No secrets committed to git (see `.gitignore`)
