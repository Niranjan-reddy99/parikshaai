import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const CHUNK_RELOAD_KEY = 'pariksha_chunk_reload_guard';

function isDynamicImportFetchError(reason: unknown): boolean {
  const message =
    typeof reason === 'string'
      ? reason
      : reason && typeof reason === 'object' && 'message' in reason
      ? String((reason as { message?: unknown }).message || '')
      : '';

  return (
    message.includes('Failed to fetch dynamically imported module') ||
    message.includes('Importing a module script failed') ||
    message.includes('error loading dynamically imported module')
  );
}

function reloadOnceForChunkMismatch() {
  try {
    const guard = sessionStorage.getItem(CHUNK_RELOAD_KEY);
    const currentTarget = window.location.href;
    if (guard === currentTarget) {
      return;
    }
    sessionStorage.setItem(CHUNK_RELOAD_KEY, currentTarget);
    window.location.reload();
  } catch {
    window.location.reload();
  }
}

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  reloadOnceForChunkMismatch();
});

window.addEventListener('unhandledrejection', (event) => {
  if (!isDynamicImportFetchError(event.reason)) return;
  event.preventDefault();
  reloadOnceForChunkMismatch();
});

if (import.meta.env.VITE_ENABLE_PWA !== 'true' && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => {
      void registration.unregister();
    });
  });
  if ('caches' in window) {
    void caches.keys().then((keys) => {
      keys.forEach((key) => {
        void caches.delete(key);
      });
    });
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

window.setTimeout(() => {
  try {
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
  } catch {
    // ignore sessionStorage failures
  }
}, 10000);
