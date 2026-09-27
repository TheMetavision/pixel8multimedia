// netlify/functions/print-prewarm-background.mts
//
// POST /api/print-file/prewarm-background   (internal only)
//   { orderId }                          every keyed STOCK line of the order
//                                        (the Stripe webhook, once per new order)
//   { lines: [{ orderId, lineKey }] }    exactly these lines
//                                        (proof approval: the pid's orderedLines)
//
// Makes the print files before anyone opens the order, so the print-file page
// later answers "Ready (already made)". One line after another, through the
// same plan, cache keys, notes and renderer as on-demand
// (_shared/print-job.mjs prewarmLine). Lines already ready or pending, historic
// lines and lines without a master are skipped, and nothing is written for
// them. A failure here costs nothing: the page makes the file when opened.
//
// Internal only: the x-personalisation-key header, checked in constant time,
// because a background function's path is public.

import { prewarmLines, stockLineKeys } from './_shared/print-job.mjs';
import { printDeps } from './_shared/print-deps.mts';
import { isSafeId } from './_shared/print-keys.mjs';
import { isInternal } from './_shared/personalisation.mts';

type Target = { orderId: string; lineKey: string };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!isInternal(req)) return new Response('Forbidden', { status: 403 });

  let body: { orderId?: string; lines?: Target[] } = {};
  try { body = await req.json(); } catch { /* handled below */ }

  let targets: Target[] = [];
  const lines = Array.isArray(body.lines) ? body.lines.filter((t) => isSafeId(t?.orderId) && isSafeId(t?.lineKey)) : null;
  if (!lines?.length && !isSafeId(body.orderId)) return new Response('Nothing to pre-warm', { status: 400 });

  const deps = printDeps(req);
  if (lines) {
    targets = lines;
  } else {
    const order = await deps.fetchOrder(body.orderId!);
    if (!order) {
      console.warn(`print-prewarm: order ${body.orderId} not found`);
      return new Response('Order not found', { status: 404 });
    }
    targets = stockLineKeys(order).map((lineKey: string) => ({ orderId: body.orderId!, lineKey }));
  }
  if (!targets.length) return new Response('Nothing to pre-warm', { status: 400 });

  const t0 = Date.now();
  const results = await prewarmLines(targets, deps);
  const tally: Record<string, number> = {};
  for (const r of results) tally[r.result] = (tally[r.result] || 0) + 1;
  for (const r of results.filter((x: any) => x.result === 'failed')) {
    console.error(`print-prewarm: ${r.orderId} ${r.lineKey} FAILED — ${r.error}`);
  }
  const mem = Math.round(process.memoryUsage().rss / 1048576);
  console.log(`print-prewarm: ${results.length} line(s) ${JSON.stringify(tally)} in ${Date.now() - t0} ms, rss ${mem} MB`);
  return new Response('OK', { status: 200 });
}

// As print-file-background: memory declared in source (renders peak ~210 MB,
// one at a time here).
export const config = { path: '/api/print-file/prewarm-background', memory: '3gb' };
