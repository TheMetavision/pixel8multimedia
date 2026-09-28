// netlify/functions/commission-artwork-page.mts
//
// GET /admin/commission-artwork/<orderRef>
//
// Upload finished artwork for a commission: pick one or more files (images,
// PDF, video, zip; up to 2 GB each). Each is sent in parts of 4,000,000 bytes
// to /admin/api/commission-artwork/*, hashed (sha256) on the way, and checked
// on the server before it's listed on the commission. Refreshing mid-upload
// and picking the same file again resumes where it stopped.
//
// Behind admin-auth.ts like everything under /admin/*. Shows the order
// reference and status only — no customer details. Everything from the API is
// set as text, never as HTML.

import { isOrderRef, PART_SIZE, MAX_FILE_BYTES, TYPES } from './_shared/artwork-keys.mjs';
import { createSha256 } from './_shared/sha256-stream.mjs';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function html(orderRef: string): string {
  const accept = Object.keys(TYPES).map((e) => `.${e}`).join(',');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Artwork ${esc(orderRef)} · Pixel8 admin</title>
<style>
  *{box-sizing:border-box} body{margin:0;background:#0D0D0F;color:#F5F5F0;font-family:system-ui,Arial,sans-serif;padding:24px}
  main{max-width:760px;margin:0 auto} .card{background:#131316;border:1px solid #2A2A2E;border-top:3px solid #7c3aed;border-radius:8px;padding:24px;margin-bottom:20px}
  h1{font-size:22px;margin:0 0 4px} h2{font-size:16px;margin:0 0 12px} .note{color:#999;font-size:13px;line-height:1.6;margin:0 0 14px}
  label{display:block;color:#aaa;font-size:13px;margin:14px 0 6px} input[type=text]{width:100%;background:#0D0D0F;color:#F5F5F0;border:1px solid #333;border-radius:6px;padding:10px;font-size:15px}
  button{margin-top:16px;background:#7c3aed;color:#fff;font-weight:700;border:0;border-radius:6px;padding:12px 18px;cursor:pointer;font-size:15px} button[disabled]{opacity:.5;cursor:wait}
  .file{border:1px solid #2A2A2E;border-radius:6px;padding:10px 12px;margin-top:10px;font-size:14px}
  .bar{height:6px;background:#222;border-radius:3px;margin-top:8px;overflow:hidden} .bar i{display:block;height:100%;width:0;background:#7c3aed}
  .ok{color:#8ce99a} .err{color:#ff8a80} .muted{color:#888} table{width:100%;border-collapse:collapse;font-size:14px} td,th{padding:6px 8px;border-bottom:1px solid #222;text-align:left} th{color:#b197fc} td a{color:#b197fc}
</style></head><body><main>
<div class="card">
  <h1>Finished artwork</h1>
  <p class="note">Order <strong>${esc(orderRef)}</strong> · <span id="st">loading…</span></p>
  <p class="note">Files go to private storage (Netlify Blobs), not Sanity. Up to ${MAX_FILE_BYTES / 1024 ** 3} GB each: images, PDF, video (mp4/mov/webm) or zip. If the page is closed mid-upload, open it again and pick the same file: it carries on from where it stopped.</p>
  <label for="files">Files</label>
  <input id="files" type="file" multiple accept="${accept}">
  <label for="name">Download name (optional)</label>
  <input id="name" type="text" maxlength="80" placeholder="e.g. ${esc(orderRef)}-final — never the customer's name">
  <p class="note" style="margin-top:6px">Left empty, files are named ${esc(orderRef)}-artwork-1, -2… The original file names are never stored.</p>
  <button id="go">Upload</button>
  <div id="work"></div>
</div>
<div class="card"><h2>On this commission</h2><div id="list" class="muted">loading…</div>
<p class="note" style="margin-top:12px">Setting the commission to Complete in Studio emails the customer a 30-day link for each file listed here.</p></div>
</main>
<script>
const ORDER = ${JSON.stringify(orderRef)};
const PART = ${PART_SIZE};
const API = '/admin/api/commission-artwork/';
${createSha256.toString()}
const $ = (id) => document.getElementById(id);
const el = (tag, props, kids) => { const e = document.createElement(tag); Object.assign(e, props || {}); (kids || []).forEach((k) => e.append(k)); return e; };
const mb = (b) => (b / 1048576).toFixed(1) + ' MB';
const hexOf = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let busy = false;
window.addEventListener('beforeunload', (e) => { if (busy) { e.preventDefault(); e.returnValue = ''; } });

async function api(path, init) {
  const res = await fetch(API + path, init);
  const body = await res.json().catch(() => ({ ok: false, error: 'HTTP ' + res.status }));
  return body;
}
const post = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function loadList() {
  const r = await api('list?order=' + encodeURIComponent(ORDER));
  if (!r.ok) { $('st').textContent = r.error; $('list').textContent = ''; return; }
  $('st').textContent = 'status: ' + (r.status || '—') + ' · delivery: ' + (r.deliveryType || '—');
  const box = $('list'); box.textContent = '';
  if (!r.artwork.length) { box.textContent = 'No finished artwork yet.'; return; }
  const t = el('table', {}, [el('tr', {}, ['File', 'Size', 'Uploaded', ''].map((h) => el('th', { textContent: h })))]);
  for (const a of r.artwork) {
    const link = el('a', { href: API + 'download?order=' + encodeURIComponent(ORDER) + '&upload=' + a.uploadId, textContent: 'Download' });
    t.append(el('tr', {}, [el('td', { textContent: a.filename }), el('td', { textContent: mb(a.bytes) }), el('td', { textContent: a.uploadedAt ? new Date(a.uploadedAt).toLocaleString() : '' }), el('td', {}, [link])]));
  }
  box.append(t);
}

async function putPart(file, init, n, bytes) {
  const partSha = hexOf(await crypto.subtle.digest('SHA-256', bytes));
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await api('part?order=' + encodeURIComponent(ORDER) + '&upload=' + init.uploadId + '&n=' + n,
        { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'x-part-sha256': partSha }, body: bytes });
      if (r.ok) return;
      if (attempt >= 4) throw new Error(r.error || 'part refused');
    } catch (err) {
      if (attempt >= 4) throw err;
    }
    await sleep(1000 * attempt);
  }
}

async function uploadOne(file, typed, row) {
  const msg = el('div', { className: 'muted', textContent: 'starting…' });
  const bar = el('i');
  row.append(el('div', { textContent: file.name + ' · ' + mb(file.size) }), el('div', { className: 'bar' }, [bar]), msg);
  const init = await post('init', { orderRef: ORDER, name: file.name, size: file.size, lastModified: file.lastModified, filename: typed });
  if (!init.ok) throw new Error(init.error);
  if (init.state === 'complete' && init.listed) { bar.style.width = '100%'; msg.className = 'ok'; msg.textContent = 'Already uploaded as ' + init.filename + '.'; return; }
  if (init.state === 'uploading') {
    const have = new Set(init.received || []);
    const hash = createSha256();
    const inflight = new Set();
    let failure = null;
    let sent = have.size;
    msg.textContent = (have.size ? 'resuming — ' + have.size + ' of ' + init.parts + ' parts already there. ' : '') + 'uploading as ' + init.filename + '…';
    for (let n = 0; n < init.parts; n++) {
      const bytes = new Uint8Array(await file.slice(n * PART, Math.min(file.size, (n + 1) * PART)).arrayBuffer());
      hash.update(bytes);
      if (!have.has(n)) {
        const p = putPart(file, init, n, bytes).then(() => { sent++; bar.style.width = (100 * sent / init.parts).toFixed(1) + '%'; });
        inflight.add(p); p.then(() => inflight.delete(p), (e) => { inflight.delete(p); failure = failure || e; });
        if (inflight.size >= 3) await Promise.race(inflight).catch(() => {});
      }
      if (failure) throw failure;
      bar.style.width = (100 * sent / init.parts).toFixed(1) + '%';
    }
    await Promise.allSettled(inflight);
    if (failure) throw failure;
    msg.textContent = 'checking the stored file…';
    const done = await post('complete', { orderRef: ORDER, uploadId: init.uploadId, sha256: hash.digestHex() });
    if (!done.ok) throw new Error(done.error);
  }
  for (let i = 0; i < 600; i++) {
    const s = await api('status?order=' + encodeURIComponent(ORDER) + '&upload=' + init.uploadId);
    if (s.ok && s.state === 'complete' && s.listed) { bar.style.width = '100%'; msg.className = 'ok'; msg.textContent = 'Done — ' + s.filename + ' (' + mb(s.size) + '), sha256 checked.'; return; }
    if (s.state === 'failed') throw new Error(s.error || 'the check failed');
    if (s.state === 'complete' && s.error) throw new Error(s.error);
    await sleep(2000);
  }
  throw new Error('still checking after 20 minutes — reload this page later');
}

$('go').onclick = async () => {
  const files = [...$('files').files];
  if (!files.length) return;
  busy = true; $('go').disabled = true;
  const base = $('name').value.trim();
  for (let i = 0; i < files.length; i++) {
    const row = el('div', { className: 'file' }); $('work').append(row);
    try { await uploadOne(files[i], base ? (i ? base + '-' + (i + 1) : base) : '', row); }
    catch (err) { row.append(el('div', { className: 'err', textContent: 'Stopped: ' + (err.message || err) + ' — pick the same file and press Upload to carry on.' })); }
  }
  busy = false; $('go').disabled = false; loadList();
};
loadList();
</script></body></html>`;
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith('/admin/commission-artwork/')) return new Response('Not found', { status: 404 });
  const orderRef = decodeURIComponent(url.pathname.slice('/admin/commission-artwork/'.length).replace(/\/$/, ''));
  if (!isOrderRef(orderRef)) {
    return new Response('That order reference is malformed.', { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  return new Response(html(orderRef), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export const config = { path: '/admin/commission-artwork/*' };
