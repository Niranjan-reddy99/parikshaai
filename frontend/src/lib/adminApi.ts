import { API_BASE } from './api';

const runtimeAdminKey =
  typeof window !== 'undefined'
    ? window.__ADMIN_APP_CONFIG__?.VITE_ADMIN_KEY
    : undefined;

const rawAdminKey = runtimeAdminKey || (import.meta.env.VITE_ADMIN_KEY as string | undefined);

export const ADMIN_KEY = rawAdminKey || '';

export function adminHeaders(): HeadersInit {
  if (!ADMIN_KEY) {
    throw new Error('VITE_ADMIN_KEY is required for the admin upload frontend.');
  }
  return { 'x-admin-key': ADMIN_KEY };
}

export { API_BASE };
