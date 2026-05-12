export const API_BASE =
  (import.meta.env.VITE_ADMIN_API_URL as string | undefined)?.replace(/\/$/, '') ||
  'http://127.0.0.1:8080';
