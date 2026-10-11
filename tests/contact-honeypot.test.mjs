// The contact honeypot, renamed from `website` to `p8_extra_note`: either name,
// if filled, is treated as a bot (pages cached before the rename still send the
// old one). Sanity, Resend and Cloudflare's siteverify are stubbed: nothing is
// written, sent or verified for real. Also: the shared Turnstile check fails
// closed (503) when TURNSTILE_SECRET_KEY is missing, for contact, upload and
// commission alike.
//
//   npm test
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

globalThis.__p8c = { created: [], sent: [] };
const STUBS = {
  '@sanity/client': `
    export function createClient() {
      const t = globalThis.__p8c;
      return { fetch: async () => 0, create: async (d) => { t.created.push(d); return d; } };
    }`,
  resend: `
    export class Resend {
      constructor() { this.emails = { send: async (m) => { globalThis.__p8c.sent.push(m); return { data: { id: 'x' }, error: null }; } }; }
    }`,
};
registerHooks({
  resolve(spec, ctx, next) { return spec in STUBS ? { url: `stub:${spec}`, shortCircuit: true } : next(spec, ctx); },
  load(url, ctx, next) { return url.startsWith('stub:') ? { format: 'module', source: STUBS[url.slice(5)], shortCircuit: true } : next(url, ctx); },
});
process.env.TURNSTILE_SECRET_KEY = 'ts_test_secret';
// siteverify: passes 'tok-ok', refuses anything else. No other fetch expected.
const verified = [];
globalThis.fetch = async (url, init = {}) => {
  if (!String(url).includes('challenges.cloudflare.com')) throw new Error(`unexpected fetch ${url}`);
  const { response } = JSON.parse(init.body);
  verified.push(response);
  return Response.json(response === 'tok-ok' ? { success: true, hostname: 'localhost' } : { success: false, 'error-codes': ['invalid-input-response'] });
};
process.env.RESEND_API_KEY = 're_stub';
process.env.SANITY_TOKEN = 'stub';

const { default: handler, honeypotValue } = await import('../netlify/functions/contact.mts');

const base = { name: 'Test Person', email: 'p8-test@example.com', subject: 'general', message: 'Local test only.', turnstile: 'tok-ok' };
const post = (body) => handler(new Request('http://localhost/api/contact', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}), {});

beforeEach(() => {
  globalThis.__p8c.created.length = 0; globalThis.__p8c.sent.length = 0; verified.length = 0;
  process.env.TURNSTILE_SECRET_KEY = 'ts_test_secret';
});

test('honeypotValue reads the new name and the old one', () => {
  assert.equal(honeypotValue({ p8_extra_note: ' spam ' }), 'spam');
  assert.equal(honeypotValue({ website: 'http://spam.example' }), 'http://spam.example');
  assert.equal(honeypotValue({ p8_extra_note: '', website: '' }), '');
  assert.equal(honeypotValue({}), '');
  assert.equal(honeypotValue(null), '');
});

for (const [label, trap] of [['new name', { p8_extra_note: 'I am a bot' }], ['old name (cached page)', { website: 'http://spam.example' }]]) {
  test(`a filled honeypot (${label}) gets a fake success; nothing is saved or sent`, async () => {
    const res = await post({ ...base, ...trap });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).success, true);
    assert.equal(globalThis.__p8c.created.length, 0);
    assert.equal(globalThis.__p8c.sent.length, 0);
  });
}

test('an empty honeypot goes through to the normal path', async () => {
  const res = await post({ ...base, p8_extra_note: '' });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(globalThis.__p8c.created.length, 1, 'saved (to the stub)');
  assert.ok(globalThis.__p8c.sent.length >= 1, 'emailed (to the stub)');
});

test('a rejected Turnstile token: 403, nothing saved or sent', async () => {
  const res = await post({ ...base, turnstile: 'tok-bad' });
  assert.equal(res.status, 403);
  assert.equal(globalThis.__p8c.created.length + globalThis.__p8c.sent.length, 0);
});

test('no TURNSTILE_SECRET_KEY: contact fails closed with a 503, nothing verified, saved or sent', async () => {
  delete process.env.TURNSTILE_SECRET_KEY;
  const res = await post(base);
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /temporarily unavailable/);
  assert.equal(verified.length, 0);
  assert.equal(globalThis.__p8c.created.length + globalThis.__p8c.sent.length, 0);
});

test('the shared helper: no secret is { ok: false, unavailable: true }, never a skip', async () => {
  const { verifyTurnstile } = await import('../netlify/functions/_shared/turnstile.mjs');
  const v = await verifyTurnstile('tok-ok', { context: 'test', secret: '', log: () => {} });
  assert.equal(v.ok, false);
  assert.equal(v.unavailable, true);
  assert.equal(verified.length, 0, 'Cloudflare not even asked');
});

test('upload, commission and personalisation upload answer a missing secret with 503 too', async () => {
  process.env.STRIPE_SECRET_KEY ||= 'sk_test_stub_never_called';
  const { default: upload } = await import('../netlify/functions/upload.mts');
  const { default: commission } = await import('../netlify/functions/commission-checkout.mts');
  const { default: personalisation } = await import('../netlify/functions/personalisation-upload.mts');
  const photo = () => {
    const f = new FormData();
    f.set('file', new File([new Uint8Array([0xff, 0xd8, 0xff])], 'p.jpg', { type: 'image/jpeg' }));
    f.set('turnstile', 'tok-ok'); f.set('fieldKey', 'photo'); f.set('consent', 'true');
    return f;
  };
  const calls = {
    upload: () => upload(new Request('http://localhost/.netlify/functions/upload', { method: 'POST', body: photo() }), {}),
    commission: () => commission(new Request('http://localhost/.netlify/functions/commission-checkout', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serviceSlug: 'pet-portrait', name: 'Test Person', email: 'p8-test@example.com', turnstile: 'tok-ok' }),
    }), {}),
    personalisation: () => personalisation(new Request('http://localhost/.netlify/functions/personalisation-upload', { method: 'POST', body: photo() })),
  };
  for (const [name, call] of Object.entries(calls)) {
    delete process.env.TURNSTILE_SECRET_KEY;
    verified.length = 0;
    const res = await call();
    assert.equal(res.status, 503, name);
    assert.match((await res.json()).error, /temporarily unavailable/, name);
    assert.equal(verified.length, 0, `${name}: Cloudflare not asked`);
    assert.equal(globalThis.__p8c.created.length, 0, `${name}: nothing saved`);
  }
});
