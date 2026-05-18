type AppRuntimeConfig = {
  VITE_API_URL?: string;
  VITE_FIREBASE_API_KEY?: string;
  VITE_FIREBASE_AUTH_DOMAIN?: string;
  VITE_FIREBASE_PROJECT_ID?: string;
  VITE_FIREBASE_APP_ID?: string;
  VITE_FIREBASE_STORAGE_BUCKET?: string;
  VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  VITE_FIREBASE_MEASUREMENT_ID?: string;
  VITE_FIREBASE_FIRESTORE_DATABASE_ID?: string;
};

declare global {
  interface Window {
    __APP_CONFIG__?: AppRuntimeConfig;
  }
}

const runtimeConfig =
  typeof window !== 'undefined'
    ? window.__APP_CONFIG__
    : undefined;

function pickRuntimeValue(
  runtimeValue: string | undefined,
  envValue: string | undefined,
) {
  return (
    [runtimeValue, envValue]
      .map((value) => String(value ?? '').trim())
      .find(Boolean) ?? ''
  );
}

export const firebaseConfig = {
  apiKey: pickRuntimeValue(
    runtimeConfig?.VITE_FIREBASE_API_KEY,
    import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  ),
  authDomain: pickRuntimeValue(
    runtimeConfig?.VITE_FIREBASE_AUTH_DOMAIN,
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  ),
  projectId: pickRuntimeValue(
    runtimeConfig?.VITE_FIREBASE_PROJECT_ID,
    import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  ),
  appId: pickRuntimeValue(
    runtimeConfig?.VITE_FIREBASE_APP_ID,
    import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
  ),
  storageBucket: pickRuntimeValue(
    runtimeConfig?.VITE_FIREBASE_STORAGE_BUCKET,
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  ),
  messagingSenderId: pickRuntimeValue(
    runtimeConfig?.VITE_FIREBASE_MESSAGING_SENDER_ID,
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  ),
  measurementId: pickRuntimeValue(
    runtimeConfig?.VITE_FIREBASE_MEASUREMENT_ID,
    import.meta.env.VITE_FIREBASE_MEASUREMENT_ID as string | undefined,
  ),
};

export const firestoreDatabaseId = pickRuntimeValue(
  runtimeConfig?.VITE_FIREBASE_FIRESTORE_DATABASE_ID,
  import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID as string | undefined,
);
