// The commission review total matches what Stripe charges: P&P and the Groupon
// voucher come from one rule (netlify/functions/_shared/commission-totals.mjs).
//
//   npm test
//
// The handler tests run the real commission-checkout with Stripe, Sanity and
// Netlify Blobs stubbed: no network, nothing written, no Stripe session made.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';

/* ---------- stubs (installed before the handler is imported) ---------- */
globalThis.__p8 = { sessions: [], coupons: [], service: null, voucher: null };
const STUBS = {
  stripe: `
    export default class Stripe {
      constructor() {
        const t = globalThis.__p8;
        this.customers = {
          list: async () => ({ data: [] }),
          create: async () => ({ id: 'cus_test' }),
        };
        this.checkout = { sessions: {
          create: async (params) => { t.sessions.push(params); return { id: 'cs_test_' + t.sessions.length, url: 'https://checkout.stripe.test/s' }; },
          retrieve: async () => ({ status: 'expired' }),
        } };
        this.coupons = {
          create: async (c) => { t.coupons.push(c); return { id: 'coupon_test', ...c }; },
          retrieve: async (id) => ({ id }),
          del: async () => ({}),
        };
        this.promotionCodes = { update: async () => ({}) };
      }
    }`,
  '@sanity/client': `
    export function createClient() {
      const t = globalThis.__p8;
      const patch = () => { const b = { set: () => b, setIfMissing: () => b, unset: () => b, append: () => b, ifRevisionId: () => b, commit: async () => ({}) }; return b; };
      return {
        fetch: async (q) => (q.includes('_type == "service"') ? t.service : q.includes('claimTokenHash') ? t.voucher : null),
        create: async (d) => ({ ...d, _id: d._id || 'commission-test' }),
        patch,
      };
    }`,
  '@netlify/blobs': `export const getStore = () => new Proxy({}, { get: () => async () => null });`,
};
registerHooks({
  resolve(spec, ctx, next) { return spec in STUBS ? { url: `stub:${spec}`, shortCircuit: true } : next(spec, ctx); },
  load(url, ctx, next) { return url.startsWith('stub:') ? { format: 'module', source: STUBS[url.slice(5)], shortCircuit: true } : next(url, ctx); },
});
globalThis.fetch = async () => new Response('{}', { status: 200 });   // GA4 / internal triggers only
process.env.STRIPE_SECRET_KEY = 'sk_test_stub';
delete process.env.TURNSTILE_SECRET_KEY;

const {
  commissionShipping, commissionReviewTotals, effectiveDiscountPence,
  FREE_SHIPPING_THRESHOLD_GBP, STANDARD_SHIPPING_PENCE,
} = await import('../netlify/functions/_shared/commission-totals.mjs');

/* ---------- the shared rule ---------- */

test('the rule: £4.95 under £50, free at £50 and over', () => {
  assert.equal(FREE_SHIPPING_THRESHOLD_GBP, 50);
  assert.equal(STANDARD_SHIPPING_PENCE, 495);
});

test('digital-only order: no P&P, total is the subtotal', () => {
  const t = commissionReviewTotals({ subtotalGbp: 14.99, hasPrints: false, baseTierGbp: 14.99 });
  assert.equal(t.shipping.applies, false);
  assert.equal(t.shipping.pence, 0);
  assert.equal(t.totalPence, 1499);
});

test('print under £50: + £4.95 (the audit case: £19.99 poster -> £24.94)', () => {
  const t = commissionReviewTotals({ subtotalGbp: 19.99, hasPrints: true });
  assert.deepEqual(t.shipping, { applies: true, free: false, pence: 495, label: 'UK Standard P&P (£4.95)' });
  assert.equal(t.totalPence, 2494);
  assert.equal(commissionReviewTotals({ subtotalGbp: 49.99, hasPrints: true }).totalPence, 5494);
});

test('print at or over £50: free P&P', () => {
  for (const gbp of [50, 50.01, 89.99]) {
    const t = commissionReviewTotals({ subtotalGbp: gbp, hasPrints: true });
    assert.equal(t.shipping.free, true, String(gbp));
    assert.equal(t.shipping.pence, 0);
    assert.equal(t.shipping.label, 'FREE UK P&P');
    assert.equal(t.totalPence, Math.round(gbp * 100));
  }
});

test('Groupon voucher: off the base tier only, never prints or P&P; free P&P judged before it', () => {
  // £14.99 digital + £24.99 print = £39.98 (< £50: P&P due); a £29.99 voucher takes £14.99
  let t = commissionReviewTotals({ subtotalGbp: 39.98, hasPrints: true, baseTierGbp: 14.99, voucherValuePence: 2999 });
  assert.equal(t.discountPence, 1499);
  assert.equal(t.totalPence, 3998 + 495 - 1499);
  // £29.99 digital + £24.99 print = £54.98 (free P&P, even though the voucher brings the charge under £50)
  t = commissionReviewTotals({ subtotalGbp: 54.98, hasPrints: true, baseTierGbp: 29.99, voucherValuePence: 2999 });
  assert.equal(t.shipping.free, true);
  assert.equal(t.totalPence, 5498 - 2999);
  // a print-only order has no base tier, so a voucher takes nothing off
  assert.equal(commissionReviewTotals({ subtotalGbp: 19.99, hasPrints: true, baseTierGbp: 0, voucherValuePence: 2999 }).discountPence, 0);
});

test('groupon.mts uses the same voucher rule', async () => {
  const groupon = await import('../netlify/functions/_shared/groupon.mts');
  assert.equal(groupon.effectiveDiscountPence, effectiveDiscountPence);
});

/* ---------- the real checkout charges what the review step shows ---------- */

const { default: handler } = await import('../netlify/functions/commission-checkout.mts');
const SERVICE = {
  _id: 'service-cartoonify-me', title: 'Cartoonify Me', slug: { current: 'cartoonify-me' },
  commissionEnabled: true, price: 14.99, digitalPrice: 14.99, artworkFee: 5, styleOptions: [],
  printUpcharges: { poster: { small: 14.99, medium: 19.99, large: 24.99 }, canvasStandard: { small: 29.99, medium: 39.99, large: 49.99 } },
};

async function checkout(extra) {
  const t = globalThis.__p8;
  t.sessions.length = 0;
  t.service = SERVICE;
  const res = await handler(new Request('http://localhost/api/commission-checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      serviceSlug: 'cartoonify-me', name: 'Test', email: 'p8-test@example.com', brief: 'test', digitalSupplyConsent: true,
      // Cartoonify needs a photo; an already-uploaded Sanity asset id stands in for one.
      uploadedAssets: [{ fieldKey: 'photo', assetId: 'image-test0001-1200x1200-jpg' }],
      ...extra,
    }),
  }), {});
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  const s = t.sessions[0];
  const goods = s.line_items.reduce((n, li) => n + li.price_data.unit_amount * li.quantity, 0);
  const ship = s.shipping_options ? s.shipping_options[0].shipping_rate_data.fixed_amount.amount : null;
  return { s, goods, ship };
}

test('checkout: digital-only sends no shipping, like the review step', async () => {
  const { s, goods, ship } = await checkout({ orderType: 'digital' });
  assert.equal(ship, null);
  assert.equal(s.shipping_address_collection, undefined);
  assert.equal(goods, commissionReviewTotals({ subtotalGbp: 14.99, hasPrints: false }).totalPence);
});

test('checkout: Single Print, Poster, Small = £19.99 + £4.95, the review total', async () => {
  const { s, goods, ship } = await checkout({ orderType: 'singlePrint', prints: [{ format: 'poster', size: 'small' }] });
  assert.equal(goods, 1999);
  assert.equal(ship, 495);
  assert.equal(s.shipping_options[0].shipping_rate_data.display_name, 'UK Standard P&P (£4.95)');
  assert.equal(goods + ship, commissionReviewTotals({ subtotalGbp: 19.99, hasPrints: true }).totalPence);
});

test('checkout: a print order of £50 or more ships free, like the review step', async () => {
  const { goods, ship, s } = await checkout({ orderType: 'singlePrint', prints: [{ format: 'canvas-standard', size: 'large' }] });
  assert.equal(goods, 5499);
  assert.equal(ship, 0);
  assert.equal(s.shipping_options[0].shipping_rate_data.display_name, 'FREE UK P&P');
  assert.equal(goods + ship, commissionReviewTotals({ subtotalGbp: 54.99, hasPrints: true }).totalPence);
});

test('checkout: a Groupon voucher comes off as the review step says', async () => {
  const token = 'test-claim-token';
  globalThis.__p8.voucher = {
    _id: 'grouponVoucher.test1', _rev: 'r1', code: 'TEST-0001', status: 'claimed', serviceSlug: 'cartoonify-me',
    valuePence: 2999, claimTokenHash: createHash('sha256').update(token).digest('hex'),
    claimExpiresAt: new Date(Date.now() + 3600e3).toISOString(), verificationStatus: 'verified',
  };
  globalThis.__p8.coupons.length = 0;
  const { s, goods, ship } = await checkout({
    orderType: 'bundle', prints: [{ format: 'poster', size: 'large' }], grouponClaimToken: token,
  });
  const coupon = globalThis.__p8.coupons[0];
  assert.ok(s.discounts && coupon, 'voucher coupon applied');
  const review = commissionReviewTotals({ subtotalGbp: goods / 100, hasPrints: true, baseTierGbp: 14.99, voucherValuePence: 2999 });
  assert.equal(coupon.amount_off, review.discountPence);
  assert.equal(ship, review.shipping.pence);
  assert.equal(goods + ship - coupon.amount_off, review.totalPence);
  globalThis.__p8.voucher = null;
});
