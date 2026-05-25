# ParikshaGPT Domain And DNS Setup Plan

This document is the domain and DNS plan for the current ParikshaGPT stack.


## 1. Recommended Domain Purchase

Buy one main domain now.

Recommended registrar:
- Cloudflare Registrar

Why:
- at-cost pricing model
- easy DNS management
- DNSSEC support
- clean integration with frontend/backend custom domains


## 2. Recommended Subdomain Layout

Use subdomains instead of putting everything on one hostname.

Recommended:
- `app.<your-domain>` → learner frontend
- `admin.<your-domain>` → admin frontend
- `api.<your-domain>` → public backend
- `admin-api.<your-domain>` → admin backend

Optional:
- `www.<your-domain>` → marketing / redirect to `app.<your-domain>`
- root domain `<your-domain>` → landing page redirect to `app.<your-domain>`


## 3. Target Providers

### Learner frontend
- Host: Vercel
- Target DNS:
  - CNAME for `app`

### Admin frontend
- Host: Vercel
- Target DNS:
  - CNAME for `admin`

### Public backend
- Host: Render
- Target DNS:
  - CNAME for `api`

### Admin backend
- Host: Render
- Target DNS:
  - CNAME for `admin-api`


## 4. DNS Record Model

Exact record values depend on the hosting dashboards, but the shape should be:

- `app` → CNAME → Vercel-assigned target
- `admin` → CNAME → Vercel-assigned target
- `api` → CNAME → Render-assigned target
- `admin-api` → CNAME → Render-assigned target

If you also map the apex/root domain:
- `@` → either redirect to `app.<your-domain>` or point to the learner landing page


## 5. SSL

Expected behavior:
- Vercel provisions SSL for frontend domains
- Render provisions SSL for backend custom domains
- Cloudflare can sit as DNS only

Do not launch until all four production domains have valid HTTPS.


## 6. Auth Domain Work

### Firebase Auth
Because learner sign-in uses Firebase, you must add the learner domain to Firebase authorized domains.

Minimum domains to add:
- `app.<your-domain>`
- `www.<your-domain>` if used

If staging is used:
- `staging-app.<your-domain>` or equivalent


## 7. CORS Work

The backend currently uses `CORS_ORIGINS` in [backend/main.py](/Users/niranjan/Downloads/upsc-ai-strategy-engine/backend/main.py:157).

Production `CORS_ORIGINS` should include:
- `https://app.<your-domain>`
- `https://admin.<your-domain>`

If using root or `www`, include those explicitly too.


## 8. Admin Exposure Plan

The admin route should not be casually public even if it has a domain.

Recommended:
- `admin.<your-domain>` for the UI
- `admin-api.<your-domain>` for the API
- protect one or both with additional access controls

Good options:
- Cloudflare Access
- IP allowlist
- VPN
- internal-only ops policy


## 9. Redirect Policy

Recommended:
- root domain → redirect to learner app
- choose one canonical public app URL:
  - either `app.<your-domain>`
  - or `www.<your-domain>`

Avoid splitting public traffic between multiple equivalent app URLs.


## 10. Suggested Naming Example

If the domain is `parikshagpt.in`, use:
- `app.parikshagpt.in`
- `admin.parikshagpt.in`
- `api.parikshagpt.in`
- `admin-api.parikshagpt.in`


## 11. Launch DNS Checklist

1. Buy domain
2. Enable Cloudflare DNS
3. Add Vercel custom domain for learner app
4. Add Vercel custom domain for admin app
5. Add Render custom domain for public API
6. Add Render custom domain for admin API
7. Wait for SSL issuance
8. Verify HTTPS on all routes
9. Add Firebase authorized domains
10. Update backend `CORS_ORIGINS`
11. Test login, API calls, admin upload, publish flow


## 12. Operational Reminder

Once the domain is live, also update:
- support email
- privacy policy links
- terms links
- any landing-page CTA copy
- Google sign-in branding if needed
