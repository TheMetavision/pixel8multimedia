// netlify/functions/print-file-page.mts
//
// GET /admin/print-file/<orderId>/<lineKey>
//
// What the Studio's "Download print file" link opens. Starts the job, shows
// "Preparing…" while it polls, then offers the download (streamed by the
// print-file-download edge function). Order ids contain dots
// (order.cs_live_…), so the ids are taken from the path segments as they are.
//
// Behind admin-auth.ts like everything under /admin/*: the browser already
// holds the Basic Auth credentials for the page, and sends them with the
// page's own fetches to /admin/api/print-file/*.

import { isSafeId } from './_shared/print-keys.mjs';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith('/admin/print-file/')) return new Response('Not found', { status: 404 });
  const [orderId = '', lineKey = ''] = url.pathname.slice('/admin/print-file/'.length).split('/').map(decodeURIComponent);
  if (!isSafeId(orderId) || !isSafeId(lineKey)) {
    return new Response('That print-file link is malformed.', { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  const q = `order=${encodeURIComponent(orderId)}&line=${encodeURIComponent(lineKey)}`;

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Print file · Pixel8 admin</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0D0D0F;color:#F5F5F0;font-family:system-ui,Arial,sans-serif;padding:24px}
  .card{max-width:520px;width:100%;background:#131316;border:1px solid #2A2A2E;border-top:3px solid #F07828;border-radius:8px;padding:28px}
  h1{font-size:20px;margin:0 0 6px} .sub{color:#888;font-size:12px;word-break:break-all;margin:0 0 20px}
  #msg{color:#ccc;line-height:1.6} dl{display:grid;grid-template-columns:auto 1fr;gap:4px 16px;color:#bbb;font-size:14px}
  dt{color:#777} a.btn,button{display:inline-block;margin-top:18px;background:#F07828;color:#000;font-weight:700;border:0;border-radius:6px;padding:12px 18px;text-decoration:none;cursor:pointer;font-size:15px}
  .err{color:#ff8a80} .spin{display:inline-block;width:12px;height:12px;border:2px solid #555;border-top-color:#F07828;border-radius:50%;animation:s 1s linear infinite;margin-right:8px;vertical-align:-1px}
  @keyframes s{to{transform:rotate(360deg)}}
</style></head><body><div class="card">
<h1>Print file</h1><p class="sub">${esc(orderId)} · ${esc(lineKey)}</p>
<div id="msg"><span class="spin"></span>Preparing…</div><div id="out"></div>
</div>
<script>
const Q = ${JSON.stringify(q)};
const msg = document.getElementById('msg'), out = document.getElementById('out');
const mb = (b) => (b / 1048576).toFixed(1) + ' MB';
function ready(r) {
  msg.textContent = r.cached ? 'Ready (already made).' : 'Ready.';
  out.innerHTML = '<dl>' +
    '<dt>Pixels</dt><dd>' + r.width + ' × ' + r.height + ' at ' + r.dpi + ' dpi</dd>' +
    '<dt>Size / finish</dt><dd>' + r.sizeKey + ' · ' + r.formatKey + '</dd>' +
    '<dt>Wrap colour</dt><dd>' + r.wrapColour + ' (' + (r.wrapSource === 'override' ? 'override' : 'from the artwork\\'s edges') + ')</dd>' +
    '<dt>File</dt><dd>' + mb(r.bytes) + ' JPEG</dd></dl>' +
    '<a class="btn" href="/admin/api/print-file/download?' + Q + '">Download print file</a>';
}
function fail(text) { msg.innerHTML = '<span class="err"></span>'; msg.firstChild.textContent = text; out.innerHTML = '<button onclick="location.reload()">Try again</button>'; }
async function call(path, init) {
  const res = await fetch('/admin/api/print-file/' + path + '?' + Q, init);
  return res.json().catch(() => ({ state: 'failed', error: 'HTTP ' + res.status }));
}
const words = { historic: 'Historic line — no print data.', 'no-source': null, 'not-found': null, invalid: null };
async function poll(tries) {
  const r = await call('status');
  if (r.state === 'ready') return ready(r);
  if (r.state === 'failed') return fail('The render failed: ' + (r.error || 'unknown error'));
  if (tries > 200) return fail('Still not ready after 5 minutes — check the print-file-background log.');
  setTimeout(() => poll(tries + 1), 1500);
}
(async () => {
  const r = await call('start', { method: 'POST' });
  if (r.state === 'ready') return ready(r);
  if (r.state === 'pending') return poll(0);
  if (r.state in words) return fail(words[r.state] || r.message || r.state);
  fail(r.error || r.message || 'Could not start: ' + r.state);
})();
</script></body></html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export const config = { path: '/admin/print-file/*' };
