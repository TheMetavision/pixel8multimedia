/**
 * Publishing in Studio rebuilds the site, once per burst of edits.
 *
 *   node tools/builder/content-build-tests.mjs
 *
 * 1. The type lists and the webhook filter: build types in, operational
 *    types never.
 * 2. decide(): trailing edge, minimum gap, maximum wait.
 * 3. Simulated timelines (fake clock, fake Blobs with ETags): one publish,
 *    a 1,490-document script, a script that outlasts the max wait, edits
 *    arriving during a build, a failing build hook. The last change always
 *    builds.
 * 4. The REAL webhook handler: Sanity's signature is required (signed with
 *    @sanity/webhook's own encoder), drafts / operational types ignored,
 *    the waiter started once. And the waiter refuses calls without the
 *    internal header.
 * Nothing touches the network or Blobs.
 */
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (c, l, e = '') => {
  if (c) { pass++; console.log(`  PASS  ${l}${e !== '' ? ' — ' + e : ''}`); }
  else { fail++; console.log(`  FAIL  ${l}${e !== '' ? ' — ' + e : ''}`); }
};
const say = console.log.bind(console);

// Blobs replaced by an in-memory store with ETags (installed before imports).
globalThis.__mocks = {};
registerHooks({
  resolve(spec, ctx, next) {
    return spec === '@netlify/blobs' ? { url: 'file:///__mock__/blobs.mjs', shortCircuit: true } : next(spec, ctx);
  },
  load(url, ctx, next) {
    return url === 'file:///__mock__/blobs.mjs'
      ? { format: 'module', source: 'export const getStore = (o) => globalThis.__mocks.getStore(typeof o === "string" ? o : o.name);', shortCircuit: true }
      : next(url, ctx);
  },
});

/** A Blobs store with ETags and conditional writes, like the real one. */
function etagStore() {
  const m = new Map();
  let n = 0;
  return {
    m,
    writes: 0,
    async getWithMetadata(k) { return m.has(k) ? { data: structuredClone(m.get(k).data), etag: m.get(k).etag, metadata: {} } : null; },
    async setJSON(k, data, o = {}) {
      const cur = m.get(k);
      if (o.onlyIfNew && cur) return { modified: false };
      if (o.onlyIfMatch && (!cur || cur.etag !== o.onlyIfMatch)) return { modified: false };
      const etag = `"e${++n}"`;
      m.set(k, { data: structuredClone(data), etag });
      this.writes++;
      return { modified: true, etag };
    },
  };
}

const cb = await import('../../netlify/functions/_shared/content-build.mjs');
const { decide, classify, recordChange, runWaiter, BUILD_TYPES, NEVER_BUILD, WEBHOOK_FILTER, WEBHOOK_PROJECTION,
  QUIET_MS, MIN_GAP_MS, MAX_WAIT_MS, STATE_KEY } = cb;

say('\n1. WHAT BUILDS\n');
{
  const schemaTypes = readFileSync(new URL('../../studio/schemas/index.ts', import.meta.url), 'utf8').replace(/^﻿/, '');
  const all = [...schemaTypes.matchAll(/^import (\w+) from/gm)].map((m) => m[1]);
  ok([...BUILD_TYPES, ...NEVER_BUILD, 'siteSettings'].sort().join() === all.sort().join(),
    'every schema type is classified (build, never, or siteSettings — read by no page)', all.join(', '));
  ok(NEVER_BUILD.every((t) => !BUILD_TYPES.includes(t) && !WEBHOOK_FILTER.includes(`"${t}"`)), 'no operational type is a build type or appears in the filter');
  ok(BUILD_TYPES.every((t) => WEBHOOK_FILTER.includes(`"${t}"`)), 'every build type is in the filter');
  ok(/drafts\.\*\*/.test(WEBHOOK_FILTER) && /versions\.\*\*/.test(WEBHOOK_FILTER) && /before\(\)\._type/.test(WEBHOOK_FILTER), 'filter: published only (no drafts/versions); deletes matched via before()');
  ok(!/title|name|email|body|price/.test(WEBHOOK_PROJECTION), 'projection carries id, type and operation only', WEBHOOK_PROJECTION);
  ok(classify({ _id: 'drafts.p1', _type: 'product' }).build === false, 'a draft is ignored');
  ok(classify({ _id: 'order.cs_1', _type: 'order' }).build === false && classify({ _id: 'x', _type: 'pendingPersonalisation' }).build === false, 'operational types are ignored even if they got through');
  ok(classify({ _id: 'x', _type: 'siteSettings' }).build === false, 'a type no page reads is ignored');
  ok(classify({ _id: 'p1', _type: 'product' }).build === true && classify({ _id: 'p1' }).build === true, 'a published build type (or a delete that lost its type) builds');
}

say('\n2. WHEN TO BUILD\n');
{
  const T = 10 * 60 * 60 * 1000;
  const s = (o) => ({ pending: true, firstPendingAt: T, lastChangeAt: T, lastBuildAt: 0, ...o });
  ok(decide({ pending: false }, T).action === 'idle', 'nothing pending → idle');
  ok(decide(s(), T).action === 'wait' && decide(s(), T).ms === QUIET_MS, `one change → wait ${QUIET_MS / 1000} s`);
  ok(decide(s(), T + QUIET_MS).action === 'build', '…then build (trailing edge)');
  ok(decide(s({ lastChangeAt: T + 30_000 }), T + QUIET_MS).action === 'wait', 'another change resets the quiet period');
  ok(decide(s({ lastBuildAt: T - 60_000 }), T + QUIET_MS).ms === MIN_GAP_MS - 60_000 - QUIET_MS, `no sooner than ${MIN_GAP_MS / 60000} min after the last build`);
  ok(decide(s({ lastChangeAt: T + MAX_WAIT_MS - 1 }), T + MAX_WAIT_MS).action === 'build', `edits that never stop still build after ${MAX_WAIT_MS / 60000} min`);
}

/**
 * Drive webhooks and waiters on a fake clock. Each event is one webhook
 * call at time t (ms). A waiter's sleep advances the clock and delivers the
 * events that fall due meanwhile.
 */
async function simulate(times, { hook = () => ({ ok: true, status: 200 }) } = {}) {
  const store = etagStore();
  // Real clocks are far from 0: "never built" (lastBuildAt 0) must look like long ago.
  const BASE = Date.parse('2026-09-27T09:00:00Z');
  let clock = BASE;
  const queue = [...times].sort((a, b) => a - b).map((t) => t + BASE);
  const waiters = [];
  const builds = [];
  const deliver = async (upTo) => {
    while (queue.length && queue[0] <= upTo) {
      clock = Math.max(clock, queue.shift());
      const r = await recordChange(store, { now: clock, type: 'product' });
      if (r.arm) waiters.push(clock);
    }
  };
  const deps = {
    store, now: () => clock,
    sleep: async (ms) => { const target = clock + ms; await deliver(target); clock = target; },
    triggerBuild: async (title) => { const r = hook(clock); if (r.ok) builds.push({ t: clock - BASE, title }); return r; },
    rearm: async () => { waiters.push(clock); return { ok: true }; },
  };
  let guard = 0;
  while ((queue.length || waiters.length) && guard++ < 10_000) {
    if (!waiters.length) { await deliver(queue[0]); continue; }
    waiters.shift();
    await runWaiter(deps);
  }
  const state = (await store.getWithMetadata(STATE_KEY)).data;
  return { builds, state, waitersStarted: guard, store };
}

say('\n3. TIMELINES\n');
{
  const one = await simulate([1000]);
  ok(one.builds.length === 1 && one.builds[0].t === 1000 + QUIET_MS, `one publish → one build, ${QUIET_MS / 1000} s later`, `at ${one.builds[0]?.t / 1000} s: "${one.builds[0]?.title}"`);
  ok(one.state.pending === false && one.state.armedAt === 0, 'afterwards: nothing pending, waiter disarmed');

  // tools/… patching 1,490 products, one webhook every 0.3 s (≈ 7.5 min).
  const bulk = Array.from({ length: 1490 }, (_, i) => 5000 + i * 300);
  const b = await simulate(bulk);
  const last = bulk.at(-1);
  ok(b.builds.length === 1 && b.builds[0].t === last + QUIET_MS, '1,490 webhooks in 7.5 min → ONE build, after the last one', `${b.builds.length} build(s) at ${(b.builds[0]?.t / 60000).toFixed(2)} min — "${b.builds[0]?.title}"`);

  // A slower script: 1,490 webhooks over ~25 min.
  const slow = Array.from({ length: 1490 }, (_, i) => i * 1000);
  const s = await simulate(slow);
  const gaps = s.builds.slice(1).map((x, i) => x.t - s.builds[i].t);
  ok(s.builds.length >= 2 && s.builds.length <= 4 && gaps.every((g) => g >= MIN_GAP_MS), `25 min of edits → a build every ≤ ${MAX_WAIT_MS / 60000} min, never closer than ${MIN_GAP_MS / 60000} min`,
    s.builds.map((x) => (x.t / 60000).toFixed(1) + ' min').join(', '));
  ok(s.builds.at(-1).t >= slow.at(-1) && s.state.pending === false, 'the LAST change is always built (trailing edge)');

  // Publishes 30 s apart share a build; one 2 min later waits out the gap; one 20 min later builds on its own.
  const t = await simulate([0, 30_000, 150_000, 20 * 60_000]);
  const at = t.builds.map((x) => x.t);
  ok(at.length === 3 && at[0] === 30_000 + QUIET_MS && at[1] === at[0] + MIN_GAP_MS && at[2] === 20 * 60_000 + QUIET_MS,
    `close publishes share a build; the next waits for the ${MIN_GAP_MS / 60000}-min gap; a later one builds ${QUIET_MS / 1000} s after it`,
    at.map((x) => x / 1000 + ' s').join(', '));

  // Build hook failing twice, then working.
  let calls = 0;
  const f = await simulate([0], { hook: () => (++calls <= 2 ? { ok: false, status: 500, error: 'HTTP 500' } : { ok: true, status: 200 }) });
  ok(f.builds.length === 1 && calls === 3 && f.state.pending === false, 'build hook fails twice → retried, third attempt builds');
  let n2 = 0;
  const g = await simulate([0], { hook: () => { n2++; return { ok: false, error: 'HTTP 404' }; } });
  ok(g.builds.length === 0 && n2 === cb.MAX_BUILD_FAILURES && g.state.pending === true && g.state.armedAt === 0,
    'build hook keeps failing → gives up after 3, change stays pending, next publish re-arms');

  // A change landing while the build call is in flight stays pending and gets its own build.
  const store = etagStore();
  let clock = Date.parse('2026-09-27T09:00:00Z');
  await recordChange(store, { now: clock, type: 'faq' });
  let sneaked = false;
  const builds = [];
  await runWaiter({
    store, now: () => clock, sleep: async (ms) => { clock += ms; }, rearm: async () => ({ ok: true }),
    triggerBuild: async () => {
      builds.push(clock);
      if (!sneaked) { sneaked = true; await recordChange(store, { now: clock, type: 'product' }); }
      return { ok: true };
    },
  });
  ok(builds.length === 2 && builds[1] - builds[0] >= MIN_GAP_MS, 'an edit made during the build call is not lost: a second build follows (after the min gap)', builds.map((x) => (x - builds[0]) / 1000 + ' s').join(', '));
}

say('\n4. THE WEBHOOK HANDLER\n');
{
  const { encodeSignatureHeader } = await import('@sanity/webhook');
  const store = etagStore();
  globalThis.__mocks.getStore = () => store;
  const SECRET = 'test-webhook-secret';
  process.env.SANITY_WEBHOOK_SECRET = SECRET;
  process.env.PERSONALISATION_SALT = 'test-salt';
  process.env.URL = 'https://pixel8multimedia.co.uk';
  delete process.env.SITE_NAME;
  const started = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/api/sanity/build-debounce-background')) { started.push(init.headers); return new Response('', { status: 202 }); }
    throw new Error(`unexpected fetch ${url}`);
  };
  const handler = (await import('../../netlify/functions/sanity-content-changed.mts')).default;
  const call = async (payload, { secret = SECRET, header } = {}) => {
    const body = JSON.stringify(payload);
    const sig = header ?? await encodeSignatureHeader(body, Date.now(), secret);
    const res = await handler(new Request('https://pixel8multimedia.co.uk/api/sanity/content-changed', {
      method: 'POST', body, headers: { 'content-type': 'application/json', ...(sig ? { 'sanity-webhook-signature': sig } : {}) },
    }));
    return { status: res.status, text: await res.text() };
  };
  const quiet = async (fn) => { const o = [console.log, console.warn, console.error]; const lines = []; console.log = console.warn = console.error = (...a) => lines.push(a.join(' ')); try { return { v: await fn(), lines }; } finally { [console.log, console.warn, console.error] = o; } };

  const none = await quiet(() => call({ _id: 'p1', _type: 'product' }, { header: '' }));
  ok(none.v.status === 401 && store.writes === 0, 'no signature → 401, nothing recorded');
  const wrong = await quiet(() => call({ _id: 'p1', _type: 'product' }, { secret: 'not-the-secret' }));
  ok(wrong.v.status === 401 && store.writes === 0, 'signed with the wrong secret → 401');
  const junk = await quiet(() => call({ _id: 'p1', _type: 'product' }, { header: 't=1,v1=garbage' }));
  ok(junk.v.status === 401, 'a malformed signature → 401 (no throw)');

  const good = await quiet(() => call({ _id: 'p1', _type: 'product', operation: 'update' }));
  ok(good.v.status === 200 && started.length === 1 && started[0]['x-personalisation-key']?.length === 40, 'signed product change → 200, waiter started once with the internal header');
  const second = await quiet(() => call({ _id: 'p2', _type: 'faq', operation: 'create' }));
  const st = (await store.getWithMetadata(STATE_KEY)).data;
  ok(second.v.status === 200 && started.length === 1 && st.changes === 2 && st.types.join() === 'product,faq', 'a second change while the waiter lives: recorded, no second waiter');
  const del = await quiet(() => call({ _id: 'p3', operation: 'delete' }));
  ok(del.v.status === 200 && (await store.getWithMetadata(STATE_KEY)).data.changes === 3, 'a delete without _type (filtered by Sanity) still counts');

  const w0 = store.writes;
  const draft = await quiet(() => call({ _id: 'drafts.p1', _type: 'product' }));
  const order = await quiet(() => call({ _id: 'order.cs_1', _type: 'order' }));
  const voucher = await quiet(() => call({ _id: 'grouponVoucher.x', _type: 'grouponVoucher' }));
  ok(draft.v.status === 200 && order.v.status === 200 && voucher.v.status === 200 && store.writes === w0, 'draft, order, voucher: 200 (so Sanity doesn\'t retry) but ignored — nothing recorded');
  ok(![...none.lines, ...good.lines, ...order.lines, ...del.lines].some((l) => l.includes(SECRET)), 'the secret is never logged');

  delete process.env.SANITY_WEBHOOK_SECRET;
  const unset = await quiet(() => call({ _id: 'p1', _type: 'product' }));
  ok(unset.v.status === 500, 'SANITY_WEBHOOK_SECRET not set → refuses (fails closed)');
  process.env.SANITY_WEBHOOK_SECRET = SECRET;

  // The waiter can't be started → 500 so Sanity retries, and the arm is released.
  store.m.clear(); store.writes = 0;
  globalThis.fetch = async () => new Response('', { status: 503 });
  const down = await quiet(() => call({ _id: 'p1', _type: 'product' }));
  const after = (await store.getWithMetadata(STATE_KEY)).data;
  ok(down.v.status === 500 && after.pending === true && after.armedAt === 0, 'waiter can\'t start → 500 (Sanity retries), change kept, arm released');

  const bg = (await import('../../netlify/functions/content-build-background.mts')).default;
  const r = await bg(new Request('https://x/api/sanity/build-debounce-background', { method: 'POST', body: '{}' }));
  const r2 = await bg(new Request('https://x/api/sanity/build-debounce-background', { method: 'POST', body: '{}', headers: { 'x-personalisation-key': 'a'.repeat(40) } }));
  ok(r.status === 403 && r2.status === 403, 'the waiter refuses calls without (or with a wrong) internal header');
}

say(`\n${pass} passed, ${fail} failed.`);
process.exitCode = fail ? 1 : 0;
