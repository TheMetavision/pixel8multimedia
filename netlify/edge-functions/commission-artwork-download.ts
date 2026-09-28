// netlify/edge-functions/commission-artwork-download.ts
//
// GET /download/artwork?id=&file=&exp=&sig=
//     The customer's signed link (emailed by commission-deliver) for finished
//     artwork stored in Blobs "commission-artwork". Same parameters, same
//     secret (DOWNLOAD_LINK_SECRET) and same expiry rule as
//     /.netlify/functions/commission-download, which still serves links for
//     Sanity-hosted files until they expire. `file` is "blob:<orderRef>/<id>".
// GET /admin/api/commission-artwork/download?order=<orderRef>&upload=<id>
//     The same file for the admin (Basic Auth; admin-auth.ts covers /admin/*
//     too, but this checks for itself).
//
// WHY AN EDGE FUNCTION: artwork can be gigabytes. A function's response is
// capped at 6 MB buffered / 20 MB streamed; an edge function has no documented
// response-size limit. The parts are streamed in order as one file with its
// full Content-Length; nothing is buffered.

import { getStore } from '@netlify/blobs';
import type { Config } from '@netlify/edge-functions';
import { checkBasicAuth } from '../edge-lib/basic-auth.mjs';
import { verifyDownloadLink, completeManifest, streamParts, downloadHeaders } from '../edge-lib/artwork-stream.mjs';
import { ARTWORK_STORE, isOrderRef, isArtworkId, parseFileRef } from '../functions/_shared/artwork-keys.mjs';

const SANITY_QUERY_URL = 'https://bqb4w421.api.sanity.io/v2024-12-01/data/query/production';

function page(title: string, message: string, status: number): Response {
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Pixel8 Multimedia</title><style>
*{margin:0;padding:0;box-sizing:border-box}body{min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f7;color:#1a1a2e;padding:2rem}
.card{max-width:420px;background:#fff;border-radius:12px;padding:2.5rem;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,0.06)}.card h1{font-size:1.5rem;margin-bottom:0.75rem;color:#dc2626}
.card p{font-size:0.9375rem;line-height:1.6;color:#6b7280;margin-bottom:1.5rem}.card a{display:inline-block;padding:0.75rem 1.5rem;background:#7c3aed;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:0.875rem}
.brand{font-size:0.75rem;color:#9ca3af;margin-top:1.5rem}</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p><a href="/">Back to Pixel8 Multimedia</a><p class="brand">hello@pixel8multimedia.co.uk</p></div></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
const text = (body: string, status: number) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

/** The commission the link was signed for (published doc; old links carry its legacyId). */
async function fetchCommission(id: string) {
  const token = Netlify.env.get('SANITY_TOKEN');
  if (!token) throw new Error('SANITY_TOKEN not set');
  const q = '*[_type == "commission" && !(_id in path("drafts.**")) && (_id == $id || legacyId == $id)][0]{ status, orderRef, "uploads": finishedArtwork[].uploadId }';
  const url = `${SANITY_QUERY_URL}?query=${encodeURIComponent(q)}&%24id=${encodeURIComponent(JSON.stringify(id))}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sanity ${res.status}`);
  return (await res.json()).result as { status?: string; orderRef?: string; uploads?: string[] } | null;
}

function serve(req: Request, m: any): Response {
  const store = getStore({ name: ARTWORK_STORE, consistency: 'strong' });
  return new Response(req.method === 'HEAD' ? null : streamParts(store, m), { status: 200, headers: downloadHeaders(m) });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return text('Method not allowed', 405);
  const url = new URL(req.url);
  const store = () => getStore({ name: ARTWORK_STORE, consistency: 'strong' });

  // ── Admin ──
  if (url.pathname.startsWith('/admin/')) {
    const denied = checkBasicAuth(req, { user: Netlify.env.get('ADMIN_USER'), password: Netlify.env.get('ADMIN_PASSWORD') });
    if (denied) return denied;
    const orderRef = url.searchParams.get('order') || '';
    const uploadId = url.searchParams.get('upload') || '';
    if (!isOrderRef(orderRef) || !isArtworkId(uploadId)) return text('Bad order or upload id.', 400);
    const m = await completeManifest(store(), orderRef, uploadId);
    return m ? serve(req, m) : text('No finished file with that id (still uploading, failed, or never made).', 404);
  }

  // ── Customer: the signed link ──
  const p = { id: url.searchParams.get('id') || '', file: url.searchParams.get('file') || '', exp: url.searchParams.get('exp') || '', sig: url.searchParams.get('sig') || '' };
  const v = await verifyDownloadLink(p, Netlify.env.get('DOWNLOAD_LINK_SECRET') || '');
  if (!v.ok) {
    if (v.status === 410) return page('Link expired', 'This download link has expired. Please contact us at hello@pixel8multimedia.co.uk for a new link.', 410);
    if (v.status === 400) return page('Invalid download link', 'The link is missing required parameters.', 400);
    if (v.status === 403) return page('Invalid link', 'This download link is invalid or has been tampered with.', 403);
    console.error('artwork-download: DOWNLOAD_LINK_SECRET not set');
    return page('Download failed', 'Something went wrong. Please try again or contact us.', 500);
  }
  const ref = parseFileRef(p.file);
  if (!ref) return page('File not found', 'The requested file could not be located.', 404);

  try {
    const c = await fetchCommission(p.id);
    if (!c || c.orderRef !== ref.orderRef || !(c.uploads || []).includes(ref.uploadId)) {
      return page('File not found', 'The requested file could not be located.', 404);
    }
    if (!['complete', 'delivered'].includes(c.status || '')) {
      return page('Not available', 'This file is not yet available for download.', 403);
    }
    const m = await completeManifest(store(), ref.orderRef, ref.uploadId);
    if (!m) return page('File not found', 'The requested file could not be located.', 404);
    console.log(`artwork-download: ${ref.orderRef} ${ref.uploadId.slice(0, 8)} ${m.size} bytes`);
    return serve(req, m);
  } catch (err: any) {
    console.error('artwork-download error:', err?.message);
    return page('Download failed', 'Something went wrong. Please try again or contact us.', 500);
  }
}

export const config: Config = { path: ['/download/artwork', '/admin/api/commission-artwork/download'] };
