declare global {
  interface Window {
    __ADMIN_APP_CONFIG__?: {
      VITE_ADMIN_API_URL?: string;
      VITE_ADMIN_KEY?: string;
    };
  }
}

const runtimeAdminApiUrl =
  typeof window !== 'undefined'
    ? window.__ADMIN_APP_CONFIG__?.VITE_ADMIN_API_URL
    : undefined;

export const API_BASE =
  runtimeAdminApiUrl?.replace(/\/$/, '') ||
  (import.meta.env.VITE_ADMIN_API_URL as string | undefined)?.replace(/\/$/, '') ||
  'http://127.0.0.1:8080';
