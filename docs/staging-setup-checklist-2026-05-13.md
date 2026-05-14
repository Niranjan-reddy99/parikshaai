# Pariksha Staging Setup Checklist

This is the concrete staging runbook for the current repository as of 2026-05-13.

It is tailored to:
- the current local env shape in `backend/.env`
- the current deployment entrypoints in [Dockerfile](/Users/niranjan/Downloads/upsc-ai-strategy-engine/Dockerfile:1), [Dockerfile.student](/Users/niranjan/Downloads/upsc-ai-strategy-engine/Dockerfile.student:1), and [Dockerfile.admin](/Users/niranjan/Downloads/upsc-ai-strategy-engine/Dockerfile.admin:1)
- the current auth/backend split in [backend/main.py](/Users/niranjan/Downloads/upsc-ai-strategy-engine/backend/main.py:2132) and [backend/main.py](/Users/niranjan/Downloads/upsc-ai-strategy-engine/backend/main.py:5968)


## 1. Recommended Staging Target

Use Railway for staging.

Why this is the fastest path for the current repo:
- there is already a four-service Railway deploy guide in [backend/RAILWAY.md](/Users/niranjan/Downloads/upsc-ai-strategy-engine/backend/RAILWAY.md:1)
- the repo already has dedicated Dockerfiles for:
  - backend API
  - learner web
  - admin web
- the current product split already maps cleanly to four staging services

Recommended Railway services:
1. `staging-public-api`
2. `staging-learner-web`
3. `staging-admin-api`
4. `staging-admin-web`


## 2. Current Env Audit

From the current `backend/.env`, these values are already present locally:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `GEMINI_API_KEY`
- `GOOGLE_CLOUD_PROJECT`
- `GOOGLE_CLOUD_LOCATION`
- `GOOGLE_APPLICATION_CREDENTIALS`
- `FIREBASE_PROJECT_ID`
- `ADMIN_API_KEY`
- `PUBLIC_INCLUDE_ALL_QUESTIONS`
- `ADMIN_EMAILS`

Staging blockers or cleanup items discovered:
- `GOOGLE_APPLICATION_CREDENTIALS` currently points to a local machine path. That path will not exist on Railway.
- `FIREBASE_PROJECT_ID` appears twice in `backend/.env`. Keep only one value when you formalize staging env.
- both frontends currently import [firebase-applet-config.json](/Users/niranjan/Downloads/upsc-ai-strategy-engine/firebase-applet-config.json:1), which still points at the AI Studio-era Firebase project. Staging should not keep using that config.
- the admin frontend does not need `VITE_ADMIN_KEY` in staging. It already supports Firebase admin sign-in via [frontend/src/lib/adminApi.ts](/Users/niranjan/Downloads/upsc-ai-strategy-engine/frontend/src/lib/adminApi.ts:1).


## 3. Staging Architecture

Use this exact split:

### `staging-public-api`
- Dockerfile: [Dockerfile](/Users/niranjan/Downloads/upsc-ai-strategy-engine/Dockerfile:1)
- Role: public learner API only
- Required env:
  - `APP_ROLE=public`

### `staging-learner-web`
- Dockerfile: [Dockerfile.student](/Users/niranjan/Downloads/upsc-ai-strategy-engine/Dockerfile.student:1)
- Runtime config:
  - `VITE_API_URL=https://<staging-public-api-domain>`

### `staging-admin-api`
- Dockerfile: [Dockerfile](/Users/niranjan/Downloads/upsc-ai-strategy-engine/Dockerfile:1)
- Role: admin + upload + publish
- Required env:
  - `APP_ROLE=admin`

### `staging-admin-web`
- Dockerfile: [Dockerfile.admin](/Users/niranjan/Downloads/upsc-ai-strategy-engine/Dockerfile.admin:1)
- Runtime config:
  - `VITE_ADMIN_API_URL=https://<staging-admin-api-domain>`


## 4. Staging Env Matrix

### Shared backend env for both API services

Set these on both `staging-public-api` and `staging-admin-api`:

```env
SUPABASE_URL=<staging-supabase-url>
SUPABASE_SERVICE_KEY=<staging-supabase-service-key>
ADMIN_API_KEY=<new-random-staging-secret>
ADMIN_EMAILS=<comma-separated allowed admin emails>
GOOGLE_CLOUD_PROJECT=<staging-gcp-project-id>
GOOGLE_CLOUD_LOCATION=us-central1
FIREBASE_PROJECT_ID=<staging-firebase-project-id>
UVICORN_RELOAD=false
CORS_ORIGIN_REGEX=^https://.*\.up\.railway\.app$
```

Recommended extra flags:

```env
PUBLIC_INCLUDE_ALL_QUESTIONS=false
PUBLIC_USE_PRACTICE_READY=true
```

If Vertex AI auth in staging will use service-account JSON instead of metadata-based auth:

```env
GOOGLE_APPLICATION_CREDENTIALS_JSON=<full-json-string>
```

Do not set this in Railway:

```env
GOOGLE_APPLICATION_CREDENTIALS=/Users/...
```

The backend only needs a project id for Firebase Admin token verification in [backend/config.py](/Users/niranjan/Downloads/upsc-ai-strategy-engine/backend/config.py:1), but your staging frontend sign-in must still use the matching Firebase web app config.


### `staging-public-api` only

```env
APP_ROLE=public
CORS_ORIGINS=https://<staging-learner-web-domain>,http://localhost:4000
```


### `staging-admin-api` only

```env
APP_ROLE=admin
CORS_ORIGINS=https://<staging-admin-web-domain>,http://localhost:4001
```


### `staging-learner-web`

```env
RAILWAY_DOCKERFILE_PATH=Dockerfile.student
VITE_API_URL=https://<staging-public-api-domain>
VITE_FIREBASE_API_KEY=<staging-firebase-web-api-key>
VITE_FIREBASE_AUTH_DOMAIN=<staging-project>.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=<staging-firebase-project-id>
VITE_FIREBASE_APP_ID=<staging-firebase-web-app-id>
VITE_FIREBASE_STORAGE_BUCKET=<staging-project>.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=<staging-firebase-sender-id>
VITE_FIREBASE_FIRESTORE_DATABASE_ID=<staging-firestore-db-id>
```


### `staging-admin-web`

```env
RAILWAY_DOCKERFILE_PATH=Dockerfile.admin
VITE_ADMIN_API_URL=https://<staging-admin-api-domain>
VITE_FIREBASE_API_KEY=<staging-firebase-web-api-key>
VITE_FIREBASE_AUTH_DOMAIN=<staging-project>.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=<staging-firebase-project-id>
VITE_FIREBASE_APP_ID=<staging-firebase-web-app-id>
VITE_FIREBASE_STORAGE_BUCKET=<staging-project>.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=<staging-firebase-sender-id>
```

Do not add `VITE_ADMIN_KEY` in staging.


## 5. Firebase Staging Work

This is the most important non-deploy setup item.

### Create a dedicated staging Firebase project

Needed because both frontends currently read from [src/firebase.ts](/Users/niranjan/Downloads/upsc-ai-strategy-engine/src/firebase.ts:1) and [frontend/src/firebase.ts](/Users/niranjan/Downloads/upsc-ai-strategy-engine/frontend/src/firebase.ts:1), which import [firebase-applet-config.json](/Users/niranjan/Downloads/upsc-ai-strategy-engine/firebase-applet-config.json:1).

### Add authorized domains

Add these hostnames in Firebase Auth:
- `<staging-learner-web-domain>`
- `<staging-admin-web-domain>`

Use hostnames only, without `https://`.

### Update web config source

Before staging sign-in testing, replace the current Firebase web config with staging values.

Minimum safe approach:
- keep a staging version of `firebase-applet-config.json` outside production values
- make sure both learner and admin web use the same staging Firebase project

Better follow-up:
- move Firebase web config into environment-specific runtime/build config instead of a committed shared JSON file


## 6. Supabase Staging Work

Preferred:
- create a separate staging Supabase project

If you need a very fast internal staging:
- you can temporarily point staging to the current Supabase project
- but do not do that if staging testers will upload, repair, rename, or publish real content freely

Before using staging with real testers:
1. confirm schema is current
2. verify admin flows do not mutate production content unintentionally
3. verify the service-role key is only used in backend services


## 7. Concrete Deployment Order

### Phase 1: Backend first

1. Create `staging-public-api`
2. Use repo root `/`
3. Use [Dockerfile](/Users/niranjan/Downloads/upsc-ai-strategy-engine/Dockerfile:1)
4. Set shared backend env plus:
   - `APP_ROLE=public`
5. Generate Railway domain
6. Verify:

```bash
curl https://<staging-public-api-domain>/health
```

7. Create `staging-admin-api`
8. Use repo root `/`
9. Use [Dockerfile](/Users/niranjan/Downloads/upsc-ai-strategy-engine/Dockerfile:1)
10. Set shared backend env plus:
    - `APP_ROLE=admin`
11. Generate Railway domain
12. Verify:

```bash
curl https://<staging-admin-api-domain>/health
```


### Phase 2: Frontends

1. Create `staging-learner-web`
2. Use repo root `/`
3. Set:
   - `RAILWAY_DOCKERFILE_PATH=Dockerfile.student`
   - `VITE_API_URL=https://<staging-public-api-domain>`
4. Generate Railway domain
5. Open site and verify it loads

6. Create `staging-admin-web`
7. Use repo root `/`
8. Set:
   - `RAILWAY_DOCKERFILE_PATH=Dockerfile.admin`
   - `VITE_ADMIN_API_URL=https://<staging-admin-api-domain>`
9. Generate Railway domain
10. Open site and verify it loads


### Phase 3: Cross-wiring

After domains exist, go back and update backend CORS values:
- public API should allow learner staging domain
- admin API should allow admin staging domain

Then redeploy both API services.


## 8. Staging Smoke Test Checklist

### Learner web

Verify:
1. app loads without blank screen
2. Firebase login works
3. `/meta/catalog` loads
4. question bank loads
5. exam detail page opens
6. practice mode loads questions
7. mock mode starts and submits
8. results page renders
9. leaderboard and bookmarks do not throw auth errors

### Admin web

Verify:
1. admin app loads
2. Firebase login works
3. signed-in email is included in `ADMIN_EMAILS`
4. `/admin/jobs?limit=8` returns data
5. upload modal opens
6. question review workspace loads
7. edit question works
8. rename exam works
9. publish flow works

### API checks

Verify:
1. `GET /health` returns 200 on both APIs
2. public API does not expose `/admin/*` routes when `APP_ROLE=public`
3. admin API rejects unauthorized requests
4. CORS succeeds from the correct staging frontend only


## 9. Known Staging Risks In This Repo

These are worth addressing early:

### Firebase config is still file-based
- both frontends currently share one committed Firebase config file
- this is easy to mis-point across environments

### Local credential path will not deploy
- `GOOGLE_APPLICATION_CREDENTIALS=/Users/...` is local-only
- Railway needs metadata-based auth or inline JSON secret env

### Admin exposure should stay narrow
- `APP_ROLE=admin` keeps all admin routes enabled
- use a non-public staging URL and only approved test accounts in `ADMIN_EMAILS`

### Content mutation risk
- if staging points to the same Supabase project as local/prod, admin testing can mutate real data


## 10. Suggested “Done” Definition For Staging

Treat staging as ready only when:
- all four Railway services are deployed
- both APIs return healthy responses
- both frontends load successfully
- Firebase sign-in works on learner and admin staging domains
- admin access is limited to approved emails
- learner practice/mock flows work
- one admin upload or publish flow succeeds end to end
- no staging service depends on a machine-local credentials path


## 11. Best Immediate Next Actions

In order, I’d do these next:

1. Create a staging Firebase project
2. Decide whether staging gets its own Supabase project
3. Generate a new staging `ADMIN_API_KEY`
4. Remove duplicate `FIREBASE_PROJECT_ID` from local env hygiene
5. Decide how Railway will authenticate to Vertex AI
6. Deploy `staging-public-api`
7. Deploy `staging-admin-api`
8. Deploy `staging-learner-web`
9. Deploy `staging-admin-web`
10. Run the smoke checklist above
