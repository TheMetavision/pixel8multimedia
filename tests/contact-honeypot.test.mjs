// The contact honeypot, renamed from `website` to `p8_extra_note`: either name,
// if filled, is treated as a bot (pages cached before the rename still send the
// old one). Sanity and Resend are stubbed: nothing is written or sent.
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
delete process.env.TURNSTILE_SECRET_KEY;            // the bot check is skipped without a secret
process.env.RESEND_API_KEY = 're_stub';
process.env.SANITY_TOKEN = 'stub';

const { default: handler, honeypotValue } = await import('../netlify/functions/contact.mts');

const base = { name: 'Test Person', email: 'p8-test@example.com', subject: 'general', message: 'Local test only.' };
const post = (body) => handler(new Request('http://localhost/api/contact', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}), {});

beforeEach(() => { globalThis.__p8c.created.length = 0; globalThis.__p8c.sent.length = 0; });

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
