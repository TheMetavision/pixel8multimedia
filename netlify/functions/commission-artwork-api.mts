// netlify/functions/commission-artwork-api.mts
//
// POST /admin/api/commission-artwork/init       { orderRef, name, size, lastModified, filename? }
// PUT  /admin/api/commission-artwork/part?order=&upload=&n=   raw bytes, header x-part-sha256
// GET  /admin/api/commission-artwork/status?order=&upload=
// POST /admin/api/commission-artwork/complete   { orderRef, uploadId, sha256 }
// GET  /admin/api/commission-artwork/list?order=
//
// The API behind /admin/commission-artwork/<orderRef>: finished artwork in
// parts of 4,000,000 bytes (a function request body is capped at ~6 MB,
// ~4.5 MB of binary). See _shared/commission-artwork.mjs.
//
// UNDER /admin ON PURPOSE: admin-auth.ts puts Basic Auth in front of /admin/*.
// The path is checked here too. Logs order refs, ids and sizes only.

import { initUpload, putPart, uploadStatus, completeUpload } from './_shared/commission-artwork.mjs';
import { artworkDeps } from './_shared/artwork-deps.mts';
import { PART_SIZE, isOrderRef } from './_shared/artwork-keys.mjs';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const answer = (r: any) => json(r, r.ok ? 200 : r.status || 400);

const PREFIX = '/admin/api/commission-artwork/';

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith(PREFIX)) return new Response('Not found', { status: 404 });
  const action = url.pathname.slice(PREFIX.length);
  const q = (k: string) => url.searchParams.get(k) || '';

  try {
    const deps = artworkDeps(req);
    if (action === 'part') {
      if (req.method !== 'PUT') return json({ ok: false, error: 'part is a PUT' }, 405);
      const len = Number(req.headers.get('content-length') || 0);
      if (len > PART_SIZE) return json({ ok: false, error: `A part is at most ${PART_SIZE} bytes.` }, 413);
      const bytes = new Uint8Array(await req.arrayBuffer());
      return answer(await putPart({ orderRef: q('order'), uploadId: q('upload'), n: q('n'), bytes, sha256: req.headers.get('x-part-sha256') }, deps));
    }
    if (action === 'status') return answer(await uploadStatus({ orderRef: q('order'), uploadId: q('upload') }, deps));
    if (action === 'list') {
      if (!isOrderRef(q('order'))) return json({ ok: false, error: 'Bad order reference.' }, 400);
      const c = await deps.findCommission(q('order'));
      if (!c) return json({ ok: false, error: `No commission ${q('order')}.` }, 404);
      return json({ ok: true, orderRef: c.orderRef, status: c.status, deliveryType: c.deliveryType, artwork: c.artwork || [] });
    }
    if (req.method !== 'POST') return json({ ok: false, error: `${action} is a POST` }, 405);
    let body: any = {};
    try { body = await req.json(); } catch { return json({ ok: false, error: 'Send JSON.' }, 400); }
    if (action === 'init') {
      const r: any = await initUpload(body, deps);
      if (r.ok) console.log(`artwork: init ${body.orderRef} ${r.uploadId.slice(0, 8)} ${r.size} bytes ${r.parts} part(s) → ${r.state}${r.received?.length ? ` (resuming, ${r.received.length} have)` : ''}`);
      return answer(r);
    }
    if (action === 'complete') {
      const r: any = await completeUpload(body, deps);
      console.log(`artwork: complete ${String(body.orderRef).slice(0, 40)} ${String(body.uploadId).slice(0, 8)} → ${r.ok ? r.state : `refused: ${r.error}`}`);
      return answer(r);
    }
    return json({ ok: false, error: `unknown action "${action}"` }, 404);
  } catch (err: any) {
    console.error(`artwork: ${action} failed:`, err?.message);
    return json({ ok: false, error: 'Server error — see the function log.' }, 500);
  }
}

export const config = {
  path: ['/admin/api/commission-artwork/init', '/admin/api/commission-artwork/part', '/admin/api/commission-artwork/status',
    '/admin/api/commission-artwork/complete', '/admin/api/commission-artwork/list'],
};
