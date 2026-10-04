/**
 * Browser side of the GA ids sent at checkout (src/lib/analytics.ts), with a
 * fake gtag.
 *
 *   node tools/builder/ga4-client-ids-tests.mjs
 *
 * client_id and session_id are asked for together within one time limit;
 * gaSessionId only goes with a gaClientId.
 */
let pass = 0, fail = 0;
const ok = (c, l, e = '') => {
  if (c) { pass++; console.log(`  PASS  ${l}${e !== '' ? ' — ' + e : ''}`); }
  else { fail++; console.log(`  FAIL  ${l}${e !== '' ? ' — ' + e : ''}`); }
};
const say = console.log.bind(console);
const j = JSON.stringify;

// Just enough browser for analytics.ts. loadAnalytics() installs its own
// gtag once; `answers` decides what the fake one replies, and when.
let answers = {};
const store = new Map([['p8-consent', 'granted']]);
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
globalThis.document = { createElement: () => ({}), head: { appendChild() {} } };
globalThis.window = globalThis;

const { gaIds, gaCheckoutIds } = await import('../../src/lib/analytics.ts');
await gaIds(1); // installs window.gtag
window.gtag = (cmd, _id, field, cb) => {
  if (cmd !== 'get' || !(field in answers)) return; // never answers
  const [value, delay] = answers[field];
  setTimeout(() => cb(value), delay);
};

const time = async (fn) => { const t = Date.now(); const r = await fn(); return [r, Date.now() - t]; };

say('\n1. gaIds\n');
{
  answers = { client_id: ['111.222', 5], session_id: [1700000123, 10] };
  const [ids, ms] = await time(() => gaIds(500));
  ok(ids.clientId === '111.222' && ids.sessionId === '1700000123', 'both ids (numeric session id as a string)', j(ids));
  ok(ms < 200, 'resolves as soon as both answer', `${ms} ms`);

  answers = { client_id: ['111.222', 5] };
  const [late, lateMs] = await time(() => gaIds(100));
  ok(late.clientId === '111.222' && late.sessionId === null, 'session id never answers → client id still returned', j(late));
  ok(lateMs >= 90 && lateMs < 300, 'within the one time limit', `${lateMs} ms`);

  answers = { client_id: ['111.222', 5], session_id: ['1700000123', 400] };
  const [both, bothMs] = await time(() => gaIds(100));
  ok(both.sessionId === null && bothMs < 300, 'a slow session id does not extend the limit', `${bothMs} ms`);
}

say('\n2. gaCheckoutIds\n');
{
  answers = { client_id: ['111.222', 1], session_id: ['1700000123', 1] };
  ok(j(await gaCheckoutIds(100)) === j({ gaClientId: '111.222', gaSessionId: '1700000123' }), 'both');
  answers = { client_id: ['111.222', 1] };
  ok(j(await gaCheckoutIds(50)) === j({ gaClientId: '111.222' }), 'client id only');
  answers = { session_id: ['1700000123', 1] };
  ok(j(await gaCheckoutIds(50)) === '{}', 'session id without client id → nothing');
  store.set('p8-consent', 'denied');
  answers = { client_id: ['111.222', 1], session_id: ['1700000123', 1] };
  ok(j(await gaCheckoutIds(50)) === '{}', 'no consent → nothing');
}

say(`\n${pass} passed, ${fail} failed.`);
process.exitCode = fail ? 1 : 0;
