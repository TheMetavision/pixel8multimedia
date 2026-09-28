// netlify/functions/commission-artwork-verify-background.mts
//
// POST /api/commission-artwork/verify-background   { orderRef, uploadId }   (internal only)
//
// Re-hashes an uploaded artwork file's stored parts, in order, and compares
// the sha256 with the one the browser computed from the original file. Only
// an exact match marks it complete and lists it on the commission; a mismatch
// marks it failed and deletes the parts. A background function because a
// multi-gigabyte file takes longer than a synchronous function may run.
//
// Internal only: x-personalisation-key, checked in constant time, because a
// background function's path is public.

import { verifyUpload } from './_shared/commission-artwork.mjs';
import { artworkDeps } from './_shared/artwork-deps.mts';
import { isInternal } from './_shared/personalisation.mts';

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!isInternal(req)) return new Response('Forbidden', { status: 403 });
  let body: { orderRef?: string; uploadId?: string } = {};
  try { body = await req.json(); } catch { /* handled below */ }
  if (!body.orderRef || !body.uploadId) return new Response('Bad request', { status: 400 });

  const t0 = Date.now();
  const r: any = await verifyUpload({ orderRef: body.orderRef, uploadId: body.uploadId }, artworkDeps(req));
  const what = `${body.orderRef} ${String(body.uploadId).slice(0, 8)}`;
  if (r.ok) console.log(`artwork: verified ${what} ${r.size} bytes in ${Date.now() - t0} ms — ${r.state}${r.listed ? ', listed on the commission' : ''}`);
  else console.error(`artwork: verify ${what} FAILED — ${r.error}`);
  return new Response(r.ok ? 'OK' : 'Failed', { status: r.ok ? 200 : 500 });
}

export const config = { path: '/api/commission-artwork/verify-background' };
