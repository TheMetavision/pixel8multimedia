// netlify/functions/personalisation-approve.mts
//
// GET /api/personalisation/approve?pid=…&token=…
//
// The link in the proof email. Consumes the token (so a forwarded email can't
// re-approve), marks the session approved, and kicks off the print build in
// the background. Returns a small HTML page rather than JSON — a customer is
// clicking this from their inbox.
//
// Deliberately idempotent-ish: clicking twice shows "already approved" rather
// than an error, because people do click twice.

import {
  sanity, docId, getSession, isPid, nowIso, siteUrl, INTERNAL_HEADER, internalKey,
} from './_shared/personalisation.mts';
import { triggerInternal } from './_shared/origin.mjs';

function page(title: string, body: string, tone: 'ok' | 'info' | 'error' = 'ok'): Response {
  const accent = tone === 'error' ? '#E5484D' : tone === 'info' ? '#22D3EE' : '#76FF03';
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} · Pixel8 Multimedia</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       background:#0D0D0F;color:#F5F5F0;font-family:'DM Sans',system-ui,Arial,sans-serif;padding:24px}
  .card{max-width:480px;background:#131316;border:1px solid #2A2A2E;border-top:3px solid ${accent};
        border-radius:8px;padding:36px 32px;text-align:center}
  h1{font-family:Montserrat,system-ui,Arial,sans-serif;font-size:22px;margin:0 0 12px}
  p{color:#999;line-height:1.65;margin:0 0 16px}
  a{display:inline-block;margin-top:12px;color:#F07828;text-decoration:none;font-weight:600}
  a:hover{text-decoration:underline}
</style></head><body>
<div class="card"><h1>${title}</h1>${body}
<a href="${siteUrl()}/store">Back to the shop</a></div></body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  );
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pid = url.searchParams.get('pid');
  const token = url.searchParams.get('token');

  if (!isPid(pid) || !token) {
    return page('That link looks wrong', '<p>Please use the button in your proof email, or reply to it and we\u2019ll help.</p>', 'error');
  }

  const s = await getSession(pid);
  if (!s) {
    return page('We couldn\u2019t find that design', '<p>Reply to your proof email and we\u2019ll sort it out.</p>', 'error');
  }

  if (s.status === 'approved' || s.status === 'printed') {
    return page('Already approved', '<p>Thanks — this design is approved and in the queue. We\u2019ll email you when it\u2019s on its way.</p>', 'info');
  }

  const stored = (s as any).proofToken;
  if (!stored || stored !== token) {
    return page('That link has expired', '<p>It may already have been used. Reply to your proof email and we\u2019ll send a fresh one.</p>', 'error');
  }

  await sanity
    .patch(docId(pid))
    .set({ status: 'approved', approvedAt: nowIso() })
    .unset(['proofToken'])   // single use
    .commit();

  // Build the print file in the background. AWAITED: the old fire-and-forget
  // fetch could be frozen with this function once it returned, so the build
  // silently never started in production. A background function answers 202
  // as soon as it's queued, so the customer waits well under a second. If it
  // can't be started after retries, flag the session for the Studio "Needs
  // attention" list; the customer still sees their approval confirmed.
  const trigger = await triggerInternal('/api/personalisation/print-background', {
    req,
    body: { pid },
    headers: { [INTERNAL_HEADER]: internalKey() },
  });
  if (!trigger.ok) {
    console.error(`approve: print trigger FAILED for ${pid}: ${trigger.error}`);
    await sanity
      .patch(docId(pid))
      .set({ printTriggerError: `${nowIso()} — ${String(trigger.error).slice(0, 200)}` })
      .commit()
      .catch((e: any) => console.error(`approve: could not flag ${pid}:`, e?.message));
  }

  console.log(`personalisation-approve: ${pid} approved`);
  return page(
    'Approved — thank you',
    '<p>Your design is off to the printer. We\u2019ll email you tracking details once it\u2019s dispatched, usually within 3\u20136 working days.</p>',
  );
}

export const config = { path: '/api/personalisation/approve' };
