// The post-delivery sequence, end to end against fakes: the checkout opt-out
// box -> marketingConsent -> the buyer's PIX- code and MailerLite
// "P8 - Customers" at the first delivery email -> the THANKS- reward when a
// friend uses the code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakeSanity, fakeResend, quietLog } from './helpers/fake-sanity.mjs';
import {
  codeBody, friendCodeFor, issueReward, referralsFrom, ensureCoupon,
  FRIEND_COUPON_ID, REWARD_COUPON_ID, KIND_FRIEND, KIND_REWARD,
} from '../netlify/functions/_shared/referral.mjs';
import { optOutMetadata, consentFromOptOut, consentFromSession, marketingRefused } from '../netlify/functions/_shared/marketing-consent.mjs';
import { customerPayload, addDeliveredCustomer, productTitleFor, deliveryFor } from '../netlify/functions/_shared/mailerlite-customer.mjs';
import { startPostDelivery, EARLIER_CODE_QUERY } from '../netlify/functions/_shared/post-delivery.mjs';
import { rewardReferrer, rewardEmail } from '../netlify/functions/_shared/referral-reward.mjs';
import { sendDispatchEmail, afterDispatchEmail } from '../netlify/functions/_shared/dispatch-email.mjs';
import { readDiscount, isWelcomeCode } from '../netlify/functions/_shared/discount.mjs';
import { SITE_CONFIG } from '../netlify/functions/_shared/site-config.mjs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
// Source with comments removed, so a check can't be satisfied by a comment.
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '');

const GROUP = '200039636809024846';
const ML_ENV = { MAILERLITE_API_KEY: 'k' };

/* ------------------------------------------------------------------ fakes */

function fakeStripe({ couponExists = false, clashes = 0 } = {}) {
  const calls = { couponsCreated: [], promos: [] };
  let clashLeft = clashes;
  let n = 0;
  return {
    calls,
    coupons: {
      retrieve: async (id) => {
        if (couponExists || calls.couponsCreated.some((c) => c.id === id)) return { id };
        throw Object.assign(new Error('No such coupon'), { statusCode: 404, code: 'resource_missing' });
      },
      create: async (c) => { calls.couponsCreated.push(c); return c; },
    },
    promotionCodes: {
      create: async (p) => {
        if (clashLeft-- > 0) throw new Error('A promotion code with this code already exists');
        calls.promos.push(p);
        return { id: `promo_${++n}`, ...p };
      },
    },
  };
}

const order = (over = {}) => ({
  _id: 'order.cs_live_xxxxxxxxAbCdEfGh',
  _type: 'order',
  stripeSessionId: 'cs_live_xxxxxxxxAbCdEfGh',
  orderNumber: 'P8-AbCdEfGh',
  customerName: 'Ada Lovelace',
  customerEmail: 'Ada@Example.com',
  createdAt: '2026-11-02T09:00:00Z',
  status: 'dispatched',
  trackingNumber: 'RM123',
  carrier: 'royal_mail',
  lineItems: [
    { _key: 'a', productTitle: 'Hulk', format: 'Poster', size: 'Small', quantity: 1 },
    { _key: 'b', productTitle: 'Your Photo', format: 'Canvas', size: 'Large', personalisationId: 'pid', quantity: 1 },
  ],
  ...over,
});

const commission = (over = {}) => ({
  _id: 'commission.PX-ABCD1234',
  _type: 'commission',
  orderRef: 'PX-ABCD1234',
  customerName: 'Grace Hopper',
  customerEmail: 'grace@example.com',
  serviceTitle: 'Cartoonify Me',
  paidAt: '2026-10-20T12:00:00Z',
  deliveryType: 'print',
  ...over,
});

/** startPostDelivery deps with fake Stripe and MailerLite. */
function deps({ stripe = fakeStripe(), mlResult = { ok: true, status: 200 }, stripeKey = 'sk_test' } = {}) {
  const added = [];
  return {
    stripe, added,
    d: {
      stripeKey,
      makeStripe: () => stripe,
      addCustomer: async (kind, doc, opts) => { added.push({ kind, doc, opts }); return mlResult; },
      now: () => Date.parse('2026-11-02T10:00:00Z'),
    },
  };
}

/* ------------------------------------------------------------------ referral codes */

test('codes: no look-alike characters', () => {
  for (let i = 0; i < 200; i++) assert.match(codeBody(), /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
});

test('friend code: PIX- prefix, Pixel8 coupon created on first use, first-time only, kind recorded', async () => {
  const stripe = fakeStripe();
  const c = await friendCodeFor(stripe, { email: ' Ada@Example.com ', orderRef: 'P8-AbCdEfGh' });
  assert.match(c, /^PIX-[A-Z0-9]{6}$/);
  assert.deepEqual(stripe.calls.couponsCreated.map((x) => [x.id, x.percent_off, x.duration]), [[FRIEND_COUPON_ID, 10, 'once']]);
  assert.equal(FRIEND_COUPON_ID, 'p8-referral-friend-10');
  const p = stripe.calls.promos[0];
  assert.equal(p.coupon, FRIEND_COUPON_ID);
  assert.deepEqual(p.restrictions, { first_time_transaction: true });
  assert.deepEqual(p.metadata, { kind: KIND_FRIEND, referrer_email: 'ada@example.com', referrer_order: 'P8-AbCdEfGh' });
});

test('friend code: an existing one is reused, nothing created; a clashing random code is retried', async () => {
  const stripe = fakeStripe();
  assert.equal(await friendCodeFor(stripe, { email: 'a@b.co', existingCode: 'PIX-AAAAAA' }), 'PIX-AAAAAA');
  assert.equal(stripe.calls.promos.length, 0);
  const clash = fakeStripe({ couponExists: true, clashes: 1 });
  assert.match(await friendCodeFor(clash, { email: 'a@b.co' }), /^PIX-/);
  assert.equal(clash.calls.couponsCreated.length, 0, 'existing coupon left alone');
});

test('ensureCoupon: a rival creating it first is fine; other errors are not swallowed', async () => {
  const racing = {
    coupons: {
      retrieve: async () => { throw Object.assign(new Error('missing'), { statusCode: 404 }); },
      create: async () => { throw Object.assign(new Error('exists'), { code: 'resource_already_exists' }); },
    },
  };
  assert.equal(await ensureCoupon(racing, 'x', 'n'), 'x');
  const broken = { coupons: { retrieve: async () => { throw Object.assign(new Error('auth'), { statusCode: 401 }); } } };
  await assert.rejects(ensureCoupon(broken, 'x', 'n'), /auth/);
});

test('reward code: THANKS-, single use, Pixel8 reward coupon', async () => {
  const stripe = fakeStripe();
  const c = await issueReward(stripe, { referrerEmail: 'Ada@Example.com', referredOrder: 'P8-ZZZZZZZZ' });
  assert.match(c, /^THANKS-[A-Z0-9]{6}$/);
  assert.equal(REWARD_COUPON_ID, 'p8-referral-reward-10');
  const p = stripe.calls.promos[0];
  assert.equal(p.coupon, REWARD_COUPON_ID);
  assert.equal(p.max_redemptions, 1);
  assert.deepEqual(p.metadata, { kind: KIND_REWARD, referrer_email: 'ada@example.com', referred_order: 'P8-ZZZZZZZZ' });
});

test('referralsFrom: only PIX- friend codes, never your own, never without a referrer', () => {
  const promos = [
    { code: 'PIX10', metadata: {} },
    { code: 'PIX-AAAAAA', metadata: { kind: KIND_FRIEND, referrer_email: 'ada@example.com', referrer_order: 'P8-1' } },
    { code: 'PIX-BBBBBB', metadata: { kind: KIND_FRIEND, referrer_email: '' } },
    { code: 'THANKS-CCCCCC', metadata: { kind: KIND_REWARD, referrer_email: 'x@y.co' } },
  ];
  assert.deepEqual(referralsFrom(promos, 'friend@example.com'), [{ code: 'PIX-AAAAAA', referrerEmail: 'ada@example.com', referrerOrder: 'P8-1' }]);
  assert.deepEqual(referralsFrom(promos, ' ADA@example.com '), [], 'self-referral ignored');
  assert.deepEqual(referralsFrom(undefined, 'x'), []);
});

test('isWelcomeCode: PIX10 still is, referral codes are not (no false REPEAT WELCOME CODE)', () => {
  assert.equal(isWelcomeCode({ code: 'PIX10', restrictions: {} }), true);
  assert.equal(isWelcomeCode({ code: 'SPRING', restrictions: { first_time_transaction: true } }), true);
  assert.equal(isWelcomeCode({ code: 'PIX-AAAAAA', restrictions: { first_time_transaction: true }, metadata: { kind: KIND_FRIEND } }), false);
  assert.equal(isWelcomeCode({ code: 'THANKS-AAAAAA', restrictions: {}, metadata: { kind: KIND_REWARD } }), false);
});

test('readDiscount returns the expanded promotion codes for the reward', async () => {
  const pixPromo = { id: 'promo_1', code: 'PIX-AAAAAA', restrictions: { first_time_transaction: true }, metadata: { kind: KIND_FRIEND, referrer_email: 'ada@example.com' } };
  const stripe = {
    checkout: { sessions: { retrieve: async () => ({ total_details: { breakdown: { discounts: [{ discount: { coupon: { id: FRIEND_COUPON_ID, metadata: {} }, promotion_code: 'promo_1' } }] } } }) } },
    promotionCodes: { retrieve: async () => pixPromo },
  };
  const d = await readDiscount(stripe, { id: 'cs_1', total_details: { amount_discount: 500 }, metadata: {} });
  assert.deepEqual(d.codes, ['PIX-AAAAAA']);
  assert.deepEqual(d.welcomeCodes, []);
  assert.equal(d.promos.length, 1);
  assert.deepEqual(referralsFrom(d.promos, 'friend@example.com').map((r) => r.code), ['PIX-AAAAAA']);
  const none = await readDiscount(stripe, { id: 'cs_2', total_details: { amount_discount: 0 } });
  assert.deepEqual(none.promos, []);
});

/* ------------------------------------------------------------------ consent */

test('consent: only a literal true opts out, everywhere', () => {
  assert.equal(optOutMetadata(true), 'true');
  assert.equal(consentFromOptOut(true), 'refused');
  for (const v of [false, undefined, null, 'true', 1, 'yes', {}]) {
    assert.equal(optOutMetadata(v), 'false', String(v));
    assert.equal(consentFromOptOut(v), 'not_asked', String(v));
  }
  assert.equal(consentFromSession({ metadata: { marketing_opt_out: 'true' } }), 'refused');
  assert.equal(consentFromSession({ metadata: { marketing_opt_out: 'false' } }), 'not_asked');
  assert.equal(consentFromSession({ metadata: { marketing_opt_out: 'TRUE' } }), 'not_asked');
  assert.equal(consentFromSession({}), 'not_asked');
  assert.equal(marketingRefused('refused'), true);
  assert.equal(marketingRefused('not_asked'), false);
  assert.equal(marketingRefused(undefined), false, 'orders before the box: soft opt-in');
});

/* ------------------------------------------------------------------ MailerLite */

test('MailerLite payload, shop order: P8 - Customers, name plus p8_ fields only', () => {
  const body = customerPayload('order', order({ marketingConsent: 'not_asked' }), { referralCode: 'PIX-AAAAAA', groupId: GROUP });
  assert.deepEqual(body, {
    email: 'Ada@Example.com',
    groups: [GROUP],
    fields: {
      name: 'Ada',
      p8_order_id: 'P8-AbCdEfGh',
      p8_product: 'Hulk and 1 more',
      p8_last_order_date: '2026-11-02',
      p8_referral_code: 'PIX-AAAAAA',
      p8_delivery: 'print',
      p8_marketing_ok: 'yes',
    },
  });
  assert.equal('status' in body, false, 'never resubscribes an unsubscriber');
  for (const k of ['order_id', 'product', 'last_order_date', 'is_personalised', 'referral_code', 'marketing_ok']) {
    assert.equal(k in body.fields, false, `CSC's shared field ${k} is not written`);
  }
});

test('MailerLite payload, commissions: service name, PX- ref, paid date; digital only when digital-only', () => {
  const f = (over) => customerPayload('commission', commission(over), { referralCode: '', groupId: GROUP }).fields;
  assert.deepEqual(f({ deliveryType: 'digital' }), {
    name: 'Grace', p8_order_id: 'PX-ABCD1234', p8_product: 'Cartoonify Me', p8_last_order_date: '2026-10-20',
    p8_referral_code: '', p8_delivery: 'digital', p8_marketing_ok: 'yes',
  });
  assert.equal(f({ deliveryType: 'both' }).p8_delivery, 'print', 'print + digital counts as print');
  assert.equal(f({ deliveryType: 'print' }).p8_delivery, 'print');
  assert.equal(deliveryFor('order', { deliveryType: 'digital' }), 'print', 'shop orders are always print');
  assert.equal(productTitleFor([]), 'your order');
  assert.equal(productTitleFor([{ productTitle: 'Hulk' }]), 'Hulk');
});

test('MailerLite add: one upsert to the committed group; refused, unconfigured or bad email never calls', async () => {
  assert.equal(SITE_CONFIG.MAILERLITE_CUSTOMERS_GROUP_ID, GROUP);
  const calls = [];
  const fetchFn = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200 }; };
  const r = await addDeliveredCustomer('order', order(), { referralCode: 'PIX-AAAAAA' }, ML_ENV, fetchFn);
  assert.deepEqual(r, { ok: true, status: 200 });
  assert.equal(calls[0].url, 'https://connect.mailerlite.com/api/subscribers');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer k');
  assert.deepEqual(JSON.parse(calls[0].init.body).groups, [GROUP]);

  calls.length = 0;
  assert.match((await addDeliveredCustomer('order', order({ marketingConsent: 'refused' }), {}, ML_ENV, fetchFn)).skipped, /refused/);
  assert.match((await addDeliveredCustomer('order', order(), {}, {}, fetchFn)).skipped, /MAILERLITE_API_KEY/);
  assert.match((await addDeliveredCustomer('order', order({ customerEmail: 'nope' }), {}, ML_ENV, fetchFn)).skipped, /email/);
  assert.equal(calls.length, 0);

  const refused = await addDeliveredCustomer('order', order(), {}, ML_ENV, async () => ({ ok: false, status: 422, text: async () => 'bad field' }));
  assert.deepEqual(refused, { ok: false, status: 422, error: 'bad field' });
  const down = await addDeliveredCustomer('order', order(), {}, ML_ENV, async () => { throw new Error('timeout'); });
  assert.deepEqual(down, { ok: false, error: 'timeout' });
});

/* ------------------------------------------------------------------ startPostDelivery */

test('post-delivery: code created and saved, buyer added, once only', async () => {
  const sanity = fakeSanity([order()]);
  const { d, stripe, added } = deps();
  const r = await startPostDelivery('order', order(), { sanity, log: quietLog }, d);
  assert.match(r.referralCode, /^PIX-/);
  const saved = sanity.store.get(order()._id);
  assert.equal(saved.referralCode, r.referralCode);
  assert.equal(saved.postDeliveryStartedAt, '2026-11-02T10:00:00.000Z');
  assert.equal(saved.postDeliveryError, undefined);
  assert.equal(added.length, 1);
  assert.equal(added[0].kind, 'order');
  assert.equal(added[0].opts.referralCode, r.referralCode);

  const again = await startPostDelivery('order', order(), { sanity, log: quietLog }, d);
  assert.equal(again.skipped, 'already started');
  assert.equal(stripe.calls.promos.length, 1);
  assert.equal(added.length, 1);
});

test('post-delivery: a buyer who refused gets no claim, no code, no MailerLite', async () => {
  for (const [stored, passed] of [['refused', 'refused'], ['refused', undefined]]) {
    const sanity = fakeSanity([order({ marketingConsent: stored })]);
    const { d, stripe, added } = deps();
    const r = await startPostDelivery('order', order({ marketingConsent: passed }), { sanity, log: quietLog }, d);
    assert.equal(r.skipped, 'refused');
    assert.equal(stripe.calls.promos.length, 0);
    assert.equal(added.length, 0);
    assert.equal(sanity.store.get(order()._id).postDeliveryStartedAt, undefined);
  }
});

test('post-delivery: a code from an earlier order or commission (same email, any case) is reused', async () => {
  let asked;
  const sanity = fakeSanity([commission()], { fetch: async (q, params) => { asked = { q, params }; return 'PIX-EARLY1'; } });
  const { d, stripe, added } = deps();
  const r = await startPostDelivery('commission', commission(), { sanity, log: quietLog }, d);
  assert.equal(r.referralCode, 'PIX-EARLY1');
  assert.equal(asked.q, EARLIER_CODE_QUERY);
  assert.match(EARLIER_CODE_QUERY, /_type in \["order", "commission"\]/);
  assert.equal(asked.params.email, 'grace@example.com');
  assert.equal(stripe.calls.promos.length, 0);
  assert.equal(added[0].doc.serviceTitle, 'Cartoonify Me', 'the caller’s fetched service title reaches MailerLite');
});

test('post-delivery: Stripe down still adds the buyer (no code); problems recorded for Studio', async () => {
  const sanity = fakeSanity([order()]);
  const broken = { coupons: { retrieve: async () => { throw Object.assign(new Error('Stripe is down'), { statusCode: 500 }); } } };
  const { d, added } = deps({ stripe: broken, mlResult: { ok: false, status: 422, error: 'p8_delivery does not exist' } });
  const r = await startPostDelivery('order', order(), { sanity, log: quietLog }, d);
  assert.equal(r.referralCode, '');
  assert.equal(added.length, 1, 'still added to MailerLite');
  const err = sanity.store.get(order()._id).postDeliveryError;
  assert.match(err, /Stripe is down/);
  assert.match(err, /MailerLite: 422 p8_delivery does not exist/);

  const noKey = fakeSanity([order()]);
  const k = deps({ stripeKey: '' });
  await startPostDelivery('order', order(), { sanity: noKey, log: quietLog }, k.d);
  assert.match(noKey.store.get(order()._id).postDeliveryError, /STRIPE_SECRET_KEY/);
});

test('post-delivery: never throws, even when Sanity does', async () => {
  const sanity = { getDocument: async () => { throw new Error('Sanity down'); } };
  const { d } = deps();
  const r = await startPostDelivery('order', order(), { sanity, log: quietLog }, d);
  assert.match(r.error, /Sanity down/);
  assert.equal((await startPostDelivery('order', { ...order(), _id: 'drafts.x' }, { sanity, log: quietLog }, d)).skipped, 'no published document');
});

/* ------------------------------------------------------------------ the dispatch hook */

const resendDeps = (resend) => ({ getResend: () => resend, log: quietLog });

test('dispatch email (by hand and Sendcloud first scan) starts the sequence exactly once', async () => {
  const scanned = order({
    status: 'in-production', trackingNumber: '',
    shipmentResult: { dispatchedAt: '2026-11-03T10:00:00Z', parcels: [{ parcelRef: '1', trackingNumber: 'T1', trackingUrl: 'https://t/1', carrier: 'inpost_gb', labelId: 'L1' }] },
  });
  for (const o of [order(), scanned]) {
    const sanity = fakeSanity([o]);
    const resend = fakeResend();
    const { d, added } = deps();
    const after = (kind, doc, ctx) => afterDispatchEmail(kind, doc, { ...ctx, postDelivery: (k, x, c) => startPostDelivery(k, x, c, d) });
    assert.equal((await sendDispatchEmail({ kind: 'order', id: o._id, sanity, ...resendDeps(resend), after })).sent, true);
    assert.equal((await sendDispatchEmail({ kind: 'order', id: o._id, sanity, ...resendDeps(resend), after })).sent, false);
    assert.equal(resend.sent.length, 1);
    assert.equal(added.length, 1);
    assert.match(sanity.store.get(o._id).referralCode, /^PIX-/);
  }
});

test('print + digital commission: download email first, then dispatch email: one start', async () => {
  const c = commission({ deliveryType: 'both', status: 'shipped', carrier: 'dpd', trackingNumber: 'D1' });
  const sanity = fakeSanity([c], { fetch: async (q) => (/serviceTitle/.test(q) ? { serviceTitle: 'Cartoonify Me' } : null) });
  const { d, added } = deps();
  // The download email's call (commission-delivery.mts).
  await startPostDelivery('commission', c, { sanity, log: quietLog }, d);
  const after = (kind, doc, ctx) => afterDispatchEmail(kind, doc, { ...ctx, postDelivery: (k, x, cc) => startPostDelivery(k, x, cc, d) });
  const resend = fakeResend();
  assert.equal((await sendDispatchEmail({ kind: 'commission', id: c._id, sanity, ...resendDeps(resend), after })).sent, true);
  assert.equal(resend.sent.length, 1, 'the dispatch email itself still goes');
  assert.equal(added.length, 1, 'but the sequence started only once');
  assert.equal(added[0].doc.deliveryType, 'both');
});

test('afterDispatchEmail without a Sanity client does nothing (and never throws)', async () => {
  let called = false;
  await afterDispatchEmail('order', order(), { log: quietLog, postDelivery: async () => { called = true; } });
  assert.equal(called, false);
});

/* ------------------------------------------------------------------ the reward */

test('reward: THANKS- code issued, recorded on the order and emailed to the referrer only', async () => {
  const sanity = fakeSanity([order({ _id: 'order.friend' })]);
  const resend = fakeResend();
  const promos = [{ code: 'PIX-AAAAAA', metadata: { kind: KIND_FRIEND, referrer_email: 'ada@example.com', referrer_order: 'P8-AbCdEfGh' } }];
  const r = await rewardReferrer({ stripe: fakeStripe(), sanity, resend, docId: 'order.friend', ref: 'P8-FRIEND12', promos, buyerEmail: 'friend@example.com', log: quietLog });
  assert.equal(r.rewarded, true);
  assert.match(r.rewardCode, /^THANKS-/);
  assert.deepEqual(sanity.store.get('order.friend').referredBy, { code: 'PIX-AAAAAA', referrerEmail: 'ada@example.com', referrerOrder: 'P8-AbCdEfGh', rewardCode: r.rewardCode });
  assert.equal(resend.sent.length, 1);
  assert.deepEqual(resend.sent[0].to, ['ada@example.com']);
  assert.equal(resend.sent[0].from, SITE_CONFIG.EMAIL_FROM);
  assert.ok(resend.sent[0].html.includes(r.rewardCode));
});

test('reward: nothing for no code, PIX10, or your own code; a failed send is recorded, never thrown', async () => {
  const sanity = fakeSanity([order({ _id: 'order.friend' })]);
  const resend = fakeResend();
  const own = [{ code: 'PIX-AAAAAA', metadata: { kind: KIND_FRIEND, referrer_email: 'ada@example.com' } }];
  for (const [promos, buyer] of [[[], 'x@y.co'], [[{ code: 'PIX10', metadata: {} }], 'x@y.co'], [own, 'ada@example.com']]) {
    assert.deepEqual(await rewardReferrer({ stripe: fakeStripe(), sanity, resend, docId: 'order.friend', ref: 'P8-1', promos, buyerEmail: buyer, log: quietLog }), { rewarded: false });
  }
  assert.equal(resend.sent.length, 0);

  const r = await rewardReferrer({ stripe: fakeStripe(), sanity, resend: fakeResend({ fail: true }), docId: 'order.friend', ref: 'P8-1', promos: own, buyerEmail: 'friend@example.com', log: quietLog });
  assert.equal(r.rewarded, false);
  assert.match(sanity.store.get('order.friend').referralError, /refused/);
});

test('reward email: the code and the site link, no shop button', () => {
  const { subject, html } = rewardEmail('THANKS-K7QM2X');
  assert.match(subject, /10% thank you/);
  assert.ok(html.includes('THANKS-K7QM2X'));
  assert.equal(/\/store|SHOP NOW|shop now/i.test(html), false);
});

/* ------------------------------------------------------------------ the wiring */

test('cart drawer: an unticked, labelled opt-out box directly above Checkout, sent with the request', () => {
  const src = code(read('../src/components/CartPanel.astro'));
  const box = src.match(/<input id="marketing-opt-out"[^>]*>/);
  assert.ok(box, 'checkbox exists');
  assert.match(box[0], /type="checkbox"/);
  assert.equal(/\schecked\b/.test(box[0]), false, 'not ticked by default');
  assert.match(src, /<label for="marketing-opt-out"[^>]*>\s*Don't send me offers or referral emails\s*<\/label>/);
  const boxAt = src.indexOf('id="marketing-opt-out"');
  const btnAt = src.indexOf('id="checkout-btn"');
  assert.ok(boxAt > 0 && boxAt < btnAt, 'before the Checkout button');
  assert.match(src, /marketingOptOut\.set\(optOutBox\.checked\)/);
  assert.match(src, /marketingOptOut:\s*optOutBox \? optOutBox\.checked : marketingOptOut\.get\(\)/);
  const store = code(read('../src/stores/cart.ts'));
  assert.match(store, /export const marketingOptOut = atom<boolean>/);
  assert.match(store, /sessionStorage/);
});

test('Your Photo goes through the cart drawer, not its own checkout', () => {
  const page = read('../src/pages/store/your-photo.astro');
  assert.equal(page.includes('/api/checkout'), false);
  assert.ok(page.includes('addToCart('));
});

test('checkouts: opt-out stamped / recorded; never consent_collection', () => {
  const shop = code(read('../netlify/functions/checkout.mjs'));
  assert.match(shop, /const \{[^}]*\bmarketingOptOut\b[^}]*\} = await req\.json\(\)/);
  assert.match(shop, /marketing_opt_out:\s*optOutMetadata\(marketingOptOut\)/);
  const comm = code(read('../netlify/functions/commission-checkout.mts'));
  assert.match(comm, /marketingConsent:\s*consentFromOptOut\(body\.marketingOptOut\)/);
  assert.match(comm, /marketing_opt_out:\s*optOutMetadata\(body\.marketingOptOut\)/);
  for (const src of [shop, comm]) assert.equal(/consent_collection\s*:/.test(src), false);
});

test('commission wizard (Groupon voucher checkouts included) and the older form both have the box', () => {
  const wiz = code(read('../src/components/CommissionWorkflow.jsx'));
  assert.match(wiz, /useState\(false\);\s*$/m);
  assert.match(wiz, /const \[marketingOptOut, setMarketingOptOut\] = useState\(false\)/);
  assert.match(wiz, /marketingOptOut: marketingOptOut === true/);
  assert.match(wiz, /\{step === 3 && \(\s*<label className="cw__checkbox-row">\s*<input\s+id="marketing-opt-out"/, 'shown on the last step for every delivery type');
  assert.match(wiz, />Don't send me offers or referral emails</);
  const form = code(read('../src/components/CommissionForm.jsx'));
  assert.match(form, /id="marketing-opt-out"/);
  assert.match(form, /fd\.append\('marketingOptOut'/);
});

test('webhooks record consent and reward referrers; the download email starts the sequence', () => {
  const shop = code(read('../netlify/functions/webhook.mjs'));
  assert.match(shop, /marketingConsent:\s*consentFromSession\(session\)/);
  assert.match(shop, /await rewardReferrer\(\{[\s\S]*?promos: discount\.promos/);
  const comm = code(read('../netlify/functions/stripe-webhook-commission.mts'));
  assert.match(comm, /if \(promo\) \{\s*await rewardReferrer\(\{[\s\S]*?promos: promo\.promos/);
  const delivery = code(read('../netlify/functions/_shared/commission-delivery.mts'));
  assert.match(delivery, /paidAt, marketingConsent,/);
  const sentAt = delivery.indexOf("set({ status: 'delivered', deliveredAt: new Date().toISOString() })\n    .commit();\n\n  console.log(`Commission ${commissionId} (");
  const startAt = delivery.indexOf("await startPostDelivery('commission', commission,");
  assert.ok(startAt > 0, 'starts the sequence');
  assert.ok(sentAt > 0 && startAt > sentAt, 'only after the download email has gone and been marked');
});

test('Studio: marketing fields on orders and commissions', () => {
  const f = read('../studio/schemas/marketingFields.ts');
  for (const n of ['marketingConsent', 'referralCode', 'postDeliveryStartedAt', 'postDeliveryError', 'referredBy', 'referralError']) assert.ok(f.includes(`name: '${n}'`), n);
  assert.match(read('../studio/schemas/order.ts'), /\.\.\.marketingFields\(\)/);
  assert.match(read('../studio/schemas/commission.ts'), /\.\.\.marketingFields\('source'\)/);
});

test('privacy policy describes the soft opt-in and the box', () => {
  const p = read('../src/pages/privacy-policy.astro');
  assert.match(p, /once you've ordered from us, offers and referral emails about our products and services/);
  assert.match(p, /tick "Don't send me offers or referral emails" in your cart, or on the commission order form/);
  assert.equal(p.includes("only if you've opted in via our newsletter"), false);
});
