// netlify/functions/sanity-content-changed.mts
//
// POST /api/sanity/content-changed   (the Sanity "Netlify rebuild" webhook)
//
// Content that static pages read at build time was published, changed or
// deleted. Checks Sanity's signature (SANITY_WEBHOOK_SECRET, the same secret
// commission-deliver uses), records the change in Blobs "content-build", and
// starts the debounce waiter if none is running. The build itself happens
// there — see _shared/content-build.mjs.
//
// Answers fast: Sanity sends one request at a time per webhook and retries a
// 5xx twice, 30 s apart. A failure to start the waiter answers 500 so that
// retry re-arms it.

import { getStore } from '@netlify/blobs';
import { isValidSignature, SIGNATURE_HEADER_NAME } from '@sanity/webhook';
import { classify, recordChange, disarm, STATE_STORE } from './_shared/content-build.mjs';
import { triggerInternal, TRIGGER_BUDGETS } from './_shared/origin.mjs';
import { INTERNAL_HEADER, internalKey } from './_shared/personalisation.mts';

const text = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return text('Method not allowed', 405);

  const secret = process.env.SANITY_WEBHOOK_SECRET;
  if (!secret) {
    console.error('content-changed: SANITY_WEBHOOK_SECRET not set — refusing');
    return text('Webhook secret not configured', 500);
  }
  const body = await req.text();
  const sig = req.headers.get(SIGNATURE_HEADER_NAME);
  let valid = false;
  try { valid = Boolean(sig) && (await isValidSignature(body, sig!, secret)); } catch { valid = false; }
  if (!valid) {
    console.warn('content-changed: invalid or missing signature');
    return text('Invalid signature', 401);
  }

  let payload: any = null;
  try { payload = JSON.parse(body); } catch { return text('Bad JSON', 400); }
  const c = classify(payload);
  if (!c.build) {
    console.log(`content-changed: ignored (${c.reason})`);
    return text(`Ignored: ${c.reason}`);
  }

  const store = getStore({ name: STATE_STORE, consistency: 'strong' });
  const now = Date.now();
  const { arm, state } = await recordChange(store, { now, type: c.type! });
  if (arm) {
    const r = await triggerInternal('/api/sanity/build-debounce-background', {
      req,
      body: {},
      headers: { [INTERNAL_HEADER]: internalKey() },
      ...TRIGGER_BUDGETS.prewarm,
    });
    if (!r.ok) {
      await disarm(store, now).catch(() => {});
      console.error(`content-changed: could not start the build waiter (${r.error}) — asking Sanity to retry`);
      return text('Could not queue the build', 500);
    }
  }
  console.log(`content-changed: change to ${c.type} — ${state.changes} pending${arm ? ', waiter started' : ''}`);
  return text('Queued');
}

export const config = { path: '/api/sanity/content-changed' };
