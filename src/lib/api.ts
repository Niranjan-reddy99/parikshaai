/**
 * api.ts — public API configuration shared by both frontends.
 *
 * This file intentionally contains no admin secrets so the student bundle can
 * import it safely without pulling `VITE_ADMIN_KEY` into the build.
 */

export const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ||
  'http://localhost:8000';
