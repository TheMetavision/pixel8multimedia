// netlify/edge-functions/print-file-download.ts
//
// GET /admin/api/print-file/download?order=<orderId>&line=<lineKey>
//     → the order line's finished print file (from Blobs "print-files")
// GET /admin/api/print-file/download?store=personalisation&key=personalisation/<pid>/print.(png|jpg)&name=<file>
//     → a personalised print built by the approve flow (used by the old
//       /admin/personalisation/print route, which redirects here)
//
// WHY AN EDGE FUNCTION: print files run to ~41 MB. Netlify caps a function's
// response at 6 MB buffered and 20 MB streamed
// (https://docs.netlify.com/build/functions/configuration/), so no function can
// return one. Edge functions have no documented response-size limit, can read
// Netlify Blobs, and here the Blobs stream is handed straight to the Response:
// the bytes are piped, not processed, so the 50 ms CPU limit per request
// (https://docs.netlify.com/build/edge-functions/limits/) isn't spent on them.
//
// Auth: admin-auth.ts covers /admin/* too, but this function checks Basic Auth
// itself as well, so it never depends on the order edge functions run in.

import { getStore } from '@netlify/blobs';
import type { Config } from '@netlify/edge-functions';
import { checkBasicAuth } from '../edge-lib/basic-auth.mjs';
import { FILES_STORE, SERVABLE, isSafeId, stateKey } from '../functions/_shared/print-keys.mjs';

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

export default async function handler(req: Request): Promise<Response> {
  const denied = checkBasicAuth(req, {
    user: Netlify.env.get('ADMIN_USER'),
    password: Netlify.env.get('ADMIN_PASSWORD'),
  });
  if (denied) return denied;
  if (req.method !== 'GET' && req.method !== 'HEAD') return text('Method not allowed', 405);

  const url = new URL(req.url);
  let storeName = '';
  let key = '';
  let name = '';

  if (url.searchParams.has('order')) {
    const orderId = url.searchParams.get('order') || '';
    const lineKey = url.searchParams.get('line') || '';
    if (!isSafeId(orderId) || !isSafeId(lineKey)) return text('Bad order or line id.', 400);
    storeName = FILES_STORE;
    const state = await getStore({ name: FILES_STORE, consistency: 'strong' })
      .get(stateKey(orderId, lineKey), { type: 'json' }).catch(() => null) as { state?: string; key?: string } | null;
    if (state?.state !== 'ready' || !state.key) return text('This print file has not been made yet — open the print-file page first.', 409);
    key = state.key;
  } else if (url.searchParams.get('store') === 'personalisation') {
    storeName = 'personalisation';
    key = url.searchParams.get('key') || '';
    name = (url.searchParams.get('name') || '').replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 150);
  } else {
    return text('Nothing to download.', 400);
  }

  if (!SERVABLE[storeName]?.test(key)) return text('That file is not downloadable here.', 400);

  const store = getStore({ name: storeName, consistency: 'strong' });
  const meta = await store.getMetadata(key);
  if (!meta) return text('The file is gone (purged, or never made).', 404);
  const body = await store.get(key, { type: 'stream' });
  if (!body) return text('The file is gone.', 404);

  const ext = key.endsWith('.png') ? 'png' : 'jpg';
  const filename = (meta.metadata as any)?.filename || name || key.split('/').pop();
  const headers: Record<string, string> = {
    'Content-Type': ext === 'png' ? 'image/png' : 'image/jpeg',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store, private',
  };
  const bytes = (meta.metadata as any)?.bytes;
  if (Number.isFinite(bytes)) headers['Content-Length'] = String(bytes);
  return new Response(req.method === 'HEAD' ? null : body, { status: 200, headers });
}

export const config: Config = { path: '/admin/api/print-file/download' };
