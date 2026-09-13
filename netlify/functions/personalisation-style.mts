// netlify/functions/personalisation-style.mts
//
// POST /api/personalisation/style   { pid, styleKey, regenerate?: boolean }
//
// → { ok, status: 'ready' | 'styling', cached?: true, callsLeft, switchesLeft }
//
// Decides whether a generation may happen, records the intent, and kicks the
// background function. It never waits on Gemini — a foreground function has a
// ~10s budget and a 2K render takes 30–45s. The browser polls /status.
//
// Order of checks (cheap → expensive, and nothing is charged before all pass):
//   1. session exists, not expired, not already paid
//   2. valid, active style
//   3. cached render → return immediately (dedupe, no call)
//   4. per-session caps: total calls, distinct styles, regens per style
//   5. daily guards: per-IP, global
//   6. mark styling, enqueue

import {
  LIMITS, sanity, docId, getSession, stylesTried, chargeGuards, ipHash,
  json, bad, isPid, nowIso, INTERNAL_HEADER, internalKey, siteUrl,
} from './_shared/personalisation.mts';
import { isStyleKey } from './_shared/styles.mjs';

const LOCKED = new Set(['paid', 'proof-sent', 'approved', 'printed', 'expired']);

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return bad('Method not allowed', 405);

  let body: { pid?: string; styleKey?: string; regenerate?: boolean };
  try {
    body = await req.json();
  } catch {
    return bad('Expected JSON.');
  }
  const { pid, styleKey, regenerate = false } = body;
  if (!isPid(pid)) return bad('Invalid session.');
  if (!styleKey || !isStyleKey(styleKey)) return bad('Unknown style.');

  const s = await getSession(pid);
  if (!s) return bad('Session not found — please upload your photo again.', 404);
  if (LOCKED.has(s.status)) return bad('This design has already been ordered.', 409);
  if (s.expiresAt && s.expiresAt < nowIso()) return bad('This session has expired — please upload your photo again.', 410);
  if (s.status === 'styling') return json(200, { ok: true, status: 'styling', inFlight: true });

  const renders = s.renders || [];
  const tried = stylesTried(s);
  const callsUsed = s.callsUsed || 0;
  const callsLeft = Math.max(0, LIMITS.callsPerSession - callsUsed);

  // 3. cached
  const existing = renders.find((r) => r.styleKey === styleKey && !r.error);
  if (existing && !regenerate) {
    if (s.selectedStyleKey !== styleKey) {
      await sanity.patch(docId(pid)).set({ selectedStyleKey: styleKey, status: 'ready' }).commit();
    }
    return json(200, {
      ok: true, status: 'ready', cached: true, styleKey,
      callsLeft, switchesLeft: Math.max(0, LIMITS.freeSwitches - Math.max(0, tried.length - 1)),
    });
  }

  // 4. session caps
  if (callsLeft <= 0) {
    return bad("You've reached the limit for this photo. Pick your favourite of the styles you've tried, or start again with a new photo.", 429);
  }
  const isNewStyle = !tried.includes(styleKey);
  const switchesUsed = Math.max(0, tried.length - 1);
  if (isNewStyle && tried.length > 0 && switchesUsed >= LIMITS.freeSwitches) {
    return bad(`You can try up to ${LIMITS.freeSwitches + 1} styles per photo. Pick one of the styles you've already tried.`, 429);
  }
  if (regenerate) {
    const regens = renders.filter((r) => r.styleKey === styleKey && !r.error).length - 1;
    if (regens >= LIMITS.regensPerStyle) {
      return bad('That style has been regenerated as many times as we allow — try a different style or photo.', 429);
    }
  }

  // 5. daily guards
  const guard = await chargeGuards(s.ipHash || ipHash(req));
  if (!guard.ok) {
    console.warn(`personalisation-style: guard ${guard.reason} tripped for ${pid}`);
    return bad(
      guard.reason === 'global'
        ? "We're at capacity for today — please come back tomorrow, your photo will still be here."
        : "That's a lot of previews for one day. Please try again tomorrow.",
      503,
    );
  }

  // 6. mark and enqueue
  await sanity
    .patch(docId(pid))
    .set({ status: 'styling', selectedStyleKey: styleKey })
    .inc({ callsUsed: 1 })
    .commit();

  const target = `${siteUrl()}/api/personalisation/style-background`;
  const res = await fetch(target, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [INTERNAL_HEADER]: internalKey() },
    body: JSON.stringify({ pid, styleKey }),
  });
  if (res.status !== 202 && !res.ok) {
    console.error(`personalisation-style: enqueue failed ${res.status}`);
    await sanity.patch(docId(pid)).set({ status: 'ready' }).dec({ callsUsed: 1 }).commit();
    return bad('Could not start styling — please try again.', 502);
  }

  return json(200, {
    ok: true, status: 'styling', styleKey,
    callsLeft: callsLeft - 1,
    switchesLeft: Math.max(0, LIMITS.freeSwitches - (isNewStyle && tried.length > 0 ? switchesUsed + 1 : switchesUsed)),
  });
}

export const config = { path: '/api/personalisation/style' };
