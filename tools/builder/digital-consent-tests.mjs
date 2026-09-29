/**
 * Commissions that include digital files: consent to immediate supply + acknowledgement
 * that it ends the right to cancel (CCRs 2013 reg. 37).
 *
 *   node tools/builder/digital-consent-tests.mjs
 *
 * The REAL commission-checkout and stripe-webhook-commission handlers, with
 * Stripe, Sanity, Resend and Blobs replaced by fakes: an order that includes
 * digital files (alone or with prints) is refused without the consent,
 * recorded with it, and the confirmation email states it; a print-only order
 * doesn't ask. Nothing touches the network.
 */
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (c, l, e = '') => {
  if (c) { pass++; console.log(`  PASS  ${l}${e !== '' ? ' — ' + e : ''}`); }
  else { fail++; console.log(`  FAIL  ${l}${e !== '' ? ' — ' + e : ''}`); }
};
const say = console.log.bind(console);

const M = (globalThis.__mocks = {});
const MOCK_SRC = {
  stripe: 'export default class Stripe { constructor() { return globalThis.__mocks.stripe; } }',
  '@sanity/client': 'export const createClient = () => new Proxy({}, { get: (_, k) => globalThis.__mocks.sanity[k] });',
  resend: 'export class Resend { constructor() { this.emails = { send: (...a) => globalThis.__mocks.resend(...a) }; } }',
  '@netlify/blobs': 'export const getStore = () => ({ getMetadata: async () => ({ metadata: { contentType: "image/jpeg", bytes: 1000 } }) });',
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
Object.assign(process.env, { STRIPE_SECRET_KEY: 'sk_test_x', SANITY_TOKEN: 'x', RESEND_API_KEY: 're_x', STRIPE_COMMISSION_WEBHOOK_SECRET: 'whsec_x', URL: 'https://pixel8multimedia.co.uk' });
delete process.env.TURNSTILE_SECRET_KEY; // bot check skipped (tested elsewhere)

const created = [];
const sessions = [];
const emails = [];
let commission = null;
M.stripe = {
  checkout: { sessions: { create: async (p) => { sessions.push(p); return { id: 'cs_test_1', url: 'https://checkout.stripe.test/1' }; }, retrieve: async () => ({}) } },
  webhooks: { constructEvent: (body) => JSON.parse(body) },
};
M.sanity = {
  fetch: async (q) => {
    if (q.includes('_type == "service"')) {
      return { _id: 'svc-cartoonify', title: 'Cartoonify Me', digitalPrice: 14.99, styleOptions: [{ key: 'a', label: 'A' }], artworkFee: 5, commissionEnabled: true, printUpcharges: { poster: { small: 20, medium: 25, large: 30 } } };
    }
    if (q.includes('_type == "commission"') && q.includes('legacyId')) return commission;
    return null;
  },
  create: async (doc) => { created.push(doc); return { ...doc }; },
  patch: () => { const c = { set: () => c, setIfMissing: () => c, unset: () => c, commit: async () => ({}) }; return c; },
};
M.resend = async (msg) => { emails.push(msg); return { data: { id: 'e' }, error: null }; };

const { DIGITAL_CONSENT_LABEL, DIGITAL_CONSENT_CONFIRMATION, DIGITAL_CONSENT_VERSION, needsDigitalConsent } =
  await import('../../netlify/functions/_shared/digital-consent.mjs');
const checkout = (await import('../../netlify/functions/commission-checkout.mts')).default;
const webhook = (await import('../../netlify/functions/stripe-webhook-commission.mts')).default;
const quiet = async (fn) => { const o = [console.log, console.error, console.warn]; console.log = console.error = console.warn = () => {}; try { return await fn(); } finally { [console.log, console.error, console.warn] = o; } };
const order = (extra) => checkout(new Request('https://pixel8multimedia.co.uk/.netlify/functions/commission-checkout', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ serviceSlug: 'cartoonify-me', orderType: 'digital', name: 'Test Customer', email: 'customer@example.com', prints: [],
    uploadedAssets: [{ fieldKey: 'sourcePhotos', uploadKey: 'commission-upload/11111111-2222-3333-4444-555555555555/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg' }], ...extra }),
}));

say('\n1. CHECKOUT\n');
{
  const r = await quiet(() => order({}));
  const b = await r.json();
  ok(r.status === 400 && b.digitalConsent === true && created.length === 0 && sessions.length === 0, 'digital-only order without the consent → 400, nothing created, no Stripe session', b.error);
  const f = await quiet(() => order({ digitalSupplyConsent: 'yes' }));
  ok(f.status === 400 && created.length === 0, 'anything but true (e.g. "yes") is not consent');
  const g = await quiet(() => order({ digitalSupplyConsent: true, digitalConsentVersion: DIGITAL_CONSENT_VERSION }));
  const doc = created.at(-1);
  ok(g.status === 200 && sessions.length === 1 && doc?.deliveryType === 'digital', 'with the consent → order created, Stripe session made');
  ok(doc?.digitalSupplyConsent?.wording === DIGITAL_CONSENT_LABEL && doc.digitalSupplyConsent.version === DIGITAL_CONSENT_VERSION && Date.parse(doc.digitalSupplyConsent.consentedAt) > 0,
    'the commission records what was agreed: wording, version, time');
  ok(!needsDigitalConsent('print') && needsDigitalConsent('both') && needsDigitalConsent('digital'), 'every order with digital files needs it (digital and both); print-only does not');
  // Digital files + a print (bundle → deliveryType 'both'): same rule.
  const print = [{ styleKey: 'a', format: 'poster', size: 'small' }];
  const nb = created.length;
  const b0 = await quiet(() => order({ orderType: 'bundle', prints: print }));
  ok(b0.status === 400 && (await b0.json()).digitalConsent === true && created.length === nb, 'digital files + a print, without the consent → 400, nothing created');
  const b1 = await quiet(() => order({ orderType: 'bundle', prints: print, digitalSupplyConsent: true }));
  const bdoc = created.at(-1);
  ok(b1.status === 200 && bdoc.deliveryType === 'both' && bdoc.digitalSupplyConsent?.wording === DIGITAL_CONSENT_LABEL, 'with it → created (deliveryType both), consent recorded');
  const p0 = await quiet(() => order({ orderType: 'singlePrint', prints: print }));
  const pdoc = created.at(-1);
  ok(p0.status === 200 && pdoc.deliveryType === 'print' && !('digitalSupplyConsent' in pdoc), 'a print-only order needs no consent and records none');
  commission = { _id: doc._id, status: 'pending', orderRef: doc.orderRef, customerName: 'Test Customer', customerEmail: 'customer@example.com', amount: 14.99, deliveryType: 'digital', digitalSupplyConsent: doc.digitalSupplyConsent, serviceTitle: 'Cartoonify Me' };
}

say('\n2. CONFIRMATION EMAIL\n');
{
  const evt = (c) => JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_1', payment_status: 'paid', amount_total: 1499, metadata: { commissionId: c._id }, customer_details: {} } } });
  await quiet(() => webhook(new Request('https://x/.netlify/functions/stripe-webhook-commission', { method: 'POST', headers: { 'stripe-signature': 't=1,v1=x' }, body: evt(commission) }), {}));
  const mail = emails.find((e) => e.to === 'customer@example.com');
  ok(mail && mail.html.includes(DIGITAL_CONSENT_CONFIRMATION) && /Your right to cancel:/.test(mail.html), 'digital-only: the confirmation email states the consent and acknowledgement', mail?.subject);
  emails.length = 0;
  commission = { ...commission, deliveryType: 'both' };
  await quiet(() => webhook(new Request('https://x/.netlify/functions/stripe-webhook-commission', { method: 'POST', headers: { 'stripe-signature': 't=1,v1=x' }, body: evt(commission) }), {}));
  const both = emails.find((e) => e.to === 'customer@example.com');
  ok(both && both.html.includes(DIGITAL_CONSENT_CONFIRMATION), 'digital files + prints: the email states it too');
  emails.length = 0;
  commission = { ...commission, deliveryType: 'print', digitalSupplyConsent: undefined };
  await quiet(() => webhook(new Request('https://x/.netlify/functions/stripe-webhook-commission', { method: 'POST', headers: { 'stripe-signature': 't=1,v1=x' }, body: evt(commission) }), {}));
  const print = emails.find((e) => e.to === 'customer@example.com');
  ok(print && !print.html.includes('Your right to cancel:'), 'print-only: no such statement');
}

say('\n3. THE FORM\n');
{
  const src = readFileSync(new URL('../../src/components/CommissionWorkflow.jsx', import.meta.url), 'utf8');
  ok(/const includesDigital = orderType !== 'singlePrint';/.test(src) && /\{DIGITAL_CONSENT_LABEL\}/.test(src) && /digitalSupplyConsent: digitalConsent === true/.test(src),
    'the form shows the same wording as a required checkbox whenever the order includes digital files, and sends it');
  ok(/if \(includesDigital && !digitalConsent\)/.test(src), 'and won\'t submit such an order until it is ticked');
  const terms = readFileSync(new URL('../../src/pages/terms-and-conditions.astro', import.meta.url), 'utf8');
  ok(/Commissions that include digital files/.test(terms) && /on their own or with prints/.test(terms) && /lose your right to cancel once they have been supplied/.test(terms), 'the terms describe it before payment');
  ok(!/faster delivery/.test(terms), 'the terms no longer mention faster delivery (checkout has no such option)');
}

say(`\n${pass} passed, ${fail} failed.`);
process.exitCode = fail ? 1 : 0;
