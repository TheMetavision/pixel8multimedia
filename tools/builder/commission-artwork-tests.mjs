/**
 * Finished commission artwork in private Blobs: chunked upload, delivery,
 * migration.
 *
 *   node tools/builder/commission-artwork-tests.mjs
 *
 * 1. The browser's streaming SHA-256 agrees with node:crypto.
 * 2. Chunked upload (_shared/commission-artwork.mjs) against an in-memory
 *    Blobs store: a 25 MB file (over the old 20 MB cap) assembles byte-exact;
 *    a refresh mid-upload resumes; damaged parts and a wrong whole-file hash
 *    are refused and nothing is listed.
 * 3. The REAL download edge function: streams byte-exact with the right
 *    headers for a link signed exactly as commission-deliver signs it;
 *    expired, tampered and wrong-commission links are refused; the admin
 *    path needs Basic Auth.
 * 4. The REAL commission-deliver handler (Sanity/Resend faked, the webhook
 *    signed with @sanity/webhook): Blobs artwork counts as attached and each
 *    file gets a signed /download/artwork link; the legacy Sanity file still
 *    works; neither → refused.
 * 5. The migration library with mocks. 6. Admin routes need auth.
 * Nothing touches the network, Sanity or Blobs.
 */
import { registerHooks } from 'node:module';
import { createHash, createHmac, randomBytes } from 'node:crypto';

let pass = 0, fail = 0;
const ok = (c, l, e = '') => {
  if (c) { pass++; console.log(`  PASS  ${l}${e !== '' ? ' — ' + e : ''}`); }
  else { fail++; console.log(`  FAIL  ${l}${e !== '' ? ' — ' + e : ''}`); }
};
const say = console.log.bind(console);
const sha = (b) => createHash('sha256').update(b).digest('hex');

// ── Fakes for the SDKs, installed before anything imports them ──
const M = (globalThis.__mocks = {});
const MOCK_SRC = {
  // Resolved at call time, so each section can swap the fake.
  '@sanity/client': 'export const createClient = () => new Proxy({}, { get: (_, k) => globalThis.__mocks.sanity[k] });',
  resend: 'export class Resend { constructor() { this.emails = { send: (...a) => globalThis.__mocks.resend(...a) }; } }',
  '@netlify/blobs': 'export const getStore = (o) => globalThis.__mocks.getStore(typeof o === "string" ? o : o.name);',
};
registerHooks({
  resolve(spec, ctx, next) {
    return spec in MOCK_SRC ? { url: `file:///__mock__/${encodeURIComponent(spec)}.mjs`, shortCircuit: true } : next(spec, ctx);
  },
  load(url, ctx, next) {
    const m = /^file:\/\/\/__mock__\/(.+)\.mjs$/.exec(url);
    return m ? { format: 'module', source: MOCK_SRC[decodeURIComponent(m[1])], shortCircuit: true } : next(url, ctx);
  },
});
const ENV = {
  DOWNLOAD_LINK_SECRET: 'test-download-secret', SANITY_TOKEN: 'sk-test', ADMIN_USER: 'admin', ADMIN_PASSWORD: 'correct horse',
  SANITY_WEBHOOK_SECRET: 'test-webhook-secret', RESEND_API_KEY: 're_test', PERSONALISATION_SALT: 'test-salt', URL: 'https://pixel8multimedia.co.uk',
};
Object.assign(process.env, ENV);
delete process.env.SITE_NAME;
globalThis.Netlify = { env: { get: (k) => ENV[k] } };
const basic = (u, p) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;

/** An in-memory Blobs store: json/arrayBuffer/stream reads, list, delete. */
function memStore() {
  const m = new Map();
  return {
    m,
    async get(k, o = {}) {
      if (!m.has(k)) return null;
      const v = m.get(k).data;
      if (o.type === 'json') return JSON.parse(v);
      if (o.type === 'arrayBuffer') return new Uint8Array(v).slice().buffer;
      if (o.type === 'stream') {
        const bytes = new Uint8Array(v);
        let i = 0;
        return new ReadableStream({ pull(c) { if (i >= bytes.length) return c.close(); c.enqueue(bytes.slice(i, i + 65536)); i += 65536; } });
      }
      return v;
    },
    async setJSON(k, v) { m.set(k, { data: JSON.stringify(v), metadata: {} }); },
    async set(k, data, o = {}) { m.set(k, { data: Buffer.from(data), metadata: o.metadata || {} }); },
    async getMetadata(k) { return m.has(k) ? { etag: '"e"', metadata: m.get(k).metadata } : null; },
    async list({ prefix = '' } = {}) { return { blobs: [...m.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; },
    async delete(k) { m.delete(k); },
  };
}

const { createSha256 } = await import('../../netlify/functions/_shared/sha256-stream.mjs');
const K = await import('../../netlify/functions/_shared/artwork-keys.mjs');
const A = await import('../../netlify/functions/_shared/commission-artwork.mjs');
const { streamParts, verifyDownloadLink } = await import('../../netlify/edge-lib/artwork-stream.mjs');

say('\n1. THE BROWSER\'S SHA-256\n');
{
  let bad = 0;
  for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 128, 4_000_001, 9_999_937]) {
    const b = randomBytes(n);
    const h = createSha256();
    for (let i = 0; i < n;) { const k = Math.min(n - i, 1 + Math.floor(Math.random() * 1_500_000)); h.update(b.subarray(i, i + k)); i += k; }
    if (h.digestHex() !== sha(b)) bad++;
  }
  ok(bad === 0, 'matches node:crypto for 12 sizes (0 B … 10 MB) fed in random-sized pieces');
  ok(typeof createSha256.toString() === 'string' && !/\bimport\b|\brequire\(/.test(createSha256.toString()), 'self-contained, so the page can embed it');
}

// A world for the upload side.
const ORDER = 'PX-TEST0001';
function world() {
  const store = memStore();
  const listed = [];
  const commission = { _id: 'commission.PX-TEST0001', orderRef: ORDER, status: 'in-progress', deliveryType: 'digital', hasDraft: true, artwork: [] };
  let clock = Date.parse('2026-09-28T10:00:00Z');
  const deps = {
    store, now: () => clock,
    findCommission: async (ref) => (ref === ORDER ? structuredClone(commission) : null),
    listArtwork: async (c, entry) => { listed.push({ id: c._id, draft: c.hasDraft, entry }); commission.artwork = [...commission.artwork.filter((a) => a.uploadId !== entry.uploadId), entry]; },
    triggers: [],
    trigger: async (body) => { deps.triggers.push(body); return { ok: true, status: 202 }; },
  };
  return { deps, store, listed, commission };
}
/** What the page does for one part. */
const partOf = (file, n) => file.subarray(n * K.PART_SIZE, Math.min(file.length, (n + 1) * K.PART_SIZE));
const send = (deps, init, file, n, over = {}) => A.putPart({ orderRef: ORDER, uploadId: init.uploadId, n, bytes: partOf(file, n), sha256: sha(partOf(file, n)), ...over }, deps);
const readAll = async (stream) => { const out = []; for await (const c of stream) out.push(Buffer.from(c)); return Buffer.concat(out); };

say('\n2. CHUNKED UPLOAD\n');
const BIG = randomBytes(25 * 1024 * 1024 + 12345);
const { deps: W, store: WS, listed: WL, commission: WC } = world();
let bigInit;
{
  const fileInfo = { orderRef: ORDER, name: 'Jane Smith final.PNG', size: BIG.length, lastModified: 1727000000000 };
  bigInit = await A.initUpload(fileInfo, W);
  ok(bigInit.ok && bigInit.parts === 7 && bigInit.partSize === 4_000_000 && bigInit.state === 'uploading', '25 MB file → 7 parts of 4,000,000 bytes', `${bigInit.parts} parts`);
  ok(bigInit.filename === 'PX-TEST0001-artwork-1.png' && bigInit.contentType === 'image/png', 'name derived from the orderRef; type from the extension', bigInit.filename);
  const manifestText = WS.m.get(K.manifestKey(ORDER, bigInit.uploadId)).data;
  ok(!/Jane|Smith|final/i.test(manifestText), 'the original file name is not stored anywhere');

  for (let n = 0; n < 3; n++) await send(W, bigInit, BIG, n);
  // The page is refreshed; the same file is picked again.
  const again = await A.initUpload(fileInfo, W);
  ok(again.uploadId === bigInit.uploadId && JSON.stringify(again.received) === '[0,1,2]', 'refresh mid-upload → same upload, parts 0–2 already there (resume)', JSON.stringify(again.received));
  const early = await A.completeUpload({ orderRef: ORDER, uploadId: bigInit.uploadId, sha256: sha(BIG) }, W);
  ok(!early.ok && early.status === 409 && early.missing.join() === '3,4,5,6', 'complete before every part is in → 409, lists what\'s missing');
  for (let n = 3; n < 7; n++) await send(W, bigInit, BIG, n);

  const dmg = await send(W, bigInit, BIG, 2, { sha256: '0'.repeat(64) });
  ok(!dmg.ok && dmg.status === 400 && /damaged/.test(dmg.error), 'a part whose sha256 doesn\'t match → 400, not stored');
  const short = await A.putPart({ orderRef: ORDER, uploadId: bigInit.uploadId, n: 0, bytes: partOf(BIG, 0).subarray(1), sha256: sha(partOf(BIG, 0).subarray(1)) }, W);
  ok(!short.ok && /expected 4000000/.test(short.error), 'a part of the wrong length → 400');
  const range = await send(W, bigInit, BIG, 7);
  ok(!range.ok && /out of range/.test(range.error), 'a part number past the end → 400');

  const c = await A.completeUpload({ orderRef: ORDER, uploadId: bigInit.uploadId, sha256: sha(BIG) }, W);
  ok(c.ok && c.state === 'verifying' && W.triggers.length === 1, 'complete → verifying, background check started once');
  ok(WL.length === 0, 'not listed on the commission before the check');
  const v = await A.verifyUpload({ orderRef: ORDER, uploadId: bigInit.uploadId }, W);
  ok(v.ok && v.state === 'complete' && v.listed, 'the check re-hashes the stored parts: exact match → complete, listed');
  ok(WL.length === 1 && WL[0].draft === true && WL[0].entry._key === bigInit.uploadId && WL[0].entry.bytes === BIG.length && WL[0].entry.sha256 === sha(BIG),
    'listed with id, size and sha256 (on the draft too — publishing it won\'t drop the file)');
  const m = await WS.get(K.manifestKey(ORDER, bigInit.uploadId), { type: 'json' });
  const joined = await readAll(streamParts(WS, m));
  ok(joined.length === BIG.length && sha(joined) === sha(BIG), '25 MB assembles byte-exact from its parts', `${joined.length} bytes`);
  const dup = await A.initUpload(fileInfo, W);
  ok(dup.state === 'complete' && dup.listed, 'picking the same file again: "already uploaded", nothing re-sent');
}
{
  const { deps, store, listed } = world();
  const f = randomBytes(9_000_000);
  const init = await A.initUpload({ orderRef: ORDER, name: 'x.mp4', size: f.length, lastModified: 1, filename: 'Final <cut> v2!.MOV' }, deps);
  ok(init.filename === 'Final-cut-v2.mp4' && init.contentType === 'video/mp4', 'a typed name is cleaned, and keeps the file\'s real extension', init.filename);
  for (let n = 0; n < init.parts; n++) await send(deps, init, f, n);
  await A.completeUpload({ orderRef: ORDER, uploadId: init.uploadId, sha256: sha(randomBytes(8)) }, deps);
  const v = await A.verifyUpload({ orderRef: ORDER, uploadId: init.uploadId }, deps);
  const m = await store.get(K.manifestKey(ORDER, init.uploadId), { type: 'json' });
  const parts = (await store.list({ prefix: K.artworkPrefix(ORDER, init.uploadId) })).blobs.filter((b) => b.key.includes('/part-'));
  ok(!v.ok && m.state === 'failed' && /does not match/.test(m.error) && parts.length === 0 && listed.length === 0, 'wrong whole-file sha256 → failed, parts deleted, NOT listed');
  const retry = await A.initUpload({ orderRef: ORDER, name: 'x.mp4', size: f.length, lastModified: 1 }, deps);
  ok(retry.state === 'uploading' && retry.received.length === 0, 'the same file again after a failure starts cleanly');

  // Stored bytes damaged after upload (the declared hash is right): still refused.
  for (let n = 0; n < retry.parts; n++) await send(deps, retry, f, n);
  const k0 = K.partKey(ORDER, retry.uploadId, 1);
  store.m.get(k0).data[100] ^= 0xff;
  await A.completeUpload({ orderRef: ORDER, uploadId: retry.uploadId, sha256: sha(f) }, deps);
  const v2 = await A.verifyUpload({ orderRef: ORDER, uploadId: retry.uploadId }, deps);
  ok(!v2.ok && listed.length === 0, 'a stored part changed after upload → the check refuses it');
}
{
  const { deps } = world();
  ok((await A.initUpload({ orderRef: ORDER, name: 'a.exe', size: 10 }, deps)).status === 415, '.exe refused (415)');
  ok((await A.initUpload({ orderRef: ORDER, name: 'a.zip', size: K.MAX_FILE_BYTES + 1 }, deps)).status === 413, 'over 2 GB refused (413)');
  ok((await A.initUpload({ orderRef: 'PX-NOPE0000', name: 'a.png', size: 10 }, deps)).status === 404, 'unknown commission → 404');
  ok((await A.initUpload({ orderRef: '../etc', name: 'a.png', size: 10 }, deps)).status === 400, 'malformed orderRef → 400');
  ok(K.partCount(2 * 1024 ** 3) === 537 && K.partLength(2 * 1024 ** 3, 536) === 2 * 1024 ** 3 - 536 * 4_000_000, '2 GB → 537 parts; the last one exact');
}

// ── The download edge function ──
const edge = (await import('../../netlify/edge-functions/commission-artwork-download.ts')).default;
const artworkStore = WS;
M.getStore = (name) => (name === K.ARTWORK_STORE ? artworkStore : memStore());
let sanityDoc = { status: 'delivered', orderRef: ORDER, uploads: [bigInit.uploadId] };
const sanityCalls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.hostname === 'bqb4w421.api.sanity.io') {
    sanityCalls.push({ id: JSON.parse(u.searchParams.get('$id')), auth: init.headers?.Authorization });
    return new Response(JSON.stringify({ result: sanityDoc }), { status: 200 });
  }
  throw new Error(`unexpected fetch ${url}`);
};
/** Exactly how commission-deliver signs (generateSignedUrl). */
function signedLink(id, file, { days = 30, path = '/download/artwork', secret = ENV.DOWNLOAD_LINK_SECRET } = {}) {
  const exp = Date.now() + days * 86400000;
  const sig = createHmac('sha256', secret).update(`${id}:${file}:${exp}`).digest('hex');
  return `https://pixel8multimedia.co.uk${path}?${new URLSearchParams({ id, file, exp: String(exp), sig })}`;
}
const FILE = K.fileRefFor(ORDER, bigInit.uploadId);

say('\n3. THE DOWNLOAD EDGE FUNCTION\n');
{
  const r = await edge(new Request(signedLink('commission.PX-TEST0001', FILE)));
  const body = Buffer.from(await r.arrayBuffer());
  ok(r.status === 200 && sha(body) === sha(BIG), 'signed link → 200, 25 MB streamed byte-exact', `${body.length} bytes`);
  ok(r.headers.get('content-length') === String(BIG.length) && r.headers.get('content-type') === 'image/png' &&
    r.headers.get('content-disposition') === 'attachment; filename="PX-TEST0001-artwork-1.png"' && /no-store/.test(r.headers.get('cache-control')),
  'Content-Length, Content-Type, Content-Disposition (attachment), no-store', `${r.headers.get('content-length')} · ${r.headers.get('content-disposition')}`);
  ok(sanityCalls.at(-1).id === 'commission.PX-TEST0001' && sanityCalls.at(-1).auth === 'Bearer sk-test', 'the commission is checked in Sanity (with the token)');
  const head = await edge(new Request(signedLink('commission.PX-TEST0001', FILE), { method: 'HEAD' }));
  ok(head.status === 200 && head.headers.get('content-length') === String(BIG.length) && head.body === null, 'HEAD → headers only');

  const exp = new URL(signedLink('commission.PX-TEST0001', FILE, { days: -1 }));
  ok((await edge(new Request(exp))).status === 410, 'expired link → 410');
  const t = new URL(signedLink('commission.PX-TEST0001', FILE));
  t.searchParams.set('sig', t.searchParams.get('sig').replace(/.$/, (c) => (c === '0' ? '1' : '0')));
  ok((await edge(new Request(t))).status === 403, 'altered signature → 403');
  const t2 = new URL(signedLink('commission.PX-TEST0001', FILE));
  t2.searchParams.set('file', K.fileRefFor(ORDER, 'f'.repeat(32)));
  ok((await edge(new Request(t2))).status === 403, 'another file under the same signature → 403');
  ok((await edge(new Request(signedLink('commission.PX-TEST0001', FILE, { secret: 'guess' })))).status === 403, 'signed with the wrong secret → 403');
  ok((await edge(new Request('https://pixel8multimedia.co.uk/download/artwork?id=x&file=y'))).status === 400, 'missing parameters → 400');
  ok((await edge(new Request(signedLink('commission.PX-TEST0001', 'file-abc-png')))).status === 404, 'a Sanity-file link on this path → 404 (those stay on commission-download)');

  sanityDoc = { status: 'in-progress', orderRef: ORDER, uploads: [bigInit.uploadId] };
  ok((await edge(new Request(signedLink('commission.PX-TEST0001', FILE)))).status === 403, 'commission not complete/delivered → 403');
  sanityDoc = { status: 'delivered', orderRef: 'PX-OTHER000', uploads: [bigInit.uploadId] };
  ok((await edge(new Request(signedLink('commission.PX-TEST0001', FILE)))).status === 404, 'file belongs to a different order → 404');
  sanityDoc = { status: 'delivered', orderRef: ORDER, uploads: [] };
  ok((await edge(new Request(signedLink('commission.PX-TEST0001', FILE)))).status === 404, 'file no longer listed on the commission → 404');
  sanityDoc = { status: 'complete', orderRef: ORDER, uploads: [bigInit.uploadId] };

  ENV.DOWNLOAD_LINK_SECRET = '';
  ok((await edge(new Request(signedLink('commission.PX-TEST0001', FILE, { secret: 'test-download-secret' })))).status === 500, 'DOWNLOAD_LINK_SECRET unset → refuses (500)');
  ENV.DOWNLOAD_LINK_SECRET = 'test-download-secret';

  const adminUrl = `https://pixel8multimedia.co.uk/admin/api/commission-artwork/download?order=${ORDER}&upload=${bigInit.uploadId}`;
  ok((await edge(new Request(adminUrl))).status === 401, 'admin download without Basic Auth → 401');
  const adm = await edge(new Request(adminUrl, { headers: { authorization: basic('admin', 'correct horse') } }));
  ok(adm.status === 200 && sha(Buffer.from(await adm.arrayBuffer())) === sha(BIG), 'admin download with Basic Auth → byte-exact');

  // A part vanishes: the stream errors instead of ending short.
  const saved = artworkStore.m.get(K.partKey(ORDER, bigInit.uploadId, 4));
  artworkStore.m.delete(K.partKey(ORDER, bigInit.uploadId, 4));
  const broken = await edge(new Request(signedLink('commission.PX-TEST0001', FILE)));
  let threw = false;
  try { await broken.arrayBuffer(); } catch { threw = true; }
  ok(threw, 'a missing part errors the download mid-stream (never a quietly truncated file)');
  artworkStore.m.set(K.partKey(ORDER, bigInit.uploadId, 4), saved);

  const same = await verifyDownloadLink({ id: 'a', file: 'b', exp: String(Date.now() + 1000), sig: createHmac('sha256', 's').update(`a:b:${Date.now() + 1000}`).digest('hex') }, 's');
  ok(typeof same.ok === 'boolean', 'Web Crypto verification runs in Node too (same code as the edge)');
}

say('\n4. commission-deliver\n');
{
  const { encodeSignatureHeader } = await import('@sanity/webhook');
  const sent = [];
  const patches = [];
  let doc;
  M.resend = async (msg) => { sent.push(msg); return { data: { id: 'e1' }, error: null }; };
  M.sanity = {
    fetch: async () => structuredClone(doc),
    patch: (id) => { const p = { id, set: {} }; const chain = { set: (o) => { Object.assign(p.set, o); return chain; }, commit: async () => { patches.push(p); return {}; } }; return chain; },
  };
  const deliver = (await import('../../netlify/functions/commission-deliver.mts')).default;
  const hook = async (payload) => {
    const body = JSON.stringify(payload);
    const sig = await encodeSignatureHeader(body, Date.now(), ENV.SANITY_WEBHOOK_SECRET);
    return deliver(new Request('https://pixel8multimedia.co.uk/.netlify/functions/commission-deliver', { method: 'POST', body, headers: { 'sanity-webhook-signature': sig } }), {});
  };
  const quiet = async (fn) => { const o = [console.log, console.error, console.warn]; const lines = []; console.log = console.error = console.warn = (...a) => lines.push(a.join(' ')); try { return { v: await fn(), lines }; } finally { [console.log, console.error, console.warn] = o; } };
  const base = { _id: 'commission.PX-TEST0001', orderRef: ORDER, customerName: 'Test Customer', customerEmail: 'customer@example.com', deliveryType: 'digital', status: 'complete', serviceTitle: 'Pop Art Portrait' };
  const linksIn = (html) => [...html.matchAll(/href="(https:\/\/pixel8multimedia\.co\.uk\/[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&')).filter((u) => /download/.test(u));

  doc = { ...base, fileRef: null, artwork: [{ uploadId: bigInit.uploadId, filename: 'PX-TEST0001-artwork-1.png' }] };
  const r1 = await quiet(() => hook({ _id: base._id, status: 'complete' }));
  const links = linksIn(sent.at(-1)?.html || '');
  const u = new URL(links[0] || 'https://x/');
  const v = await verifyDownloadLink(Object.fromEntries(['id', 'file', 'exp', 'sig'].map((k) => [k, u.searchParams.get(k)])), ENV.DOWNLOAD_LINK_SECRET);
  ok(r1.v.status === 200 && links.length === 1 && u.pathname === '/download/artwork' && u.searchParams.get('file') === FILE && v.ok,
    'Blobs artwork counts as attached: one signed /download/artwork link, valid for the edge function', u.pathname);
  ok(/Download Your File/.test(sent.at(-1).html) && /30 days/.test(sent.at(-1).html) && patches.at(-1).set.status === 'delivered', 'same email (one button, 30 days); marked delivered');
  const e = await edge(new Request(links[0]));
  ok(e.status === 200 && sha(Buffer.from(await e.arrayBuffer())) === sha(BIG), 'the emailed link downloads the file byte-exact');
  ok(!r1.lines.some((l) => /Test Customer|customer@example\.com/.test(l)), 'no customer name or email in the log');

  doc = { ...base, fileRef: null, artwork: [{ uploadId: 'a'.repeat(32), filename: 'one.png' }, { uploadId: 'b'.repeat(32), filename: 'two.mp4' }] };
  await quiet(() => hook({ _id: base._id, status: 'complete' }));
  const two = linksIn(sent.at(-1).html);
  ok(two.length === 2 && /Download file 1 of 2 — one\.png/.test(sent.at(-1).html) && /These links stay active/.test(sent.at(-1).html), 'two files → two links, one per file');

  doc = { ...base, fileRef: 'file-abc123-png', artwork: [] };
  await quiet(() => hook({ _id: base._id, status: 'complete' }));
  const legacy = new URL(linksIn(sent.at(-1).html)[0]);
  ok(legacy.pathname === '/.netlify/functions/commission-download' && legacy.searchParams.get('file') === 'file-abc123-png', 'legacy Sanity file only → the old link, exactly as before');

  doc = { ...base, fileRef: null, artwork: [] };
  const before = sent.length;
  const none = await quiet(() => hook({ _id: base._id, status: 'complete' }));
  ok(none.v.status === 400 && sent.length === before, 'no artwork at all → refused, no email');
}

say('\n5. MIGRATION (mocks)\n');
{
  const { planArtwork, migrateArtwork, migratedUploadId } = await import('../commission-artwork/migrate-lib.mjs');
  const now = Date.parse('2026-09-28T12:00:00Z');
  const bytes = randomBytes(2_331_000);
  const file = { assetId: 'file-d148-png', bytes: bytes.length, sha1: createHash('sha1').update(bytes).digest('hex'), mime: 'image/png', ext: 'png', url: 'https://cdn.sanity.io/files/x/y/d148.png' };
  const plan = planArtwork([
    { _id: 'commission.PX-5GT67OZB', orderRef: 'PX-5GT67OZB', deliveredAt: '2026-06-01T00:00:00Z', hasDraft: false, artworkCount: 0, file },
    { _id: 'commission.PX-LIVE0000', orderRef: 'PX-LIVE0000', deliveredAt: '2026-09-20T00:00:00Z', file: { ...file, assetId: 'file-live-png' } },
    { _id: 'commission.PX-EXE00000', orderRef: 'PX-EXE00000', file: { ...file, assetId: 'file-x-exe', mime: 'application/x-msdownload', ext: 'exe' } },
  ], { now });
  ok(plan.items.length === 1 && plan.items[0].filename === 'PX-5GT67OZB-artwork-1.png' && plan.items[0].uploadId === migratedUploadId('file-d148-png'),
    'plan: derived name (never the original), deterministic id', plan.items[0]?.filename);
  ok(plan.problems.length === 2 && /live until 2026-10-20/.test(plan.problems[0]) && /isn't an accepted/.test(plan.problems[1]), 'a still-live link and an unsupported type are skipped');

  const store = memStore();
  const calls = { commits: [], deletes: [] };
  const commissionDoc = { _id: 'commission.PX-5GT67OZB', _rev: 'r1', _type: 'commission', finishedFile: { _type: 'file', asset: { _type: 'reference', _ref: 'file-d148-png' } } };
  let refs = [commissionDoc];
  const deps = (mode, over = {}) => ({
    mode, store, now: () => now,
    fetchBytes: async () => bytes,
    refsTo: async () => refs,
    commitRefs: async (patches, { dryRun }) => {
      calls.commits.push({ patches, dryRun });
      const after = patches.map((p) => { const d = structuredClone(commissionDoc); for (const u of p.unset) delete d[u]; if (p.append) d.finishedArtwork = [p.append]; return d; });
      if (!dryRun) refs = [];
      return after;
    },
    deleteAsset: async (id) => calls.deletes.push(id),
    ...over,
  });
  const item = plan.items[0];
  const val = await migrateArtwork(item, deps('validate'));
  ok(val.sha === sha(bytes) && store.m.size === 0 && calls.commits[0].dryRun === true && calls.deletes.length === 0, 'validate: bytes checked, transaction 1 sent as dryRun, nothing stored or deleted');
  const p = calls.commits[0].patches[0];
  ok(p.unset.join() === 'finishedFile' && p.append.uploadId === item.uploadId && p.append.sha256 === sha(bytes) && p.rev === 'r1', 'transaction 1: unset finishedFile, add the finishedArtwork entry, at the revision read');

  const r = await migrateArtwork(item, deps('apply'));
  const m = await store.get(K.manifestKey(item.orderRef, item.uploadId), { type: 'json' });
  const joined = await readAll(streamParts(store, m));
  ok(r.uploaded && r.deleted && calls.deletes.join() === 'file-d148-png' && m.state === 'complete' && sha(joined) === sha(bytes),
    'apply: stored as parts + complete manifest (byte-exact), listed, then the asset deleted');
  const again = await migrateArtwork(item, deps('apply', { refsTo: async () => [] }));
  ok(again.alreadyThere && !again.uploaded, 're-run: the intact copy isn\'t re-sent');
  let err = '';
  try { await migrateArtwork(item, deps('apply', { fetchBytes: async () => bytes.subarray(1) })); } catch (e) { err = e.message; }
  ok(/not the original file/.test(err), 'a download of the wrong size stops it before anything is written');
  refs = [commissionDoc, { _id: 'someOther.doc', _type: 'x' }];
  err = '';
  try { await migrateArtwork(item, deps('validate')); } catch (e) { err = e.message; }
  ok(/also referenced by someOther\.doc/.test(err), 'another document referencing the asset stops it');
}

say('\n6. ADMIN ROUTES NEED AUTH\n');
{
  const adminAuth = await import('../../netlify/edge-functions/admin-auth.ts');
  const api = await import('../../netlify/functions/commission-artwork-api.mts');
  const page = await import('../../netlify/functions/commission-artwork-page.mts');
  const bg = await import('../../netlify/functions/commission-artwork-verify-background.mts');
  const edgeCfg = (await import('../../netlify/edge-functions/commission-artwork-download.ts')).config;
  const routes = [['GET', `/admin/commission-artwork/${ORDER}`], ...api.config.path.map((p) => [p.endsWith('/part') ? 'PUT' : 'POST', p]), ['GET', '/admin/api/commission-artwork/download']];
  const guard = new URLPattern({ pathname: adminAuth.config.path });
  let reached = 0;
  const context = { next: async () => { reached++; return new Response('ok'); } };
  let all401 = true;
  for (const [method, p] of routes) {
    if (!guard.test({ pathname: p })) all401 = false;
    const r = await adminAuth.default(new Request(`https://pixel8multimedia.co.uk${p}`, { method }), context);
    if (r.status !== 401) all401 = false;
  }
  ok(all401 && reached === 0, `every admin route (${routes.length}) is under /admin/* and gets 401 without Basic Auth`);
  ok(edgeCfg.path.includes('/download/artwork') && !edgeCfg.path.some((p) => p.startsWith('/admin/') && p !== '/admin/api/commission-artwork/download'), 'the customer path is public (signed); the admin path is under /admin');
  ok((await api.default(new Request('https://x/.netlify/functions/commission-artwork-api'))).status === 404, 'the API reached by its function URL → 404');
  ok((await page.default(new Request('https://x/.netlify/functions/commission-artwork-page'))).status === 404, 'the page reached by its function URL → 404');
  const pg = await page.default(new Request(`https://x/admin/commission-artwork/${ORDER}`));
  const h = await pg.text();
  ok(pg.status === 200 && h.includes('function createSha256') && !/customerName|customerEmail/.test(h), 'the page embeds the hash and shows no customer details');
  ok((await page.default(new Request('https://x/admin/commission-artwork/..%2Fetc'))).status === 400, 'a malformed orderRef in the page URL → 400');
  const none = await bg.default(new Request('https://x/api/commission-artwork/verify-background', { method: 'POST', body: '{}' }));
  const wrong = await bg.default(new Request('https://x/api/commission-artwork/verify-background', { method: 'POST', body: '{}', headers: { 'x-personalisation-key': 'a'.repeat(40) } }));
  ok(none.status === 403 && wrong.status === 403, 'the verifier refuses calls without the internal header');
}

say('\n7. END TO END THROUGH THE REAL API AND VERIFIER\n');
{
  const store = memStore();
  M.getStore = (name) => (name === K.ARTWORK_STORE ? store : memStore());
  const commission = { _id: 'commission.PX-E2E00000', orderRef: 'PX-E2E00000', status: 'review', deliveryType: 'digital', hasDraft: false, artwork: [] };
  const txs = [];
  M.sanity = {
    fetch: async (q, p) => (p?.ref === commission.orderRef ? structuredClone(commission) : null),
    transaction: () => {
      const ops = [];
      const tx = {
        patch: (id, fn) => {
          const rec = { id, ops: [] };
          const chain = { setIfMissing: (o) => { rec.ops.push(['setIfMissing', o]); return chain; }, unset: (a) => { rec.ops.push(['unset', a]); return chain; }, append: (f, a) => { rec.ops.push(['append', f, a]); return chain; } };
          fn(chain); ops.push(rec); return tx;
        },
        commit: async () => { txs.push(ops); for (const r of ops) for (const o of r.ops) if (o[0] === 'append') commission.artwork.push(...o[2]); return {}; },
      };
      return tx;
    },
  };
  const verifyCalls = [];
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith('/api/commission-artwork/verify-background')) { verifyCalls.push({ body: JSON.parse(init.body), headers: init.headers }); return new Response('', { status: 202 }); }
    throw new Error(`unexpected fetch ${url}`);
  };
  const api = (await import('../../netlify/functions/commission-artwork-api.mts')).default;
  const bg = (await import('../../netlify/functions/commission-artwork-verify-background.mts')).default;
  const call = async (path, init) => { const r = await api(new Request(`https://pixel8multimedia.co.uk/admin/api/commission-artwork/${path}`, init)); return { status: r.status, body: await r.json() }; };
  const quiet = async (fn) => { const o = [console.log, console.error]; const lines = []; console.log = console.error = (...a) => lines.push(a.join(' ')); try { return { v: await fn(), lines }; } finally { [console.log, console.error] = o; } };

  const f = randomBytes(9_500_000);
  const logs = [];
  const init = await quiet(() => call('init', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderRef: 'PX-E2E00000', name: 'Customer Name.jpg', size: f.length, lastModified: 5 }) }));
  logs.push(...init.lines);
  const id = init.v.body.uploadId;
  ok(init.v.status === 200 && init.v.body.parts === 3, 'API init → 3 parts');
  const big = await call(`part?order=PX-E2E00000&upload=${id}&n=0`, { method: 'PUT', headers: { 'content-length': String(4_000_001) }, body: new Uint8Array(4_000_001) });
  ok(big.status === 413, 'a request body over one part → 413 before it is read');
  for (let n = 0; n < 3; n++) {
    const part = f.subarray(n * K.PART_SIZE, Math.min(f.length, (n + 1) * K.PART_SIZE));
    const r = await call(`part?order=PX-E2E00000&upload=${id}&n=${n}`, { method: 'PUT', headers: { 'x-part-sha256': sha(part) }, body: part });
    if (r.status !== 200) ok(false, `part ${n}`, JSON.stringify(r.body));
  }
  const st = await call(`status?order=PX-E2E00000&upload=${id}`);
  ok(st.body.received.join() === '0,1,2', 'API status: all 3 parts received');
  const done = await quiet(() => call('complete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderRef: 'PX-E2E00000', uploadId: id, sha256: sha(f) }) }));
  logs.push(...done.lines);
  ok(done.v.body.state === 'verifying' && verifyCalls.length === 1 && verifyCalls[0].headers['x-personalisation-key']?.length === 40, 'API complete → verifier started with the internal header');
  const v = await quiet(() => bg(new Request('https://x/api/commission-artwork/verify-background', { method: 'POST', body: JSON.stringify(verifyCalls[0].body), headers: verifyCalls[0].headers })));
  logs.push(...v.lines);
  ok(v.v.status === 200 && commission.artwork.length === 1 && commission.artwork[0].sha256 === sha(f) && txs[0][0].ops[1][1][0] === `finishedArtwork[_key=="${id}"]`,
    'background verifier: sha256 matches → listed on the commission (replace-by-key, so a retry never duplicates)');
  const list = await call('list?order=PX-E2E00000');
  ok(list.body.artwork.length === 1 && list.body.artwork[0].filename === 'PX-E2E00000-artwork-1.jpg', 'API list shows it under its derived name');
  ok(logs.length >= 3 && !logs.some((l) => /Customer Name/.test(l)), 'logs carry refs, ids and sizes — not the original file name', logs[0]);
}

say(`\n${pass} passed, ${fail} failed.`);
process.exitCode = fail ? 1 : 0;
