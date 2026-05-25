export const config = { runtime: 'edge' };

export default function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const target = `https://gen-lang-client-0575996387.firebaseapp.com/__/auth/handler${url.search}`;
  return fetch(target);
}
