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
    };
  }
}

const runtimeApiUrl =
  typeof window !== 'undefined'
    ? window.__APP_CONFIG__?.VITE_API_URL
    : undefined;

export const API_BASE =
  runtimeApiUrl?.replace(/\/$/, '') ||
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ||
  'http://localhost:8000';
