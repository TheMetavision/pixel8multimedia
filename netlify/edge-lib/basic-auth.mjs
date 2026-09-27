/**
 * netlify/edge-lib/basic-auth.mjs
 *
 * The same Basic Auth check as netlify/edge-functions/admin-auth.ts, as a
 * function other edge functions can call for themselves. Lives outside
 * netlify/edge-functions/ so Netlify doesn't treat it as a function.
 *
 * Returns null when the request is allowed, otherwise the Response to send.
 * Fails closed: no ADMIN_USER / ADMIN_PASSWORD configured → 503 for everyone.
 */

const unauthorized = (message) => new Response(message, {
  status: 401,
  headers: {
    'WWW-Authenticate': 'Basic realm="Pixel8 admin", charset="UTF-8"',
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  },
});

/** Compare without leaking length or position through timing. */
export function safeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function checkBasicAuth(req, { user, password }) {
  if (!user || !password) {
    return new Response('Admin area is not configured.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  const header = req.headers.get('authorization') || '';
  if (!header.toLowerCase().startsWith('basic ')) return unauthorized('Authentication required.');
  let decoded = '';
  try { decoded = atob(header.slice(6).trim()); } catch { return unauthorized('Malformed credentials.'); }
  const i = decoded.indexOf(':');
  if (i === -1) return unauthorized('Malformed credentials.');
  const okUser = safeEqual(decoded.slice(0, i), user);
  const okPass = safeEqual(decoded.slice(i + 1), password);
  return okUser && okPass ? null : unauthorized('Invalid credentials.');
}
