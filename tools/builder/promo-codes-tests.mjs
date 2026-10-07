/**
 * Promotion codes at Stripe Checkout: the REAL handlers, called.
 *
 *   node tools/builder/promo-codes-tests.mjs
 *
 * 1. checkout.mjs (shop) turns the promo box on; P&P is a shipping rate, not
 *    a line, so a code can never discount it.
 * 2. commission-checkout.mts: no voucher → promo box on, no `discounts`;
 *    Groupon voucher → a single-use coupon minted for that voucher in
 *    `discounts`, promo box off, and NO promotion code anywhere (nothing a
 *    customer could type elsewhere). A failed checkout deletes the coupon.
 * 3. webhook.mjs (shop): a code is recorded on the order (amount + code) and
 *    shown as "Discount (CODE) −£x.xx" above P&P and the charged total in
 *    both emails; no code → nothing; a minted Groupon code → flagged.
 * 4. stripe-webhook-commission.mts: a typed code is recorded and the emails
 *    show what was PAID with the discount as its own line; the Groupon path
 *    is unchanged (order value, voucher finalised); a Groupon code typed into
 *    the promo box is flagged.
 * 5. _shared/discount.mjs and deleteVoucherCoupon: a voucher is recognised by
 *    its coupon's metadata, not a code; only minted coupons are deleted.
 * 6. commission-checkout passes one Stripe Customer per (lower-cased) email,
 *    so "first-time order only" is enforced; falls back to customer_email.
 * 7. webhook.mjs (shop): a welcome code from an email with an earlier order
 *    is flagged ⚠ REPEAT WELCOME CODE for the team; the customer sees nothing.
 * Stripe, Sanity, Resend and Blobs are faked; nothing touches the network.
 */
import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';

let pass = 0, fail = 0;
const ok = (c, l, e = '') => {
  if (c) { pass++; console.log(`  PASS  ${l}${e !== '' ? ' — ' + e : ''}`); }
  else { fail++; console.log(`  FAIL  ${l}${e !== '' ? ' — ' + e : ''}`); }
};
const say = console.log.bind(console);

// ── Fakes for the SDKs, installed before anything imports them ──
const MOCK_SRC = {
  stripe: 'export default class Stripe { constructor() { return globalThis.__mocks.stripe; } }',
  '@sanity/client': 'export const createClient = () => new Proxy({}, { get: (_, k) => globalThis.__mocks.sanity[k] });',
  resend: 'export class Resend { constructor() { this.emails = { send: (...a) => globalThis.__mocks.resend(...a) }; } }',
  '@netlify/blobs': 'export const getStore = () => globalThis.__mocks.store;',
};
registerHooks({
  resolve(spec, ctx, next) {
    return spec in MOCK_SRC ? { url: `file:///__mock__/${encodeURIComponent(spec)}.mjs`, shortCircuit: true } : next(spec, ctx);
  },
  load(url, ctx, next) {
    const m = /^file:\/\/\/__mock__\/(.+)\.mjs$/.exec(url);
    return m ? { format: 'module', source: MOCK_SRC[decodeURIComponent(m[1])], shortCircuit: true } : next(url, ctx);
  },
});

process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_fake';
process.env.STRIPE_COMMISSION_WEBHOOK_SECRET = 'whsec_fake';
process.env.TEAM_EMAIL = 'team@test.local';
delete process.env.TURNSTILE_SECRET_KEY;

// ── State the fakes read and write ──
let created, sessions, promos, coupons, deletedCoupons, customers, docs, patches, sent, fetchQueries;
const M = (globalThis.__mocks = {});
function reset() {
  created = []; sessions = new Map(); promos = new Map(); coupons = new Map(); deletedCoupons = []; customers = [];
  M.failCustomers = false;
  docs = new Map(); patches = []; sent = []; fetchQueries = [];
}
reset();

M.stripe = {
  checkout: {
    sessions: {
      create: async (p) => {
        created.push(p);
        if (M.failCreate) throw new Error('stub: Stripe refused the session');
        return { id: `cs_test_${created.length}`, url: 'https://checkout.stripe.test', ...p };
      },
      retrieve: async (id) => { const s = sessions.get(id); if (!s) throw new Error(`no session ${id}`); return s; },
      listLineItems: async (id) => ({ data: sessions.get(id)?.lines || [] }),
    },
  },
  customers: {
    list: async ({ email }) => { if (M.failCustomers) throw new Error('stub: Stripe down'); return { data: customers.filter((c) => c.email === email) }; },
    create: async (c) => { if (M.failCustomers) throw new Error('stub: Stripe down'); const cu = { id: `cus_${customers.length + 1}`, ...c }; customers.push(cu); return cu; },
  },
  promotionCodes: {
    retrieve: async (id) => { const p = promos.get(id); if (!p) throw new Error(`no promo ${id}`); return p; },
    create: async (p) => { const promo = { id: `promo_grpn_${promos.size + 1}`, ...p }; promos.set(promo.id, promo); return promo; },
    update: async () => ({}),
  },
  coupons: {
    retrieve: async (id) => { const c = coupons.get(id); if (!c) { const e = new Error('no coupon'); e.statusCode = 404; throw e; } return c; },
    create: async (c) => { const coupon = { id: `co_minted_${coupons.size + 1}`, ...c }; coupons.set(coupon.id, coupon); return coupon; },
    del: async (id) => { deletedCoupons.push(id); coupons.delete(id); return { id, deleted: true }; },
  },
  webhooks: {
    constructEvent: (body, sig) => { if (sig !== 'good') throw new Error('bad signature'); return JSON.parse(body); },
  },
};

function patchBuilder(id) {
  const rec = { id, set: {}, unset: [] };
  const b = {
    set(o) { Object.assign(rec.set, o); return b; },
    setIfMissing() { return b; },
    append() { return b; },
    unset(k) { rec.unset.push(...k); return b; },
    ifRevisionId() { return b; },
    async commit() { patches.push(rec); docs.set(id, { ...(docs.get(id) || {}), ...rec.set }); return docs.get(id); },
  };
  return b;
}
let fetchImpl = async () => null;
M.sanity = {
  fetch: async (q, params) => { fetchQueries.push(q); return fetchImpl(q, params); },
  create: async (doc) => { if (docs.has(doc._id)) { const e = new Error('exists'); e.statusCode = 409; throw e; } docs.set(doc._id, doc); return doc; },
  patch: (id) => patchBuilder(id),
};
M.resend = async (payload) => { sent.push(payload); return { data: { id: `r${sent.length}` }, error: null }; };
M.store = new Proxy({}, { get: () => async () => null });
// triggerInternal (proof / prewarm) and GA4 go through fetch; answer 200.
globalThis.fetch = async () => new Response('{}', { status: 200 });

const ROOT = new URL('../../netlify/functions/', import.meta.url).href;
const shopCheckout = (await import(`${ROOT}checkout.mjs`)).default;
const commissionCheckout = (await import(`${ROOT}commission-checkout.mts`)).default;
const shopWebhook = (await import(`${ROOT}webhook.mjs`)).default;
const commissionWebhook = (await import(`${ROOT}stripe-webhook-commission.mts`)).default;

const post = (fn, url, body, headers = {}) => fn(new Request(`https://test.local${url}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
}), {});
const event = (object, type = 'checkout.session.completed') => JSON.stringify({ id: 'evt_1', type, data: { object } });
const strip = (html) => (html || '').replace(/<[^>]+>/g, ' ').replace(/&minus;|−/g, '−').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

/* ================================================================ 1 */
say('\n1. SHOP CHECKOUT: THE PROMO BOX IS ON, P&P IS NOT A LINE\n');
{
  reset();
  const PRICES = { poster: { small: 9.99, medium: 14.99, large: 19.99 }, canvasStandard: { small: 29.99, medium: 39.99, large: 49.99 }, canvasGallery: { small: 34.99, medium: 44.99, large: 54.99 } };
  fetchImpl = async (q) => (q.includes('_type == "product"')
    ? [{ _id: 'product-hulk-style-c', slug: 'hulk-style-c', title: 'Hulk — Option C', category: 'tv-movies', style: 'style-c', prices: PRICES, imageRef: 'image-abc-1024x1024-png' }]
    : []);
  const res = await post(shopCheckout, '/api/checkout', { items: [{ productId: 'product-hulk-style-c', slug: 'hulk-style-c', title: 'x', format: 'poster', size: 'small', quantity: 1, unitPrice: 9.99 }] });
  ok(res.status === 200, 'a valid cart gets a session', String(res.status));
  const p = created[0] || {};
  ok(p.allow_promotion_codes === true, 'promotion codes are accepted');
  ok(!('discounts' in p), 'and no discount is forced on the session');
  ok(p.shipping_options?.[0]?.shipping_rate_data?.fixed_amount?.amount === 495, 'P&P is a £4.95 shipping rate');
  ok(!(p.line_items || []).some((l) => /p&p|postage|shipping|delivery/i.test(l.price_data?.product_data?.name || '')), 'and not a line item');
}

/* ================================================================ 2 */
say('\n2. COMMISSION CHECKOUT: VOUCHER OR PROMO BOX, NEVER BOTH\n');
const SERVICE = { _id: 'service-song', title: 'Your Song Your Story', price: 29.99, digitalPrice: 29.99, styleOptions: [], commissionEnabled: true };
const commissionBody = (extra = {}) => ({
  serviceSlug: 'your-song-your-story', name: 'Promo Test', email: 'promo@test.local', brief: 'x',
  orderType: 'digital', digitalSupplyConsent: true, ...extra,
});
{
  reset();
  fetchImpl = async (q) => (q.includes('_type == "service"') ? SERVICE : null);
  const res = await post(commissionCheckout, '/.netlify/functions/commission-checkout', commissionBody());
  ok(res.status === 200, 'a direct commission gets a session', `${res.status} ${res.status !== 200 ? await res.text() : ''}`);
  const p = created[0] || {};
  ok(p.allow_promotion_codes === true, 'no voucher: the promo box is on');
  ok(!('discounts' in p), 'and nothing is pre-applied');
}
{
  reset();
  const token = 'claim-token-123';
  const voucher = {
    _id: 'grouponVoucher.v1', _rev: 'r1', code: 'GRPN-REAL-CODE', status: 'claimed', serviceSlug: 'your-song-your-story',
    valuePence: 2999, claimTokenHash: createHash('sha256').update(token).digest('hex'),
    claimExpiresAt: new Date(Date.now() + 3600e3).toISOString(), verificationStatus: 'verified',
  };
  fetchImpl = async (q) => (q.includes('_type == "service"') ? SERVICE : q.includes('claimTokenHash') ? voucher : null);
  const res = await post(commissionCheckout, '/.netlify/functions/commission-checkout', commissionBody({ grouponClaimToken: token }));
  ok(res.status === 200, 'a voucher commission gets a session', `${res.status} ${res.status !== 200 ? await res.text() : ''}`);
  const p = created[0] || {};
  const applied = p.discounts?.[0] || {};
  const coupon = coupons.get(applied.coupon);
  ok(p.discounts?.length === 1 && !!coupon, 'voucher: a coupon is applied via discounts', JSON.stringify(applied));
  ok(!('promotion_code' in applied) && promos.size === 0, 'and no promotion code is minted — nothing to type into another checkout');
  ok(!('allow_promotion_codes' in p), 'and the promo box is NOT on (Stripe refuses both together)');
  ok(coupon?.amount_off === 2999 && coupon?.max_redemptions === 1, 'single-use, for the voucher value',
    `${coupon?.amount_off} x${coupon?.max_redemptions}`);
  const ttl = (coupon?.redeem_by || 0) - Date.now() / 1000;
  ok(ttl > 59 * 60 && ttl <= 60 * 60, 'redeemable for the 60-minute checkout window only', `${Math.round(ttl / 60)} min`);
  ok(p.expires_at && p.expires_at < coupon?.redeem_by, 'and the session expires before the coupon does');
  ok(coupon?.metadata?.source === 'groupon' && coupon?.metadata?.grouponVoucherId === 'grouponVoucher.v1',
    'the coupon names its voucher in metadata');
  ok(!JSON.stringify(coupon).includes('GRPN-REAL-CODE'), 'and never carries the Groupon code itself');
  const vp = patches.filter((x) => x.id === 'grouponVoucher.v1').map((x) => x.set).reduce((a, b) => ({ ...a, ...b }), {});
  ok(vp.stripeCouponId === coupon?.id, 'the voucher records its coupon id', vp.stripeCouponId);
  ok(patches.some((x) => x.id === 'grouponVoucher.v1' && x.unset.includes('stripePromotionCodeId')),
    'and drops any promotion code id left from an older checkout');
}
{
  /* Stripe refuses the session: the minted coupon must not be left live, and
     the voucher goes back to `claimed`. */
  reset();
  const token = 'claim-token-456';
  const voucher = {
    _id: 'grouponVoucher.v2', _rev: 'r1', code: 'GRPN-REAL-2', status: 'claimed', serviceSlug: 'your-song-your-story',
    valuePence: 2999, claimTokenHash: createHash('sha256').update(token).digest('hex'),
    claimExpiresAt: new Date(Date.now() + 3600e3).toISOString(), verificationStatus: 'verified',
  };
  fetchImpl = async (q) => (q.includes('_type == "service"') ? SERVICE : q.includes('claimTokenHash') ? voucher : null);
  M.failCreate = true;
  const res = await post(commissionCheckout, '/.netlify/functions/commission-checkout', commissionBody({ grouponClaimToken: token }));
  M.failCreate = false;
  ok(res.status >= 500, 'a refused session fails the request', String(res.status));
  ok(deletedCoupons.length === 1 && coupons.size === 0, 'and its minted coupon is deleted', deletedCoupons.join(','));
  ok(patches.some((x) => x.id === 'grouponVoucher.v2' && x.set.status === 'claimed'), 'and the voucher is released');
}

/* ================================================================ 3 */
say('\n3. SHOP WEBHOOK: THE DISCOUNT ON THE ORDER AND IN BOTH EMAILS\n');
const shopLine = { quantity: 1, description: 'Hulk', price: { unit_amount: 999, product: { metadata: { productId: 'product-hulk-style-c', slug: 'hulk-style-c', title: 'Hulk — Option C', format: 'poster', size: 'small', formatKey: 'poster', sizeKey: 'small' } } } };
function shopSession(id, { discount = 0, promo } = {}) {
  const s = {
    id, payment_intent: 'pi_1', payment_status: 'paid', metadata: { source: 'shop' },
    amount_total: 999 - discount + 495,
    shipping_cost: { amount_total: 495 },
    total_details: { amount_discount: discount, amount_shipping: 495, amount_tax: 0 },
    customer_details: { email: 'buyer@test.local', name: 'A Buyer' },
    shipping_details: { name: 'A Buyer', address: { line1: '1 Test St', city: 'London', postal_code: 'E1 1AA', country: 'GB' } },
  };
  sessions.set(id, { ...s, lines: [shopLine], total_details: { ...s.total_details, breakdown: { discounts: promo ? [{ amount: discount, discount: { promotion_code: promo } }] : [] } } });
  return s;
}
const team = () => sent.find((m) => [].concat(m.to).includes('team@test.local'));
const customer = () => sent.find((m) => ![].concat(m.to).includes('team@test.local'));
{
  reset(); fetchImpl = async () => null;
  promos.set('promo_pix10', { id: 'promo_pix10', code: 'PIX10', metadata: {} });
  const s = shopSession('cs_shop_promo', { discount: 100, promo: 'promo_pix10' });
  const res = await post(shopWebhook, '/api/webhook', event(s), { 'stripe-signature': 'good' });
  ok(res.status === 200, 'a discounted shop session is accepted', String(res.status));
  const o = docs.get('order.cs_shop_promo');
  ok(o?.discountAmount === 1, 'the order records the discount', String(o?.discountAmount));
  ok(o?.discountCode === 'PIX10', 'and the code', o?.discountCode);
  ok(o?.totalAmount === 13.94, 'the total is what Stripe charged (9.99 − 1.00 + 4.95)', String(o?.totalAmount));
  ok(!o?.discountWarning, 'a welcome code raises no warning');
  for (const [who, m] of [['customer', customer()], ['team', team()]]) {
    const t = strip(m?.html);
    ok(t.includes('Discount (PIX10): −£1.00'), `the ${who} email shows "Discount (PIX10) −£1.00"`);
    ok(t.includes('P&P: £4.95') && t.includes('Total: £13.94'), `and full-price P&P with the real total`);
  }
}
{
  reset(); fetchImpl = async () => null;
  const s = shopSession('cs_shop_none');
  await post(shopWebhook, '/api/webhook', event(s), { 'stripe-signature': 'good' });
  const o = docs.get('order.cs_shop_none');
  ok(o && !('discountAmount' in o) && !('discountCode' in o), 'no code: no discount fields on the order');
  ok(!sent.some((m) => strip(m.html).includes('Discount')), 'and no discount row in either email');
  ok(strip(customer()?.html).includes('Total: £14.94'), 'the total is the full price plus P&P');
}
{
  reset(); fetchImpl = async () => null;
  // A legacy GRPN code (minted before the switch to coupons) typed into the shop.
  promos.set('promo_grpn', { id: 'promo_grpn', code: 'GRPNABC123', metadata: { source: 'groupon', grouponVoucherId: 'grouponVoucher.v9' } });
  const s = shopSession('cs_shop_grpn', { discount: 999, promo: 'promo_grpn' });
  await post(shopWebhook, '/api/webhook', event(s), { 'stripe-signature': 'good' });
  const o = docs.get('order.cs_shop_grpn');
  ok(!!o?.discountWarning, 'a Groupon code on a shop order is flagged on the order');
  ok(/GROUPON CODE/.test(team()?.subject || '') && strip(team()?.html).includes('GROUPON CODE USED ON A SHOP ORDER'),
    'and in the team email subject and body');
  ok(!strip(customer()?.html).includes('GROUPON'), 'but not in the customer email');
}
{
  reset(); fetchImpl = async () => null;
  const s = shopSession('cs_shop_lookupfail', { discount: 100, promo: 'promo_missing' });
  const res = await post(shopWebhook, '/api/webhook', event(s), { 'stripe-signature': 'good' });
  const o = docs.get('order.cs_shop_lookupfail');
  ok(res.status === 200 && o?.discountAmount === 1 && !o?.discountCode,
    'a failed code lookup keeps the amount and never fails the order');
  ok(strip(team()?.html).includes('Discount: −£1.00'), 'labelled plainly "Discount"');
}

/* ================================================================ 4 */
say('\n4. COMMISSION WEBHOOK: PROMO CODE vs GROUPON VOUCHER\n');
const COMMISSION = {
  _id: 'commission.PX-TEST1', status: 'pending', orderRef: 'PX-TEST1', customerName: 'Promo Test',
  customerEmail: 'promo@test.local', amount: 29.99, deliveryType: 'digital', serviceTitle: 'Your Song Your Story',
};
function commissionSession(id, { discount = 0, promo, voucher } = {}) {
  const s = {
    id, payment_intent: 'pi_c', payment_status: discount >= 2999 ? 'no_payment_required' : 'paid',
    amount_total: 2999 - discount,
    total_details: { amount_discount: discount, amount_shipping: 0 },
    customer_details: { email: 'promo@test.local' },
    metadata: { commissionId: 'commission.PX-TEST1', orderRef: 'PX-TEST1', serviceSlug: 'your-song-your-story', ...(voucher ? { grouponVoucherId: 'grouponVoucher.v1', grouponCode: 'GRPN-REAL' } : {}) },
  };
  sessions.set(id, { ...s, lines: [], total_details: { ...s.total_details, breakdown: { discounts: promo ? [{ amount: discount, discount: { promotion_code: promo } }] : [] } } });
  return s;
}
const commissionFetch = async (q) => (q.includes('_type == "commission"') ? { ...COMMISSION } : q.includes('grouponVoucher') ? 'grouponVoucher.v1' : null);
const commissionPatch = () => patches.find((p) => p.id === 'commission.PX-TEST1')?.set || {};
{
  reset(); fetchImpl = commissionFetch;
  promos.set('promo_pix10', { id: 'promo_pix10', code: 'PIX10', metadata: {} });
  const s = commissionSession('cs_c_promo', { discount: 300, promo: 'promo_pix10' });
  const res = await post(commissionWebhook, '/.netlify/functions/stripe-webhook-commission', event(s), { 'stripe-signature': 'good' });
  ok(res.status === 200, 'a discounted commission is accepted', String(res.status));
  const p = commissionPatch();
  ok(p.status === 'paid' && p.amount === 26.99, 'marked paid at the amount charged (29.99 − 3.00)', `${p.status} ${p.amount}`);
  ok(p.discountPence === 300 && p.discountCode === 'PIX10', 'the discount and code are recorded', `${p.discountPence} ${p.discountCode}`);
  ok(!p.discountWarning, 'no warning for a welcome code');
  const c = strip(customer()?.html), t = strip(team()?.html);
  ok(c.includes('Discount (PIX10) −£3.00') && c.includes('Total paid £26.99'), 'customer email: the discount line and the real total paid');
  ok(t.includes('£26.99') && t.includes('Discount (PIX10) −£3.00'), 'team email: the real total and the discount');
  ok(!patches.some((x) => x.id === 'grouponVoucher.v1'), 'no voucher is touched');
}
{
  reset(); fetchImpl = commissionFetch;
  const s = commissionSession('cs_c_none');
  await post(commissionWebhook, '/.netlify/functions/stripe-webhook-commission', event(s), { 'stripe-signature': 'good' });
  const p = commissionPatch();
  ok(p.amount === 29.99 && !('discountPence' in p) && !('discountCode' in p), 'no code: full price, no discount fields');
  ok(!sent.some((m) => strip(m.html).includes('Discount')), 'and no discount line in either email');
}
{
  /* The existing Groupon behaviour, unchanged: a fully covered £29.99 job
     captures £0; the emails show the ORDER's value, the voucher is redeemed. */
  reset(); fetchImpl = commissionFetch;
  const s = commissionSession('cs_c_voucher', { discount: 2999, voucher: true });
  const res = await post(commissionWebhook, '/.netlify/functions/stripe-webhook-commission', event(s), { 'stripe-signature': 'good' });
  ok(res.status === 200, 'a voucher commission is accepted', String(res.status));
  const p = commissionPatch();
  ok(p.amount === 0 && p.discountPence === 2999 && !('discountCode' in p), 'voucher: £0 captured, voucher discount recorded, no promo code', `${p.amount} ${p.discountPence}`);
  ok(strip(customer()?.html).includes('Total paid £29.99'), 'the email still shows the order value, as before');
  ok(!sent.some((m) => strip(m.html).includes('Discount (')), 'and no promo-code line');
  const v = patches.find((x) => x.id === 'grouponVoucher.v1')?.set || {};
  ok(v.status === 'redeemed' && v.discountAppliedPence === 2999, 'the voucher is finalised as before');
}
{
  reset(); fetchImpl = commissionFetch;
  promos.set('promo_grpn', { id: 'promo_grpn', code: 'GRPNABC123', metadata: { source: 'groupon', grouponVoucherId: 'grouponVoucher.v9' } });
  const s = commissionSession('cs_c_grpn', { discount: 2999, promo: 'promo_grpn' });
  await post(commissionWebhook, '/.netlify/functions/stripe-webhook-commission', event(s), { 'stripe-signature': 'good' });
  const p = commissionPatch();
  ok(!!p.discountWarning, 'a Groupon code typed into the promo box is flagged on the commission');
  ok(/GROUPON CODE/.test(team()?.subject || '') && strip(team()?.html).includes('GROUPON CODE IN THE PROMO BOX'), 'and in the team email');
  ok(!strip(customer()?.html).includes('GROUPON'), 'but not in the customer email');
}

/* ================================================================ 5 */
say('\n5. A VOUCHER IS KNOWN BY ITS COUPON METADATA, NOT A CODE\n');
{
  const { readDiscount } = await import(`${ROOT}_shared/discount.mjs`);
  const { deleteVoucherCoupon } = await import(`${ROOT}_shared/groupon.mts`);
  const withBreakdown = (id, claimed, discounts) => {
    sessions.set(id, { id, total_details: { amount_discount: 2999, breakdown: { discounts } } });
    return { id, total_details: { amount_discount: 2999 }, metadata: claimed ? { grouponVoucherId: claimed } : {} };
  };
  const minted = (voucherId) => ({ id: `co_${voucherId}`, amount_off: 2999, name: 'Groupon £29.99 - x', metadata: { source: 'groupon', grouponVoucherId: voucherId } });

  reset();
  let d = await readDiscount(M.stripe, withBreakdown('cs_own', 'grouponVoucher.v1', [{ amount: 2999, discount: { coupon: minted('grouponVoucher.v1') } }]));
  ok(!d.groupon && d.codes.length === 0, 'its own minted coupon: not flagged, and no "Discount (CODE)" line');

  promos.set('promo_legacy', { id: 'promo_legacy', code: 'GRPNOLD1', metadata: { source: 'groupon', grouponVoucherId: 'grouponVoucher.v1' } });
  d = await readDiscount(M.stripe, withBreakdown('cs_legacy', 'grouponVoucher.v1', [{ amount: 2999, discount: { promotion_code: 'promo_legacy', coupon: { id: 'groupon-x-2999', metadata: { source: 'groupon' } } } }]));
  ok(!d.groupon, 'a voucher checkout begun before the switch (legacy GRPN code, same voucher): not flagged');

  d = await readDiscount(M.stripe, withBreakdown('cs_other', 'grouponVoucher.v2', [{ amount: 2999, discount: { coupon: minted('grouponVoucher.v1') } }]));
  ok(d.groupon, "another voucher's coupon on this checkout: flagged");

  d = await readDiscount(M.stripe, withBreakdown('cs_shop', null, [{ amount: 2999, discount: { promotion_code: 'promo_legacy', coupon: { id: 'groupon-x-2999', metadata: { source: 'groupon' } } } }]));
  ok(d.groupon && d.codes.includes('GRPNOLD1'), 'a legacy GRPN code on a checkout with no voucher: flagged, and named');

  reset();
  coupons.set('groupon-your-song-your-story-2999', { id: 'groupon-your-song-your-story-2999', metadata: { source: 'groupon', serviceSlug: 'x' } });
  coupons.set('co_mine', minted('grouponVoucher.v1'));
  await deleteVoucherCoupon(M.stripe, 'groupon-your-song-your-story-2999');
  await deleteVoucherCoupon(M.stripe, 'co_mine');
  await deleteVoucherCoupon(M.stripe, 'co_already_gone');
  ok(deletedCoupons.join() === 'co_mine', 'only a minted coupon is ever deleted; the shared legacy one is left', deletedCoupons.join());
}

/* ================================================================ 6 */
say('\n6. COMMISSION CHECKOUT: ONE STRIPE CUSTOMER PER EMAIL (FIRST-TIME ONLY)\n');
{
  reset();
  fetchImpl = async (q) => (q.includes('_type == "service"') ? SERVICE : null);
  await post(commissionCheckout, '/.netlify/functions/commission-checkout', commissionBody({ email: 'Repeat@Test.Local' }));
  const first = created[0] || {};
  ok(first.customer === 'cus_1' && !('customer_email' in first), 'a new email gets a Customer, passed as `customer` (not customer_email)', first.customer);
  ok(customers[0]?.email === 'repeat@test.local', 'stored lower-cased', customers[0]?.email);
  await post(commissionCheckout, '/.netlify/functions/commission-checkout', commissionBody({ email: 'repeat@test.local', brief: 'second' }));
  ok(created[1]?.customer === 'cus_1' && customers.length === 1, 'the same email (any case) reuses that Customer', `${created[1]?.customer}, ${customers.length} customer(s)`);
}
{
  reset();
  const token = 'claim-token-789';
  const voucher = {
    _id: 'grouponVoucher.v3', _rev: 'r1', code: 'GRPN-REAL-3', status: 'claimed', serviceSlug: 'your-song-your-story',
    valuePence: 2999, claimTokenHash: createHash('sha256').update(token).digest('hex'),
    claimExpiresAt: new Date(Date.now() + 3600e3).toISOString(), verificationStatus: 'verified',
  };
  fetchImpl = async (q) => (q.includes('_type == "service"') ? SERVICE : q.includes('claimTokenHash') ? voucher : null);
  await post(commissionCheckout, '/.netlify/functions/commission-checkout', commissionBody({ grouponClaimToken: token }));
  ok(created[0]?.customer && created[0]?.discounts?.[0]?.coupon, 'a voucher checkout uses the Customer too, with its coupon');
}
{
  reset();
  M.failCustomers = true;
  fetchImpl = async (q) => (q.includes('_type == "service"') ? SERVICE : null);
  const res = await post(commissionCheckout, '/.netlify/functions/commission-checkout', commissionBody());
  ok(res.status === 200 && created[0]?.customer_email === 'promo@test.local' && !('customer' in created[0]),
    'if Stripe cannot find or create the Customer, the order still goes ahead with customer_email', String(res.status));
}

/* ================================================================ 7 */
say('\n7. SHOP WEBHOOK: A WELCOME CODE FROM A REPEAT EMAIL IS FLAGGED, NOT BLOCKED\n');
const repeatFetch = (earlier) => async (q, params) => {
  if (q.includes('lower(customerEmail)')) { fetchQueries.push(params); return params.email === 'buyer@test.local' ? earlier : null; }
  return null;
};
{
  reset();
  fetchImpl = repeatFetch({ _id: 'order.cs_earlier', createdAt: '2026-10-01T10:00:00Z' });
  promos.set('promo_pix10', { id: 'promo_pix10', code: 'PIX10', restrictions: { first_time_transaction: true }, metadata: {} });
  const s = shopSession('cs_shop_repeat', { discount: 100, promo: 'promo_pix10' });
  s.customer_details.email = 'Buyer@Test.Local';
  const res = await post(shopWebhook, '/api/webhook', event(s), { 'stripe-signature': 'good' });
  const o = docs.get('order.cs_shop_repeat');
  ok(res.status === 200 && !!o, 'the order is created, not blocked', String(res.status));
  ok(/order\.cs_earlier/.test(o?.repeatWelcomeCode || ''), 'flagged repeatWelcomeCode, naming the earlier order', o?.repeatWelcomeCode);
  ok(fetchQueries.some((p) => p?.email === 'buyer@test.local' && p?.sessionId === 'cs_shop_repeat'),
    'matched case-insensitively, excluding this session');
  ok(o?.discountCode === 'PIX10' && o?.totalAmount === 13.94, 'the discount is still recorded as charged');
  ok(/^⚠ REPEAT WELCOME CODE — /.test(team()?.subject || '') && strip(team()?.html).includes('⚠ REPEAT WELCOME CODE'),
    'the team email subject and banner say ⚠ REPEAT WELCOME CODE', team()?.subject);
  ok(!/REPEAT|WELCOME CODE|earlier order/i.test(customer()?.subject + strip(customer()?.html)), 'the customer email says nothing about it');
}
{
  reset();
  fetchImpl = repeatFetch(null);
  promos.set('promo_pix10', { id: 'promo_pix10', code: 'PIX10', restrictions: { first_time_transaction: true }, metadata: {} });
  await post(shopWebhook, '/api/webhook', event(shopSession('cs_shop_first', { discount: 100, promo: 'promo_pix10' })), { 'stripe-signature': 'good' });
  ok(!('repeatWelcomeCode' in (docs.get('order.cs_shop_first') || {})) && !/REPEAT/.test(team()?.subject || ''), 'a genuine first order: no flag');
}
{
  reset();
  fetchImpl = repeatFetch({ _id: 'order.cs_earlier' });
  promos.set('promo_other', { id: 'promo_other', code: 'SUMMER5', restrictions: { first_time_transaction: false }, metadata: {} });
  await post(shopWebhook, '/api/webhook', event(shopSession('cs_shop_other', { discount: 100, promo: 'promo_other' })), { 'stripe-signature': 'good' });
  ok(!('repeatWelcomeCode' in (docs.get('order.cs_shop_other') || {})), 'a repeat buyer with a non-welcome code: no flag');
  ok(!fetchQueries.some((p) => p?.email), 'and no lookup is made');
}
{
  reset();
  fetchImpl = repeatFetch({ _id: 'order.cs_earlier' });
  await post(shopWebhook, '/api/webhook', event(shopSession('cs_shop_nocode')), { 'stripe-signature': 'good' });
  ok(!('repeatWelcomeCode' in (docs.get('order.cs_shop_nocode') || {})), 'a repeat buyer with no code: no flag');
}
{
  reset();
  fetchImpl = async (q) => { if (q.includes('lower(customerEmail)')) throw new Error('stub: Sanity down'); return null; };
  promos.set('promo_pix10', { id: 'promo_pix10', code: 'PIX10', restrictions: { first_time_transaction: true }, metadata: {} });
  const res = await post(shopWebhook, '/api/webhook', event(shopSession('cs_shop_lookupdown', { discount: 100, promo: 'promo_pix10' })), { 'stripe-signature': 'good' });
  ok(res.status === 200 && docs.has('order.cs_shop_lookupdown'), 'a failed lookup never fails the order');
}

say(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
