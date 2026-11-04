// Every email Pixel8 can send, rendered with full sample data (no blank fields).
// Used by tests/email-contrast.test.mjs, and by the email-preview script.
//
// Stripe, Sanity, Resend and Netlify Blobs are stubbed through globalThis.__mocks:
// nothing leaves the machine. The two shop emails are inline in webhook.mjs, so
// they are captured by running the real handler against those stubs:
//   plain — a simple paid order, no discount, nothing to warn about;
//   full  — Groupon + PIX10 (repeat buyer) + a self-referred PIX- friend code,
//           a personalised line (proof note) and missing print files, so the
//           team alert carries every warning block.
import { registerHooks } from 'node:module';

const STUBS = {
  stripe: 'export default class Stripe { constructor() { return new Proxy({}, { get: (_, k) => globalThis.__mocks?.stripe?.[k] }); } }',
  '@sanity/client': 'export const createClient = () => new Proxy({}, { get: (_, k) => globalThis.__mocks?.sanity?.[k] });',
  resend: 'export class Resend { constructor() { this.emails = { send: (...a) => globalThis.__mocks.resend(...a) }; } }',
  '@netlify/blobs': 'export const getStore = () => globalThis.__mocks?.store;',
};

const sent = [];
const sessions = new Map();
const promos = new Map();
const state = { mode: 'plain' };
const patchBuilder = () => { const b = { set() { return b; }, setIfMissing() { return b; }, append() { return b; }, unset() { return b; }, ifRevisionId() { return b; }, async commit() { return {}; } }; return b; };
const mocks = {
  resend: async (p) => { sent.push(p); return { data: { id: `r${sent.length}` }, error: null }; },
  stripe: {
    checkout: { sessions: { retrieve: async (id) => sessions.get(id), listLineItems: async (id) => ({ data: sessions.get(id)?.lines || [] }) } },
    promotionCodes: { retrieve: async (id) => promos.get(id), update: async () => ({}), create: async (p) => ({ id: 'promo_new', ...p }) },
    coupons: { retrieve: async () => { const e = new Error('no coupon'); e.statusCode = 404; throw e; }, create: async (c) => ({ id: 'coupon_new', ...c }) },
    customers: { list: async () => ({ data: [] }), create: async (c) => ({ id: 'cus_1', ...c }) },
    webhooks: { constructEvent: (body) => JSON.parse(body) },
  },
  sanity: {
    fetch: async (query) => {
      if (state.mode === 'full' && /lower\(customerEmail\) == \$email/.test(query)) return { _id: 'order.cs_live_earlier1', createdAt: '2026-09-12T10:00:00Z' };
      if (/pendingPersonalisation|\$id\]\[0\]\{ status/.test(query)) return { status: 'ready' };
      return null;
    },
    create: async (doc) => doc,
    createIfNotExists: async (doc) => doc,
    patch: () => patchBuilder(),
  },
  // Print masters: present for the plain order, absent for the full one.
  store: new Proxy({}, { get: (_, k) => (k === 'getMetadata' ? async () => (state.mode === 'full' ? null : { etag: 'e1', metadata: { sha256: 'a'.repeat(64) } }) : async () => null) }),
};

let installed = false;
export function installStubs() {
  globalThis.__mocks = mocks;
  if (installed) return;
  installed = true;
  registerHooks({
    resolve(spec, ctx, next) { return spec in STUBS ? { url: `file:///__mock__/${encodeURIComponent(spec)}.mjs`, shortCircuit: true } : next(spec, ctx); },
    load(url, ctx, next) { const m = /^file:\/\/\/__mock__\/(.+)\.mjs$/.exec(url); return m ? { format: 'module', source: STUBS[decodeURIComponent(m[1])], shortCircuit: true } : next(url, ctx); },
  });
}

const fn = (p) => new URL(`../../netlify/functions/${p}`, import.meta.url).href;

/* ------------------------------------------------------------------ shop (webhook.mjs) */

const shopLine = (title, slug, extra = {}) => ({
  quantity: 1, description: title,
  price: { unit_amount: 999, product: { metadata: { productId: `product-${slug}`, slug, title, format: 'poster', size: 'small', formatKey: 'poster', sizeKey: 'small', ...extra } } },
});

async function runShopWebhook(mode) {
  state.mode = mode;
  const full = mode === 'full';
  const id = `cs_test_${mode}AbCdEfGh`;
  const lines = full
    ? [shopLine('Hulk — Option C', 'hulk-style-c'), shopLine('Your Photo — Pop Art', 'your-photo', { personalisationId: 'pid-ada-1', styleKey: 'pop-art' })]
    : [shopLine('Hulk — Option C', 'hulk-style-c')];
  const discountPence = full ? 300 : 0;
  const shippingPence = 495;
  const goods = lines.length * 999;
  const session = {
    id, payment_intent: `pi_3Q${mode}Xyz123`, payment_status: 'paid', livemode: true, metadata: { source: 'shop' },
    amount_total: goods - discountPence + shippingPence, shipping_cost: { amount_total: shippingPence },
    total_details: { amount_discount: discountPence, amount_shipping: shippingPence, amount_tax: 0 },
    customer_details: { email: 'ada@example.com', name: 'Ada Lovelace' },
    shipping_details: { name: 'Ada Lovelace', address: { line1: '1 Test Street', line2: 'Flat 2', city: 'Leeds', state: 'West Yorkshire', postal_code: 'LS1 1AA', country: 'GB' } },
  };
  if (full) {
    promos.set('promo_grpn', { id: 'promo_grpn', code: 'GRPN-7Q2X', metadata: { source: 'groupon' } });
    promos.set('promo_pix10', { id: 'promo_pix10', code: 'PIX10', metadata: {}, restrictions: { first_time_transaction: true } });
    promos.set('promo_friend', { id: 'promo_friend', code: 'PIX-ADA123', metadata: { kind: 'p8-referral', referrer_email: 'ada@example.com', referrer_order: 'P8-Earlier1' } });
  }
  const breakdown = { discounts: full ? ['promo_grpn', 'promo_pix10', 'promo_friend'].map((p) => ({ amount: 100, discount: { promotion_code: p } })) : [] };
  sessions.set(id, { ...session, lines, total_details: { ...session.total_details, breakdown } });

  const { default: webhook } = await import(fn('webhook.mjs'));
  const from = sent.length;
  const quiet = ['log', 'warn', 'error', 'info'].map((k) => [k, console[k]]);
  const realFetch = globalThis.fetch;
  for (const [k] of quiet) console[k] = () => {};
  globalThis.fetch = async () => new Response('{}', { status: 200 });
  let res;
  try {
    res = await webhook(new Request('https://test.local/api/webhook', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': 'stub' },
      body: JSON.stringify({ id: `evt_${mode}`, type: 'checkout.session.completed', data: { object: session } }),
    }), {});
  } finally {
    for (const [k, f] of quiet) console[k] = f;
    globalThis.fetch = realFetch;
  }
  if (res.status !== 200) throw new Error(`webhook (${mode}) answered ${res.status}: ${await res.text()}`);
  const mine = sent.slice(from);
  const confirmation = mine.find((m) => /Order Confirmed/.test(m.subject || ''));
  const team = mine.find((m) => (m.html || '').includes('NEW ORDER RECEIVED'));
  if (!confirmation || !team) throw new Error(`webhook (${mode}): shop emails not captured (${mine.length} sends)`);
  return { confirmation, team };
}

/* ------------------------------------------------------------------ fixtures */

const order = {
  _id: 'order.cs_live_xxxxxxxxAbCdEfGh', _type: 'order', orderNumber: 'P8-AbCdEfGh', customerName: 'Ada Lovelace', customerEmail: 'ada@example.com',
  lineItems: [
    { _key: 'a', productTitle: 'Hulk — Option C', format: 'Poster', size: 'Small (12×12")', quantity: 1, unitPrice: 9.99 },
    { _key: 'b', productTitle: 'Iron Man — Option A', format: 'Canvas', size: 'Medium (16×16")', quantity: 2, unitPrice: 29.99 },
  ],
  shipmentResult: { parcels: [
    { parcelRef: 'P1', carrier: 'royal_mail', trackingNumber: 'RM123456785GB', trackingUrl: 'https://track.example/RM123456785GB' },
    { parcelRef: 'P2', carrier: 'evri', trackingNumber: 'H01AAA123456789', trackingUrl: 'https://track.example/H01AAA123456789' },
  ] },
};
const commission = {
  _id: 'commission.c1', _type: 'commission', orderRef: 'PX-AB12CD34', customerName: 'Grace Hopper', customerEmail: 'grace@example.com',
  serviceTitle: 'Cartoonify Me', trackingNumber: 'RM987654321GB', carrier: 'royalmail',
};
const who = {
  ref: 'P8-AbCdEfGh', id: order._id, type: 'order', name: 'Ada Lovelace', email: 'ada@example.com',
  address: { line1: '1 Test Street', city: 'Leeds', postcode: 'LS1 1AA', country: 'GB' },
};
const parcel = { parcelRef: 'P1', band: 'small', carrier: 'royal_mail', option: 'Tracked 48', quotedPrice: 3.2, trackingNumber: 'RM123456785GB', labelId: 'L1' };
const parcel2 = { parcelRef: 'P2', band: 'large', carrier: 'evri', option: 'Next Day', quotedPrice: 5.4, trackingNumber: 'H01AAA123456789', labelId: 'L2' };
const event = {
  status: 'exception', statusCode: 80, carrierStatus: 'Parcel lost in network', trackingNumber: 'RM123456785GB',
  trackingUrl: 'https://track.example/RM123456785GB', at: '2026-11-04T10:00:00Z',
};
const ret = {
  _id: 'returnRequest.r1', returnNumber: 'P8-AbCdEfGh-R1', orderNumber: 'P8-AbCdEfGh', orderId: order._id,
  customerName: 'Ada Lovelace', customerEmail: 'ada@example.com', carrier: 'evri', trackingNumber: 'H01RTN123456789',
  reason: 'changed_mind', reasonLabel: 'Changed my mind', customerNotes: 'The colours are lovely but it is too big for the wall.',
  deliveredAt: '2026-10-29T10:00:00Z', windowEndsOn: '12 November 2026', quotedPostage: 3.5, postageDeduction: 3.5,
  rejectionReason: 'This print was personalised with your own photo, so it was made to order and cannot be returned unless it arrived faulty or damaged.',
  lines: [{ productTitle: 'Hulk — Option C', format: 'Poster', size: 'Small (12×12")', quantity: 1, unitPrice: 9.99 }],
};
const commissionBase = { customerName: 'Grace Hopper', serviceTitle: 'Cartoonify Me', orderRef: 'PX-AB12CD34', total: 44.1 };
const discount = { label: 'Discount (PIX10)', amount: 4.9 };

/**
 * @returns {Promise<Array<{ group: 'Customer'|'Team', title: string, mail: { html: string, subject?: string, to?: string[] } }>>}
 */
export async function renderAllEmails() {
  installStubs();
  const { buildOrderDispatchEmail, buildCommissionDispatchEmail } = await import(fn('_shared/dispatch-email.mjs'));
  const { rewardEmail } = await import(fn('_shared/referral-reward.mjs'));
  const se = await import(fn('_shared/shipping-emails.mjs'));
  const { proofEmailHtml, proofDetailsHtml } = await import(fn('_shared/proof-email.mjs'));
  const { confirmationEmail } = await import(fn('_shared/newsletter-email.mjs'));
  const { COPY: newsletterCopy, brand: newsletterBrand } = await import(fn('newsletter.mts'));
  const { buildDeliveryEmailHtml } = await import(fn('_shared/commission-delivery.mts'));
  const { customerEmailHtml, teamEmailHtml } = await import(fn('stripe-webhook-commission.mts'));
  const { buildTeamEmail, buildAckEmail } = await import(fn('contact.mts'));
  const { GROUPON_MISUSE } = await import(fn('_shared/discount.mjs'));

  const plain = await runShopWebhook('plain');
  const full = await runShopWebhook('full');
  const html = (h, subject) => ({ html: h, ...(subject ? { subject } : {}) });

  return [
    // ---- customer
    { group: 'Customer', title: 'Shop order confirmation', mail: plain.confirmation },
    { group: 'Customer', title: 'Shop order confirmation (discount, personalised item)', mail: full.confirmation },
    { group: 'Customer', title: 'Personalisation proof', mail: html(proofEmailHtml({
      approveUrl: 'https://pixel8multimedia.co.uk/api/personalisation/approve?pid=pid-ada-1&token=t0k3n',
      details: proofDetailsHtml([['Style', 'Option C — Pop Art'], ['Format', 'Poster Print'], ['Size', 'Small (12×12")']]),
    }), 'Your Pixel8 proof — one click to approve') },
    { group: 'Customer', title: 'Dispatch (shop order)', mail: buildOrderDispatchEmail(order) },
    { group: 'Customer', title: 'Dispatch (commission)', mail: buildCommissionDispatchEmail(commission) },
    { group: 'Customer', title: 'Referral reward', mail: rewardEmail('THANKS-ABC123') },
    { group: 'Customer', title: 'Return label', mail: se.returnLabelEmail(ret, { pdf: Buffer.from('%PDF'), instructions: 'Print the label, stick it on the parcel and drop it off at any Evri ParcelShop.', postage: 3.5 }) },
    { group: 'Customer', title: 'Return declined', mail: se.returnDeclinedEmail(ret) },
    { group: 'Customer', title: 'Commission confirmation', mail: html(customerEmailHtml({
      ...commissionBase, deliveryType: 'both', hasShipping: true, discount,
      digitalConsent: 'You asked us to start straight away and agreed that you lose the right to cancel once the digital file is delivered.',
    }), 'Order confirmed — PX-AB12CD34') },
    { group: 'Customer', title: 'Commission digital delivery', mail: html(buildDeliveryEmailHtml('Grace Hopper', 'Cartoonify Me', 'PX-AB12CD34', [
      { url: 'https://pixel8multimedia.co.uk/api/commission-download?id=c1&f=0', filename: 'cartoonify-me.png' },
      { url: 'https://pixel8multimedia.co.uk/api/commission-download?id=c1&f=1', filename: 'cartoonify-me-print.pdf' },
    ]), 'Your Cartoonify Me is ready! — PX-AB12CD34') },
    { group: 'Customer', title: 'Contact form acknowledgement', mail: html(buildAckEmail({ name: 'Ada', refCode: 'P8C-7KQ2' }), 'Thanks for your message — Pixel8 Multimedia') },
    { group: 'Customer', title: 'Newsletter confirmation', mail: confirmationEmail({
      brand: newsletterBrand(), copy: newsletterCopy,
      confirmUrl: 'https://pixel8multimedia.co.uk/newsletter/confirm/?t=abc123',
    }) },
    // ---- team
    { group: 'Team', title: 'Shop new-order alert', mail: plain.team },
    { group: 'Team', title: 'Shop new-order alert (every warning block)', mail: full.team },
    { group: 'Team', title: 'Commission team notification', mail: html(teamEmailHtml({
      ...commissionBase, deliveryType: 'both', customerEmail: 'grace@example.com', customerPhone: '07700 900123', commissionId: 'commission.c1',
      shippingAddress: 'Grace Hopper\n2 Sample Road\nYork\nYO1 7AA\nGB', discount,
      warning: GROUPON_MISUSE, referralNote: 'Friend code PIX-GRACE1 used by an existing customer (earlier order P8-Earlier1) — no reward issued (repeat customer).',
    }), 'NEW PAID COMMISSION — Cartoonify Me') },
    { group: 'Team', title: 'Commission team notification (digital only)', mail: html(teamEmailHtml({
      ...commissionBase, deliveryType: 'digital', customerEmail: 'grace@example.com', commissionId: 'commission.c1',
    })) },
    { group: 'Team', title: 'Contact form (team)', mail: html(buildTeamEmail({ name: 'Ada Lovelace', email: 'ada@example.com', subject: 'general', message: 'Hi there,\nDo you ship canvases to Ireland?\nThanks, Ada', refCode: 'P8C-7KQ2' }), '[P8C-7KQ2] General enquiry — Ada Lovelace') },
    { group: 'Team', title: 'Label ready', mail: se.labelReadyEmail(who, [parcel, parcel2]) },
    { group: 'Team', title: 'Shipment problem', mail: se.shipmentProblemEmail(who, 'No parcel band fits "Iron Man — Option A" (Canvas, Medium).') },
    { group: 'Team', title: 'Parcel alert', mail: se.parcelAlertEmail(who, parcel, event, 'exception') },
    { group: 'Team', title: 'New return', mail: se.newReturnEmail(ret) },
    { group: 'Team', title: 'New return (delivery date unknown)', mail: se.newReturnEmail({ ...ret, deliveryDateUnknown: true, deliveredAt: null, windowEndsOn: null }) },
    { group: 'Team', title: 'Return problem', mail: se.returnProblemEmail(ret, 'Carrier refused the parcel size for the Evri return service.') },
    { group: 'Team', title: 'Return alert', mail: se.returnAlertEmail(ret, event, 'exception') },
    { group: 'Team', title: 'Return ready', mail: se.returnReadyEmail(ret, event) },
  ];
}
