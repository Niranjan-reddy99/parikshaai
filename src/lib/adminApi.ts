import { API_BASE } from './api';

const _rawAdminKey = import.meta.env.VITE_ADMIN_KEY as string | undefined;

if (!_rawAdminKey && import.meta.env.PROD) {
  console.error(
    '[config] VITE_ADMIN_KEY is not set. Admin endpoints will be inaccessible.'
  );
}

export const ADMIN_KEY = _rawAdminKey || '';

export function adminHeaders(): HeadersInit {
  if (!ADMIN_KEY) {
    throw new Error('VITE_ADMIN_KEY is required for admin frontend requests.');
  }
  return { 'x-admin-key': ADMIN_KEY };
}

export { API_BASE };
