/**
 * Print-file routes are admin-only.
 *
 *   node tools/builder/print-auth-tests.mjs
 *
 * Every /admin/api/print-file and /admin/api/print-any route, and the
 * /admin/print-file and /admin/print-any pages, must sit
 * under admin-auth.ts's /admin/* guard and get a 401 without Basic Auth; the
 * download edge function must refuse on its own too; the background renderer
 * and the pre-warm function must refuse anything without the internal header. Loads the real .ts/.mts
 * handlers (Node 24 strips the types).
 */
import { createHash } from 'node:crypto';

let pass = 0, fail = 0;
const ok = (c, l, e = '') => {
  if (c) { pass++; console.log(`  PASS  ${l}${e !== '' ? ' — ' + e : ''}`); }
  else { fail++; console.log(`  FAIL  ${l}${e !== '' ? ' — ' + e : ''}`); }
};
const say = console.log.bind(console);

const ENV = { ADMIN_USER: 'admin', ADMIN_PASSWORD: 'correct horse' };
globalThis.Netlify = { env: { get: (k) => ENV[k] } };
process.env.PERSONALISATION_SALT = 'test-salt';
const basic = (u, p) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;

const adminAuth = await import('../../netlify/edge-functions/admin-auth.ts');
const download = await import('../../netlify/edge-functions/print-file-download.ts');
const api = await import('../../netlify/functions/print-file-api.mts');
const page = await import('../../netlify/functions/print-file-page.mts');
const bg = await import('../../netlify/functions/print-file-background.mts');
const anyApi = await import('../../netlify/functions/print-any-api.mts');
const anyPage = await import('../../netlify/functions/print-any-page.mts');
const prewarm = await import('../../netlify/functions/print-prewarm-background.mts');

const ROUTES = [
  ['POST', '/admin/api/print-file/start?order=order.cs_live_x&line=l1'],
  ['GET', '/admin/api/print-file/status?order=order.cs_live_x&line=l1'],
  ['GET', '/admin/api/print-file/download?order=order.cs_live_x&line=l1'],
  ['GET', '/admin/print-file/order.cs_live_x/l1'],
  ['GET', '/admin/print-any'],
  ['GET', '/admin/api/print-any/products'],
  ['POST', '/admin/api/print-any/start'],
  ['GET', '/admin/api/print-any/status?key=print/adhoc/x/small-poster-aaaa-auto.jpg'],
  ['GET', '/admin/api/print-any/history'],
  ['GET', '/admin/api/print-file/download?adhoc=print/adhoc/x/small-poster-aaaa-auto.jpg'],
];

say('\n1. EVERY ROUTE IS UNDER THE /admin/* GUARD\n');
{
  const guard = new URLPattern({ pathname: adminAuth.config.path });
  for (const [, p] of ROUTES) ok(guard.test({ pathname: p.split('?')[0] }), `${p.split('?')[0]} matches admin-auth's "${adminAuth.config.path}"`);
  const paths = [...[].concat(api.config.path), page.config.path, download.config.path, ...[].concat(anyApi.config.path), anyPage.config.path];
  ok(paths.every((p) => p.startsWith('/admin/')), 'every print-file / print-any function and edge path starts with /admin/', paths.join(', '));
  ok(!anyPage.config.path.startsWith('/admin/print-file/'), 'print-any is NOT under /admin/print-file/ (whose segments are order ids)');
}

say('\n2. admin-auth: 401 WITHOUT BASIC AUTH\n');
{
  let reached = 0;
  const context = { next: async () => { reached++; return new Response('ok'); } };
  for (const [method, p] of ROUTES) {
    const r = await adminAuth.default(new Request(`https://pixel8multimedia.co.uk${p}`, { method }), context);
    ok(r.status === 401 && /Basic/.test(r.headers.get('www-authenticate') || ''), `${method} ${p.split('?')[0]} → 401 with a Basic challenge`);
  }
  const wrong = await adminAuth.default(new Request(`https://x${ROUTES[0][1]}`, { method: 'POST', headers: { authorization: basic('admin', 'nope') } }), context);
  ok(wrong.status === 401, 'wrong password → 401');
  ok(reached === 0, 'nothing behind the guard ran');
  const right = await adminAuth.default(new Request(`https://x${ROUTES[0][1]}`, { method: 'POST', headers: { authorization: basic('admin', 'correct horse') } }), context);
  ok(right.status === 200 && reached === 1 && right.headers.get('cache-control') === 'no-store, private', 'right credentials → passed through, not cacheable');
}

say('\n3. THE DOWNLOAD EDGE FUNCTION CHECKS FOR ITSELF\n');
{
  const url = `https://x${ROUTES[2][1]}`;
  const none = await download.default(new Request(url));
  ok(none.status === 401, 'no credentials → 401 (even if it ran before admin-auth)');
  const bad = await download.default(new Request(url, { headers: { authorization: basic('admin', 'guess') } }));
  ok(bad.status === 401, 'wrong credentials → 401');
  ENV.ADMIN_PASSWORD = '';
  const unconfigured = await download.default(new Request(url, { headers: { authorization: basic('admin', '') } }));
  ok(unconfigured.status === 503, 'no ADMIN_PASSWORD configured → 503, fails closed');
  ENV.ADMIN_PASSWORD = 'correct horse';
  const key = await download.default(new Request('https://x/admin/api/print-file/download?store=personalisation&key=../../secret', { headers: { authorization: basic('admin', 'correct horse') } }));
  ok(key.status === 400, 'authenticated, but a key outside the allowed patterns → 400');
  const adhocNone = await download.default(new Request(`https://x${ROUTES.at(-1)[1]}`));
  ok(adhocNone.status === 401, 'ad-hoc download without credentials → 401');
  const adhocBad = await download.default(new Request('https://x/admin/api/print-file/download?adhoc=' + encodeURIComponent('print/order.cs_x/l1/small-poster-c-aaaa-auto.jpg'), { headers: { authorization: basic('admin', 'correct horse') } }));
  ok(adhocBad.status === 400, 'authenticated, but an order file asked for as ad-hoc → 400 (ad-hoc keys only)');
}

say('\n4. FUNCTIONS REFUSE WHAT DIDN\'T COME IN UNDER /admin/\n');
{
  const r = await api.default(new Request('https://x/.netlify/functions/print-file-api?order=a&line=b', { method: 'POST' }));
  ok(r.status === 404, 'print-file-api reached by its function URL → 404');
  const p = await page.default(new Request('https://x/.netlify/functions/print-file-page'));
  ok(p.status === 404, 'print-file-page reached by its function URL → 404');
  const a = await anyApi.default(new Request('https://x/.netlify/functions/print-any-api'));
  ok(a.status === 404, 'print-any-api reached by its function URL → 404');
  const ap = await anyPage.default(new Request('https://x/.netlify/functions/print-any-page'));
  ok(ap.status === 404, 'print-any-page reached by its function URL → 404');
}

say('\n5. THE BACKGROUND RENDERER NEEDS THE INTERNAL HEADER\n');
{
  const body = JSON.stringify({ orderId: 'order.cs_live_x', lineKey: 'l1' });
  const none = await bg.default(new Request('https://x/api/print-file/render-background', { method: 'POST', body }));
  ok(none.status === 403, 'no x-personalisation-key → 403');
  const wrong = await bg.default(new Request('https://x/api/print-file/render-background', { method: 'POST', body, headers: { 'x-personalisation-key': 'a'.repeat(40) } }));
  ok(wrong.status === 403, 'wrong key of the right length → 403');
  const short = await bg.default(new Request('https://x/api/print-file/render-background', { method: 'POST', body, headers: { 'x-personalisation-key': 'abc' } }));
  ok(short.status === 403, 'wrong length → 403 (no throw from the constant-time compare)');
  const good = createHash('sha256').update('internal:test-salt').digest('hex').slice(0, 40);
  const noIds = await bg.default(new Request('https://x/api/print-file/render-background', { method: 'POST', body: '{}', headers: { 'x-personalisation-key': good } }));
  ok(noIds.status === 400, 'the right key gets past auth (then 400 for a body without ids)');

  const pw = (headers) => prewarm.default(new Request('https://x/api/print-file/prewarm-background', { method: 'POST', body: JSON.stringify({ orderId: 'order.cs_live_x' }), headers }));
  ok((await pw({})).status === 403, 'pre-warm: no x-personalisation-key → 403');
  ok((await pw({ 'x-personalisation-key': 'a'.repeat(40) })).status === 403, 'pre-warm: wrong key → 403');
  const pwEmpty = await prewarm.default(new Request('https://x/api/print-file/prewarm-background', { method: 'POST', body: JSON.stringify({ lines: [] }), headers: { 'x-personalisation-key': good } }));
  ok(pwEmpty.status === 400, 'pre-warm: the right key gets past auth (then 400 for nothing to do)');
}

say(`\n${pass} passed, ${fail} failed.`);
process.exitCode = fail ? 1 : 0;
