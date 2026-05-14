# Pariksha Deployment Checklist And Environment Variables

This document is the practical deployment checklist for the current repository.


## 1. Services To Deploy

### Learner frontend
- command: `npm run build`
- source app: [src/App.tsx](/Users/niranjan/Downloads/upsc-ai-strategy-engine/src/App.tsx:1)

### Admin frontend
- command: `npm run build:admin`
- source app: [frontend/src/App.tsx](/Users/niranjan/Downloads/upsc-ai-strategy-engine/frontend/src/App.tsx:1)

### Public backend
- working dir: `backend/`
- role: `APP_ROLE=public`

### Admin backend
- working dir: `backend/`
- role: `APP_ROLE=admin`


## 2. Frontend Environment Variables

### Learner frontend

Used by:
- [src/lib/api.ts](/Users/niranjan/Downloads/upsc-ai-strategy-engine/src/lib/api.ts:1)
- [src/views/PatternPracticeView.tsx](/Users/niranjan/Downloads/upsc-ai-strategy-engine/src/views/PatternPracticeView.tsx:8)

Required:
- `VITE_API_URL`
  - example: `https://api.<your-domain>`
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`

Current Firebase note:
- learner auth can now be supplied from runtime/build config
- [firebase-applet-config.json](/Users/niranjan/Downloads/upsc-ai-strategy-engine/firebase-applet-config.json:1) remains only as a local fallback
- before production, set the Firebase values above for the real environment

### Admin frontend

Used by:
- [frontend/src/lib/api.ts](/Users/niranjan/Downloads/upsc-ai-strategy-engine/frontend/src/lib/api.ts:1)
- [frontend/src/lib/adminApi.ts](/Users/niranjan/Downloads/upsc-ai-strategy-engine/frontend/src/lib/adminApi.ts:1)

Required:
- `VITE_ADMIN_API_URL`
  - example: `https://admin-api.<your-domain>`
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`

Local dev only:
- `VITE_ADMIN_KEY`
  - optional localhost fallback
  - do not set this in staging/production


## 3. Backend Environment Variables

Base reference:
- [backend/.env.example](/Users/niranjan/Downloads/upsc-ai-strategy-engine/backend/.env.example:1)

Required:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `ADMIN_API_KEY`
- `GOOGLE_CLOUD_PROJECT`
- `GOOGLE_CLOUD_LOCATION`
- `FIREBASE_PROJECT_ID`

Recommended:
- `CORS_ORIGINS`
- `UVICORN_RELOAD=false`

Optional model overrides:
- `AI_MODEL_DEFAULT`
- `AI_MODEL_EXTRACTION`
- `AI_MODEL_EXTRACTION_REPAIR`
- `AI_MODEL_TAGGING`
- `AI_MODEL_EXPLANATION`
- `AI_MODEL_ANSWER`

Other runtime flags found in backend:
- `APP_ROLE`
- `PORT`
- `PUBLIC_INCLUDE_ALL_QUESTIONS`
- `PUBLIC_USE_PRACTICE_READY`
- `PATTERN_BOOK_GEMINI_STAGE12_MODEL`
- `PATTERN_BOOK_GEMINI_VISION_MODEL`


## 4. Recommended Environment Matrix

### Learner frontend production
- `VITE_API_URL=https://api.<your-domain>`
- `VITE_FIREBASE_API_KEY=<firebase-web-api-key>`
- `VITE_FIREBASE_AUTH_DOMAIN=<project>.firebaseapp.com`
- `VITE_FIREBASE_PROJECT_ID=<prod-firebase-project>`
- `VITE_FIREBASE_APP_ID=<firebase-web-app-id>`
- `VITE_FIREBASE_STORAGE_BUCKET=<project>.firebasestorage.app`
- `VITE_FIREBASE_MESSAGING_SENDER_ID=<firebase-sender-id>`

### Admin frontend production
- `VITE_ADMIN_API_URL=https://admin-api.<your-domain>`
- `VITE_FIREBASE_API_KEY=<firebase-web-api-key>`
- `VITE_FIREBASE_AUTH_DOMAIN=<project>.firebaseapp.com`
- `VITE_FIREBASE_PROJECT_ID=<prod-firebase-project>`
- `VITE_FIREBASE_APP_ID=<firebase-web-app-id>`
- `VITE_FIREBASE_STORAGE_BUCKET=<project>.firebasestorage.app`
- `VITE_FIREBASE_MESSAGING_SENDER_ID=<firebase-sender-id>`

### Public backend production
- `APP_ROLE=public`
- `PORT=10000` or provider port
- `SUPABASE_URL=<prod-supabase-url>`
- `SUPABASE_SERVICE_KEY=<prod-service-role-key>`
- `ADMIN_API_KEY=<long-random-secret>`
- `GOOGLE_CLOUD_PROJECT=<prod-gcp-project>`
- `GOOGLE_CLOUD_LOCATION=us-central1`
- `FIREBASE_PROJECT_ID=<prod-firebase-project>`
- `CORS_ORIGINS=https://app.<your-domain>,https://admin.<your-domain>`
- `UVICORN_RELOAD=false`

### Admin backend production
- same as public backend, plus:
- `APP_ROLE=admin`


## 5. Vercel Deployment Checklist

### Learner frontend
1. Create Vercel project from repo root
2. Build command: `npm run build`
3. Output dir: `dist`
4. Add env:
   - `VITE_API_URL`
5. Add custom domain:
   - `app.<your-domain>`

### Admin frontend
1. Create separate Vercel project from same repo
2. Override build command: `npm run build:admin`
3. Output dir: `frontend/dist`
4. Add env:
   - `VITE_ADMIN_API_URL`
   - `VITE_ADMIN_KEY`
5. Add custom domain:
   - `admin.<your-domain>`


## 6. Render Deployment Checklist

### Public backend
1. Create web service from repo
2. Root directory: `backend`
3. Build command:
   - `pip install -r requirements.txt`
4. Start command:
   - `APP_ROLE=public uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Add all required env vars
6. Add custom domain:
   - `api.<your-domain>`

### Admin backend
1. Create second Render web service
2. Root directory: `backend`
3. Build command:
   - `pip install -r requirements.txt`
4. Start command:
   - `APP_ROLE=admin uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Add same backend env vars
6. Add custom domain:
   - `admin-api.<your-domain>`
7. Restrict access operationally


## 7. Supabase Production Checklist

Before launch:
1. Create dedicated production project
2. confirm schema is current
3. enable backups / PITR if budget allows
4. review RLS posture
5. verify service-role key handling
6. review indexes for hot public queries
7. confirm email / auth settings if used there later


## 8. Firebase Production Checklist

Because learner auth uses Firebase:
1. create a production Firebase project
2. update web app config
3. replace current AI Studio-era config file
4. add authorized domains:
   - `app.<your-domain>`
   - `www.<your-domain>` if used
5. test Google sign-in on live domain


## 9. Smoke Test Checklist

### Learner app
- landing page loads
- question bank loads
- commission page loads
- exam detail loads
- practice mode works
- mock mode works
- results render
- PYQ feed loads
- pattern practice loads
- login works

### Admin app
- app loads
- recent jobs load
- upload works
- review workspace loads
- edit question works
- rename exam works
- publish works
- pattern-book upload works

### API / data
- `/meta/catalog` returns 200
- `/meta/feed` returns 200
- public questions load
- admin endpoints reject bad keys
- CORS works for learner and admin domains


## 10. Pre-Launch Hardening

Do before public launch:
- rotate `ADMIN_API_KEY`
- remove any old local/testing origins from production `CORS_ORIGINS`
- disable reload in backend
- keep admin service private in practice, not just by obscurity
- ensure production Firebase config is not the current demo/applet one


## 11. Post-Launch Operations

Week 1 after launch:
- monitor backend logs daily
- monitor Supabase query failures
- monitor upload/publish failures
- watch topic-tagging quality in PYQ feed
- record every user-facing taxonomy/content issue and fix the pipeline, not just the row
