import fallbackFirebaseConfig from '../../../firebase-applet-config.json';

type AdminRuntimeConfig = {
  VITE_ADMIN_API_URL?: string;
  VITE_FIREBASE_API_KEY?: string;
  VITE_FIREBASE_AUTH_DOMAIN?: string;
  VITE_FIREBASE_PROJECT_ID?: string;
  VITE_FIREBASE_APP_ID?: string;
  VITE_FIREBASE_STORAGE_BUCKET?: string;
  VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  VITE_FIREBASE_MEASUREMENT_ID?: string;
};

declare global {
  interface Window {
    __ADMIN_APP_CONFIG__?: AdminRuntimeConfig;
  }
}

const runtimeConfig =
  typeof window !== 'undefined'
    ? window.__ADMIN_APP_CONFIG__
    : undefined;

function pickRuntimeValue(
  runtimeValue: string | undefined,
  envValue: string | undefined,
  fallbackValue: string | undefined,
) {
  const resolved = runtimeValue ?? envValue ?? fallbackValue ?? '';
  return resolved.trim();
}

export const firebaseConfig = {
  apiKey: pickRuntimeValue(
    runtimeConfig?.VITE_FIREBASE_API_KEY,
    import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
    fallbackFirebaseConfig.apiKey,
  ),
  authDomain: pickRuntimeValue(
    runtimeConfig?.VITE_FIREBASE_AUTH_DOMAIN,
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
    fallbackFirebaseConfig.authDomain,
  ),
  projectId: pickRuntimeValue(
    runtimeConfig?.VITE_FIREBASE_PROJECT_ID,
    import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
    fallbackFirebaseConfig.projectId,
  ),
  appId: pickRuntimeValue(
    runtimeConfig?.VITE_FIREBASE_APP_ID,
    import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
    fallbackFirebaseConfig.appId,
  ),
  storageBucket: pickRuntimeValue(
    runtimeConfig?.VITE_FIREBASE_STORAGE_BUCKET,
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
    fallbackFirebaseConfig.storageBucket,
  ),
  messagingSenderId: pickRuntimeValue(
    runtimeConfig?.VITE_FIREBASE_MESSAGING_SENDER_ID,
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
    fallbackFirebaseConfig.messagingSenderId,
  ),
  measurementId: pickRuntimeValue(
    runtimeConfig?.VITE_FIREBASE_MEASUREMENT_ID,
    import.meta.env.VITE_FIREBASE_MEASUREMENT_ID as string | undefined,
    fallbackFirebaseConfig.measurementId,
  ),
};
