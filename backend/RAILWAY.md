# Railway Deploy

This repo is set up to run **four Railway services**:

1. `public-api` for the learner backend
2. `learner-web` for the learner frontend
3. `admin-api` for admin upload/edit/publish routes
4. `admin-web` for the admin frontend

The safest rollout order is:

1. `public-api`
2. `learner-web`
3. `admin-api`
4. `admin-web`

## 1. Public API

Use the repo root `/` so Railway picks up the root [Dockerfile](../Dockerfile).

Set these variables:

```env
APP_ROLE=public
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_KEY=your-supabase-service-or-secret-key
ADMIN_API_KEY=your-long-random-admin-secret
GOOGLE_CLOUD_PROJECT=your-gcp-project-id
GOOGLE_CLOUD_LOCATION=us-central1
FIREBASE_PROJECT_ID=your-firebase-project-id
CORS_ORIGINS=https://your-learner-domain.up.railway.app,http://localhost:4000,http://localhost:4001,http://localhost:5173
CORS_ORIGIN_REGEX=^https://.*\.up\.railway\.app$
```

After deploy, generate a public domain and verify:

```bash
curl https://your-public-api.up.railway.app/health
```

## 2. Learner Web

Use the repo root `/` and set:

```env
RAILWAY_DOCKERFILE_PATH=Dockerfile.student
VITE_API_URL=https://your-public-api.up.railway.app
```

Generate a public domain and point it to port `8080` if Railway asks for the target port manually.

## 3. Admin API

Create a second backend service from the same repo root `/`.

Use the same variables as `public-api`, but change:

```env
APP_ROLE=admin
CORS_ORIGINS=https://your-admin-web.up.railway.app,http://localhost:4001,http://localhost:5173
```

After deploy, generate a domain and verify:

```bash
curl https://your-admin-api.up.railway.app/health
```

Admin upload routes live here:

- `POST /admin/upload-pdf`
- `POST /admin/upload-pattern-book`

## 4. Admin Web

Use the repo root `/` and set:

```env
RAILWAY_DOCKERFILE_PATH=Dockerfile.admin
VITE_ADMIN_API_URL=https://your-admin-api.up.railway.app
VITE_ADMIN_KEY=the-same-value-as-ADMIN_API_KEY
```

Generate a public domain and point it to port `8080` if Railway asks for the target port manually.

## 5. Firebase

Add your live frontend domains in Firebase Authentication -> Authorized domains:

- `your-learner-domain.up.railway.app`
- `your-admin-web.up.railway.app`

Use the bare hostnames, without `https://`.

## 6. Production Checks

Learner:

1. login works
2. question bank loads
3. exam detail opens
4. practice works
5. mock submit works

Admin:

1. admin frontend loads
2. recent jobs load
3. PDF upload works
4. repair queue loads
5. publish works
