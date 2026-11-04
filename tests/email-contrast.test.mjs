// Readable Pixel8 emails (fix/pixel8-email-contrast, 4 Nov 2026).
//  1. The shop order table and ship-to block appear in the dark customer
//     confirmation AND the white team alert; each has its own palette, and every
//     text colour in each clears WCAG AA (4.5:1) on its background.
//  2. The customer card's small print is #6b7280 (not the pale #9ca3af), and the
//     "POP. ART. MOTION." line is gone: the logo already carries it.
// Stripe, Sanity and Resend are stubbed: nothing is sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

const STUBS = {
  stripe: 'export default class Stripe { constructor() {} }',
  '@sanity/client': 'export function createClient() { return {}; }',
  resend: 'export class Resend { constructor() { this.emails = { send: async () => ({ data: {}, error: null }) }; } }',
};
registerHooks({
  resolve(spec, ctx, next) { return spec in STUBS ? { url: `stub:${spec}`, shortCircuit: true } : next(spec, ctx); },
  load(url, ctx, next) { return url.startsWith('stub:') ? { format: 'module', source: STUBS[url.slice(5)], shortCircuit: true } : next(url, ctx); },
});

const se = await import('../netlify/functions/_shared/shipping-emails.mjs');
const { buildOrderDispatchEmail, buildCommissionDispatchEmail } = await import('../netlify/functions/_shared/dispatch-email.mjs');
const { rewardEmail } = await import('../netlify/functions/_shared/referral-reward.mjs');
const { buildDeliveryEmailHtml } = await import('../netlify/functions/_shared/commission-delivery.mts');
const { customerEmailHtml, teamEmailHtml } = await import('../netlify/functions/stripe-webhook-commission.mts');

const hex = (h) => { const x = h.replace('#', ''); const f = x.length === 3 ? x.split('').map((c) => c + c).join('') : x; return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)); };
const lum = (h) => { const [r, g, b] = hex(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/* ------------------------------------------------------------------ 1. webhook.mjs */

const src = readFileSync(new URL('../netlify/functions/webhook.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const palette = (name) => {
  const m = src.match(new RegExp(`const ${name} = \\{([\\s\\S]*?)\\};`));
  assert.ok(m, `${name} defined`);
  return Object.fromEntries([...m[1].matchAll(/(\w+): '(#[0-9A-Fa-f]{3,6})'/g)].map((x) => [x[1], x[2]]));
};

test('team alert (white): every order-table and ship-to colour is readable', () => {
  const t = palette('TABLE_LIGHT');
  for (const k of ['title', 'muted', 'price', 'discount', 'label']) assert.ok(contrast(t[k], '#FFFFFF') >= 4.5, `${k} ${t[k]} on white: ${contrast(t[k], '#FFFFFF').toFixed(2)}`);
  assert.ok(contrast(t.headText, t.head) >= 4.5, 'header row');
  for (const k of ['boxStrong', 'boxText']) assert.ok(contrast(t[k], t.boxBg) >= 4.5, `${k} on the ship-to box`);
});

test('customer confirmation (dark #0D0D0D): every order-table and ship-to colour is readable', () => {
  const t = palette('TABLE_DARK');
  for (const k of ['title', 'muted', 'price', 'discount', 'label']) assert.ok(contrast(t[k], '#0D0D0D') >= 4.5, `${k} ${t[k]} on #0D0D0D`);
  assert.ok(contrast(t.headText, t.head) >= 4.5, 'header row');
  for (const k of ['boxStrong', 'boxText']) assert.ok(contrast(t[k], t.boxBg) >= 4.5, `${k} on the ship-to box`);
});

test('each email uses its own palette, and the rest of the team alert is dark on light', () => {
  const confirm = src.slice(src.indexOf('subject: `Order Confirmed'), src.indexOf('Customer confirmation email sent'));
  assert.ok(confirm.includes('${orderTable(TABLE_DARK)}') && confirm.includes('${shippingBlock(TABLE_DARK)}'));
  const team = src.slice(src.indexOf("const teamEmail = setting('TEAM_EMAIL')"), src.indexOf('Team notification sent'));
  assert.ok(team.includes('${orderTable(TABLE_LIGHT)}') && team.includes('${shippingBlock(TABLE_LIGHT)}'));
  assert.doesNotMatch(team, /color: #(F5F5F0|999|E91E7B)\b/i, 'no near-white, pale grey or light-pink text in the team alert');
});

/* ------------------------------------------------------------------ 2. customer card */

const ret = {
  _id: 'returnRequest.r1', returnNumber: 'P8-AbCdEfGh-R1', orderNumber: 'P8-AbCdEfGh', customerName: 'Ada', customerEmail: 'ada@example.com',
  carrier: 'evri', rejectionReason: 'Personalised items cannot be returned unless faulty.',
  lines: [{ productTitle: 'Hulk', format: 'Poster', size: 'Small', quantity: 1, unitPrice: 9.99 }],
};
const order = { _id: 'order.x', orderNumber: 'P8-AbCdEfGh', customerName: 'Ada', lineItems: [{ productTitle: 'Hulk', format: 'Poster', size: 'Small', quantity: 1 }] };
const base = { customerName: 'Grace', serviceTitle: 'Cartoonify Me', orderRef: 'PX-AB12CD34', total: 49, deliveryType: 'both' };

test('return declined: reference shown in readable grey, reason and order filled in', () => {
  const { html } = se.returnDeclinedEmail(ret);
  assert.match(html, /<p style="color: #6b7280;[^"]*">Return reference: P8-AbCdEfGh-R1<\/p>/);
  assert.ok(html.includes('P8-AbCdEfGh</strong>') && html.includes('Personalised items cannot be returned'));
  assert.ok(contrast('#6b7280', '#ffffff') >= 4.5 && contrast('#6b7280', '#f9fafb') >= 4.5);
});

test('no Pixel8 email repeats the tagline under the logo or uses the pale #9ca3af', () => {
  const emails = {
    returnDeclined: se.returnDeclinedEmail(ret).html,
    returnLabel: se.returnLabelEmail(ret, { pdf: Buffer.from('%PDF'), instructions: 'Drop it off', postage: 3.5 }).html,
    dispatchOrder: buildOrderDispatchEmail(order).html,
    dispatchCommission: buildCommissionDispatchEmail({ _id: 'c1', orderRef: 'PX-AB12CD34', customerName: 'Grace', serviceTitle: 'Cartoonify Me', trackingNumber: 'RM2', carrier: 'royalmail' }).html,
    referral: rewardEmail('THANKS-ABC123').html,
    delivery: buildDeliveryEmailHtml('Grace', 'Cartoonify Me', 'PX-AB12CD34', [{ url: 'https://x/dl', filename: 'art.png' }]),
    commissionCustomer: customerEmailHtml({ ...base, hasShipping: true }),
    commissionTeam: teamEmailHtml({ ...base, customerEmail: 'grace@example.com', commissionId: 'c1' }),
  };
  for (const [name, html] of Object.entries(emails)) {
    assert.ok(!html.includes('POP. ART. MOTION.'), `${name}: tagline still under the logo`);
    assert.ok(!/#9ca3af/i.test(html), `${name}: pale #9ca3af text`);
    assert.ok(html.includes('email-logo-400.png'), `${name}: logo present`);
  }
});
