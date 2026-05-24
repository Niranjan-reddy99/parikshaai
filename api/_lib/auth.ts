import admin from 'firebase-admin';

const firebaseProjectId = process.env.FIREBASE_PROJECT_ID;
if (!firebaseProjectId) throw new Error('FIREBASE_PROJECT_ID env var is required');

if (!admin.apps.length) {
  admin.initializeApp({ projectId: firebaseProjectId });
}

export async function verifyToken(authHeader: string | undefined): Promise<boolean> {
  if (!authHeader) return false;
  const token = authHeader.replace('Bearer ', '');
  try {
    await admin.auth().verifyIdToken(token);
    return true;
  } catch {
    return false;
  }
}
