// Pure parts of the Sendcloud integration: bands, references, settings,
// keys, request signing, return eligibility.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bandFor, bandForLine, commissionBand, commissionLines, proposeParcelPlan, validateParcelPlan,
  ALL_BANDS, mapCarrier, carrierName, trackingUrlFor, CARRIER_OPTIONS,
} from '../netlify/functions/_shared/parcel-bands.mjs';
import {
  orderRefFromSession, orderRefFor, normaliseOrderRef, orderMatchesRef, isPaymentIntentId, isCommissionRef,
} from '../netlify/functions/_shared/order-ref.mjs';
import { setting, sanityWriteToken, SITE_CONFIG } from '../netlify/functions/_shared/site-config.mjs';
import { shippingInternalKey, isShippingInternal, SHIPPING_INTERNAL_HEADER } from '../netlify/functions/_shared/shipping-internal.mjs';
import { shippingRequest, verifyShippingCallback, sign, shippingEnabled } from '../netlify/functions/_shared/shipping-client.mjs';
import { evaluateReturn, pickLines, windowEndsOn } from '../netlify/functions/_shared/returns-eligibility.mjs';
import { classifyStatus, isCarrierScan } from '../netlify/functions/_shared/tracking-status.mjs';
import { createHash } from 'node:crypto';

/* ------------------------------------------------------------------ bands */

test('shop bands: square posters P5-P7, standard canvas CS5-CS7, gallery CG5-CG7', () => {
  assert.deepEqual(['small', 'medium', 'large'].map((s) => bandFor('poster', s)), ['P5', 'P6', 'P7']);
  assert.deepEqual(['small', 'medium', 'large'].map((s) => bandFor('canvasStandard', s)), ['CS5', 'CS6', 'CS7']);
  assert.deepEqual(['small', 'medium', 'large'].map((s) => bandFor('canvasGallery', s)), ['CG5', 'CG6', 'CG7']);
  assert.equal(bandFor('poster', 'huge'), null);
});

test('a shop line with labels only is flagged, never guessed', () => {
  const r = bandForLine({ productTitle: 'Hulk', format: 'Poster', size: 'Small (12×12")', quantity: 1 });
  assert.ok(r.problem && !r.band);
  assert.deepEqual(bandForLine({ productTitle: 'Your Photo', formatKey: 'canvasGallery', sizeKey: 'large', personalisationId: 'x' }), { band: 'CG7' });
});

test('commission bands: 3:2 service -> P1/P3/P4 etc., square service -> P5-P7', () => {
  const ratio = { printSizeLabels: { small: 'Small (12×8")', medium: 'Medium (18×12")' } };
  const square = { printSizeLabels: null };
  assert.equal(commissionBand({ format: 'poster', size: 'small' }, ratio).band, 'P1');
  assert.equal(commissionBand({ format: 'poster', size: 'medium' }, ratio).band, 'P3');
  assert.equal(commissionBand({ format: 'poster', size: 'large' }, ratio).band, 'P4');
  assert.equal(commissionBand({ format: 'canvas-standard', size: 'large' }, ratio).band, 'CS4');
  assert.equal(commissionBand({ format: 'canvas-gallery', size: 'small' }, ratio).band, 'CG1');
  assert.equal(commissionBand({ format: 'canvas-gallery', size: 'medium' }, square).band, 'CG6');
  assert.equal(commissionBand({ format: 'poster', size: 'large' }, { printSizeLabels: { small: '', medium: ' ' } }).band, 'P7');
  // Dimensions say their own shape.
  assert.equal(commissionBand({ format: 'poster', size: '24x16' }, null).band, 'P4');
  assert.equal(commissionBand({ format: 'poster', size: '16 × 24' }, null).band, 'P4');
  assert.equal(commissionBand({ format: 'canvas-standard', size: '16x16' }, null).band, 'CS6');
  // A key with no readable service is flagged.
  assert.ok(commissionBand({ format: 'poster', size: 'small' }, null).problem);
  assert.ok(commissionBand({ format: 'mug', size: 'small' }, square).problem);
});

test('legacy 16x12 commissions map to P2 / CS2 / CG2, not flagged', () => {
  assert.equal(commissionBand({ format: 'poster', size: '16x12' }, null).band, 'P2');
  assert.equal(commissionBand({ format: 'canvas-standard', size: '12x16' }, null).band, 'CS2');
  assert.equal(commissionBand({ format: 'canvas-gallery', size: '16x12' }, { printSizeLabels: null }).band, 'CG2');
  // prints[] says "medium" (checkout maps 16x12 to medium) but the legacy field still says 16x12.
  const lines = commissionLines({ prints: [{ _key: 'a', format: 'poster', size: 'medium' }], printSize: '16x12' }, { printSizeLabels: { small: 'x' } });
  assert.equal(lines[0].band, 'P2');
  // A legacy commission with only printFormat / printSize.
  const legacy = commissionLines({ printFormat: 'canvas-gallery', printSize: '16x12', serviceTitle: 'Cartoonify Me' }, null);
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].band, 'CG2');
  for (const b of ['P2', 'CS2', 'CG2', 'P1', 'P7', 'CS5', 'CG4']) assert.ok(ALL_BANDS.includes(b), b);
});

test('plans: one parcel per item, a placeless line still planned and refused', () => {
  const lines = [
    { _key: 'a', productTitle: 'Hulk', formatKey: 'poster', sizeKey: 'small', quantity: 2 },
    { _key: 'b', productTitle: 'Old', format: 'Poster', size: 'Small', quantity: 1 },
  ];
  const { plan, problems } = proposeParcelPlan(lines);
  assert.equal(plan.length, 3);
  assert.deepEqual(plan.map((p) => p.band), ['P5', 'P5', undefined]);
  assert.equal(problems.length, 1);
  assert.ok(validateParcelPlan(plan, lines).some((p) => /has no band/.test(p)));
  // Two posters in one tube: one parcel holding both.
  const combined = [{ parcelRef: '1', band: 'P7', items: [{ lineKey: 'a', quantity: 2 }] }, { parcelRef: '2', band: 'P5', items: [{ lineKey: 'b', quantity: 1 }] }];
  assert.deepEqual(validateParcelPlan(combined, lines), []);
  assert.ok(validateParcelPlan([{ parcelRef: '1', band: 'P5', items: [{ lineKey: 'a', quantity: 1 }] }], lines).length >= 2);
});

test('carriers: enum includes evri, inpost, dpd, ups; Sendcloud codes map onto it', () => {
  const values = CARRIER_OPTIONS.map((c) => c.value);
  for (const v of ['royalmail', 'evri', 'inpost', 'dpd', 'ups', 'other']) assert.ok(values.includes(v), v);
  assert.deepEqual(mapCarrier('royal_mail'), { carrier: 'royalmail', carrierOther: null });
  assert.equal(mapCarrier('hermes_c2c_gb').carrier, 'evri');
  assert.equal(mapCarrier('inpost_gb').carrier, 'inpost');
  assert.equal(mapCarrier('dhl_express').carrier, 'other');
  assert.equal(carrierName('evri'), 'Evri');
  assert.equal(carrierName('other', 'Parcelforce'), 'Parcelforce');
  assert.match(trackingUrlFor('royalmail', 'AB 1'), /royalmail\.com.*AB%201/);
  assert.equal(trackingUrlFor('inpost', 'X'), null);
});

/* ------------------------------------------------------------------ refs */

test('order reference: P8- + last 8 of the session id, matched case-insensitively', () => {
  assert.equal(orderRefFromSession('cs_live_a1B2c3D4e5F6g7H8'), 'P8-e5F6g7H8');
  assert.equal(orderRefFromSession(''), null);
  assert.equal(orderRefFor({ stripeSessionId: 'cs_test_zzzzzzzzAbCdEfGh' }), 'P8-AbCdEfGh');
  assert.equal(orderRefFor({ orderNumber: 'P8-STAMPED1', stripeSessionId: 'cs_x_other123' }), 'P8-STAMPED1');
  assert.equal(normaliseOrderRef(' p8-abcdefgh '), 'p8-abcdefgh');
  assert.equal(normaliseOrderRef('#P8 ABCDEFGH'), 'p8-abcdefgh');
  assert.equal(normaliseOrderRef('abcdefgh'), 'p8-abcdefgh');
  assert.equal(normaliseOrderRef('abc'), null);
  assert.ok(orderMatchesRef({ stripeSessionId: 'cs_live_xxxxxxxxAbCdEfGh' }, 'p8-abcdefgh'));
  assert.ok(!orderMatchesRef({ stripeSessionId: 'cs_live_xxxxxxxxAbCdEfGh' }, 'p8-abcdefgX'));
  assert.ok(isPaymentIntentId('pi_3Abc123456789'));
  assert.ok(!isPaymentIntentId('P8-ABCDEFGH'));
  assert.ok(isCommissionRef('PX-AB12CD34'));
});

/* ------------------------------------------------------------------ settings */

test('site-config: committed values, env override, unknown names refused', () => {
  assert.equal(setting('SHIPPING_BRAND', {}), 'PIXEL8');
  assert.equal(setting('TEAM_EMAIL', { TEAM_EMAIL: '  ops@example.com ' }), 'ops@example.com');
  assert.equal(setting('TEAM_EMAIL', { TEAM_EMAIL: '' }), SITE_CONFIG.TEAM_EMAIL);
  assert.throws(() => setting('SHIPPING_SECRET', {}));
  assert.match(setting('RETURN_POINT_INPOST', {}), /59 West Road, Shoeburyness/);
  assert.match(setting('RETURN_POINT_EVRI', {}), /ASDA Shoebury, North Shoebury Road/);
  assert.match(setting('RETURN_POINT_UPS', {}), /Skanda, 93-95 West Road, Shoeburyness/);
});

test('site-config holds nothing that looks secret', () => {
  for (const [k, v] of Object.entries(SITE_CONFIG)) {
    assert.ok(!/SECRET|TOKEN|PASSWORD|API_KEY/.test(k), k);
    assert.ok(!/^(sk_|rk_|re_|whsec_|sk[A-Za-z0-9]{20,})/.test(v), k);
  }
});

test('sanityWriteToken: the caller\'s own name first, then the consolidated one', () => {
  const env = { SANITY_TOKEN: 'a', SANITY_API_TOKEN: 'b', SANITY_WRITE_TOKEN: 'c' };
  assert.equal(sanityWriteToken('SANITY_TOKEN', env), 'a');
  assert.equal(sanityWriteToken('SANITY_API_TOKEN', env), 'b');
  assert.equal(sanityWriteToken('SANITY_WRITE_TOKEN', env), 'c');
  // After Alan deletes the old two, everyone gets SANITY_WRITE_TOKEN.
  assert.equal(sanityWriteToken('SANITY_TOKEN', { SANITY_WRITE_TOKEN: 'c' }), 'c');
  assert.equal(sanityWriteToken('SANITY_API_TOKEN', { SANITY_WRITE_TOKEN: 'c' }), 'c');
  assert.equal(sanityWriteToken('SANITY_TOKEN', {}), undefined);
});

/* ------------------------------------------------------------------ internal key */

test('internal shipping key: from PERSONALISATION_SALT, not the personalisation key, fails closed', () => {
  const env = { PERSONALISATION_SALT: 'salt-123' };
  const key = shippingInternalKey(env);
  const personalisation = createHash('sha256').update('internal:salt-123').digest('hex').slice(0, 40);
  assert.ok(key && key.length === 48);
  assert.notEqual(key, personalisation);
  assert.ok(!key.startsWith(personalisation.slice(0, 10)));
  assert.equal(shippingInternalKey({}), null);
  const req = (v) => new Request('http://x', { headers: v ? { [SHIPPING_INTERNAL_HEADER]: v } : {} });
  assert.ok(isShippingInternal(req(key), env));
  assert.ok(!isShippingInternal(req(personalisation), env));
  assert.ok(!isShippingInternal(req(''), env));
  assert.ok(!isShippingInternal(req(key), {}));
});

/* ------------------------------------------------------------------ client */

test('shipping client: signed headers, test flag only in test mode, callback check', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ ok: 1 }), { status: 200 }); };
  const env = { SHIPPING_SECRET: 's3cret', SHIPPING_TEST_MODE: 'true' };
  await shippingRequest('create-parcel', { body: { a: 1 }, env, fetchImpl, now: 1_700_000_000_000 });
  const { url, init } = calls[0];
  assert.equal(url, 'https://mv-shipping-svc-26.netlify.app/api/create-parcel');
  assert.equal(init.headers['x-mv-brand'], 'PIXEL8');
  assert.deepEqual(JSON.parse(init.body), { a: 1, test: true });
  assert.equal(init.headers['x-mv-signature'], sign('s3cret', '1700000000', init.body));
  await shippingRequest('rates', { body: { a: 1 }, env, fetchImpl });
  assert.deepEqual(JSON.parse(calls[1].init.body), { a: 1 });
  await assert.rejects(shippingRequest('create-parcel', { body: {}, env: {}, fetchImpl }), /SHIPPING_SECRET/);

  const raw = JSON.stringify({ kind: 'parcel' });
  const ts = String(Math.floor(Date.now() / 1000));
  const signed = new Request('http://x', { method: 'POST', headers: { 'x-mv-brand': 'pixel8', 'x-mv-timestamp': ts, 'x-mv-signature': sign('s3cret', ts, raw) } });
  assert.ok(verifyShippingCallback(signed, raw, { env }));
  assert.ok(!verifyShippingCallback(signed, `${raw} `, { env }));
  const wrongBrand = new Request('http://x', { method: 'POST', headers: { 'x-mv-brand': 'csc', 'x-mv-timestamp': ts, 'x-mv-signature': sign('s3cret', ts, raw) } });
  assert.ok(!verifyShippingCallback(wrongBrand, raw, { env }));
  assert.equal(shippingEnabled({}), false);
  assert.equal(shippingEnabled({ SHIPPING_ENABLED: 'true' }), true);
});

test('tracking: a failed announcement is not a carrier scan', () => {
  assert.equal(classifyStatus(1002, 'Announcement failed'), 'exception');
  assert.ok(!isCarrierScan('exception'));
  assert.ok(isCarrierScan(classifyStatus(91, 'In transit')));
  assert.equal(classifyStatus(11, 'Delivered'), 'delivered');
});

/* ------------------------------------------------------------------ returns */

const DAY = 86_400_000;
const order = (over = {}) => ({
  _id: 'order.cs_live_xxxxxxxxAbCdEfGh',
  stripeSessionId: 'cs_live_xxxxxxxxAbCdEfGh',
  status: 'dispatched',
  shipmentResult: { dispatchedAt: '2026-11-01T10:00:00Z', deliveredAt: '2026-11-03T10:00:00Z' },
  lineItems: [
    { _key: 'stock', productTitle: 'Hulk', formatKey: 'poster', sizeKey: 'small', quantity: 2, unitPrice: 9.99 },
    { _key: 'photo', productTitle: 'Your Photo', personalisationId: 'pid1', formatKey: 'canvasGallery', sizeKey: 'large', quantity: 1, unitPrice: 52.99 },
  ],
  ...over,
});

test('returns: stock lines only; Your Photo / personalised excluded', () => {
  const v = evaluateReturn(order(), { now: Date.parse('2026-11-05T12:00:00Z') });
  assert.ok(v.eligible);
  assert.equal(v.lines.find((l) => l.lineKey === 'stock').returnable, 2);
  assert.equal(v.lines.find((l) => l.lineKey === 'photo').returnable, 0);
  assert.match(v.lines.find((l) => l.lineKey === 'photo').why, /Your Photo/);
});

test('returns: 14 days from delivery, UK date; unknown delivery allowed but marked', () => {
  assert.equal(windowEndsOn('2026-11-03T10:00:00Z'), '2026-11-17');
  assert.ok(evaluateReturn(order(), { now: Date.parse('2026-11-17T23:30:00Z') }).eligible);
  assert.ok(!evaluateReturn(order(), { now: Date.parse('2026-11-18T00:30:00Z') }).eligible);
  const unknown = evaluateReturn(order({ shipmentResult: {} }), { now: Date.now() + 365 * DAY });
  assert.ok(unknown.eligible && unknown.deliveryDateUnknown);
  assert.ok(!evaluateReturn(order({ status: 'received', shipmentResult: {} })).eligible);
  assert.ok(!evaluateReturn(order({ status: 'refunded' })).eligible);
});

test('returns: earlier requests count, rejected ones do not; picks are checked', () => {
  const now = Date.parse('2026-11-05T12:00:00Z');
  const existing = [{ status: 'requested', lines: [{ lineKey: 'stock', quantity: 1 }] }, { status: 'rejected', lines: [{ lineKey: 'stock', quantity: 1 }] }];
  const v = evaluateReturn(order(), { now, existing });
  assert.equal(v.lines.find((l) => l.lineKey === 'stock').returnable, 1);
  assert.match(pickLines(v, [{ lineKey: 'stock', quantity: 2 }]).error, /at most 1/);
  assert.match(pickLines(v, [{ lineKey: 'photo', quantity: 1 }]).error, /can't be returned/);
  assert.equal(pickLines(v, [{ lineKey: 'stock', quantity: 1 }]).lines[0].quantity, 1);
});
