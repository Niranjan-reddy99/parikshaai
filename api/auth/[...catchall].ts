export const config = { runtime: 'edge' };

const FIREBASE_BASE = 'https://gen-lang-client-0575996387.firebaseapp.com';

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const authPath = url.pathname.replace(/^\/api\/auth/, '');
  const firebaseUrl = `${FIREBASE_BASE}/__/auth${authPath}${url.search}`;

  const upstream = await fetch(firebaseUrl, {
    method: req.method,
    redirect: 'manual',
  });

  const headers = new Headers(upstream.headers);
  headers.set('cross-origin-opener-policy', 'same-origin-allow-popups');

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}
