# Railway Deploy

This backend is ready to deploy to Railway from the `/backend` directory.

## 1. Create the service

In Railway:

1. New Project
2. Deploy from GitHub repo
3. Select this repository
4. Open the backend service settings
5. Set `Root Directory` to `/backend`
6. Generate a public domain in `Networking`

Railway will use:
- [railway.toml](./railway.toml) for the start command
- [nixpacks.toml](./nixpacks.toml) to install `tesseract-ocr`

## 2. Add environment variables

Copy these from your real local backend setup:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `ADMIN_API_KEY`
- `GOOGLE_CLOUD_PROJECT`
- `GOOGLE_CLOUD_LOCATION`
- `FIREBASE_PROJECT_ID`
- `CORS_ORIGINS`

Recommended `CORS_ORIGINS` value:

```env
https://your-frontend-domain.vercel.app,http://localhost:4000,http://localhost:5173
```

## 3. Verify the backend

After deploy, test:

```bash
curl https://your-railway-domain.up.railway.app/health
```

You should get a healthy JSON response.

## 4. Point the frontend to Railway

In your frontend deployment, set:

```env
VITE_API_URL=https://your-railway-domain.up.railway.app
```

Then redeploy the frontend.

## 5. Production sanity checks

Verify these flows on the deployed app:

1. login works
2. practice answer submit works
3. mock submit works
4. attempts are written
5. `/progress/me` returns data after login
6. PDF upload works from admin mode

