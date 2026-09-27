// netlify/functions/print-file-api.mts
//
// POST /admin/api/print-file/start?order=<orderId>&line=<lineKey>
// GET  /admin/api/print-file/status?order=<orderId>&line=<lineKey>
//
// The fast half of the print-file flow (ported from Comic Strip Canvas's
// order-print-file). start answers a cache hit at once, or writes a pending
// note and hands the render to print-file-background; status reports the note.
// The download itself is an edge function (print-file-download), because a
// print file is up to ~41 MB and a function response is capped at 6 MB
// buffered / 20 MB streamed.
//
// UNDER /admin ON PURPOSE: admin-auth.ts puts Basic Auth in front of /admin/*.
// The path is checked here too, so a request that reached this function any
// other way is refused.

import { startJob, jobStatus } from './_shared/print-job.mjs';
import { printDeps } from './_shared/print-deps.mts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith('/admin/api/print-file/')) return new Response('Not found', { status: 404 });

  const action = url.pathname.split('/').pop();
  const orderId = url.searchParams.get('order') || '';
  const lineKey = url.searchParams.get('line') || '';

  try {
    if (action === 'start') {
      if (req.method !== 'POST') return json({ error: 'start is a POST' }, 405);
      const r = await startJob(orderId, lineKey, printDeps(req));
      console.log(`print-file: start ${orderId} ${lineKey} → ${r.state}${(r as any).cached ? ' (cache hit)' : ''}`);
      return json(r, r.state === 'failed' ? 502 : r.state === 'invalid' ? 400 : 200);
    }
    if (action === 'status') {
      return json(await jobStatus(orderId, lineKey, printDeps(req)));
    }
    return json({ error: `unknown action "${action}"` }, 404);
  } catch (err: any) {
    console.error(`print-file: ${action} ${orderId} ${lineKey} failed:`, err?.message);
    return json({ state: 'failed', error: 'server error — see the function log' }, 500);
  }
}

export const config = { path: ['/admin/api/print-file/start', '/admin/api/print-file/status'] };
