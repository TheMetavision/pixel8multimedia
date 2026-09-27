// netlify/edge-functions/commission-photo.ts
//
// GET /admin/commission-photo/<uploadId>/<file>.<ext>
//   → the customer's commission photo commission-upload/<uploadId>/<file>.<ext>
//     from the private Blobs store "commission-uploads", shown inline.
//
// The Studio's commission view links here (one link per photo). Behind
// admin-auth.ts like everything under /admin/*, and it checks Basic Auth
// itself too, so it never depends on the order edge functions run in.
// Streams the blob rather than buffering it (a function's response is capped
// at 6 MB buffered / 20 MB streamed; an edge function has no documented cap).

import { getStore } from '@netlify/blobs';
import type { Config } from '@netlify/edge-functions';
import { checkBasicAuth } from '../edge-lib/basic-auth.mjs';
import { UPLOADS_STORE, KEY_PREFIX, isUploadKey } from '../functions/_shared/commission-uploads.mjs';

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

export default async function handler(req: Request): Promise<Response> {
  const denied = checkBasicAuth(req, {
    user: Netlify.env.get('ADMIN_USER'),
    password: Netlify.env.get('ADMIN_PASSWORD'),
  });
  if (denied) return denied;
  if (req.method !== 'GET' && req.method !== 'HEAD') return text('Method not allowed', 405);

  const rest = new URL(req.url).pathname.replace(/^\/admin\/commission-photo\//, '');
  const key = `${KEY_PREFIX}${decodeURIComponent(rest)}`;
  if (!isUploadKey(key)) return text('Not a commission photo address.', 400);

  const store = getStore({ name: UPLOADS_STORE, consistency: 'strong' });
  const meta = await store.getMetadata(key);
  if (!meta) return text('That photo is gone (deleted with an abandoned checkout, or never uploaded).', 404);
  const body = await store.get(key, { type: 'stream' });
  if (!body) return text('That photo is gone.', 404);

  const md = (meta.metadata || {}) as { contentType?: string; bytes?: number };
  const headers: Record<string, string> = {
    'Content-Type': md.contentType || 'application/octet-stream',
    'Content-Disposition': `inline; filename="${key.split('/').pop()}"`,
    'Cache-Control': 'no-store, private',
    'X-Content-Type-Options': 'nosniff',
  };
  if (Number.isFinite(md.bytes)) headers['Content-Length'] = String(md.bytes);
  return new Response(req.method === 'HEAD' ? null : body, { status: 200, headers });
}

export const config: Config = { path: '/admin/commission-photo/*' };
