declare global {
  interface Window {
    __ADMIN_APP_CONFIG__?: {
      VITE_ADMIN_API_URL?: string;
      VITE_FIREBASE_API_KEY?: string;
      VITE_FIREBASE_AUTH_DOMAIN?: string;
      VITE_FIREBASE_PROJECT_ID?: string;
      VITE_FIREBASE_APP_ID?: string;
      VITE_FIREBASE_STORAGE_BUCKET?: string;
      VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
      VITE_FIREBASE_MEASUREMENT_ID?: string;
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
  'http://127.0.0.1:8000';
