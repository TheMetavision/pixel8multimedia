// netlify/functions/print-any-api.mts
//
// GET  /admin/api/print-any/products   stock products for the picker (+ whether each has a master)
// POST /admin/api/print-any/start      { slug, size, finish, wrap?, channel, reference? }
// GET  /admin/api/print-any/status?key=print/adhoc/…
// GET  /admin/api/print-any/history    the last 50 files made
//
// The API behind /admin/print-any: print files for a stock product with no
// site order (marketplace sales). Same start/status flow, renderer and
// download edge function as order lines — see _shared/print-adhoc.mjs.
//
// UNDER /admin ON PURPOSE: admin-auth.ts puts Basic Auth in front of /admin/*.
// The path is checked here too, so a request that reached this function any
// other way is refused. The order reference is never logged.

import { startAdhoc, adhocStatus, readHistory, CHANNELS } from './_shared/print-adhoc.mjs';
import { printDeps } from './_shared/print-deps.mts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const PREFIX = '/admin/api/print-any/';

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith(PREFIX)) return new Response('Not found', { status: 404 });
  const action = url.pathname.slice(PREFIX.length);
  const deps = printDeps(req);

  try {
    if (action === 'products') {
      const products = await deps.listProducts();
      // Which have a master: one listing of print-masters rather than 1,490
      // lookups. If the listing fails the picker still works (unknown = allowed;
      // start refuses a missing master anyway).
      let masters: Set<string> | null = null;
      try { masters = new Set(await deps.listMasters()); } catch (err: any) {
        console.warn('print-any: could not list print-masters:', err?.message);
      }
      return json({
        channels: CHANNELS,
        products: (products || []).map((p: any) => ({ ...p, master: masters ? masters.has(p.slug) : null })),
      });
    }
    if (action === 'start') {
      if (req.method !== 'POST') return json({ error: 'start is a POST' }, 405);
      let body: Record<string, unknown> = {};
      try { body = await req.json(); } catch { return json({ state: 'invalid', message: 'Send JSON.' }, 400); }
      const r: any = await startAdhoc(body, deps);
      console.log(`print-any: start ${String(body.slug ?? '').slice(0, 120)} ${String(body.size ?? '')} ${String(body.finish ?? '')} ${String(body.channel ?? '').slice(0, 20)} → ${r.state}${r.cached ? ' (cache hit)' : ''}`);
      const status = r.state === 'failed' ? 502 : ['invalid', 'unknown', 'no-source'].includes(r.state) ? 400 : 200;
      return json(r, status);
    }
    if (action === 'status') {
      const r = await adhocStatus(url.searchParams.get('key') || '', deps);
      return json(r, r.state === 'invalid' ? 400 : 200);
    }
    if (action === 'history') {
      return json({ entries: await readHistory(deps) });
    }
    return json({ error: `unknown action "${action}"` }, 404);
  } catch (err: any) {
    console.error(`print-any: ${action} failed:`, err?.message);
    return json({ state: 'failed', error: 'server error — see the function log' }, 500);
  }
}

export const config = {
  path: ['/admin/api/print-any/products', '/admin/api/print-any/start', '/admin/api/print-any/status', '/admin/api/print-any/history'],
};
