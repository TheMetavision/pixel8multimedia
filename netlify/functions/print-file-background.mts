// netlify/functions/print-file-background.mts
//
// POST /api/print-file/render-background   { orderId, lineKey }   (internal only)
//
// Renders one order line's print file and stores it in Blobs "print-files",
// then marks the line's .state ready (or failed, with the reason). Started,
// awaited, by print-file-api's start; a background function so the render has
// up to 15 minutes, though the largest sheet (7050 px) takes a few seconds.
//
// Internal only: it checks the x-personalisation-key header in constant time
// and refuses anything else, because a background function's path is public.

import { runRender } from './_shared/print-job.mjs';
import { printDeps } from './_shared/print-deps.mts';
import { isInternal } from './_shared/personalisation.mts';

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!isInternal(req)) return new Response('Forbidden', { status: 403 });

  let body: { orderId?: string; lineKey?: string } = {};
  try { body = await req.json(); } catch { /* handled below */ }
  const { orderId = '', lineKey = '' } = body;
  if (!orderId || !lineKey) return new Response('Bad request', { status: 400 });

  const t0 = Date.now();
  const r = await runRender(orderId, lineKey, printDeps(req));
  const mem = Math.round(process.memoryUsage().rss / 1048576);
  if (r.ok) {
    const m: any = (r as any).metadata;
    console.log(`print-file: ${orderId} ${lineKey} ${r.cached ? 'already made' : `rendered ${m.width}px ${(m.bytes / 1048576).toFixed(1)} MB wrap ${m.wrapColour}`} in ${Date.now() - t0} ms, rss ${mem} MB`);
  } else {
    console.error(`print-file: ${orderId} ${lineKey} FAILED — ${r.error} (rss ${mem} MB)`);
  }
  return new Response(r.ok ? 'OK' : 'Failed', { status: r.ok ? 200 : 500 });
}

// Memory declared in source, as Comic Strip Canvas does (its notes record that
// the netlify.toml memory key wasn't applied). Netlify documents this setting
// for credit-based Pro and Enterprise plans; the render itself peaks at ~210 MB
// (measured on the heaviest master at 7050 px), so it fits the 1024 MB default
// either way.
export const config = { path: '/api/print-file/render-background', memory: '3gb' };
