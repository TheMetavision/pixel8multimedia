/**
 * The on-demand print-file job: cache keys, start/status, idempotency.
 *
 *   node tools/builder/print-job-tests.mjs
 *
 * Runs _shared/print-job.mjs against in-memory stores and a fake order, with
 * the real renderer for the render step.
 */
import { createRequire } from 'node:module';
import { startJob, jobStatus, runRender, cacheKey, stateKey, STALE_PENDING_MS } from '../../netlify/functions/_shared/print-job.mjs';
import { renderPrint } from '../../netlify/functions/_shared/print-render.mjs';
import { lineSpec, renderKey } from '../../netlify/functions/_shared/print-sources.mjs';

const sharp = createRequire(import.meta.url)('sharp');
let pass = 0, fail = 0;
const ok = (c, l, e = '') => {
  if (c) { pass++; console.log(`  PASS  ${l}${e !== '' ? ' — ' + e : ''}`); }
  else { fail++; console.log(`  FAIL  ${l}${e !== '' ? ' — ' + e : ''}`); }
};
const say = console.log.bind(console);

/** An in-memory stand-in for a Netlify Blobs store. */
function memStore(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    m,
    async get(k, o) { if (!m.has(k)) return null; const v = m.get(k); return o?.type === 'json' ? JSON.parse(v.data) : v.data; },
    async setJSON(k, v) { m.set(k, { data: JSON.stringify(v), metadata: {}, etag: `"${Math.random()}"` }); },
    async set(k, data, o = {}) { m.set(k, { data, metadata: o.metadata || {}, etag: `"${Math.random()}"` }); },
    async getMetadata(k) { return m.has(k) ? { etag: m.get(k).etag, metadata: m.get(k).metadata } : null; },
  };
}

const master = await sharp({ create: { width: 400, height: 400, channels: 3, background: '#aa3311' } }).png().toBuffer();
const ORDER = 'order.cs_live_TESTabc123';
const LINE = 'hulk-style-c-poster-small-0-1';
const order = {
  _id: ORDER,
  lineItems: [
    { _key: LINE, productTitle: 'Hulk', formatKey: 'poster', sizeKey: 'small', productSlug: 'hulk-style-c', styleLetter: 'C', quantity: 1 },
    { _key: 'old-line', productTitle: 'Elvis', format: 'Poster Print', size: 'Small (12×8")', quantity: 1 },
    { _key: 'no-master', productTitle: 'X', formatKey: 'poster', sizeKey: 'small', productSlug: 'x-style-a', styleLetter: 'A' },
    { _key: 'pers', productTitle: 'Your Photo', formatKey: 'canvasGallery', sizeKey: 'medium', personalisationId: 'abcdefghijklmnopqrstuv', styleKey: 'style-b' },
  ],
};

function world({ masterSha = 'a'.repeat(64), triggerOk = true, renderNow = false } = {}) {
  const files = memStore();
  const masters = memStore({ 'hulk-style-c': { data: master, metadata: { sha256: masterSha }, etag: '"m1"' } });
  const pers = memStore({ [renderKey('abcdefghijklmnopqrstuv', 'style-b')]: { data: master, metadata: {}, etag: '"r1"' } });
  const stores = (n) => (n === 'print-masters' ? masters : pers);
  let clock = Date.parse('2026-09-27T10:00:00Z');
  const deps = {
    files, stores,
    now: () => clock,
    fetchOrder: async (id) => (id === ORDER ? structuredClone(order) : null),
    triggers: 0,
    trigger: async (body) => {
      deps.triggers++;
      if (!triggerOk) return { ok: false, error: 'HTTP 503' };
      if (renderNow) await runRender(body.orderId, body.lineKey, deps);
      return { ok: true, status: 202 };
    },
    loadSource: async (info) => { const v = await stores(info.store).get(info.key, { type: 'arrayBuffer' }); return v ? Buffer.from(v) : null; },
    render: renderPrint,
    tick: (ms) => { clock += ms; },
  };
  return { deps, files, masters };
}

say('\n1. KEYS\n');
{
  const base = { orderId: ORDER, lineKey: LINE, sizeKey: 'small', formatKey: 'poster', style: 'c', identity: 'aaaa' };
  ok(cacheKey(base) === `print/${ORDER}/${LINE}/small-poster-c-aaaa-auto.jpg`, 'cache key shape', cacheKey(base));
  ok(cacheKey({ ...base, wrapColour: '#AbCdEf' }).endsWith('-abcdef.jpg'), 'override hex goes into the key (lower-case, no #)');
  ok(cacheKey({ ...base, identity: 'bbbb' }) !== cacheKey(base), 'different source identity → different key');
  ok(stateKey(ORDER, LINE) === `print/${ORDER}/${LINE}.state`, 'state key');
  ok(lineSpec(order.lineItems[1]).kind === 'historic', 'a line without keys is historic');
  ok(lineSpec(order.lineItems[3]).kind === 'personalised' && lineSpec(order.lineItems[3]).style === 'style-b', 'personalised line spec');
}

say('\n2. START → RENDER → READY → CACHE HIT\n');
{
  const { deps, files } = world();
  const s1 = await startJob(ORDER, LINE, deps);
  ok(s1.state === 'pending' && deps.triggers === 1, 'first start: pending, renderer triggered once');
  const st = await jobStatus(ORDER, LINE, deps);
  ok(st.state === 'pending', 'status: pending while rendering');
  const s2 = await startJob(ORDER, LINE, deps);
  ok(s2.state === 'pending' && s2.already && deps.triggers === 1, 'repeated start while pending: NOT triggered again (idempotent)');
  const r = await runRender(ORDER, LINE, deps);
  ok(r.ok && r.metadata.width === 3600 && r.metadata.dpi === 300 && /\.jpg$/.test(r.metadata.filename), 'render: 3600 px, 300 dpi, a .jpg filename', r.metadata?.filename);
  const st2 = await jobStatus(ORDER, LINE, deps);
  ok(st2.state === 'ready' && st2.width === 3600 && st2.key === s1.key, 'status: ready, with the file\'s metadata');
  const s3 = await startJob(ORDER, LINE, deps);
  ok(s3.state === 'ready' && s3.cached === true && deps.triggers === 1, 'second start: cache hit, answered at once, nothing triggered');
  ok([...files.m.keys()].filter((k) => k.endsWith('.jpg')).length === 1, 'exactly one file stored');
}

say('\n3. WHAT MISSES THE CACHE\n');
{
  const w = world({ renderNow: true });
  const a = await startJob(ORDER, LINE, w.deps);
  ok(a.state === 'ready' && a.cached === false, 'renderer finishing before the trigger returns is reported as ready');
  // new master uploaded (different sha)
  w.masters.m.get('hulk-style-c').metadata = { sha256: 'b'.repeat(64) };
  const b = await startJob(ORDER, LINE, w.deps);
  ok(b.state === 'ready' && b.cached === false && b.key !== a.key && w.deps.triggers === 2, 'a changed master identity → new key → rendered again');
  // wrap override set in Studio
  const orig = w.deps.fetchOrder;
  w.deps.fetchOrder = async (id) => { const o = await orig(id); o.lineItems[0].wrapColour = '#123456'; return o; };
  const c = await startJob(ORDER, LINE, w.deps);
  ok(c.state === 'ready' && c.cached === false && c.key.endsWith('-123456.jpg') && c.wrapColour === '#123456', 'a wrap-colour override → new key, and it is applied', c.wrapColour);
  const d = await startJob(ORDER, LINE, w.deps);
  ok(d.cached === true && w.deps.triggers === 3, 'and asking again with nothing changed is a hit');
}

say('\n4. EDGES\n');
{
  const { deps } = world({ triggerOk: false });
  const f = await startJob(ORDER, LINE, deps);
  const st = await jobStatus(ORDER, LINE, deps);
  ok(f.state === 'failed' && /could not start/.test(f.error) && st.state === 'failed', 'trigger fails → state failed (the page stops polling and says why)');

  const w = world();
  ok((await startJob(ORDER, 'old-line', w.deps)).state === 'historic', 'historic line → "historic", nothing triggered');
  ok((await startJob(ORDER, 'no-master', w.deps)).state === 'no-source', 'no master uploaded → "no-source"');
  ok((await startJob('order.nope', LINE, w.deps)).state === 'not-found', 'unknown order → not-found');
  ok((await startJob('../etc', LINE, w.deps)).state === 'invalid', 'unsafe id → invalid');
  ok(w.deps.triggers === 0, 'none of those triggered a render');

  const p = await startJob(ORDER, 'pers', w.deps);
  ok(p.state === 'pending' && p.key.includes('medium-canvasGallery-style-b-abcdefghijklmnopqrstuv-style-b-'), 'personalised line: identity = pid + style + render hash', p.key);

  const s = world();
  await startJob(ORDER, LINE, s.deps);
  s.deps.tick(STALE_PENDING_MS + 1000);
  ok((await jobStatus(ORDER, LINE, s.deps)).state === 'failed', 'a pending job older than the background limit reads as failed');
  await startJob(ORDER, LINE, s.deps);
  ok(s.deps.triggers === 2, 'and starting again re-triggers it');
}

say(`\n${pass} passed, ${fail} failed.`);
process.exitCode = fail ? 1 : 0;
