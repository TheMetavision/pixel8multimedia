// A Groupon voucher is claimed once: a repeat claim (double click, retried
// POST, second tab, or two requests racing) gets the existing claim back and
// nothing is written twice. Sanity is stubbed with an in-memory store that
// enforces document revisions the way Sanity does.
//
//   npm test
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';

globalThis.__gr = { docs: new Map(), writes: [], stale: null };
const STUBS = {
  '@sanity/client': `
    export function createClient() {
      const t = globalThis.__gr;
      const snapshot = (d) => (d ? JSON.parse(JSON.stringify({ ...d, commissionPaidAt: null })) : null);
      return {
        fetch: async (q, params = {}) => {
          if (q.includes('_type == "service"')) return { commissionEnabled: true, briefFieldCount: 3 };
          if (q.includes('count(')) return 0;
          if (q.includes('grouponVoucher')) {
            if (t.stale && t.stale.length) return t.stale.shift();   // a read taken before another request wrote
            const d = [...t.docs.values()].find((v) => v.code === params.code);
            return snapshot(d);
          }
          return null;
        },
        patch: (id) => {
          let want = null; const set = {};
          const b = {
            ifRevisionId(rev) { want = rev; return b; },
            set(o) { Object.assign(set, o); return b; },
            async commit() {
              const d = t.docs.get(id);
              if (!d) throw new Error('not found');
              if (want && d._rev !== want) { const e = new Error('Document revision mismatch'); e.statusCode = 409; throw e; }
              Object.assign(d, set); d._rev = d._rev + 'x'; t.writes.push({ id, set }); return d;
            },
          };
          return b;
        },
        create: async (doc) => {
          if (t.docs.has(doc._id)) { const e = new Error('Document already exists'); e.statusCode = 409; throw e; }
          const d = { ...doc, _rev: 'r1' }; t.docs.set(doc._id, d); t.writes.push({ id: doc._id, create: true }); return d;
        },
      };
    }`,
};
registerHooks({
  resolve(spec, ctx, next) { return spec in STUBS ? { url: `stub:${spec}`, shortCircuit: true } : next(spec, ctx); },
  load(url, ctx, next) { return url.startsWith('stub:') ? { format: 'module', source: STUBS[url.slice(5)], shortCircuit: true } : next(url, ctx); },
});
process.env.PERSONALISATION_SALT = 'test-salt';
delete process.env.GROUPON_CLAIM_SECRET;
delete process.env.GROUPON_ACCEPT_UNKNOWN;

const { default: handler } = await import('../netlify/functions/groupon-redeem.mts');

const t = globalThis.__gr;
const CODE = 'TESTCODE0001';
let ip = 0;
const redeem = async (code = CODE, h = handler) => {
  const res = await h(new Request('http://localhost/.netlify/functions/groupon-redeem', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': `203.0.113.${++ip}` },
    body: JSON.stringify({ code, dealKey: '' }),
  }), {});
  return { status: res.status, body: await res.json(), cookie: res.headers.get('set-cookie') || '' };
};
const sha = (s) => createHash('sha256').update(s).digest('hex');
const voucher = () => [...t.docs.values()].find((v) => v.code === CODE);

beforeEach(() => {
  t.docs.clear(); t.writes.length = 0; t.stale = null;
  t.docs.set('grouponVoucher.test1', {
    _id: 'grouponVoucher.test1', _rev: 'r1', _type: 'grouponVoucher', code: CODE, status: 'imported',
    serviceSlug: 'cartoonify-me', valuePence: 1499, claimCount: 0, verificationStatus: 'verified',
    expiresAt: new Date(Date.now() + 30 * 864e5).toISOString(),
  });
});

test('first claim: one write; the token is the one whose hash is stored', async () => {
  const r = await redeem();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ok, true);
  assert.match(r.body.claimToken, /^[0-9a-f]{64}$/);
  assert.equal(t.writes.length, 1);
  assert.equal(voucher().claimTokenHash, sha(r.body.claimToken));
  assert.equal(voucher().claimCount, 1);
  assert.match(r.cookie, new RegExp(`p8_groupon_claim=${r.body.claimToken}`));
});

test('repeat claim: the existing claim comes back, nothing is written', async () => {
  const first = await redeem();
  const second = await redeem();
  const third = await redeem();
  assert.equal(second.status, 200);
  assert.equal(second.body.claimToken, first.body.claimToken);
  assert.equal(third.body.claimToken, first.body.claimToken);
  assert.equal(second.body.claimExpiresAt, first.body.claimExpiresAt);
  assert.equal(t.writes.length, 1, 'only the first request wrote');
  assert.equal(voucher().claimCount, 1);
  assert.equal(voucher().claimTokenHash, sha(first.body.claimToken), 'the first token still works at checkout');
});

test('two requests racing: one write, both get the same claim', async () => {
  // Both requests read the voucher before either has written.
  const before = JSON.parse(JSON.stringify({ ...voucher(), commissionPaidAt: null }));
  t.stale = [before, structuredClone(before)];
  const [a, b] = await Promise.all([redeem(), redeem()]);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.equal(a.body.claimToken, b.body.claimToken);
  assert.equal(t.writes.length, 1);
  assert.equal(voucher().claimTokenHash, sha(a.body.claimToken));
});

test('a repeat claim during checkout returns the claim and leaves status alone', async () => {
  const first = await redeem();
  voucher().status = 'checkout';
  const again = await redeem();
  assert.equal(again.body.claimToken, first.body.claimToken);
  assert.equal(voucher().status, 'checkout');
  assert.equal(t.writes.length, 1);
});

test('a lapsed claim is a new claim', async () => {
  const first = await redeem();
  voucher().claimExpiresAt = new Date(Date.now() - 1000).toISOString();
  const later = await redeem();
  assert.equal(later.status, 200);
  assert.notEqual(later.body.claimToken, first.body.claimToken);
  assert.equal(t.writes.length, 2);
  assert.equal(voucher().claimCount, 2);
});

test('a spent voucher is still refused', async () => {
  voucher().status = 'redeemed';
  const r = await redeem();
  assert.equal(r.status, 409);
  assert.equal(t.writes.length, 0);
});

test('accept-unknown mode: a repeated unknown code makes one document and one claim', async () => {
  process.env.GROUPON_ACCEPT_UNKNOWN = 'true';
  const { default: openHandler } = await import('../netlify/functions/groupon-redeem.mts?accept-unknown');
  delete process.env.GROUPON_ACCEPT_UNKNOWN;
  const body = (code) => ({ code, dealKey: '' });
  const call = async () => {
    const res = await openHandler(new Request('http://localhost/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': `198.51.100.${++ip}` },
      body: JSON.stringify({ ...body('NEWCODE77777'), dealKey: process.env.__DEAL || '' }),
    }), {});
    return { status: res.status, body: await res.json() };
  };
  // the deal key has to name a real option; take the first one the campaigns file defines
  const { dealOptionByKey } = await import('../netlify/functions/_shared/groupon.mts');
  const campaigns = (await import('../src/data/groupon-campaigns.json', { with: { type: 'json' } })).default;
  const firstKey = JSON.stringify(campaigns).match(/"key":\s*"([^"]+)"/)?.[1];
  assert.ok(firstKey && dealOptionByKey(firstKey), 'a deal option to use');
  process.env.__DEAL = firstKey;
  const a = await call();
  const b = await call();
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.equal(b.body.claimToken, a.body.claimToken);
  const docs = [...t.docs.values()].filter((d) => d.code === 'NEWCODE77777');
  assert.equal(docs.length, 1);
});
