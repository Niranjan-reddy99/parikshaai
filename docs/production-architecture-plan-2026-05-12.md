# ParikshaGPT Production Architecture Plan

This document defines the recommended production architecture for the current ParikshaGPT repository.

It is based on the current codebase split:
- learner frontend
- admin frontend
- public backend
- admin backend
- Supabase as the main operational data store
- Firebase Auth on the learner side


## 1. Recommended Production Topology

### Public learner app
- Service: Vercel project
- Source: repo root
- Build command: `npm run build`
- Output: `dist/`
- Public URL:
  - `https://app.<your-domain>`
  - or `https://www.<your-domain>`

### Admin frontend
- Service: separate Vercel project
- Source: repo root using `frontend/vite.config.ts`
- Build command: `npm run build:admin`
- Output: `frontend/dist/`
- Private URL:
  - `https://admin.<your-domain>`

### Public API backend
- Service: Render web service
- Runtime: Python
- Working directory: `backend/`
- Start command:
  - `APP_ROLE=public uvicorn main:app --host 0.0.0.0 --port $PORT`
- Public URL:
  - `https://api.<your-domain>`

### Admin API backend
- Service: separate Render web service
- Runtime: Python
- Working directory: `backend/`
- Start command:
  - `APP_ROLE=admin uvicorn main:app --host 0.0.0.0 --port $PORT`
- Private URL:
  - `https://admin-api.<your-domain>`
- This service should not be publicly discoverable or casually exposed.

### Database + storage
- Service: Supabase
- Role:
  - questions
  - papers
  - jobs
  - explanations
  - pattern books
  - attempts / leaderboard data

### Auth
- Current state:
  - learner app uses Firebase Auth via [src/firebase.ts](/Users/niranjan/Downloads/upsc-ai-strategy-engine/src/firebase.ts:1)
  - config currently comes from [firebase-applet-config.json](/Users/niranjan/Downloads/upsc-ai-strategy-engine/firebase-applet-config.json:1)
- Production recommendation:
  - create a dedicated Firebase project for production
  - replace the current AI Studio-generated config
  - add your real learner domain to Firebase authorized domains


## 2. Production Domain Shape

Recommended DNS layout:
- `app.<your-domain>` → learner frontend
- `admin.<your-domain>` → admin frontend
- `api.<your-domain>` → public backend
- `admin-api.<your-domain>` → admin backend

Alternative simpler layout:
- `www.<your-domain>` → learner frontend
- `admin.<your-domain>` → admin frontend
- `api.<your-domain>` → public backend
- `admin-api.<your-domain>` → admin backend


## 3. Why This Split Fits The Current Repo

The repo already has a real product split:
- learner app on port `4000`
- admin app on port `4001`
- public backend on port `8000`
- admin backend on port `8080`

This is reflected in:
- learner app: [src/App.tsx](/Users/niranjan/Downloads/upsc-ai-strategy-engine/src/App.tsx:1)
- admin app: [frontend/src/App.tsx](/Users/niranjan/Downloads/upsc-ai-strategy-engine/frontend/src/App.tsx:1)
- public/admin role switching: [backend/main.py](/Users/niranjan/Downloads/upsc-ai-strategy-engine/backend/main.py:5594)
- public launch script: [backend/run_public.sh](/Users/niranjan/Downloads/upsc-ai-strategy-engine/backend/run_public.sh:1)
- admin launch script: [backend/run_admin.sh](/Users/niranjan/Downloads/upsc-ai-strategy-engine/backend/run_admin.sh:1)

So production should preserve that separation instead of collapsing everything into one service.


## 4. Security Requirements

### Admin frontend
- Protect behind a non-public URL
- Require strong `VITE_ADMIN_KEY`
- Prefer access only for internal operators

### Admin backend
- Must have `ADMIN_API_KEY`
- Should be restricted by at least one of:
  - Cloudflare Access
  - basic IP allowlist
  - internal VPN
  - Render private service pattern if you later move the admin frontend off public Vercel

### Supabase
- Enable production safeguards:
  - RLS review
  - backups / PITR
  - SSL enforcement
  - network restrictions if feasible

### Firebase Auth
- Update authorized domains
- verify production redirect/auth domain behavior


## 5. Environment Separation

Create distinct environments:
- local
- staging
- production

Recommended branches:
- `main` or `production`
- `staging`

Recommended infra:
- separate Supabase project for staging and production
- separate Firebase project for staging and production
- separate Vercel projects for learner/admin in staging and production
- separate Render services for public/admin in staging and production


## 6. Observability Requirements

Before launch, add:
- backend error logging
- request/latency monitoring
- uptime checks for:
  - learner frontend
  - public API
  - admin frontend
  - admin API
- deploy notifications

Recommended minimal stack:
- Render service logs
- Vercel deploy logs
- Supabase logs
- one external uptime checker


## 7. Backup / Recovery Requirements

Minimum:
- Supabase automated backups enabled
- export critical tables on a schedule if possible
- store a copy of admin/import source PDFs outside the app server filesystem

Operational note:
- `backend/uploads/` should not be treated as durable production storage by itself
- original uploaded PDFs should live in durable object storage or a managed bucket if these uploads matter long-term


## 8. Performance Notes

### Frontend
- learner app already builds to static assets via Vite
- Vercel is a good fit

### Backend
- FastAPI on Render is fine for early production
- if extraction workloads get heavier, separate them from request-serving APIs later

### Caching
- public metadata endpoints already have in-process cache
- topic buckets also have cache in [backend/main.py](/Users/niranjan/Downloads/upsc-ai-strategy-engine/backend/main.py:223)
- browser cache/local cache exists in learner app too

Later improvement:
- move public metadata caching to Redis or another shared cache if you scale beyond one instance


## 9. Near-Term Architecture Improvements

Best next infra improvements after first launch:
- move uploaded PDFs to managed object storage
- move admin backend behind Cloudflare Access
- introduce staging environment parity
- add centralized error monitoring
- replace local-only assumptions in any admin-only flows


## 10. Recommended Launch Order

1. Freeze production env variables
2. Create production Supabase project
3. Create production Firebase project
4. Deploy learner frontend
5. Deploy public backend
6. Connect learner frontend to public backend
7. Deploy admin frontend
8. Deploy admin backend
9. Restrict admin access
10. Connect domain + SSL
11. Verify auth domains
12. Run smoke tests
13. Invite a small beta group
14. Launch publicly
