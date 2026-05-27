# ParikshaGPT — Project Navigation Guide

> Use this as a map. When something breaks, jump to the relevant section, find the exact file + line, fix it.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [How to Run Locally](#2-how-to-run-locally)
3. [Environment Variables — Complete List](#3-environment-variables--complete-list)
4. [Database Tables (Supabase)](#4-database-tables-supabase)
5. [Frontend — Views & Navigation Flow](#5-frontend--views--navigation-flow)
6. [Frontend — Key Components](#6-frontend--key-components)
7. [Frontend — State Management](#7-frontend--state-management)
8. [Backend API — All Endpoints](#8-backend-api--all-endpoints)
9. [Payment Flow (Razorpay)](#9-payment-flow-razorpay)
10. [Auth Flow (Firebase)](#10-auth-flow-firebase)
11. [PDF Upload Pipeline](#11-pdf-upload-pipeline)
12. [Explanation Generation](#12-explanation-generation)
13. [Admin Panel](#13-admin-panel)
14. [Deployment (Render)](#14-deployment-render)
15. [Common Errors & Fixes](#15-common-errors--fixes)
16. [requirements.txt Checklist](#16-requirementstxt-checklist)

---

## 1. Architecture Overview

```
User Browser
  └─ React 19 + TypeScript + Vite (src/)
       ↓ fetch /api/*
  Express server (server.ts, port 4000)
       ↓ proxy /api/* → port 8000
  FastAPI backend (backend/main.py, port 8000)
       ↓
  Supabase PostgreSQL   ← questions, explanations, jobs, papers, payments
  Firebase Auth         ← Google OAuth + JWT verification
  Firebase Firestore    ← legacy user data (streak, XP, local sync)
  Vertex AI / Gemini    ← explanations, tagging, reports
  Razorpay              ← payments
```

**Two separate apps:**
- `src/` — **User-facing app** (React, runs as part of Express on port 4000)
- `frontend/src/` — **Admin panel** (separate React app, also uses Express)

---

## 2. How to Run Locally

```bash
# Terminal 1 — Frontend + Express server
npm install
npm run dev                  # port 4000

# Terminal 2 — FastAPI backend
cd backend
source venv/bin/activate
uvicorn main:app --reload --port 8000
```

**Build for production:**
```bash
npm run build                # builds src/ → dist/
npx tsc --noEmit             # type-check (must be zero errors before commit)
```

---

## 3. Environment Variables — Complete List

### `backend/.env`
| Variable | Purpose | Where used |
|---|---|---|
| `SUPABASE_URL` | Supabase project URL | `backend/config.py:13` |
| `SUPABASE_SERVICE_KEY` | Service role key (bypasses RLS) | `backend/config.py:14` |
| `FIREBASE_PROJECT_ID` | Firebase project for token verify | `backend/config.py:38` |
| `ADMIN_API_KEY` | Header key for admin endpoints | `backend/main.py:275` |
| `GOOGLE_CLOUD_PROJECT` | GCP project for Vertex AI | `backend/main.py:73` |
| `GOOGLE_CLOUD_LOCATION` | GCP region (default: us-central1) | `backend/main.py:74` |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to GCP service account JSON | Vertex AI SDK |
| `GEMINI_API_KEY` or `GOOGLE_API_KEY` | Direct Gemini API (fallback if no Vertex) | `backend/main.py:52` |
| `RAZORPAY_KEY_ID` | Razorpay publishable key | `backend/main.py:3996` |
| `RAZORPAY_KEY_SECRET` | Razorpay secret (HMAC signing) | `backend/main.py:3997` |

### `.env.local` (frontend + server.ts)
| Variable | Purpose | Where used |
|---|---|---|
| `GEMINI_API_KEY` | Gemini for report/chat generation | `server.ts:138` |
| `VITE_API_URL` or `BACKEND_URL` | Points to FastAPI | `server.ts:320` |
| `VITE_FIREBASE_API_KEY` | Firebase web SDK | `server.ts:325` |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase auth domain | `server.ts:326` |
| `VITE_FIREBASE_PROJECT_ID` | Firebase project | `server.ts:327` |
| `VITE_FIREBASE_APP_ID` | Firebase app ID | `server.ts:328` |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase storage | `server.ts:329` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase messaging | `server.ts:330` |
| `VITE_FIREBASE_MEASUREMENT_ID` | Firebase analytics | `server.ts:331` |
| `VITE_FIREBASE_FIRESTORE_DATABASE_ID` | Firestore DB ID | `server.ts:332` |

> **If Render deploy fails with exit code 1** → almost always a missing env var or missing package in `requirements.txt`. Check Render logs first.

---

## 4. Database Tables (Supabase)

All schemas in `backend/schema.sql`. Migrations in `backend/migration*.sql`.

| Table | Purpose | Key columns |
|---|---|---|
| `papers` | One row per uploaded exam paper | `id`, `exam_name`, `exam_year`, `is_active`, `publish_state` |
| `questions` | All questions from all papers | `id`, `question_hash` (SHA256 dedup), `is_active`, `needs_review`, `has_image`, `pattern_tag` |
| `explanations` | Lazy-generated AI explanations | `question_id` (FK), `explanation_text`, `created_at` |
| `jobs` | Upload/processing job queue | `id`, `status`, `exam_name`, `exam_year`, `paper_id` |
| `payments` | Razorpay payment records | `razorpay_order_id`, `razorpay_payment_id`, `status`, `uid` |
| `user_subscriptions` | Premium subscription per user | `uid`, `is_premium`, `expires_at` |
| `srs_cards` | Spaced-repetition cards per user | `uid`, `question_id`, `interval`, `ease`, `reps`, `next_review` |
| `bookmarks` | User bookmarks | `uid`, `question_id` |
| `flags` | User-reported question issues | `question_id`, `uid`, `reason` |

**Run a new migration:**  
Open Supabase SQL editor → paste contents of the relevant `migration_*.sql` file → run.

---

## 5. Frontend — Views & Navigation Flow

All views live in `src/views/`. Navigation is driven by `view` state in `src/App.tsx`.

```
landing → dashboard
dashboard → home → commission → exam-detail → practice/mock → results → report
dashboard → feed
dashboard → browse
dashboard → badges
dashboard → leaderboard
dashboard → profile
dashboard → bookmarks
dashboard → referral
dashboard → legal
```

**View type definition:** `src/types/index.ts:142`
```typescript
type View = 'dashboard' | 'home' | 'commission' | 'exam-detail' | 'practice' | 
            'mock' | 'results' | 'browse' | 'report' | 'feed' | 'badges' | 
            'leaderboard' | 'pattern-practice' | 'profile' | 'bookmarks' | 
            'referral' | 'legal'
```

| View | File | What it does |
|---|---|---|
| `landing` | `src/views/LandingPage.tsx` | Public landing, sign-in entry |
| `dashboard` | `src/views/DashboardView.tsx` | Home after login — stats, patterns, progress |
| `home` | `src/views/HomeView.tsx` | Commission selector |
| `commission` | `src/views/CommissionView.tsx` | Exam list within a commission |
| `exam-detail` | `src/views/ExamDetailView.tsx` | Paper detail — questions list, publish controls |
| `practice` | `src/views/PracticeView.tsx` | Timed practice session |
| `mock` | `src/views/MockView.tsx` | Full mock exam |
| `results` | `src/views/ResultsView.tsx` | Post-practice results |
| `report` | `src/views/ReportView.tsx` | AI-generated strategy report |
| `feed` | `src/views/FeedView.tsx` | PYQ feed by topic/subject |
| `browse` | `src/views/BrowseView.tsx` | Browse all questions |
| `badges` | `src/views/BadgesView.tsx` | Achievement badges |
| `leaderboard` | `src/views/LeaderboardView.tsx` | Rankings |
| `profile` | `src/views/ProfileView.tsx` | User profile |
| `bookmarks` | `src/views/BookmarksView.tsx` | Saved questions |
| `referral` | `src/views/ReferralView.tsx` | Referral program |
| `legal` | `src/views/LegalView.tsx` | Privacy Policy + Terms |
| `pattern-practice` | `src/views/PatternPracticeView.tsx` | **LOCKED** — Coming Soon |

**To add a new view:**
1. Create `src/views/NewView.tsx`
2. Add `'new-view'` to the `View` type in `src/types/index.ts:142`
3. Add `setView('new-view')` call wherever needed
4. Add `{view === 'new-view' && <NewView ... />}` in `src/App.tsx` around line 1895

---

## 6. Frontend — Key Components

| Component | File | Purpose |
|---|---|---|
| `Navbar` | `src/components/Navbar.tsx` | Left sidebar nav, mobile drawer, locked items (SOON badge) |
| `QuestionModal` | `src/components/QuestionModal.tsx` | Question detail overlay with explanation |
| `PremiumGateModal` | `src/components/PremiumGateModal.tsx` | Paywall — monthly/yearly plan picker + Razorpay checkout |
| `OnboardingModal` | `src/components/OnboardingModal.tsx` | First-login onboarding flow |
| `AuthModal` | `src/components/AuthModal.tsx` | Sign-in modal |
| `FlagQuestionModal` | `src/components/FlagQuestionModal.tsx` | Report bad question |
| `Toast` | `src/components/Toast.tsx` | Toast notifications (ToastProvider context) |
| `ExplanationSkeleton` | `src/components/skeletons/ExplanationSkeleton.tsx` | Loading state while explanation generates |

**Admin-only components** (only rendered in `frontend/src/App.tsx`):
- `frontend/src/components/` — EditQuestionModal, CostModal, DeleteExamModal, RenameModal, UploadPaperModal

**To lock a nav item (Coming Soon):**  
In `src/components/Navbar.tsx`, set `locked: true` on the nav item definition. The `renderItem` function automatically dims it and shows the SOON badge.

---

## 7. Frontend — State Management

All shared state lives in `src/App.tsx`. No Redux or Zustand — everything is `useState` + prop drilling.

### Auth state (`src/contexts/AuthContext.tsx`)
| State | What it is |
|---|---|
| `user` | Firebase `User` object (null if not signed in) |
| `isPremium` | Whether user has active subscription |
| `subscriptionLoaded` | False until `/user/subscription` returns |
| `refreshSubscription()` | Call after payment to instantly update `isPremium` |

**Premium check:** `src/contexts/AuthContext.tsx:57` — hits `GET /user/subscription`

### Key App.tsx state
| State | Type | Purpose |
|---|---|---|
| `view` | `View` | Which view is rendered |
| `commissionMap` | `CommissionMap` | All commissions + exams loaded at mount |
| `userStats` | object | Streak, XP, accuracy stats |
| `selectedQuestion` | `Question \| null` | Opens QuestionModal when set |
| `feedInitialSubject` | string | Passed to FeedView on open |
| `showPremiumModal` | boolean | Opens PremiumGateModal |
| `flagQuestion` | `Question \| null` | Opens FlagQuestionModal |

---

## 8. Backend API — All Endpoints

All in `backend/main.py`. Base URL: `http://localhost:8000` (dev) or Render URL (prod).

### Public (no auth)
| Method | Path | What it does |
|---|---|---|
| GET | `/health` | Health check — returns version + DB status |
| GET | `/questions` | Paginated question list with filters |
| GET | `/questions/meta` | Subject/topic counts for filter UI |
| GET | `/meta/catalog` | All commissions + exam list |
| GET | `/meta/feed` | Feed summary by subject+topic |
| GET | `/meta/exam-outline` | Single exam structure |
| GET | `/meta/exam-papers` | Papers list for an exam |
| GET | `/pattern-books` | List pattern books |
| GET | `/pattern-books/{book_id}/questions` | Questions from a pattern book |

### Authenticated (Firebase JWT required — `Authorization: Bearer <token>`)
| Method | Path | What it does |
|---|---|---|
| GET | `/questions/{id}` | Single question with answer |
| POST | `/reveal-answers` | Batch reveal answers for a session |
| GET | `/explanation/{question_id}` | Get or generate explanation (lazy) |
| GET | `/user/stats` | User's stats from Supabase |
| POST | `/user/sync-local` | Sync localStorage stats to Supabase |
| GET | `/user/weakness-report` | AI-generated weakness analysis |
| GET | `/user/subscription` | Check if user is premium |
| GET | `/user/srs-queue` | Spaced repetition queue |
| POST | `/user/srs-review` | Submit SRS review result |
| POST | `/user/bookmark` | Add bookmark |
| DELETE | `/user/bookmark/{question_id}` | Remove bookmark |
| GET | `/user/bookmarks` | List bookmarks |
| POST | `/feedback` | Submit feedback |

### Payment (Firebase JWT required)
| Method | Path | What it does |
|---|---|---|
| POST | `/payment/create-order` | Create Razorpay order → returns `order_id`, `amount`, `key_id` |
| POST | `/payment/verify` | Verify HMAC signature after payment success |
| POST | `/payment/webhook` | Razorpay webhook for async payment events |

**Payment flow code:** `backend/main.py:3993–4130`

### Admin (requires Firebase JWT from admin email + `ADMIN_API_KEY` header on localhost)
| Method | Path | What it does |
|---|---|---|
| GET | `/admin/me` | Verify admin session |
| POST | `/admin/upload-pdf` | Upload + process a paper PDF |
| POST | `/admin/inject-answers` | Inject answer key for an exam |
| GET | `/admin/jobs` | List upload jobs |
| GET | `/admin/jobs/{id}` | Single job status |
| POST | `/admin/retry-job/{id}` | Retry failed job |
| POST | `/admin/jobs/{id}/reset` | Reset job to idle |
| GET | `/admin/publish-readiness` | All exams publish gate status |
| GET | `/admin/repair-queue` | Questions needing repair |
| POST | `/admin/publish-paper` | Publish/unpublish a paper |
| DELETE | `/admin/delete-exam` | Hard delete an exam (irreversible) |
| GET | `/admin/questions` | All questions for an exam |
| PATCH | `/admin/questions/{id}` | Edit a question |
| DELETE | `/admin/questions/{id}` | Delete a question |
| POST | `/admin/add-blank-question` | Add new blank question |
| PATCH | `/admin/rename-exam` | Rename an exam |
| POST | `/admin/generate-explanations` | Bulk generate explanations |
| GET | `/admin/answer-coverage` | Per-paper answer + explanation coverage % |
| GET | `/admin/explanation-mismatches` | Questions where explanation contradicts answer |
| POST | `/admin/fix-explanation-mismatches` | Auto-fix contradicting explanations |
| POST | `/admin/tag-patterns` | Tag pattern types for an exam |
| POST | `/admin/tag-patterns-all` | Tag all untagged questions |
| GET | `/admin/flags` | User-reported question flags |
| POST | `/admin/flags/{id}/resolve` | Dismiss or hide flagged question |
| GET | `/admin/cost-log` | AI API cost tracking |
| GET | `/admin/exam-quality` | Quality report for an exam |

---

## 9. Payment Flow (Razorpay)

**When payment is broken, check these in order:**

1. **`RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` set in Render env** → Settings → Environment
2. **`razorpay` in `backend/requirements.txt`** — was missing before, caused deploy crash
3. **`migration_payments.sql` run in Supabase** — `payments` table must exist

**Full flow:**
```
User clicks "Upgrade" → PremiumGateModal opens
  → POST /payment/create-order  (backend/main.py:4015)
  → Razorpay checkout.js popup (src/lib/razorpay.ts:38)
  → User pays
  → POST /payment/verify        (backend/main.py:4050)  — HMAC check
  → Supabase user_subscriptions.is_premium = true
  → AuthContext.refreshSubscription() called
  → isPremium flips to true instantly
```

**Frontend files:**
- `src/components/PremiumGateModal.tsx` — UI + Razorpay checkout trigger
- `src/lib/razorpay.ts` — script loader + TypeScript types
- `src/contexts/AuthContext.tsx` — `refreshSubscription()` at line ~57

**Backend:** `backend/main.py:3993–4130`

---

## 10. Auth Flow (Firebase)

**User-facing app:**
- Google sign-in popup → Firebase JWT → sent as `Authorization: Bearer <token>` on every API call
- Token verified in `backend/config.py:138` (`verify_firebase_token`)
- Local JWT verify first (faster), falls back to Firebase Admin SDK if it fails

**Admin panel:**
- Same Google sign-in but email must be in `ADMIN_EMAILS` list in `backend/main.py:2300`
- On localhost also accepts `X-Admin-Key: <ADMIN_API_KEY>` header

**If auth is broken:**
- `backend/config.py:57` — `_fetch_firebase_certs()` — fetches Google public keys (cached 1h)
- `backend/main.py:2254` — `_verify_firebase_token_cached()` — token cache layer
- `backend/main.py:176` — `_pre_warm_firebase_keys()` — pre-warms on startup
- If Railway/Render is returning 401: check `FIREBASE_PROJECT_ID` env var is set correctly

---

## 11. PDF Upload Pipeline

**Trigger:** Admin panel → Upload tab → submit form → `POST /admin/upload-pdf`

**Code:** `backend/main.py:4559`

**Stages:**
```
Upload PDF
  → Stage 1: Pre-processing (deskew, contrast)
  → Stage 2: OCR (Tesseract + PyMuPDF)
  → Stage 3: Layout analysis (columns, tables)
  → Stage 4: Question parser (regex + heuristics)
  → Stage 5: AI tagging (subject/topic/difficulty) — gemini-1.5-flash-8b, batched 20-30 qs
  → Stage 6: Validation (completeness check)
  → Stage 7: Repair pass (re-OCR at 600 DPI if failed)
  → Stage 8: DB insert (idempotent via question_hash SHA256)
```

**Key files:**
- `backend/extractor/universal_extractor.py` — PRIMARY extractor for all exam types
- `backend/extractor/answer_key_parser.py` — Parses standalone answer key PDFs
- `backend/pipeline.py` — Orchestrates stages + `generate_explanations_bulk()`

**After upload + answer injection** → `generate_explanations_bulk()` runs in background thread:
- `backend/main.py:5015` — `admin_inject_answers` triggers background thread
- This pre-generates all explanations so users see them instantly (not on-demand)

**If extraction is wrong:**
- Check `backend/cache/` — SHA256-keyed extraction cache. Delete the file for that PDF to force re-extraction.
- Use `backend/repair_missing.py` to re-extract missing question numbers
- Use `backend/repair_explanations.py` to regenerate bad explanations

---

## 12. Explanation Generation

**Two paths:**

1. **Pre-generated (fast — should be instant):**
   - Triggered automatically after answer key upload via background thread
   - `backend/pipeline.py` — `generate_explanations_bulk(exam, year)`
   - Stored in `explanations` table, fetched instantly on demand

2. **On-demand (slow — 3–5 seconds first time):**
   - Triggered when user opens a question with no explanation yet
   - `GET /explanation/{question_id}` — `backend/main.py:2889`
   - Uses Vertex AI / Gemini 1.5 Flash 8B
   - Skeleton shown: `src/components/skeletons/ExplanationSkeleton.tsx`

**If explanations are slow for everyone:**  
→ `generate_explanations_bulk` never ran for that paper  
→ Go to Admin → Papers → select the exam → "Generate Explanations" button  
→ Or run `python backend/generate_all_explanations.py` manually

**If explanation contradicts answer:**  
→ Admin panel → Coverage tab shows mismatch count  
→ `GET /admin/explanation-mismatches` lists them  
→ `POST /admin/fix-explanation-mismatches` auto-fixes them

---

## 13. Admin Panel

**File:** `frontend/src/App.tsx` (entire file is the admin app)

**URL:** `/admin` (or whatever Render URL is configured for admin)

**Four tabs:**

| Tab | `adminTab` value | What's there |
|---|---|---|
| Upload | `'upload'` | Upload PDF form + current job status + recent jobs list |
| Papers | `'papers'` | Browse uploaded papers, edit questions, publish/unpublish |
| Coverage | `'coverage'` | Per-paper answer % + explanation % table |
| Tools | `'tools'` | Pattern tagging tool |

**Admin tab state:** `frontend/src/App.tsx:893`

**Key admin actions and their backend endpoints:**
| Action | Endpoint | File:Line |
|---|---|---|
| Upload paper | `POST /admin/upload-pdf` | `main.py:4559` |
| Inject answer key | `POST /admin/inject-answers` | `main.py:5015` |
| Publish paper | `POST /admin/publish-paper` | `main.py:5751` |
| Hide paper (soft delete) | `POST /admin/publish-paper` with `is_active:false` | `main.py:5751` |
| Permanent delete | `DELETE /admin/delete-exam` | `main.py:5895` |
| Edit question | `PATCH /admin/questions/{id}` | `main.py:5503` |
| Rename exam | `PATCH /admin/rename-exam` | `main.py:5714` |
| Tag patterns | `POST /admin/tag-patterns-all` | `main.py:4485` |

---

## 14. Deployment (Render)

**Backend service:** `parikshagpt` (FastAPI, Python)
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Root dir: `backend/`

**Frontend service:** (Express serving React build)
- Build command: `npm install && npm run build`
- Start command: `node server.js` (or similar)

**Why deploys fail — most common causes:**

| Symptom | Cause | Fix |
|---|---|---|
| Exit code 1 | Missing package in `requirements.txt` | Add the package + version |
| Exit code 1 | Missing env var used at import time | Add to Render Environment settings |
| Timed out | Previous broken commit still in queue | Render retries; once good commit is pushed it clears |
| 401 on all requests | `FIREBASE_PROJECT_ID` wrong or missing | Check Render env vars |
| Payment errors | `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` missing | Add to Render env vars |

**Always before pushing:**
```bash
npx tsc --noEmit        # must be zero errors
cd backend && python -c "import main"   # quick import check
```

---

## 15. Common Errors & Fixes

### "ModuleNotFoundError: No module named 'X'"
→ `X` is missing from `backend/requirements.txt`  
→ Add `X==<version>` and push

### Render deploy "Exited with status 1"
→ Check Render deploy logs (click the failed deploy → View logs)  
→ Usually import error or missing env var

### TypeScript error `')' expected` or `JSX element has no closing tag`
→ JSX structure is broken — an `&&` expression opened with `(` but closed with `}` instead of `)}`  
→ Check the area around the reported line number for missing `)` before `}`

### Explanations loading slowly for all users on a paper
→ `generate_explanations_bulk` never ran for that paper  
→ Admin panel → Papers → select exam → Generate Explanations  
→ Or: `POST /admin/generate-explanations` with `{exam_name, exam_year}`

### 401 on API calls (user logged in but gets unauthorized)
→ Usually Firebase cert fetch failed on backend startup  
→ Check `FIREBASE_PROJECT_ID` env var  
→ Check `backend/config.py:57` — `_fetch_firebase_certs()`

### Payment verify fails / user doesn't go premium after paying
→ Check `RAZORPAY_KEY_SECRET` — wrong secret = HMAC mismatch = 400 from `/payment/verify`  
→ Check `payments` table exists in Supabase (run `migration_payments.sql`)  
→ Check `user_subscriptions` table exists (run `add_user_subscriptions.sql`)

### Questions not showing after upload
→ Paper not published — Admin → Papers → publish the paper  
→ Or `is_active = false` on questions — check `needs_review` flag in DB

### Pattern tags showing as raw uppercase (e.g. "RANKING-ORDER")
→ `PATTERN_META` mapping in `src/views/DashboardView.tsx` — add the new tag there

### Sort/filter not working in PYQ Feed
→ `src/views/FeedView.tsx` — `subjectGroups` memo. Sort applies to outer groups, not just topics inside.

---

## 16. requirements.txt Checklist

Every package imported in `backend/main.py` or `backend/config.py` must be here.  
File: `backend/requirements.txt`

```
fastapi==0.115.0
uvicorn[standard]==0.32.0
python-multipart==0.0.22
supabase==2.11.0
python-dotenv==1.0.1
firebase-admin==6.6.0
google-genai==1.35.0
PyMuPDF==1.25.0
pytesseract==0.3.13
Pillow==11.0.0
pydantic==2.10.0
httpx==0.28.1
langdetect==1.0.9
beautifulsoup4==4.12.3
lxml==5.3.0
PyJWT==2.10.1
cryptography==44.0.1
razorpay==1.4.2          ← added after Razorpay integration
```

**When adding a new Python feature that uses a new package:**  
1. Add it to `backend/requirements.txt` in the same commit  
2. Pin the version (`pip show <package>` to get exact version)  
3. This is the #1 cause of Render deploy failures

---

*Last updated: May 2026*
