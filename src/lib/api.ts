/**
 * api.ts — centralised API configuration
 *
 * In development:  VITE_API_URL is unset → falls back to http://localhost:8000
 * In production:   set VITE_API_URL=https://api.yourdomain.com in .env.production
 *
 * VITE_ADMIN_KEY must always be set in production. The app will show a visible
 * warning if it is missing rather than silently using a weak fallback.
 */

export const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ||
  'http://localhost:8000';

const _rawAdminKey = import.meta.env.VITE_ADMIN_KEY as string | undefined;

if (!_rawAdminKey && import.meta.env.PROD) {
  // In production a missing admin key is a misconfiguration — log clearly.
  console.error(
    '[config] VITE_ADMIN_KEY is not set. Admin endpoints will be inaccessible.'
  );
}

export const ADMIN_KEY = _rawAdminKey || '';

/** Convenience helper — returns headers object for admin requests */
export function adminHeaders(): HeadersInit {
  return { 'x-admin-key': ADMIN_KEY };
}
