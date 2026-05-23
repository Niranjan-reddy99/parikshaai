import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const disablePwa = env.VITE_DISABLE_PWA === 'true';
  return {
    plugins: [
      react(),
      tailwindcss(),
      ...(!disablePwa
        ? [
            VitePWA({
              registerType: 'autoUpdate',
              includeAssets: ['icon.svg', 'apple-touch-icon.png'],
              manifest: {
                name: 'Pariksha — PYQ Intelligence',
                short_name: 'Pariksha',
                description: 'Practice official PYQs from UPSC, APPSC, TSPSC, SSC and more with AI explanations and pattern intelligence.',
                theme_color: '#0d1f1e',
                background_color: '#0d1f1e',
                display: 'standalone',
                orientation: 'portrait',
                scope: '/',
                start_url: '/',
                icons: [
                  {
                    src: 'pwa-192x192.png',
                    sizes: '192x192',
                    type: 'image/png',
                  },
                  {
                    src: 'pwa-512x512.png',
                    sizes: '512x512',
                    type: 'image/png',
                  },
                  {
                    src: 'pwa-512x512.png',
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'any maskable',
                  },
                ],
              },
              workbox: {
                globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
                navigateFallbackDenylist: [/^\/api/, /^\/questions/, /^\/admin/],
                runtimeCaching: [
                  {
                    urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
                    handler: 'CacheFirst',
                    options: {
                      cacheName: 'google-fonts',
                      expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
                      cacheableResponse: { statuses: [0, 200] },
                    },
                  },
                  {
                    urlPattern: ({ url }) => url.port === '8000' || url.pathname.startsWith('/api/'),
                    handler: 'NetworkFirst',
                    options: {
                      cacheName: 'api-cache',
                      networkTimeoutSeconds: 10,
                      expiration: { maxEntries: 50, maxAgeSeconds: 60 * 5 },
                      cacheableResponse: { statuses: [0, 200] },
                    },
                  },
                ],
              },
            }),
          ]
        : []),
    ],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return;

            if (id.includes('/recharts/')) return 'charts-vendor';
            if (id.includes('/firebase/')) return 'firebase-vendor';
            if (id.includes('/motion/') || id.includes('/framer-motion/')) return 'motion-vendor';
            if (id.includes('/lucide-react/')) return 'icons-vendor';
            if (id.includes('/react/') || id.includes('/react-dom/')) return 'react-vendor';
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    optimizeDeps: {
      include: ['recharts', 'lucide-react', 'motion/react', 'firebase/app', 'firebase/auth', 'firebase/firestore'],
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify — file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: {
        ignored: ['**/backend/**']
      }
    },
  };
});
