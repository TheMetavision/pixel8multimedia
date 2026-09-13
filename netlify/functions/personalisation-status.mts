// netlify/functions/personalisation-status.mts
//
// GET /api/personalisation/status?pid=…
//
// → { ok, status, selectedStyleKey, styles: [{styleKey, ok}], callsLeft,
//     switchesLeft, failCode?, failMessage?, expiresAt }
//
// Polled by the builder every ~3s while status is 'styling'. Returns only
// what the browser needs — never blob keys, model names, ip hashes or error
// internals.

import { LIMITS, getSession, stylesTried, isPid, json, bad } from './_shared/personalisation.mts';

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return bad('Method not allowed', 405);
  const pid = new URL(req.url).searchParams.get('pid');
  if (!isPid(pid)) return bad('Invalid session.');

  const s = await getSession(pid);
  if (!s) return bad('Session not found.', 404);

  const tried = stylesTried(s);
  const doc = s as any;
  return json(200, {
    ok: true,
    status: s.status,
    selectedStyleKey: s.selectedStyleKey || null,
    styles: tried.map((styleKey) => ({ styleKey, ok: true })),
    callsLeft: Math.max(0, LIMITS.callsPerSession - (s.callsUsed || 0)),
    switchesLeft: Math.max(0, LIMITS.freeSwitches - Math.max(0, tried.length - 1)),
    ...(s.status === 'failed' ? { failCode: doc.failCode || 'error', failMessage: doc.failMessage || '' } : {}),
    expiresAt: s.expiresAt || null,
  });
}

export const config = { path: '/api/personalisation/status' };
