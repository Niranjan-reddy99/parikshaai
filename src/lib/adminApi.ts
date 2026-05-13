import { API_BASE } from './api';
import { onIdTokenChanged } from 'firebase/auth';
import { auth } from '../firebase';

let adminAuthToken = '';
const rawAdminKey =
  import.meta.env.DEV
    ? (import.meta.env.VITE_ADMIN_KEY as string | undefined)
    : undefined;

onIdTokenChanged(auth, async (user) => {
  if (!user) {
    adminAuthToken = '';
    return;
  }
  try {
    adminAuthToken = await user.getIdToken();
  } catch {
    adminAuthToken = '';
  }
});

export function setAdminAuthToken(token: string | null | undefined) {
  adminAuthToken = (token || '').trim();
}

export function hasAdminAuth() {
  return Boolean(adminAuthToken || rawAdminKey);
}

export function adminHeaders(): HeadersInit {
  if (adminAuthToken) {
    return { Authorization: `Bearer ${adminAuthToken}` };
  }
  if (rawAdminKey) {
    return { 'x-admin-key': rawAdminKey };
  }
  throw new Error('Admin sign-in is required for admin requests.');
}

export { API_BASE };
