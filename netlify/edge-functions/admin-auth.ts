// netlify/edge-functions/admin-auth.ts
//
// HTTP Basic Auth in front of everything under /admin/*.
//
// This is what protects personalisation print files — un-watermarked, full
// resolution, built from customers' own photos. Without it, anyone holding a
// personalisation id could download one. The ids are 128-bit random so they
// aren't guessable, but "unguessable URL" is not access control.
//
// Set ADMIN_USER and ADMIN_PASSWORD in the Netlify site environment (both
// secret). If either is missing the edge function denies everything rather
// than falling open — a misconfigured deploy should lock you out, not the
// internet in.

import type { Context, Config } from '@netlify/edge-functions';

function unauthorized(message: string): Response {
  return new Response(message, {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Pixel8 admin", charset="UTF-8"',
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

/** Compare without leaking length or position through timing. */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export default async function handler(req: Request, context: Context): Promise<Response> {
  const user = Netlify.env.get('ADMIN_USER');
  const password = Netlify.env.get('ADMIN_PASSWORD');

  if (!user || !password) {
    console.error('admin-auth: ADMIN_USER / ADMIN_PASSWORD not set — denying all /admin requests');
    return new Response('Admin area is not configured.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  const header = req.headers.get('authorization') || '';
  if (!header.toLowerCase().startsWith('basic ')) return unauthorized('Authentication required.');

  let decoded = '';
  try {
    decoded = atob(header.slice(6).trim());
  } catch {
    return unauthorized('Malformed credentials.');
  }

  const i = decoded.indexOf(':');
  if (i === -1) return unauthorized('Malformed credentials.');

  // Both comparisons always run, so a wrong username and a wrong password
  // take the same time.
  const okUser = safeEqual(decoded.slice(0, i), user);
  const okPass = safeEqual(decoded.slice(i + 1), password);
  if (!okUser || !okPass) {
    console.warn('admin-auth: failed login attempt');
    return unauthorized('Invalid credentials.');
  }

  const res = await context.next();
  // Never let a proxy or CDN hold on to anything from the admin area.
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', 'no-store, private');
  out.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return out;
}

export const config: Config = { path: '/admin/*' };
