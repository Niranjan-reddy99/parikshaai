/**
 * api.ts — public API configuration shared by both frontends.
 *
 * This file intentionally contains no admin secrets so the student bundle can
 * import it safely without pulling `VITE_ADMIN_KEY` into the build.
 */

declare global {
  interface Window {
    __APP_CONFIG__?: {
      VITE_API_URL?: string;
      VITE_FIREBASE_API_KEY?: string;
      VITE_FIREBASE_AUTH_DOMAIN?: string;
      VITE_FIREBASE_PROJECT_ID?: string;
      VITE_FIREBASE_APP_ID?: string;
      VITE_FIREBASE_STORAGE_BUCKET?: string;
      VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
      VITE_FIREBASE_MEASUREMENT_ID?: string;
      VITE_FIREBASE_FIRESTORE_DATABASE_ID?: string;
    };
  }
}

const runtimeApiUrl =
  typeof window !== 'undefined'
    ? window.__APP_CONFIG__?.VITE_API_URL
    : undefined;

// Auto-detect the correct API URL from the current hostname.
// This ensures the correct backend is used even when the service worker
// serves a cached JS bundle that predates the VITE_API_URL env var being set.
const PRODUCTION_HOSTS = ['parikshagpt.in', 'www.parikshagpt.in', 'parikshaai.vercel.app'];
const hostnameApiUrl =
  typeof window !== 'undefined' && PRODUCTION_HOSTS.includes(window.location.hostname)
    ? 'https://api.parikshagpt.in'
    : undefined;

export const API_BASE =
  runtimeApiUrl?.replace(/\/$/, '') ||
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ||
  hostnameApiUrl ||
  'http://localhost:8000';
