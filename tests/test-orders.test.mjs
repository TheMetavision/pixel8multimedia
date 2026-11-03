// Stripe test-mode orders and commissions (fix/test-order-safety, 3 Nov 2026):
// recorded as test: true, [TEST] on the team emails, a free void label from
// the shipping service, and no GA4 purchase. A live order is untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakeSanity, fakeResend, quietLog } from './helpers/fake-sanity.mjs';
import { dispatchShipment } from '../netlify/functions/_shared/shipping-dispatch.mjs';
import { processReturn } from '../netlify/functions/_shared/shipping-returns.mjs';
import { testOrderFlag, shippingRequest } from '../netlify/functions/_shared/shipping-client.mjs';
import { sendPurchase } from '../netlify/functions/_shared/ga4.mjs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SESSION = 'cs_live_xxxxxxxxAbCdEfGh';
const ORDER_ID = `order.${SESSION}`;
const REF = 'P8-AbCdEfGh';
const order = (over = {}) => ({
  _id: ORDER_ID, _type: 'order', stripeSessionId: SESSION, orderNumber: REF,
  customerName: 'Ada Lovelace', customerEmail: 'ada@example.com',
  shippingAddress: { line1: '2 Road', line2: '', city: 'Leeds', county: '', postcode: 'LS1 1AA', country: 'GB' },
  lineItems: [{ _key: 'stock', productTitle: 'Hulk', format: 'Poster', size: 'Small (12×12")', formatKey: 'poster', sizeKey: 'small', quantity: 1, unitPrice: 9.99 }],
  status: 'received', createdAt: '2026-11-02T10:00:00Z',
  ...over,
});
const commission = (over = {}) => ({
  _id: 'comm1', _type: 'commission', orderRef: 'PX-AB12CD34', customerName: 'Grace Hopper', customerEmail: 'grace@example.com',
  deliveryType: 'both', status: 'in-progress', stripeSessionId: 'cs_live_commission01',
  prints: [{ _key: 'pr1', format: 'canvas-gallery', size: 'medium' }],
  ...over,
});
const shippingFake = () => {
  const calls = [];
  const fn = async (path, body) => {
    calls.push({ path, body });
    return { parcelId: 100 + calls.length, shipmentId: 's', carrier: 'royal_mail', method: 'royal_mail:tracked48', trackingNumber: `TN${body.parcelRef || 'R'}`, trackingUrl: 'https://track/x', labelId: `L${calls.length}`, quotedPrice: { amount: 0, currency: 'GBP' } };
  };
  fn.calls = calls;
  return fn;
};
const noTestMode = async (fn) => {
  const saved = process.env.SHIPPING_TEST_MODE;
  delete process.env.SHIPPING_TEST_MODE;
  try { return await fn(); } finally { if (saved !== undefined) process.env.SHIPPING_TEST_MODE = saved; }
};

test('testOrderFlag: { test: true } only for a document with test === true', () => {
  assert.deepEqual(testOrderFlag({ test: true }), { test: true });
  for (const o of [{}, { test: false }, { test: 'true' }, null, undefined]) assert.deepEqual(testOrderFlag(o), {});
});

test('shop order: test-mode -> test label and [TEST] team email; live -> neither', () => noTestMode(async () => {
  for (const [over, isTest] of [[{ test: true }, true], [{}, false]]) {
    const sanity = fakeSanity([order({ shipment: { status: 'ready_to_ship' }, ...over })]);
    const shipping = shippingFake();
    const resend = fakeResend();
    assert.equal((await dispatchShipment(ORDER_ID, { sanity, shipping, getResend: () => resend, log: quietLog })).outcome, 'label_created');
    assert.equal(shipping.calls[0].path, 'create-parcel');
    assert.equal(shipping.calls.every((c) => c.body.test === true), isTest);
    if (!isTest) assert.ok(shipping.calls.every((c) => !('test' in c.body)), 'a live order never sends test');
    assert.equal(/^\[TEST\] /.test(resend.sent[0].subject), isTest);
  }
}));

test('commission: a test-mode commission gets a test label; a live one does not', async () => {
  const fetch = async () => ({ serviceTitle: 'Cartoonify Me', printSizeLabels: { small: '12×8' }, hasService: true });
  const retrieveSession = async () => ({ shipping_details: { name: 'Grace H', address: { line1: '1 Lane', city: 'York', postal_code: 'YO1 1AA', country: 'GB' } } });
  for (const [over, isTest] of [[{ test: true }, true], [{}, false]]) {
    const sanity = fakeSanity([commission({ shipment: { status: 'ready_to_ship' }, ...over })], { fetch });
    const shipping = shippingFake();
    assert.equal((await dispatchShipment('comm1', { sanity, shipping, retrieveSession, getResend: () => fakeResend(), log: quietLog })).outcome, 'label_created');
    assert.equal(shipping.calls[0].body.test === true, isTest);
    if (!isTest) assert.equal('test' in shipping.calls[0].body, false);
  }
});

test('return: the return of a test-mode order gets a test label; a live order\'s does not', async () => {
  for (const [over, isTest] of [[{ test: true }, true], [{}, false]]) {
    const o = order({ status: 'delivered', shipmentResult: { dispatchedAt: '2026-11-03T09:00:00Z', deliveredAt: '2026-11-04T09:00:00Z' }, ...over });
    const ret = { _id: 'returnRequest.ret-t', _type: 'returnRequest', returnRef: 'ret-t', returnNumber: `${REF}-R1`, orderId: ORDER_ID, orderNumber: REF, customerName: 'Ada', customerEmail: 'ada@example.com', status: 'approved', band: 'P5', lines: [{ lineKey: 'stock', productTitle: 'Hulk', format: 'Poster', size: 'Small', quantity: 1, unitPrice: 9.99 }] };
    const calls = [];
    const shipping = async (path, body) => { calls.push({ path, body }); return { carrier: 'inpost_gb', labelId: 'R1', trackingNumber: 'IP1', customerInstructions: 'Drop it at any InPost Locker.', quotedPrice: { amount: 0, currency: 'GBP' } }; };
    const r = await processReturn('returnRequest.ret-t', { sanity: fakeSanity([o, ret]), shipping, fetchLabel: async () => Buffer.from('%PDF'), getResend: () => fakeResend(), log: quietLog });
    assert.equal(r.outcome, 'label_sent');
    assert.equal(calls[0].path, 'create-return');
    assert.equal(calls[0].body.test === true, isTest);
    if (!isTest) assert.equal('test' in calls[0].body, false);
  }
});

test('shippingRequest: a test order\'s flag reaches the service with SHIPPING_TEST_MODE off; a live body stays live', async () => {
  const sent = [];
  const fetchImpl = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
  const env = { SHIPPING_SECRET: 'sek' };
  await shippingRequest('create-parcel', { body: { orderRef: 'A', ...testOrderFlag({ test: true }) }, env, fetchImpl });
  await shippingRequest('create-parcel', { body: { orderRef: 'B', ...testOrderFlag({}) }, env, fetchImpl });
  assert.equal(sent[0].test, true);
  assert.equal('test' in sent[1], false);
});

test('GA4: a live purchase is sent; a test-mode (or livemode-less) session never is', async () => {
  const saved = process.env.GA4_API_SECRET;
  process.env.GA4_API_SECRET = 'secret';
  try {
    const calls = [];
    const fetchImpl = async (url, init) => { calls.push(url); return { ok: true, status: 204 }; };
    const s = { id: 'cs_x', currency: 'gbp', amount_total: 1000, metadata: { ga_client_id: '1234567890.1700000000' } };
    for (const session of [{ ...s, livemode: false }, s]) await sendPurchase(session, [], { fetchImpl });
    assert.equal(calls.length, 0, 'test-mode sessions are not reported');
    await sendPurchase({ ...s, livemode: true }, [], { fetchImpl });
    assert.equal(calls.length, 1, 'a live session still is');
  } finally { if (saved === undefined) delete process.env.GA4_API_SECRET; else process.env.GA4_API_SECRET = saved; }
});

test('webhooks: a test-mode session is saved with test: true and its team email is [TEST]', () => {
  const shop = code(read('../netlify/functions/webhook.mjs'));
  const create = shop.slice(shop.indexOf('order = await sanity.create({'), shop.indexOf('order = await sanity.create({') + 700);
  assert.match(create, /\.\.\.\(session\.livemode === false \? \{ test: true \} : \{\}\),/);
  assert.match(shop, /subject: `\$\{session\.livemode === false \? '\[TEST\] ' : ''\}\$\{discountWarning/);
  const comm = code(read('../netlify/functions/stripe-webhook-commission.mts'));
  assert.match(comm, /if \(session\.livemode === false\) patch\.test = true;/);
  assert.match(comm, /subject: `\$\{session\.livemode === false \? '\[TEST\] ' : ''\}\$\{promoWarning/);
});

test('Studio: orders and commissions show a read-only "Test order" field, hidden on live ones', () => {
  for (const f of ['order.ts', 'commission.ts']) {
    const schema = read(`../studio/schemas/${f}`);
    const at = schema.indexOf("name: 'test'");
    assert.ok(at > 0, f);
    const field = schema.slice(at, at + 300);
    assert.match(field, /title: 'Test order \(Stripe test mode\)'/, f);
    assert.match(field, /readOnly: true/, f);
    assert.match(field, /hidden: \(\{ value \}\) => !value/, f);
  }
});
