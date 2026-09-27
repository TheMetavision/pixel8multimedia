/**
 * Print files made before the order is opened, and print files for any
 * stock product without a site order.
 *
 *   node tools/builder/print-prewarm-tests.mjs
 *
 * 1. Pre-warm core (_shared/print-job.mjs): only eligible lines are rendered,
 *    through the same keys as on-demand, so a later start is a cache hit.
 * 2. The REAL Stripe webhook handler (webhook.mjs), with Stripe, Sanity,
 *    Resend and Blobs replaced by in-memory fakes (module hooks) and fetch
 *    mocked: exactly one pre-warm call per new order, 200 within budget when
 *    it fails or hangs, none on a duplicate delivery.
 * 3. The REAL proof-approval handler: pre-warms every ordered line once; a
 *    repeated (or simultaneous) approval doesn't.
 * 4. Ad-hoc files (_shared/print-adhoc.mjs + print-any-api): keys, cache
 *    hits, refusals, history — and the order reference is never logged.
 * Nothing touches the network, Sanity or Blobs.
 */
import { createRequire, registerHooks } from 'node:module';

const sharp = createRequire(import.meta.url)('sharp');
let pass = 0, fail = 0;
const ok = (c, l, e = '') => {
  if (c) { pass++; console.log(`  PASS  ${l}${e !== '' ? ' — ' + e : ''}`); }
  else { fail++; console.log(`  FAIL  ${l}${e !== '' ? ' — ' + e : ''}`); }
};
const say = console.log.bind(console);

// ── Fakes for the SDKs the handlers import (installed before any import) ────
const M = (globalThis.__mocks = {});
const MOCK_SRC = {
  stripe: 'export default class Stripe { constructor() { return globalThis.__mocks.stripe; } }',
  '@sanity/client': 'export const createClient = () => globalThis.__mocks.sanity;',
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

Object.assign(process.env, {
  STRIPE_SECRET_KEY: 'sk_test_dummy', STRIPE_WEBHOOK_SECRET: 'whsec_dummy', RESEND_API_KEY: 're_dummy',
  PERSONALISATION_SALT: 'test-salt', SANITY_WRITE_TOKEN: 'x', SANITY_TOKEN: 'x', URL: 'https://pixel8multimedia.co.uk',
});
delete process.env.SITE_NAME;

/** An in-memory stand-in for a Netlify Blobs store. */
function memStore(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    m,
    async get(k, o) { if (!m.has(k)) return null; const v = m.get(k); return o?.type === 'json' ? JSON.parse(v.data) : v.data; },
    async setJSON(k, v) { m.set(k, { data: JSON.stringify(v), metadata: {}, etag: `"${Math.random()}"` }); },
    async set(k, data, o = {}) { m.set(k, { data, metadata: o.metadata || {}, etag: `"${Math.random()}"` }); },
    async getMetadata(k) { return m.has(k) ? { etag: m.get(k).etag, metadata: m.get(k).metadata } : null; },
    async list() { return { blobs: [...m.keys()].map((key) => ({ key })) }; },
  };
}

const { prewarmLines, prewarmLine, stockLineKeys, orderedLineTargets, startJob, jobStatus, runRender, cacheKey, stateKey, STALE_PENDING_MS } =
  await import('../../netlify/functions/_shared/print-job.mjs');
const { renderPrint } = await import('../../netlify/functions/_shared/print-render.mjs');
const { renderKey } = await import('../../netlify/functions/_shared/print-sources.mjs');
const { TRIGGER_BUDGETS } = await import('../../netlify/functions/_shared/origin.mjs');
const adhoc = await import('../../netlify/functions/_shared/print-adhoc.mjs');
const { isAdhocKey, SERVABLE, FILES_STORE } = await import('../../netlify/functions/_shared/print-keys.mjs');

const master = await sharp({ create: { width: 400, height: 400, channels: 3, background: '#aa3311' } }).png().toBuffer();
const SHA = 'ab'.repeat(32);
const PID = 'abcdefghijklmnopqrstuv';
const ORDER = 'order.cs_live_TESTprewarm1';
const line = (k, over) => ({ _key: k, productTitle: 'Hulk', productSlug: 'hulk-style-c', styleLetter: 'C', quantity: 1, ...over });
const order = {
  _id: ORDER,
  lineItems: [
    line('l-hulk', { formatKey: 'poster', sizeKey: 'small' }),
    line('l-hulk-2', { formatKey: 'canvasStandard', sizeKey: 'small' }),
    line('l-ready', { formatKey: 'poster', sizeKey: 'medium' }),
    line('l-pending', { formatKey: 'canvasGallery', sizeKey: 'small' }),
    { _key: 'l-old', productTitle: 'Elvis', format: 'Poster Print', size: 'Small (12×8")', quantity: 1 },
    line('l-nomaster', { productSlug: 'x-style-a', styleLetter: 'A', formatKey: 'poster', sizeKey: 'small' }),
    { _key: 'l-pers', productTitle: 'Your Photo', formatKey: 'poster', sizeKey: 'small', personalisationId: PID, styleKey: 'style-b' },
  ],
};

function world() {
  const files = memStore();
  const masters = memStore({ 'hulk-style-c': { data: master, metadata: { sha256: SHA }, etag: '"m1"' } });
  const pers = memStore({ [renderKey(PID, 'style-b')]: { data: master, metadata: {}, etag: '"r1"' } });
  const stores = (n) => (n === 'print-masters' ? masters : pers);
  let clock = Date.parse('2026-09-27T10:00:00Z');
  const deps = {
    files, stores,
    now: () => clock,
    fetchOrder: async (id) => (id === ORDER ? structuredClone(order) : null),
    triggers: [],
    trigger: async (body) => { deps.triggers.push(body); return { ok: true, status: 202 }; },
    loadSource: async (info) => { const v = await stores(info.store).get(info.key, { type: 'arrayBuffer' }); return v ? Buffer.from(v) : null; },
    renders: 0,
    render: (o) => { deps.renders++; return renderPrint(o); },
    findProduct: async (slug) => (slug === 'hulk-style-c' ? { slug, title: 'Hulk' } : slug === 'x-style-a' ? { slug, title: 'X' } : null),
    tick: (ms) => { clock += ms; },
  };
  return { deps, files, masters };
}

say('\n1. PRE-WARM: ONLY ELIGIBLE LINES, SAME KEYS AS ON-DEMAND\n');
{
  const { deps, files } = world();
  ok(JSON.stringify(stockLineKeys(order)) === JSON.stringify(['l-hulk', 'l-hulk-2', 'l-ready', 'l-pending', 'l-nomaster']),
    'the webhook set: keyed stock lines only (no historic, no personalised)', stockLineKeys(order).join(','));

  await runRender(ORDER, 'l-ready', deps);                 // already made on demand
  await startJob(ORDER, 'l-pending', deps);                 // someone opened it; render queued
  const before = deps.renders;
  const res = await prewarmLines([...stockLineKeys(order), 'l-old'].map((lineKey) => ({ orderId: ORDER, lineKey })), deps);
  const by = Object.fromEntries(res.map((r) => [r.lineKey, r.result]));
  ok(by['l-hulk'] === 'rendered' && by['l-hulk-2'] === 'rendered', 'eligible lines rendered', JSON.stringify(by));
  ok(by['l-ready'] === 'ready' && by['l-pending'] === 'pending' && by['l-old'] === 'historic' && by['l-nomaster'] === 'no-source',
    'skipped: already ready, pending, historic, missing master');
  ok(deps.renders - before === 2, 'exactly 2 renders (one per eligible line), one after another');
  ok(!files.m.has(stateKey(ORDER, 'l-nomaster')) && !files.m.has(stateKey(ORDER, 'l-old')), 'nothing written for a line that can\'t be made (the page reports it as before)');

  const expected = cacheKey({ orderId: ORDER, lineKey: 'l-hulk', sizeKey: 'small', formatKey: 'poster', style: 'c', identity: SHA.slice(0, 16) });
  ok(files.m.has(expected), 'stored under the on-demand cache key', expected);
  const trig = deps.triggers.length;
  const s = await startJob(ORDER, 'l-hulk', deps);
  ok(s.state === 'ready' && s.cached === true && deps.triggers.length === trig, 'a later on-demand start is a cache hit: "Ready (already made)", no render triggered');
  ok((await jobStatus(ORDER, 'l-hulk', deps)).state === 'ready', 'status: ready');
  const meta = files.m.get(expected).metadata;
  ok(meta.width === 3600 && meta.dpi === 300 && /hulk-style-c-poster-small/.test(meta.filename), 'the file is the normal order file (12" poster = 3600 px at 300 dpi, same file name)', meta.filename);

  const again = await prewarmLines(stockLineKeys(order).map((lineKey) => ({ orderId: ORDER, lineKey })), deps);
  ok(deps.renders - before === 2 && again.filter((r) => r.result === 'ready').length === 3, 'pre-warming again renders nothing (all hits)');

  deps.tick(STALE_PENDING_MS + 1000);
  const stale = await prewarmLine(ORDER, 'l-pending', deps);
  ok(stale.result === 'rendered', 'a pending note older than the background limit is treated as dead and re-made');

  const pers = await prewarmLines([{ orderId: ORDER, lineKey: 'l-pers' }, { orderId: ORDER, lineKey: 'l-pers' }], deps);
  ok(pers.length === 1 && pers[0].result === 'rendered', 'a personalised line named explicitly is rendered (once, even if listed twice)');
  ok((await startJob(ORDER, 'l-pers', deps)).cached === true, '…and its on-demand start is a hit too');

  const t = orderedLineTargets([{ _key: 'a', orderId: ORDER }, { _key: 'a', orderId: ORDER }, { _key: 'b', orderId: ORDER }, { _key: '../x', orderId: ORDER }, { orderId: ORDER }]);
  ok(JSON.stringify(t) === JSON.stringify([{ orderId: ORDER, lineKey: 'a' }, { orderId: ORDER, lineKey: 'b' }]), 'orderedLines → targets: de-duplicated, unsafe ids dropped');
}

// ── A fake world for the real handlers ──────────────────────────────────────
const calls = [];
let prewarmMode = '202';
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ path: new URL(u).pathname, body, headers: init.headers });
  if (u.endsWith('/api/print-file/prewarm-background')) {
    if (prewarmMode === 'hang') {
      // AbortSignal.timeout's timer doesn't keep Node alive; this does, until the abort.
      const keepAlive = setInterval(() => {}, 1000);
      return new Promise((_, rej) => init.signal?.addEventListener('abort', () => { clearInterval(keepAlive); rej(init.signal.reason); }));
    }
    return new Response('', { status: prewarmMode === '503' ? 503 : 202 });
  }
  if (u.includes('/api/')) return new Response('', { status: 202 });
  throw new Error(`unexpected fetch ${u}`);
};
const prewarms = () => calls.filter((c) => c.path === '/api/print-file/prewarm-background');

const docs = new Map();
const blobStores = new Map();
M.getStore = (name) => { if (!blobStores.has(name)) blobStores.set(name, memStore()); return blobStores.get(name); };
M.getStore('print-masters').m.set('hulk-style-c', { data: master, metadata: { sha256: SHA }, etag: '"m1"' });
M.resend = async () => ({ data: { id: 'email' } });
let listLineItemsData = [];
M.stripe = {
  webhooks: { constructEvent: (body) => JSON.parse(body) },
  checkout: { sessions: { listLineItems: async () => ({ data: listLineItemsData }) } },
};
let createGate = null;
M.sanity = {
  async fetch(q, p = {}) {
    if (q.includes('_type == "order" && (_id == $orderId')) {
      return docs.has(p.orderId) ? p.orderId : [...docs.values()].find((d) => d.stripeSessionId === p.sessionId)?._id ?? null;
    }
    if (q.includes('_type == "product"')) return p.slug === 'hulk-style-c' ? { slug: 'hulk-style-c', title: 'Hulk' } : null;
    if (q.includes('_id == $id')) return docs.get(p.id) ?? null;
    return null;
  },
  async create(doc) {
    if (createGate) await createGate;
    if (docs.has(doc._id)) throw Object.assign(new Error('conflict'), { statusCode: 409 });
    docs.set(doc._id, structuredClone(doc));
    return doc;
  },
  async getDocument(id) { return docs.has(id) ? structuredClone(docs.get(id)) : null; },
  patch(id) {
    const ops = { set: {}, rev: null };
    const chain = {
      set(o) { Object.assign(ops.set, o); return chain; },
      setIfMissing() { return chain; }, append() { return chain; }, unset() { return chain; }, inc() { return chain; },
      ifRevisionId(r) { ops.rev = r; return chain; },
      async commit() {
        const d = docs.get(id) || { _id: id };
        if (ops.rev && d._rev !== ops.rev) throw Object.assign(new Error('revision mismatch'), { statusCode: 409 });
        Object.assign(d, ops.set, { _rev: `r${Math.random()}` });
        docs.set(id, d);
        return d;
      },
    };
    return chain;
  },
};

const webhook = (await import('../../netlify/functions/webhook.mjs')).default;
const approve = (await import('../../netlify/functions/personalisation-approve.mts')).default;
const printAnyApi = (await import('../../netlify/functions/print-any-api.mts')).default;

const stockItem = (over = {}) => ({
  quantity: 1, description: 'Hulk',
  price: { unit_amount: 1699, product: { metadata: { productId: 'prod-hulk', slug: 'hulk-style-c', title: 'Hulk', format: 'poster', size: 'small', formatKey: 'poster', sizeKey: 'small', styleLetter: 'C', ...over } } },
});
const event = (sessionId) => JSON.stringify({
  type: 'checkout.session.completed',
  data: { object: {
    id: sessionId, metadata: {}, amount_total: 3398, payment_intent: 'pi_test',
    customer_details: { email: 'buyer@example.com', name: 'Test Buyer' },
    shipping_details: { name: 'Test Buyer', address: { line1: '1 Test St', city: 'Testville', postal_code: 'TE1 1ST', country: 'GB' } },
  } },
});
const deliver = async (sessionId) => {
  const t0 = Date.now();
  const r = await webhook(new Request('https://pixel8multimedia.co.uk/api/webhook', { method: 'POST', headers: { 'stripe-signature': 't=1,v1=x' }, body: event(sessionId) }), {});
  return { status: r.status, text: await r.text(), ms: Date.now() - t0 };
};
const quiet = async (fn) => {
  const orig = [console.log, console.warn, console.error];
  const lines = [];
  console.log = console.warn = console.error = (...a) => lines.push(a.map(String).join(' '));
  try { return { value: await fn(), lines }; } finally { [console.log, console.warn, console.error] = orig; }
};

say('\n2. THE STRIPE WEBHOOK: ONE PRE-WARM, NEVER IN THE WAY\n');
{
  listLineItemsData = [stockItem(), stockItem({ formatKey: 'canvasGallery', sizeKey: 'large', format: 'canvasGallery', size: 'large' })];
  calls.length = 0; prewarmMode = '202';
  const { value: r, lines } = await quiet(() => deliver('cs_test_ok'));
  const pw = prewarms();
  ok(r.status === 200 && docs.has('order.cs_test_ok'), 'order created, 200');
  ok(pw.length === 1 && pw[0].body.orderId === 'order.cs_test_ok' && pw[0].headers['x-personalisation-key']?.length === 40,
    'exactly ONE pre-warm call, with the order _id and the internal header');
  ok(lines.some((l) => /Customer confirmation email sent/.test(l)) && lines.some((l) => /Team notification sent/.test(l)) &&
    lines.findIndex((l) => /print pre-warm started/.test(l)) > lines.findIndex((l) => /Team notification sent/.test(l)),
    'it comes after the order and both emails');
  ok(!lines.some((l) => /buyer@example\.com|Test Buyer|1 Test St/.test(l)), 'no personal data in the log lines around it');

  calls.length = 0;
  const dup = await quiet(() => deliver('cs_test_ok'));
  ok(dup.value.status === 200 && /duplicate/.test(dup.value.text) && prewarms().length === 0, 'duplicate delivery: skipped, NO second pre-warm');

  calls.length = 0;
  let release; createGate = new Promise((r) => { release = r; });
  const [a, b] = await quiet(async () => { const p = [deliver('cs_test_race'), deliver('cs_test_race')]; setTimeout(release, 20); return Promise.all(p); }).then((x) => x.value);
  createGate = null;
  ok(a.status === 200 && b.status === 200 && prewarms().length === 1, 'two simultaneous deliveries (409 on create): one order, one pre-warm');

  calls.length = 0; prewarmMode = '503';
  const f = await quiet(() => deliver('cs_test_503'));
  ok(f.value.status === 200 && docs.has('order.cs_test_503') && f.value.ms < TRIGGER_BUDGETS.prewarm.budgetMs + 1000, 'pre-warm answers 503: still 200, within budget', `${f.value.ms} ms, ${prewarms().length} attempt(s)`);
  ok(f.lines.some((l) => /print pre-warm not started .* on demand/.test(l)) && !docs.get('order.cs_test_503').printTriggerError, 'failure is logged only — nothing flagged on the order');

  calls.length = 0; prewarmMode = 'hang';
  const h = await quiet(() => deliver('cs_test_hang'));
  ok(h.value.status === 200 && h.value.ms <= TRIGGER_BUDGETS.prewarm.budgetMs + 1000 && prewarms().length === 1,
    `pre-warm hangs: 200 after ≤ ${TRIGGER_BUDGETS.prewarm.budgetMs} ms + slack, not retried`, `${h.value.ms} ms`);
  ok(TRIGGER_BUDGETS.prewarm.budgetMs <= 6000 && TRIGGER_BUDGETS.prewarm.retryOnTimeout === false, 'the pre-warm budget sits inside the webhook\'s 6 s cap', JSON.stringify(TRIGGER_BUDGETS.prewarm));

  calls.length = 0; prewarmMode = '202';
  listLineItemsData = [stockItem({ formatKey: '', sizeKey: '' })];
  await quiet(() => deliver('cs_test_historic'));
  ok(docs.has('order.cs_test_historic') && prewarms().length === 0, 'an order with no keyed stock lines: no pre-warm call');
}

say('\n3. PROOF APPROVAL: EVERY ORDERED LINE, ONCE\n');
{
  const seed = (pid) => docs.set(`pendingPersonalisation.${pid}`, {
    _id: `pendingPersonalisation.${pid}`, _rev: 'r0', status: 'proof-sent', proofToken: 'tok',
    orderedLines: [{ _key: 'lp1', orderId: 'order.cs_A' }, { _key: 'lp2', orderId: 'order.cs_A' }, { _key: 'lp1', orderId: 'order.cs_A' }, { _key: 'lp9', orderId: 'order.cs_B' }],
  });
  const click = (pid) => approve(new Request(`https://pixel8multimedia.co.uk/api/personalisation/approve?pid=${pid}&token=tok`)).then((r) => r.text());
  const P1 = 'PPPPPPPPPPPPPPPPPPPPP1';
  seed(P1); calls.length = 0;
  const first = await quiet(() => click(P1));
  const pw = prewarms();
  ok(/Approved — thank you/.test(first.value) && docs.get(`pendingPersonalisation.${P1}`).status === 'approved', 'approved');
  ok(pw.length === 1 && JSON.stringify(pw[0].body.lines) === JSON.stringify([
    { orderId: 'order.cs_A', lineKey: 'lp1' }, { orderId: 'order.cs_A', lineKey: 'lp2' }, { orderId: 'order.cs_B', lineKey: 'lp9' }]),
  'one pre-warm call naming every orderedLines entry (once each, across orders)', JSON.stringify(pw[0]?.body));
  ok(calls.filter((c) => c.path === '/api/personalisation/print-background').length === 1, 'the existing print build is still triggered once');

  calls.length = 0;
  const again = await quiet(() => click(P1));
  ok(/Already approved/.test(again.value) && prewarms().length === 0, 'a repeated approval: "Already approved", no second pre-warm');

  const P2 = 'PPPPPPPPPPPPPPPPPPPPP2';
  seed(P2); calls.length = 0;
  const both = await quiet(() => Promise.all([click(P2), click(P2)]));
  ok(both.value.filter((t) => /Approved — thank you/.test(t)).length === 1 && both.value.filter((t) => /Already approved/.test(t)).length === 1 && prewarms().length === 1,
    'two simultaneous clicks: one approves, the other sees "Already approved"; one pre-warm');

  const P3 = 'PPPPPPPPPPPPPPPPPPPPP3';
  seed(P3); calls.length = 0; prewarmMode = '503';
  const bad = await quiet(() => click(P3));
  ok(/Approved — thank you/.test(bad.value) && !docs.get(`pendingPersonalisation.${P3}`).printTriggerError, 'pre-warm fails: the customer still sees "Approved", nothing flagged');
  prewarmMode = '202';
}

say('\n4. AD-HOC: /admin/print-any\n');
{
  const v = adhoc.validateAdhoc;
  ok(v({ slug: 'hulk-style-c', size: '20', finish: 'gallery', channel: 'etsy' }).spec?.sizeKey === 'large', '12/16/20 and poster/standard/gallery accepted');
  ok(v({ slug: 'hulk-style-c', size: 'large', finish: 'canvasGallery', channel: 'amazon' }).ok, 'the spec\'s own keys accepted too');
  ok(!v({ slug: 'hulk-style-c', size: '18', finish: 'poster', channel: 'etsy' }).ok, 'unknown size refused');
  ok(!v({ slug: 'hulk-style-c', size: '12', finish: 'metal', channel: 'etsy' }).ok, 'unknown finish refused');
  ok(!v({ slug: '../etc', size: '12', finish: 'poster', channel: 'etsy' }).ok, 'a slug that isn\'t a slug refused');
  ok(!v({ slug: 'hulk-style-c', size: '12', finish: 'poster', channel: 'ebay' }).ok, 'unknown channel refused');
  ok(!v({ slug: 'hulk-style-c', size: '12', finish: 'gallery', channel: 'etsy', wrap: 'red' }).ok, 'wrap colour that isn\'t #rrggbb refused');
  ok(v({ slug: 'hulk-style-c', size: '12', finish: 'poster', channel: 'etsy', wrap: '#123456' }).spec.wrapColour === '', 'a poster ignores a wrap colour (it has no wrap)');
  ok(v({ slug: 'hulk-style-c', size: '12', finish: 'poster', channel: 'etsy', reference: '  123-45\n67 ' + 'x'.repeat(80) }).reference.length === 60, 'reference: one line, trimmed, ≤ 60 characters');

  const { deps, files } = world();
  deps.trigger = async (body) => { deps.triggers.push(body); await adhoc.runAdhocRender(body.adhoc, body.key, deps); return { ok: true, status: 202 }; };
  const req = { slug: 'hulk-style-c', size: '20', finish: 'gallery', channel: 'etsy', reference: 'ETSY-3141592653' };
  const t0 = Date.now();
  const r1 = await adhoc.startAdhoc(req, deps);
  const ms = Date.now() - t0;
  const KEY = `print/adhoc/hulk-style-c/large-canvasGallery-${SHA.slice(0, 16)}-auto.jpg`;
  ok(r1.key === KEY && deps.triggers.length === 1, 'valid request → print/adhoc/<slug>/<size>-<format>-<masterSha>-<wrap>.jpg', r1.key);
  ok(r1.state === 'ready' && r1.width === 7050 && r1.height === 7050 && r1.dpi === 300 && r1.wrapPx === 525 && r1.facePx === 6000,
    '20×20 gallery: 7050 × 7050 at 300 dpi, 525 px wrap, 6000 px face', `${r1.width}×${r1.height} @${r1.dpi}, wrap ${r1.wrapPx}, ${ms} ms`);
  ok(r1.filename === 'pixel8-hulk-style-c-canvasGallery-20x20.jpg', 'file name has the slug, finish and size', r1.filename);
  ok(isAdhocKey(KEY) && SERVABLE[FILES_STORE].test(KEY), 'the download edge function will serve that key');
  ok(!isAdhocKey('print/adhoc/../order.cs_x/l1/a-b-c-auto.jpg') && !isAdhocKey('print/order.cs_x/l1/small-poster-c-aaaa-auto.jpg'), '…and refuses anything else as an ad-hoc key');

  const r2 = await adhoc.startAdhoc({ ...req, channel: 'amazon', reference: '112-0000000-0000000' }, deps);
  ok(r2.state === 'ready' && r2.cached === true && deps.triggers.length === 1 && deps.renders === 1, 'repeat (any channel/reference) → cache hit, no render');
  ok((await adhoc.adhocStatus(KEY, deps)).state === 'ready', 'status by key: ready');

  const r3 = await adhoc.startAdhoc({ ...req, wrap: '#1A2B3C' }, deps);
  ok(r3.key.endsWith('-1a2b3c.jpg') && r3.wrapColour === '#1a2b3c' && r3.filename.endsWith('-wrap1a2b3c.jpg'), 'wrap override → its own key and file name', r3.key.split('/').pop());

  const hist = await adhoc.readHistory(deps);
  ok(hist.length === 3 && hist[0].wrap === '1a2b3c'.replace(/^/, '#') && hist[1].channel === 'amazon' && hist[2].reference === 'ETSY-3141592653' && hist[2].key === KEY &&
    hist.every((h) => h.at && h.slug === 'hulk-style-c' && h.sizeKey === 'large' && h.formatKey === 'canvasGallery'),
  'history appended, newest first: date, channel, reference, slug, size, finish, key', JSON.stringify(hist[1]));

  const bad = [
    [{ ...req, slug: 'no-such-product' }, 'unknown'],
    [{ ...req, slug: 'x-style-a' }, 'no-source'],
    [{ ...req, size: '14' }, 'invalid'],
    [{ ...req, finish: 'acrylic' }, 'invalid'],
  ];
  for (const [input, want] of bad) {
    const r = await adhoc.startAdhoc(input, deps);
    ok(r.state === want && r.message && deps.triggers.length === 2, `refused (${want}): "${r.message}"`);
  }
  ok((await adhoc.readHistory(deps)).length === 3, 'refusals are not added to the history');

  files.m.set(adhoc.HISTORY_KEY, { data: JSON.stringify({ entries: Array.from({ length: adhoc.HISTORY_KEEP }, (_, i) => ({ at: 'old', key: `k${i}` })) }) });
  await adhoc.appendHistory({ at: 'new', key: 'k-new' }, deps);
  const all = JSON.parse(files.m.get(adhoc.HISTORY_KEY).data).entries;
  ok(all.length === adhoc.HISTORY_KEEP && all[0].key === 'k-new' && (await adhoc.readHistory(deps)).length === adhoc.HISTORY_SHOWN, `history kept to ${adhoc.HISTORY_KEEP}; the page shows ${adhoc.HISTORY_SHOWN}`);

  // Through the real API function (fake Sanity/Blobs): the reference never reaches the log.
  calls.length = 0;
  const api = (path, init) => printAnyApi(new Request(`https://pixel8multimedia.co.uk/admin/api/print-any/${path}`, init));
  const post = (body) => api('start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const started = await quiet(async () => { const r = await post({ ...req, reference: 'AMZ-SECRET-REF-99' }); return { status: r.status, body: await r.json() }; });
  ok(started.value.status === 200 && started.value.body.state === 'pending' && calls.filter((c) => c.path === '/api/print-file/render-background').length === 1,
    'API start: pending, background renderer triggered', started.lines.join(' | '));
  ok(started.lines.length && !started.lines.some((l) => l.includes('AMZ-SECRET-REF-99')), 'the order reference is not in the log');
  const refused = await quiet(async () => { const r = await post({ ...req, slug: 'nope' }); return { status: r.status, body: await r.json() }; });
  ok(refused.value.status === 400 && /No stock product/.test(refused.value.body.message), 'API: unknown product → 400 with a clear message', refused.value.body.message);
  const list = await (await api('products')).json();
  ok(list.channels?.etsy === 'Etsy', 'API products: channels listed');
  const h = await (await api('history')).json();
  ok(h.entries?.[0]?.reference === 'AMZ-SECRET-REF-99', 'API history: the new entry is there');
  const badKey = await api('status?key=' + encodeURIComponent('print/order.cs_x/l1/x.jpg'));
  ok(badKey.status === 400, 'API status with a non-ad-hoc key → 400');
}

say(`\n${pass} passed, ${fail} failed.`);
process.exitCode = fail ? 1 : 0;
