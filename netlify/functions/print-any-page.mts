// netlify/functions/print-any-page.mts
//
// GET /admin/print-any
//
// Print files for any stock product without a site order (Amazon, Etsy,
// Groupon…): pick a product, size, finish, optional wrap colour, the channel
// and the marketplace's order number, then download the file. Same renderer
// and download as the order print-file page; see _shared/print-adhoc.mjs.
// Deliberately NOT under /admin/print-file/, whose segments are order ids.
//
// Behind admin-auth.ts like everything under /admin/*: the browser already
// holds the Basic Auth credentials for the page, and sends them with the
// page's own fetches to /admin/api/print-any/*. Everything the page shows from
// the API is set as text, never as HTML.

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Print any product · Pixel8 admin</title>
<style>
  *{box-sizing:border-box} body{margin:0;background:#0D0D0F;color:#F5F5F0;font-family:system-ui,Arial,sans-serif;padding:24px}
  main{max-width:920px;margin:0 auto} .card{background:#131316;border:1px solid #2A2A2E;border-top:3px solid #F07828;border-radius:8px;padding:24px;margin-bottom:20px}
  h1{font-size:22px;margin:0 0 6px} h2{font-size:16px;margin:0 0 12px} .note{color:#999;font-size:13px;line-height:1.6;margin:0 0 16px}
  label{display:block;color:#aaa;font-size:13px;margin:14px 0 6px} input,select{width:100%;background:#0D0D0F;color:#F5F5F0;border:1px solid #333;border-radius:6px;padding:10px;font-size:15px}
  .row{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}
  #results{max-height:320px;overflow:auto;border:1px solid #2A2A2E;border-radius:6px;margin-top:8px}
  .p{display:flex;gap:10px;align-items:center;width:100%;background:none;border:0;border-bottom:1px solid #1f1f23;color:inherit;text-align:left;padding:6px 10px;cursor:pointer;font-size:14px}
  .p:hover,.p.sel{background:#1d1d22} .p img{width:44px;height:44px;object-fit:cover;border-radius:4px;background:#222;flex:none}
  .p small{display:block;color:#777} .p[disabled]{opacity:.45;cursor:not-allowed}
  #chosen{margin-top:10px;color:#F07828;font-weight:600;min-height:1.2em}
  .wrap{display:flex;gap:8px;align-items:center} .wrap input[type=color]{width:52px;padding:2px;height:42px} .wrap input[type=checkbox]{width:auto}
  button.go,a.btn{display:inline-block;margin-top:18px;background:#F07828;color:#000;font-weight:700;border:0;border-radius:6px;padding:12px 18px;text-decoration:none;cursor:pointer;font-size:15px}
  button.go[disabled]{opacity:.5;cursor:wait} #msg{margin-top:16px;color:#ccc;line-height:1.6} .err{color:#ff8a80}
  dl{display:grid;grid-template-columns:auto 1fr;gap:4px 16px;color:#bbb;font-size:14px} dt{color:#777}
  .spin{display:inline-block;width:12px;height:12px;border:2px solid #555;border-top-color:#F07828;border-radius:50%;animation:s 1s linear infinite;margin-right:8px;vertical-align:-1px}
  @keyframes s{to{transform:rotate(360deg)}}
  .tbl{overflow-x:auto} table{width:100%;border-collapse:collapse;font-size:13px} th,td{padding:6px 8px;border-bottom:1px solid #222;text-align:left;white-space:nowrap} th{color:#F07828;font-weight:600} td a{color:#F07828}
</style></head><body><main>
<div class="card">
  <h1>Print any product</h1>
  <p class="note">For marketplace sales with no site order. <strong>Stock products only</strong> — personalised (Your Photo) and commission artwork aren't covered here. Same print spec and renderer as site orders; asking again for the same product, size, finish and wrap is instant.</p>

  <label for="q">Product</label>
  <input id="q" type="search" placeholder="Search by title or slug…" autocomplete="off">
  <div id="results"></div>
  <div id="chosen"></div>

  <div class="row">
    <div><label for="size">Size</label>
      <select id="size"><option value="12">12 × 12"</option><option value="16">16 × 16"</option><option value="20">20 × 20"</option></select></div>
    <div><label for="finish">Finish</label>
      <select id="finish"><option value="poster">Poster</option><option value="standard">Canvas — standard frame</option><option value="gallery">Canvas — gallery frame</option></select></div>
    <div><label for="channel">Channel</label>
      <select id="channel"><option value="">Choose…</option></select></div>
  </div>
  <label>Wrap colour</label>
  <div class="wrap"><input id="wrapOn" type="checkbox"><input id="wrap" type="color" value="#000000" disabled><span id="wrapNote" class="note" style="margin:0">Automatic (from the artwork's edges)</span></div>
  <label for="ref">Order reference</label>
  <input id="ref" maxlength="60" placeholder="The marketplace's order number — no customer names">

  <button class="go" id="go">Make print file</button>
  <div id="msg"></div><div id="out"></div>
</div>

<div class="card">
  <h2>Recent ad-hoc files (last 50)</h2>
  <div class="tbl"><table><thead><tr><th>Date</th><th>Channel</th><th>Reference</th><th>Product</th><th>Size</th><th>Finish</th><th>Wrap</th><th></th></tr></thead><tbody id="hist"></tbody></table></div>
</div>
</main>
<script>
const $ = (id) => document.getElementById(id);
const el = (tag, props, kids) => { const e = document.createElement(tag); Object.assign(e, props || {}); (kids || []).forEach((k) => e.append(k)); return e; };
const SIZES = { small: '12×12', medium: '16×16', large: '20×20' };
const FINISHES = { poster: 'Poster', canvasStandard: 'Canvas standard', canvasGallery: 'Canvas gallery' };
let products = [], chosen = null, channels = {};

async function api(path, init) {
  const res = await fetch('/admin/api/print-any/' + path, init);
  return res.json().catch(() => ({ state: 'failed', error: 'HTTP ' + res.status }));
}
function say(text, cls) { const m = $('msg'); m.textContent = ''; if (cls === 'spin') m.append(el('span', { className: 'spin' })); m.append(el('span', { className: cls === 'err' ? 'err' : '', textContent: text })); }

function renderResults() {
  const q = $('q').value.trim().toLowerCase();
  const box = $('results'); box.textContent = '';
  const hits = (q ? products.filter((p) => (p.title || '').toLowerCase().includes(q) || p.slug.includes(q)) : products).slice(0, 60);
  for (const p of hits) {
    const b = el('button', { type: 'button', className: 'p' + (chosen && chosen.slug === p.slug ? ' sel' : ''), disabled: p.master === false });
    const img = el('img', { alt: '', loading: 'lazy' });
    if (p.thumb) img.src = p.thumb + '?w=88&h=88&fit=crop&auto=format';
    b.append(img, el('span', {}, [el('span', { textContent: p.title || p.slug }), el('small', { textContent: p.slug + (p.master === false ? ' · no print master' : '') })]));
    b.onclick = () => { chosen = p; $('chosen').textContent = (p.title || p.slug) + ' (' + p.slug + ')'; renderResults(); };
    box.append(b);
  }
  if (!hits.length) box.append(el('div', { className: 'note', style: 'padding:10px', textContent: products.length ? 'No match.' : 'Loading products…' }));
}

function syncWrap() {
  const poster = $('finish').value === 'poster';
  $('wrapOn').disabled = poster; if (poster) $('wrapOn').checked = false;
  $('wrap').disabled = !$('wrapOn').checked;
  $('wrapNote').textContent = poster ? 'None (a poster has no wrap)' : $('wrapOn').checked ? 'Override' : 'Automatic (from the artwork\\'s edges)';
}

function ready(r) {
  say(r.cached ? 'Ready (already made).' : 'Ready.');
  const out = $('out'); out.textContent = '';
  const dl = el('dl');
  const row = (k, v) => dl.append(el('dt', { textContent: k }), el('dd', { textContent: v }));
  row('Pixels', r.width + ' × ' + r.height + ' at ' + r.dpi + ' dpi');
  if (r.facePx) row('Face / wrap', r.facePx + ' px face, ' + r.wrapPx + ' px wrap each side');
  row('Size / finish', (SIZES[r.sizeKey] || r.sizeKey) + ' · ' + (FINISHES[r.formatKey] || r.formatKey));
  row('Wrap colour', r.wrapColour + ' (' + (r.wrapSource === 'override' ? 'override' : 'from the artwork\\'s edges') + ')');
  row('File', (r.bytes / 1048576).toFixed(1) + ' MB JPEG — ' + r.filename);
  out.append(dl, el('a', { className: 'btn', href: '/admin/api/print-file/download?adhoc=' + encodeURIComponent(r.key), textContent: 'Download print file' }));
}

async function poll(key, tries) {
  const r = await api('status?key=' + encodeURIComponent(key));
  if (r.state === 'ready') { $('go').disabled = false; loadHistory(); return ready(r); }
  if (r.state === 'failed') { $('go').disabled = false; return say('The render failed: ' + (r.error || 'unknown error'), 'err'); }
  if (tries > 200) { $('go').disabled = false; return say('Still not ready after 5 minutes — check the print-file-background log.', 'err'); }
  setTimeout(() => poll(key, tries + 1), 1500);
}

$('go').onclick = async () => {
  $('out').textContent = '';
  if (!chosen) return say('Choose a product first.', 'err');
  if (!$('channel').value) return say('Choose a channel.', 'err');
  $('go').disabled = true; say('Preparing…', 'spin');
  const r = await api('start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    slug: chosen.slug, size: $('size').value, finish: $('finish').value,
    wrap: $('wrapOn').checked ? $('wrap').value : '', channel: $('channel').value, reference: $('ref').value,
  }) });
  if (r.state === 'ready') { $('go').disabled = false; loadHistory(); return ready(r); }
  if (r.state === 'pending') { loadHistory(); return poll(r.key, 0); }
  $('go').disabled = false;
  say(r.message || r.error || ('Could not start: ' + r.state), 'err');
};

async function loadHistory() {
  const r = await api('history');
  const body = $('hist'); body.textContent = '';
  for (const h of r.entries || []) {
    const link = el('a', { href: '/admin/api/print-file/download?adhoc=' + encodeURIComponent(h.key), textContent: 'Download' });
    const cells = [new Date(h.at).toLocaleString(), channels[h.channel] || h.channel, h.reference || '—', h.slug, SIZES[h.sizeKey] || h.sizeKey, FINISHES[h.formatKey] || h.formatKey, h.wrap];
    body.append(el('tr', {}, [...cells.map((c) => el('td', { textContent: String(c) })), el('td', {}, [link])]));
  }
  if (!(r.entries || []).length) body.append(el('tr', {}, [el('td', { colSpan: 8, className: 'note', textContent: 'Nothing yet.' })]));
}

$('q').oninput = renderResults;
$('finish').onchange = syncWrap; $('wrapOn').onchange = syncWrap;
syncWrap();
(async () => {
  renderResults();
  const r = await api('products');
  channels = r.channels || {};
  for (const [k, v] of Object.entries(channels)) $('channel').append(el('option', { value: k, textContent: v }));
  products = r.products || [];
  if (!products.length) say(r.error || 'No products could be loaded.', 'err');
  renderResults();
})();
loadHistory();
</script></body></html>`;

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname !== '/admin/print-any' && url.pathname !== '/admin/print-any/') return new Response('Not found', { status: 404 });
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export const config = { path: '/admin/print-any' };
