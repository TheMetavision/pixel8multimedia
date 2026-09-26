/**
 * Which address the site uses to reach itself, and what a trigger does when
 * that address has a bad few seconds. Adapted from Comic Strip Canvas.
 *
 *   node tools/builder/origin-tests.mjs
 *
 * approve → print-background and webhook → proof used to be fire-and-forget
 * fetches to the public domain. They now await triggerInternal(), which posts
 * to https://<SITE_NAME>.netlify.app with a short retry.
 */
import {
  internalOrigin, publicOrigin, fetchWithRetry, triggerInternal, TRIGGER_BUDGETS,
} from '../../netlify/functions/_shared/origin.mjs';

let pass = 0, fail = 0;
const ok = (c, l, e = '') => {
  if (c) { pass++; console.log(`  PASS  ${l}${e !== '' ? ' — ' + e : ''}`); }
  else { fail++; console.log(`  FAIL  ${l}${e !== '' ? ' — ' + e : ''}`); }
};
const say = console.log.bind(console);
const req = (url) => ({ url });
const PROD = { URL: 'https://pixel8multimedia.co.uk', SITE_NAME: 'pixel8multimedia' };
const sleeps = [];
const sleep = async (ms) => { sleeps.push(ms); };

say('\n1. WHICH ORIGIN\n');
{
  ok(internalOrigin(req('https://pixel8multimedia.co.uk/api/webhook'), PROD) === 'https://pixel8multimedia.netlify.app',
    'production: a request on the custom domain calls <SITE_NAME>.netlify.app');
  ok(internalOrigin(undefined, PROD) === 'https://pixel8multimedia.netlify.app', 'no request at all: still SITE_NAME');
  ok(internalOrigin(req('https://deploy-preview-7--pixel8multimedia.netlify.app/x'), PROD) === 'https://deploy-preview-7--pixel8multimedia.netlify.app',
    'a deploy preview calls ITS OWN functions');
  ok(internalOrigin(req('http://localhost:8888/api/x'), PROD) === 'http://localhost:8888', 'netlify dev on localhost stays on localhost');
  ok(internalOrigin(undefined, { ...PROD, NETLIFY_DEV: 'true' }) === 'https://pixel8multimedia.co.uk', 'NETLIFY_DEV without a request: URL');
  ok(internalOrigin(undefined, { URL: 'https://pixel8multimedia.co.uk' }) === 'https://pixel8multimedia.co.uk', 'no SITE_NAME: falls back to URL');
  ok(publicOrigin(req('https://pixel8multimedia.netlify.app/x'), PROD) === 'https://pixel8multimedia.co.uk', 'customer-facing links stay on the public domain');
}

say('\n2. RETRIES\n');
{
  let n = 0;
  const flaky = async () => { n++; if (n < 3) throw new Error('fetch failed'); return { ok: true, status: 202 }; };
  sleeps.length = 0;
  const r = await fetchWithRetry('https://x/y', { fetchImpl: flaky, sleep });
  ok(r.status === 202 && n === 3, 'two refused connections, then a 202: succeeds on the third attempt', `${n} attempts`);
  ok(sleeps.join(',') === '300,900', 'backs off 300ms then 900ms', sleeps.join(','));

  let hits = 0;
  const forbidden = async () => { hits++; return { ok: false, status: 403 }; };
  const f = await fetchWithRetry('https://x/y', { fetchImpl: forbidden, sleep });
  ok(f.status === 403 && hits === 1, 'a 4xx is not retried', `${hits} attempt`);

  let fives = 0;
  const busy = async () => { fives++; return { ok: false, status: 503 }; };
  const b = await fetchWithRetry('https://x/y', { fetchImpl: busy, sleep });
  ok(fives === 3 && b.status === 503, 'a 503 is retried, and the last response handed back', `${fives} attempts`);

  let down = 0;
  const dead = async () => { down++; throw new Error('ECONNREFUSED'); };
  let threw = null;
  try { await fetchWithRetry('https://x/y', { fetchImpl: dead, sleep }); } catch (e) { threw = e; }
  ok(threw && down === 3, 'always refused: throws after 3 attempts', threw?.message);
}

say('\n3. triggerInternal\n');
{
  let seen = null;
  const accept = async (url, init) => { seen = { url, init }; return { ok: true, status: 202 }; };
  const r = await triggerInternal('/api/personalisation/print-background', {
    req: req('https://pixel8multimedia.co.uk/api/personalisation/approve?pid=x'), env: PROD,
    body: { pid: 'abc' }, headers: { 'x-personalisation-key': 'k' }, fetchImpl: accept, sleep,
  });
  ok(r.ok && r.status === 202, 'a 202 from a background function counts as success');
  ok(seen.url === 'https://pixel8multimedia.netlify.app/api/personalisation/print-background', 'posts to the internal origin', seen.url);
  ok(seen.init.method === 'POST' && JSON.parse(seen.init.body).pid === 'abc' && seen.init.headers['x-personalisation-key'] === 'k'
    && seen.init.headers['Content-Type'] === 'application/json', 'POST, JSON body, internal key header');

  const done = await triggerInternal('/api/personalisation/proof', { env: PROD, fetchImpl: async () => ({ ok: true, status: 200 }), sleep });
  ok(done.ok, 'a 200 from a synchronous function counts as success');

  let tries = 0;
  const gone = await triggerInternal('/api/x', { env: PROD, fetchImpl: async () => { tries++; throw new Error('fetch failed'); }, sleep });
  ok(!gone.ok && gone.error === 'fetch failed' && tries === 3, 'gives up cleanly after retries: returns { ok:false, error }, never throws', gone.error);

  const refused = await triggerInternal('/api/x', { env: PROD, fetchImpl: async () => ({ ok: false, status: 403 }), sleep });
  ok(!refused.ok && refused.status === 403, 'a 403 (bad internal key) is a failure, reported with its status');

  const slow = await triggerInternal('/api/x', {
    env: PROD, timeoutMs: 20, attempts: 1, sleep,
    // A real hung fetch holds a socket open; this fake holds a timer instead,
    // or Node would exit before AbortSignal.timeout's (unref'd) timer fires.
    fetchImpl: (url, init) => new Promise((_, rej) => {
      const hold = setTimeout(() => {}, 5000);
      init.signal.addEventListener('abort', () => { clearTimeout(hold); rej(init.signal.reason); });
    }),
  });
  ok(!slow.ok && slow.error === 'timed out', 'a hung request times out instead of hanging the webhook', slow.error);
}

say('\n4. THE BUDGET — real timers, real numbers\n');
{
  /** A fake endpoint that answers after `ms` (or never), and honours abort like a real socket. */
  const endpoint = (ms, res) => (url, init) => new Promise((resolve, reject) => {
    const t = ms === Infinity ? setTimeout(() => {}, 60_000) : setTimeout(() => resolve(res), ms);
    init?.signal?.addEventListener('abort', () => { clearTimeout(t); reject(init.signal.reason); });
  });
  const timed = async (fn) => { const t0 = Date.now(); const r = await fn(); return { r, ms: Date.now() - t0 }; };

  const W = TRIGGER_BUDGETS.webhookProof;
  ok(W.budgetMs <= 6000 && W.retryOnTimeout === false && W.attempts === 2, 'webhook → proof: ≤ 6 s, 2 attempts, a timeout is not retried', JSON.stringify(W));
  ok(TRIGGER_BUDGETS.sweepRetry.budgetMs <= 6000, 'sweep retry: ≤ 6 s per trigger');
  ok(TRIGGER_BUDGETS.approvePrint.budgetMs <= 10000, 'approve → print: ≤ 10 s');

  let calls = 0;
  const hung = (url, init) => { calls++; return endpoint(Infinity)(url, init); };
  const a = await timed(() => triggerInternal('/api/personalisation/proof', { env: PROD, fetchImpl: hung, ...W }));
  ok(!a.r.ok && a.r.error === 'timed out' && calls === 1 && a.ms <= W.budgetMs + 250,
    'proof endpoint hangs: gives up after ONE attempt, within the cap', `${a.ms} ms, ${calls} call`);

  let slowCalls = 0;
  const slow503 = (url, init) => { slowCalls++; return endpoint(4000, { ok: false, status: 503 })(url, init); };
  const b = await timed(() => triggerInternal('/api/personalisation/proof', { env: PROD, fetchImpl: slow503, ...W }));
  ok(!b.r.ok && slowCalls === 2 && b.ms <= W.budgetMs + 250,
    'a 503 after 4 s: the retry gets only what is left of the 6 s, and it still gives up in time', `${b.ms} ms, ${slowCalls} calls, ${b.r.error}`);

  let refusals = 0;
  const refused = async () => { refusals++; throw new Error('ECONNREFUSED'); };
  const c = await timed(() => triggerInternal('/api/x', { env: PROD, fetchImpl: refused, ...W }));
  ok(!c.r.ok && refusals === 2 && c.ms < 1000, 'refused twice: 2 quick attempts, gives up in well under a second', `${c.ms} ms`);

  const fast = await timed(() => triggerInternal('/api/x', { env: PROD, fetchImpl: endpoint(50, { ok: true, status: 202 }), ...TRIGGER_BUDGETS.approvePrint }));
  ok(fast.r.ok && fast.ms < 500, 'a healthy 202 is not slowed down by any of this', `${fast.ms} ms`);

  // The same mechanism, fast: budget smaller than attempts × timeout.
  let n = 0;
  const d = await timed(() => fetchWithRetry('https://x/y', {
    attempts: 5, timeoutMs: 200, budgetMs: 450, minAttemptMs: 100, baseDelayMs: 10,
    fetchImpl: (u, i) => { n++; return endpoint(Infinity)(u, i); },
  }).catch((e) => e));
  ok(d.ms <= 450 + 100 && n === 2, 'budget wins over attempts × timeout: 5 allowed, 2 fit in 450 ms', `${d.ms} ms, ${n} attempts`);
}

say(`\n${pass} passed, ${fail} failed.`);
process.exitCode = fail ? 1 : 0;
