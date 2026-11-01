// The Sendcloud flow end to end against fakes: the dispatch email's once-only
// claim, the router, label buying, tracking events, returns.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeSanity, fakeResend, quietLog } from './helpers/fake-sanity.mjs';
import { sendDispatchEmail, buildOrderDispatchEmail } from '../netlify/functions/_shared/dispatch-email.mjs';
import { routeFor, runRoute } from '../netlify/functions/_shared/orders-router.mjs';
import { dispatchShipment } from '../netlify/functions/_shared/shipping-dispatch.mjs';
import { applyParcelEvent, applyReturnEvent } from '../netlify/functions/_shared/shipping-events.mjs';
import { processReturn } from '../netlify/functions/_shared/shipping-returns.mjs';
import { handleReturns, issueSession } from '../netlify/functions/_shared/returns-api.mjs';
import { serverPatch } from '../netlify/functions/_shared/server-patch.mjs';

const SESSION = 'cs_live_xxxxxxxxAbCdEfGh';
const ORDER_ID = `order.${SESSION}`;
const REF = 'P8-AbCdEfGh';

const order = (over = {}) => ({
  _id: ORDER_ID,
  _type: 'order',
  stripeSessionId: SESSION,
  stripePaymentId: 'pi_3TESTabcdefgh',
  orderNumber: REF,
  customerName: 'Ada Lovelace',
  customerEmail: 'ada@example.com',
  shippingAddress: { line1: '2 Road', line2: '', city: 'Leeds', county: '', postcode: 'LS1 1AA', country: 'GB' },
  lineItems: [
    { _key: 'stock', productTitle: 'Hulk', format: 'Poster', size: 'Small (12×12")', formatKey: 'poster', sizeKey: 'small', quantity: 1, unitPrice: 9.99 },
    { _key: 'photo', productTitle: 'Your Photo', format: 'Gallery Canvas', size: 'Large', formatKey: 'canvasGallery', sizeKey: 'large', personalisationId: 'pid', quantity: 1, unitPrice: 52.99 },
  ],
  status: 'received',
  createdAt: '2026-11-02T10:00:00Z',
  ...over,
});

const commission = (over = {}) => ({
  _id: 'comm1',
  _type: 'commission',
  orderRef: 'PX-AB12CD34',
  customerName: 'Grace Hopper',
  customerEmail: 'grace@example.com',
  deliveryType: 'both',
  status: 'in-progress',
  stripeSessionId: 'cs_live_commission01',
  prints: [{ _key: 'pr1', format: 'canvas-gallery', size: 'medium' }],
  ...over,
});

const resendDeps = (resend) => ({ getResend: () => resend, log: quietLog });

/* ------------------------------------------------------------------ dispatch email */

test('manual dispatch: an order dispatched with tracking is emailed once, stamped on published AND draft', async () => {
  const sanity = fakeSanity([
    order({ status: 'dispatched', trackingNumber: 'RM123', carrier: 'royalmail' }),
    { ...order({ status: 'in-production' }), _id: `drafts.${ORDER_ID}`, notes: 'Alan is typing' },
  ]);
  const resend = fakeResend();
  const r = await sendDispatchEmail({ kind: 'order', id: ORDER_ID, sanity, ...resendDeps(resend) });
  assert.equal(r.sent, true);
  assert.equal(resend.sent.length, 1);
  assert.match(resend.sent[0].subject, /P8-AbCdEfGh/);
  assert.match(resend.sent[0].html, /royalmail\.com\/track-your-item\?trackNumber=RM123/);
  assert.equal(resend.sent[0].from, 'Pixel8 Multimedia <hello@pixel8multimedia.co.uk>');
  const pub = sanity.store.get(ORDER_ID);
  const draft = sanity.store.get(`drafts.${ORDER_ID}`);
  assert.ok(pub.dispatchEmailSentAt && !pub.dispatchEmailClaimedAt);
  assert.equal(draft.dispatchEmailSentAt, pub.dispatchEmailSentAt, 'the draft carries the stamp, so publishing it cannot undo it');
  assert.equal(draft.notes, 'Alan is typing');
  assert.equal(draft.status, 'in-production', 'only the server field is written to the draft');
  // Again: nothing.
  const again = await sendDispatchEmail({ kind: 'order', id: ORDER_ID, sanity, ...resendDeps(resend) });
  assert.equal(again.sent, false);
  assert.equal(resend.sent.length, 1);
});

test('two dispatch emails racing: exactly one is sent', async () => {
  const sanity = fakeSanity([order({ status: 'dispatched', trackingNumber: 'EV1', carrier: 'evri' })]);
  const resend = fakeResend();
  const rs = await Promise.all([1, 2, 3].map(() => sendDispatchEmail({ kind: 'order', id: ORDER_ID, sanity, ...resendDeps(resend) })));
  assert.equal(rs.filter((r) => r.sent).length, 1);
  assert.equal(resend.sent.length, 1);
});

test('a failed send gives the claim back, so the next event retries', async () => {
  const sanity = fakeSanity([order({ status: 'dispatched', trackingNumber: 'X1' })]);
  const r = await sendDispatchEmail({ kind: 'order', id: ORDER_ID, sanity, ...resendDeps(fakeResend({ fail: true })) });
  assert.equal(r.status, 500);
  assert.ok(!sanity.store.get(ORDER_ID).dispatchEmailClaimedAt);
  assert.ok(!sanity.store.get(ORDER_ID).dispatchEmailSentAt);
  const ok = await sendDispatchEmail({ kind: 'order', id: ORDER_ID, sanity, ...resendDeps(fakeResend()) });
  assert.equal(ok.sent, true);
});

test('not due: no tracking number, not dispatched, or no email', async () => {
  for (const o of [order({ status: 'dispatched' }), order({ trackingNumber: 'X' }), order({ status: 'dispatched', trackingNumber: 'X', customerEmail: '' })]) {
    const sanity = fakeSanity([o]);
    const resend = fakeResend();
    const r = await sendDispatchEmail({ kind: 'order', id: ORDER_ID, sanity, ...resendDeps(resend) });
    assert.equal(r.sent, false);
    assert.equal(resend.sent.length, 0);
  }
});

test('the hook after the email runs once, for Sendcloud orders too', async () => {
  const calls = [];
  const after = async (kind, doc) => calls.push([kind, doc._id]);
  const sanity = fakeSanity([order({ status: 'dispatched', shipmentResult: { dispatchedAt: '2026-11-03T10:00:00Z', parcels: [{ parcelRef: '1', trackingNumber: 'T1', trackingUrl: 'https://t/1', carrier: 'inpost_gb', labelId: 'L1' }] } })]);
  const resend = fakeResend();
  await sendDispatchEmail({ kind: 'order', id: ORDER_ID, sanity, ...resendDeps(resend), after });
  await sendDispatchEmail({ kind: 'order', id: ORDER_ID, sanity, ...resendDeps(resend), after });
  assert.deepEqual(calls, [['order', ORDER_ID]]);
  assert.match(resend.sent[0].html, /InPost/);
  assert.match(resend.sent[0].html, /https:\/\/t\/1/);
});

test('commission dispatch: same claim; dispatchedAt stays the sent marker; digital / unconfirmed Groupon never', async () => {
  const fetch = async () => ({ serviceTitle: 'Cartoonify Me' });
  const sanity = fakeSanity([commission({ status: 'shipped', carrier: 'dpd', trackingNumber: 'D1' })], { fetch });
  const resend = fakeResend();
  const r = await sendDispatchEmail({ kind: 'commission', id: 'comm1', sanity, ...resendDeps(resend) });
  assert.equal(r.sent, true);
  assert.match(resend.sent[0].html, /Cartoonify Me/);
  assert.match(resend.sent[0].html, /track\.dpd\.co\.uk\/parcels\/D1/);
  assert.ok(sanity.store.get('comm1').dispatchedAt);
  assert.equal((await sendDispatchEmail({ kind: 'commission', id: 'comm1', sanity, ...resendDeps(resend) })).sent, false);

  for (const c of [commission({ status: 'shipped', deliveryType: 'digital' }), commission({ status: 'shipped', awaitingVoucherCheck: true }), commission({ status: 'shipped', dispatchedAt: '2026-01-01T00:00:00Z' })]) {
    const s = fakeSanity([c], { fetch });
    const rr = fakeResend();
    assert.equal((await sendDispatchEmail({ kind: 'commission', id: 'comm1', sanity: s, ...resendDeps(rr) })).sent, false);
    assert.equal(rr.sent.length, 0);
  }
});

test('order dispatch email lists items and shows the reference', () => {
  const { html, subject } = buildOrderDispatchEmail(order({ status: 'dispatched', trackingNumber: '<b>1</b>' }));
  assert.match(subject, /P8-AbCdEfGh/);
  assert.match(html, /Hulk/);
  assert.ok(!html.includes('<b>1</b>'), 'escaped');
});

/* ------------------------------------------------------------------ router */

test('router: hand dispatch emails go even with shipping off; Sendcloud jobs need it on', async () => {
  const doc = { ...order({ status: 'dispatched', trackingNumber: 'X', shipment: { status: 'ready_to_ship' }, parcelPlan: [{ parcelRef: '1' }] }), before: { status: 'in-production', trackingNumber: null, shipmentStatus: 'not_ready' } };
  assert.deepEqual(routeFor(doc).actions, ['dispatch-email', 'shipping-dispatch']);
  const done = [];
  const deps = {
    log: quietLog,
    sendDispatch: async (t, id) => { done.push(['email', t, id]); return { status: 200, reason: 'OK' }; },
    completeCommission: async () => ({ status: 200, body: 'x' }),
    start: async (a) => { done.push(['start', a]); return { ok: true }; },
  };
  await runRoute(doc, { ...deps, shippingOn: false });
  assert.deepEqual(done, [['email', 'order', ORDER_ID]]);
  done.length = 0;
  await runRoute(doc, { ...deps, shippingOn: true });
  assert.deepEqual(done, [['email', 'order', ORDER_ID], ['start', 'shipping-dispatch']]);
});

test('router: an order already dispatched before this edit is not emailed (the backlog)', () => {
  const doc = order({ status: 'dispatched', trackingNumber: 'X' });
  assert.deepEqual(routeFor({ ...doc, before: { status: 'dispatched', trackingNumber: 'X' } }).actions, []);
  assert.deepEqual(routeFor({ ...doc, before: { status: 'dispatched', trackingNumber: null } }).actions, ['dispatch-email']);
  // No projection: orders older than the cut-off are left alone.
  assert.deepEqual(routeFor({ ...doc, createdAt: '2026-06-01T00:00:00Z' }).actions, []);
  assert.deepEqual(routeFor(doc).actions, ['dispatch-email']);
  assert.deepEqual(routeFor({ ...doc, _id: `drafts.${ORDER_ID}` }).actions, []);
});

test('router: a failed label is not retried by the server\'s own write, only by On hold -> Ready to ship', () => {
  const base = order({ shipment: { status: 'ready_to_ship' }, shipmentResult: { state: 'exception', error: 'band_not_configured' } });
  assert.deepEqual(routeFor({ ...base, before: { status: 'received', shipmentStatus: 'ready_to_ship' } }).actions, []);
  assert.deepEqual(routeFor(base).actions, [], 'no projection: no retry');
  assert.deepEqual(routeFor({ ...base, before: { status: 'received', shipmentStatus: 'on_hold' } }).actions, ['shipping-dispatch']);
  const labelled = order({ shipment: { status: 'ready_to_ship' }, parcelPlan: [{ parcelRef: '1' }], shipmentResult: { parcels: [{ parcelRef: '1', labelId: 'L' }] } });
  assert.deepEqual(routeFor(labelled).actions, []);
});

test('router: commissions — shipped -> email, complete -> download, once per transition', () => {
  assert.deepEqual(routeFor(commission({ status: 'shipped' })).actions, ['dispatch-email']);
  assert.deepEqual(routeFor(commission({ status: 'complete' })).actions, ['commission-complete']);
  assert.deepEqual(routeFor({ ...commission({ status: 'complete' }), before: { status: 'complete' } }).actions, []);
  assert.deepEqual(routeFor(commission({ status: 'complete', deliveredAt: '2026-01-01' })).actions, []);
  assert.deepEqual(routeFor(commission({ status: 'shipped', dispatchedAt: '2026-01-01' })).actions, []);
});

test('router: returns — approve / reject start the job; after a problem only a status change retries', () => {
  const ret = { _id: 'returnRequest.ret-1', _type: 'returnRequest', status: 'approved' };
  assert.deepEqual(routeFor(ret).actions, ['shipping-return']);
  assert.deepEqual(routeFor({ ...ret, labelSentAt: 'x' }).actions, []);
  assert.deepEqual(routeFor({ ...ret, error: 'no band', before: { status: 'approved' } }).actions, []);
  assert.deepEqual(routeFor({ ...ret, error: 'no band', before: { status: 'requested' } }).actions, ['shipping-return']);
  assert.deepEqual(routeFor({ ...ret, status: 'rejected' }).actions, ['shipping-return']);
});

/* ------------------------------------------------------------------ labels */

const shippingFake = (fail = {}) => {
  const calls = [];
  const fn = async (path, body) => {
    calls.push({ path, body });
    if (fail[body.parcelRef]) throw Object.assign(new Error('no option'), { code: fail[body.parcelRef] });
    return { parcelId: 100 + calls.length, shipmentId: 's', carrier: 'royal_mail', method: 'royal_mail:tracked48', trackingNumber: `TN${body.parcelRef}`, trackingUrl: `https://track/${body.parcelRef}`, labelId: `L${body.parcelRef}`, quotedPrice: { amount: 3.05, currency: 'GBP' } };
  };
  fn.calls = calls;
  return fn;
};

test('Ready to ship: default plan, one label per item, team emailed print links, operator fields untouched', async () => {
  const sanity = fakeSanity([order({ shipment: { status: 'ready_to_ship' } })]);
  const resend = fakeResend();
  const shipping = shippingFake();
  const r = await dispatchShipment(ORDER_ID, { sanity, shipping, ...resendDeps(resend) });
  assert.equal(r.outcome, 'label_created');
  assert.deepEqual(shipping.calls.map((c) => [c.body.orderRef, c.body.parcelRef, c.body.band]), [[REF, '1', 'P5'], [REF, '2', 'CG7']]);
  assert.equal(shipping.calls[0].body.recipient.postalCode, 'LS1 1AA');
  const doc = sanity.store.get(ORDER_ID);
  assert.equal(doc.shipmentResult.state, 'label_created');
  assert.equal(doc.shipmentResult.parcels.length, 2);
  assert.equal(doc.shipmentResult.parcels[0].quotedPrice, 3.05);
  assert.equal(doc.shipment.status, 'ready_to_ship', 'never changes Alan\'s switch');
  assert.equal(doc.parcelPlan.length, 2, 'default plan written back for editing');
  assert.equal(resend.sent.length, 1);
  assert.equal(resend.sent[0].to[0], 'contact@pixel8multimedia.co.uk');
  assert.match(resend.sent[0].html, /\/admin\/shipping\/label\/L1/);
  // Again: claim gone, everything labelled -> nothing bought.
  const again = await dispatchShipment(ORDER_ID, { sanity, shipping, ...resendDeps(resend) });
  assert.equal(again.outcome, 'label_created');
  assert.equal(shipping.calls.length, 2);
});

test('a failure part-way keeps the labels bought, marks exception, emails the reason', async () => {
  const sanity = fakeSanity([order({ shipment: { status: 'ready_to_ship' } })]);
  const resend = fakeResend();
  const r = await dispatchShipment(ORDER_ID, { sanity, shipping: shippingFake({ 2: 'band_not_configured' }), ...resendDeps(resend) });
  assert.equal(r.outcome, 'exception');
  const doc = sanity.store.get(ORDER_ID);
  assert.equal(doc.shipmentResult.state, 'exception');
  assert.match(doc.shipmentResult.error, /band_not_configured/);
  assert.equal(doc.shipmentResult.parcels.filter((p) => p.labelId).length, 1);
  assert.ok(!doc.shipmentResult.dispatchClaimedAt);
  assert.match(resend.sent[0].subject, /Shipping problem/);
});

test('plan problems and non-UK addresses are refused before anything is bought', async () => {
  const legacy = order({ shipment: { status: 'ready_to_ship' }, lineItems: [{ _key: 'old', productTitle: 'Old', format: 'Poster', size: 'Small', quantity: 1 }] });
  for (const o of [legacy, order({ shipment: { status: 'ready_to_ship' }, shippingAddress: { country: 'FR', postcode: '75001' } })]) {
    const sanity = fakeSanity([o]);
    const shipping = shippingFake();
    const r = await dispatchShipment(ORDER_ID, { sanity, shipping, ...resendDeps(fakeResend()) });
    assert.equal(r.outcome, 'exception');
    assert.equal(shipping.calls.length, 0);
  }
  assert.equal((await dispatchShipment(ORDER_ID, { sanity: fakeSanity([order()]), shipping: shippingFake(), ...resendDeps(fakeResend()) })).outcome, 'ignored');
});

test('commissions: band from the service, address from Stripe, digital refused', async () => {
  const fetch = async () => ({ serviceTitle: 'Cartoonify Me', printSizeLabels: { small: '12×8' }, hasService: true });
  const retrieveSession = async () => ({ shipping_details: { name: 'Grace H', address: { line1: '1 Lane', city: 'York', postal_code: 'YO1 1AA', country: 'GB' } } });
  const sanity = fakeSanity([commission({ shipment: { status: 'ready_to_ship' } })], { fetch });
  const shipping = shippingFake();
  const r = await dispatchShipment('comm1', { sanity, shipping, retrieveSession, ...resendDeps(fakeResend()) });
  assert.equal(r.outcome, 'label_created');
  assert.equal(shipping.calls[0].body.band, 'CG3');
  assert.equal(shipping.calls[0].body.orderRef, 'PX-AB12CD34');
  assert.equal(shipping.calls[0].body.recipient.postalCode, 'YO1 1AA');
  assert.equal(shipping.calls[0].body.recipient.name, 'Grace H');

  const digital = fakeSanity([commission({ deliveryType: 'digital', shipment: { status: 'ready_to_ship' } })], { fetch });
  assert.equal((await dispatchShipment('comm1', { sanity: digital, shipping, retrieveSession, ...resendDeps(fakeResend()) })).outcome, 'exception');
  const stored = fakeSanity([commission({ shipment: { status: 'ready_to_ship' }, shippingAddressFields: { name: 'G', line1: 'x', postcode: 'B1 1AA', country: 'GB', city: 'B' } })], { fetch });
  const s2 = shippingFake();
  await dispatchShipment('comm1', { sanity: stored, shipping: s2, retrieveSession: async () => { throw new Error('should not be called'); }, ...resendDeps(fakeResend()) });
  assert.equal(s2.calls[0].body.recipient.postalCode, 'B1 1AA');
});

/* ------------------------------------------------------------------ tracking */

const labelled = () => order({
  shipment: { status: 'ready_to_ship' },
  shipmentResult: { state: 'label_created', parcels: [{ parcelRef: '1', labelId: 'L1', carrier: 'royal_mail', trackingNumber: 'TN1', trackingUrl: 'https://track/1' }] },
});

test('first carrier scan: in transit, order Dispatched with tracking, dispatch email once; repeat ignored', async () => {
  const fetch = async (q, p) => (q.includes('orderNumber == $r') && p.r === REF ? ORDER_ID : null);
  const sanity = fakeSanity([labelled()], { fetch });
  const resend = fakeResend();
  const ev = { kind: 'parcel', orderRef: REF, parcelRef: '1', parcelId: 1, status: 'En route', statusCode: 3, at: '2026-11-03T09:00:00Z' };
  const r = await applyParcelEvent(ev, { sanity, ...resendDeps(resend) });
  assert.equal(r.status, 200);
  const doc = sanity.store.get(ORDER_ID);
  assert.equal(doc.shipmentResult.state, 'in_transit');
  assert.ok(doc.shipmentResult.dispatchedAt);
  assert.equal(doc.status, 'dispatched');
  assert.equal(doc.trackingNumber, 'TN1');
  assert.equal(doc.carrier, 'royalmail');
  assert.equal(resend.sent.length, 1);
  assert.match(resend.sent[0].subject, /on the way/);
  await applyParcelEvent(ev, { sanity, ...resendDeps(resend) });
  await applyParcelEvent({ ...ev, statusCode: 91, status: 'Sorted', at: '2026-11-03T12:00:00Z' }, { sanity, ...resendDeps(resend) });
  assert.equal(resend.sent.length, 1, 'never a second dispatch email');
  assert.equal(sanity.store.get(ORDER_ID).shipmentResult.events.length, 2);

  await applyParcelEvent({ ...ev, statusCode: 11, status: 'Delivered', at: '2026-11-04T12:00:00Z' }, { sanity, ...resendDeps(resend) });
  const done = sanity.store.get(ORDER_ID);
  assert.equal(done.shipmentResult.state, 'delivered');
  assert.ok(done.shipmentResult.deliveredAt);
  assert.equal(done.status, 'delivered');
});

test('an announcement failure is an alert to the team, not a dispatch email', async () => {
  const fetch = async () => ORDER_ID;
  const sanity = fakeSanity([labelled()], { fetch });
  const resend = fakeResend();
  await applyParcelEvent({ kind: 'parcel', orderRef: REF, parcelRef: '1', status: 'Announcement failed', statusCode: 1002, at: 't' }, { sanity, ...resendDeps(resend) });
  assert.equal(resend.sent.length, 1);
  assert.equal(resend.sent[0].to[0], 'contact@pixel8multimedia.co.uk');
  assert.equal(sanity.store.get(ORDER_ID).status, 'received');
});

test('a commission delivered by Sendcloud never gets deliveredAt (that guards its download email)', async () => {
  const fetch = async (q) => (q.includes('commission') ? 'comm1' : { serviceTitle: 'Cartoonify Me' });
  const sanity = fakeSanity([commission({ shipmentResult: { state: 'in_transit', dispatchedAt: 'x', parcels: [{ parcelRef: '1', labelId: 'L', trackingNumber: 'T' }] }, dispatchedAt: 'x' })], { fetch });
  await applyParcelEvent({ kind: 'parcel', orderRef: 'PX-AB12CD34', parcelRef: '1', statusCode: 11, status: 'Delivered', at: 'z' }, { sanity, ...resendDeps(fakeResend()) });
  const c = sanity.store.get('comm1');
  assert.ok(c.shipmentResult.deliveredAt);
  assert.equal(c.deliveredAt, undefined);
  assert.equal(c.status, 'in-progress', 'a "both" commission keeps its status until its download is sent');
});

test('a return reaching the collection point emails the team where to collect it', async () => {
  const fetch = async () => 'returnRequest.ret-1';
  const sanity = fakeSanity([{ _id: 'returnRequest.ret-1', _type: 'returnRequest', returnRef: 'ret-1', returnNumber: `${REF}-R1`, status: 'label_sent', carrier: 'inpost_gb', lines: [] }], { fetch });
  const resend = fakeResend();
  await applyReturnEvent({ kind: 'return', returnRef: 'ret-1', statusCode: 12, status: 'Awaiting customer pickup', at: 'a' }, { sanity, ...resendDeps(resend) });
  assert.equal(sanity.store.get('returnRequest.ret-1').status, 'ready_to_collect');
  assert.match(resend.sent[0].html, /InPost locker, 59 West Road, Shoeburyness/);
  assert.equal(resend.sent[0].to[0], 'contact@pixel8multimedia.co.uk');
});

/* ------------------------------------------------------------------ returns */

const SECRET_ENV = { SHIPPING_SECRET: 'test-secret' };
const post = (body) => new Request('https://x/api/returns', { method: 'POST', body: JSON.stringify(body), headers: { 'x-nf-client-connection-ip': '1.2.3.4' } });
const delivered = () => order({ status: 'delivered', shipmentResult: { dispatchedAt: '2026-11-03T09:00:00Z', deliveredAt: '2026-11-04T09:00:00Z' } });

function returnsDeps(sanity, over = {}) {
  return {
    sanity, getResend: () => over.resend || fakeResend(), shippingOn: true, env: SECRET_ENV,
    now: () => Date.parse('2026-11-06T12:00:00Z'),
    turnstile: async () => ({ ok: true }),
    rateLimit: async () => Date.now(),
    quote: async () => ({ option: 'inpost_gb:l2l/size=s', price: 2.57, currency: 'GBP' }),
    log: quietLog,
    ...over,
  };
}
const returnsFetch = (o) => async (q, p) => {
  if (q.includes('lower(customerEmail) == $e')) return p.e === o.customerEmail ? [o] : [];
  if (q.includes('_id == $id')) return o;
  if (q.includes('returnRequest')) return [];
  return null;
};

test('/returns lookup: by reference or Payment ID plus email; same answer for a wrong one', async () => {
  const o = delivered();
  const sanity = fakeSanity([o], { fetch: returnsFetch(o) });
  for (const ref of ['p8-abcdefgh', 'P8-AbCdEfGh', 'pi_3TESTabcdefgh']) {
    const r = await handleReturns(post({ action: 'lookup', orderRef: ref, email: 'ADA@example.com', turnstile: 't' }), returnsDeps(sanity));
    assert.equal(r.status, 200, ref);
    assert.ok(r.body.eligible);
    assert.equal(r.body.lines.find((l) => l.lineKey === 'photo').returnable, 0);
  }
  const wrong = await handleReturns(post({ action: 'lookup', orderRef: 'P8-AbCdEfGX', email: 'ada@example.com', turnstile: 't' }), returnsDeps(sanity));
  const wrongEmail = await handleReturns(post({ action: 'lookup', orderRef: REF, email: 'eve@example.com', turnstile: 't' }), returnsDeps(sanity));
  assert.equal(wrong.status, 404);
  assert.deepEqual(wrong.body, wrongEmail.body);
  const px = await handleReturns(post({ action: 'lookup', orderRef: 'PX-AB12CD34', email: 'a@b.co', turnstile: 't' }), returnsDeps(sanity));
  assert.match(px.body.reason, /Commissions/);
  assert.equal((await handleReturns(post({ action: 'lookup' }), returnsDeps(sanity, { shippingOn: false }))).status, 404);
});

test('/returns quote shows the postage for one item, then submit records the request and emails the team', async () => {
  const o = delivered();
  const sanity = fakeSanity([o], { fetch: returnsFetch(o) });
  const session = issueSession({ orderId: ORDER_ID, email: 'ada@example.com' }, { env: SECRET_ENV, now: Date.parse('2026-11-06T12:00:00Z') });
  const q = await handleReturns(post({ action: 'quote', session, lines: [{ lineKey: 'stock', quantity: 1 }] }), returnsDeps(sanity));
  assert.equal(q.body.postage, 2.57);
  const resend = fakeResend();
  const s = await handleReturns(post({ action: 'submit', session, lines: [{ lineKey: 'stock', quantity: 1 }], reason: 'changed_mind', shownPostage: 2.57 }), returnsDeps(sanity, { resend }));
  assert.equal(s.status, 200);
  assert.equal(s.body.returnNumber, `${REF}-R1`);
  const ret = [...sanity.store.values()].find((d) => d._type === 'returnRequest');
  assert.ok(ret._id.startsWith('returnRequest.ret-'));
  assert.equal(ret.band, 'P5');
  assert.equal(ret.quotedPostage, 2.57);
  assert.equal(ret.status, 'requested');
  assert.match(resend.sent[0].html, /£2\.57/);
  const bad = await handleReturns(post({ action: 'submit', session, lines: [{ lineKey: 'photo', quantity: 1 }], reason: 'changed_mind' }), returnsDeps(sanity));
  assert.equal(bad.status, 400);
  const forged = await handleReturns(post({ action: 'quote', session: `${session}x`, lines: [] }), returnsDeps(sanity));
  assert.equal(forged.status, 400);
});

test('approved return: label bought, emailed with the deduction, deduction recorded; free label deducts nothing', async () => {
  for (const freeLabel of [false, true]) {
    const o = delivered();
    const ret = { _id: 'returnRequest.ret-1', _type: 'returnRequest', returnRef: 'ret-1', returnNumber: `${REF}-R1`, orderId: ORDER_ID, orderNumber: REF, customerName: 'Ada', customerEmail: 'ada@example.com', status: 'approved', band: 'P5', freeLabel, lines: [{ productTitle: 'Hulk', quantity: 1, unitPrice: 9.99 }] };
    const sanity = fakeSanity([o, ret]);
    const resend = fakeResend();
    const calls = [];
    const shipping = async (path, body) => { calls.push(body); return { carrier: 'inpost_gb', labelId: 'R1', trackingNumber: 'IP1', customerInstructions: 'Drop it at any InPost Locker.', quotedPrice: { amount: 2.61, currency: 'GBP' } }; };
    const r = await processReturn('returnRequest.ret-1', { sanity, shipping, fetchLabel: async () => Buffer.from('%PDF'), ...resendDeps(resend) });
    assert.equal(r.outcome, 'label_sent');
    assert.equal(calls[0].customer.postalCode, 'LS1 1AA');
    const after = sanity.store.get('returnRequest.ret-1');
    assert.equal(after.status, 'label_sent');
    assert.equal(after.postageDeduction, freeLabel ? 0 : 2.61);
    assert.equal(resend.sent[0].attachments.length, 1);
    if (freeLabel) assert.ok(!/deducted/.test(resend.sent[0].html));
    else assert.match(resend.sent[0].html, /£2\.61 return postage will be deducted from your refund/);
    assert.ok(!/Shoeburyness/.test(resend.sent[0].html), 'the customer is never told where returns are collected');
    // Again: nothing more.
    assert.equal((await processReturn('returnRequest.ret-1', { sanity, shipping, fetchLabel: async () => Buffer.from(''), ...resendDeps(resend) })).outcome, 'ignored');
    assert.equal(calls.length, 1);
  }
});

test('rejected without a reason: an error for Alan, nothing to the customer', async () => {
  const sanity = fakeSanity([{ _id: 'returnRequest.ret-2', _type: 'returnRequest', status: 'rejected', returnNumber: 'R2' }]);
  const resend = fakeResend();
  const r = await processReturn('returnRequest.ret-2', { sanity, shipping: async () => ({}), fetchLabel: async () => Buffer.from(''), ...resendDeps(resend) });
  assert.equal(r.outcome, 'error');
  assert.ok(sanity.store.get('returnRequest.ret-2').error);
  assert.equal(resend.sent[0].to[0], 'contact@pixel8multimedia.co.uk');
});

test('serverPatch refuses a draft id and writes dotted fields into missing objects', async () => {
  const sanity = fakeSanity([{ _id: 'a', _type: 'order' }]);
  await assert.rejects(serverPatch(sanity, 'drafts.a', { set: { x: 1 } }));
  await serverPatch(sanity, 'a', { set: { 'shipmentResult.state': 'label_created' } });
  assert.equal(sanity.store.get('a').shipmentResult.state, 'label_created');
});
