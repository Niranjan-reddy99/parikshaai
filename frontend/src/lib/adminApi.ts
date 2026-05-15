import { API_BASE } from './api';
import { auth } from '../firebase';

const rawAdminKey =
  import.meta.env.DEV
    ? (import.meta.env.VITE_ADMIN_KEY as string | undefined)
    : undefined;

export function setAdminAuthToken(_token: string | null | undefined) {
  // no-op — token is now fetched fresh on every request via getIdToken()
}

export function hasAdminAuth() {
  return Boolean(auth.currentUser || rawAdminKey);
}

export async function adminHeaders(): Promise<HeadersInit> {
  if (auth.currentUser) {
    try {
      const token = await auth.currentUser.getIdToken();
      return { Authorization: `Bearer ${token}` };
    } catch {
      // fall through to rawAdminKey
    }
  }
  if (rawAdminKey) {
    return { 'x-admin-key': rawAdminKey };
  }
  throw new Error('Admin sign-in is required for admin frontend requests.');
}

export { API_BASE };
