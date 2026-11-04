// Every Pixel8 email shows the same logo (fix/email-logos, 4 Nov 2026): the
// real 400x233 PNG at /email-logo-400.png, from one place (EMAIL_LOGO_URL in
// _shared/site-config.mjs, via _shared/email-logo.mjs). Not /Pixel8_Logo.png
// (a 1024px JPEG with a .png name), and nothing from another brand.
//
// Emails that are built by a pure function are rendered and checked; the shop
// order emails live inline in webhook.mjs, so that file is checked as source.
// Stripe, Sanity and Resend are stubbed: nothing is sent.
//
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
delete process.env.EMAIL_LOGO_URL;

const { emailLogoUrl, emailLogoImg } = await import('../netlify/functions/_shared/email-logo.mjs');
const { buildOrderDispatchEmail, buildCommissionDispatchEmail } = await import('../netlify/functions/_shared/dispatch-email.mjs');
const { rewardEmail } = await import('../netlify/functions/_shared/referral-reward.mjs');
const shippingEmails = await import('../netlify/functions/_shared/shipping-emails.mjs');
const { proofEmailHtml } = await import('../netlify/functions/_shared/proof-email.mjs');
const { confirmationEmail } = await import('../netlify/functions/_shared/newsletter-email.mjs');
const { buildDeliveryEmailHtml } = await import('../netlify/functions/_shared/commission-delivery.mts');
const { customerEmailHtml, teamEmailHtml } = await import('../netlify/functions/stripe-webhook-commission.mts');
const { buildTeamEmail, buildAckEmail } = await import('../netlify/functions/contact.mts');

const LOGO = 'https://pixel8multimedia.co.uk/email-logo-400.png';
const OTHER_BRANDS = /wyrmfuel|comicstripcanvas|comic strip canvas|thefuglys|labrats|catsoncrack|cats on crack|bikerbabies|biker babies|dottyandfriends|dotty & friends|dotty &amp; friends/i;

function assertPixel8Logo(name, html) {
  assert.ok(html.includes(`src="${LOGO}"`), `${name}: has the email logo`);
  assert.match(html, /<img src="https:\/\/pixel8multimedia\.co\.uk\/email-logo-400\.png" width="\d+" alt="Pixel8 Multimedia" style="[^"]*height:auto/, `${name}: sized, height auto, alt text`);
  assert.ok(!html.includes('Pixel8_Logo.png'), `${name}: not the old JPEG logo`);
  assert.doesNotMatch(html, OTHER_BRANDS, `${name}: no other brand`);
}

/* ------------------------------------------------------------------ fixtures */

const order = {
  _id: 'order.cs_live_xxxxxxxxAbCdEfGh', _type: 'order', orderNumber: 'P8-AbCdEfGh',
  customerName: 'Ada Lovelace', customerEmail: 'ada@example.com',
  lineItems: [{ _key: 'a', productTitle: 'Hulk', format: 'Poster', size: 'Small', quantity: 1, unitPrice: 9.99 }],
  shipmentResult: { parcels: [{ parcelRef: 'P1', carrier: 'royal_mail', trackingNumber: 'RM1', trackingUrl: 'https://track/x' }] },
};
const commission = { _id: 'c1', _type: 'commission', orderRef: 'PX-AB12CD34', customerName: 'Grace', serviceTitle: 'Cartoonify Me', trackingNumber: 'RM2', carrier: 'royalmail' };
const who = { ref: 'P8-AbCdEfGh', id: order._id, type: 'order', name: 'Ada', email: 'ada@example.com', address: { city: 'Leeds', postcode: 'LS1 1AA' } };
const parcel = { parcelRef: 'P1', band: 'small', carrier: 'royal_mail', option: 'Tracked 48', quotedPrice: 3.2, trackingNumber: 'RM1', labelId: 'L1' };
const event = { status: 'exception', statusCode: 80, carrierStatus: 'Lost', trackingNumber: 'RM1', trackingUrl: 'https://track/x', at: '2026-11-04T10:00:00Z' };
const ret = {
  _id: 'return.1', returnRef: 'R-1', orderRef: 'P8-AbCdEfGh', orderId: order._id, customerName: 'Ada', customerEmail: 'ada@example.com',
  carrier: 'evri', reason: 'damaged', lines: [{ productTitle: 'Hulk', format: 'Poster', size: 'Small', quantity: 1, unitPrice: 9.99 }],
};

/* ------------------------------------------------------------------ the source */

test('the logo URL lives in site-config (env override allowed) and the <img> is sized with height auto', () => {
  assert.equal(emailLogoUrl({}), LOGO);
  assert.equal(emailLogoUrl({ EMAIL_LOGO_URL: 'https://cdn.example/logo.png' }), 'https://cdn.example/logo.png');
  const img = emailLogoImg();
  assert.match(img, /width="180"/);
  assert.match(img, /width:180px;max-width:100%;height:auto/);
  assert.match(img, /alt="Pixel8 Multimedia"/);
  assert.match(emailLogoImg({ width: 200 }), /width="200"/);
});

/* ------------------------------------------------------------------ rendered emails */

test('customer emails: dispatch (order + commission), referral reward, return label, return declined', () => {
  assertPixel8Logo('dispatch (order)', buildOrderDispatchEmail(order).html);
  assertPixel8Logo('dispatch (commission)', buildCommissionDispatchEmail(commission).html);
  assertPixel8Logo('referral reward', rewardEmail('THANKS-ABC123').html);
  assertPixel8Logo('return label', shippingEmails.returnLabelEmail(ret, { pdf: Buffer.from('%PDF'), instructions: 'Drop it off', postage: 3.5 }).html);
  assertPixel8Logo('return declined', shippingEmails.returnDeclinedEmail(ret).html);
});

test('the 7 shipping and returns team emails have the logo at the top', () => {
  const emails = {
    labelReady: shippingEmails.labelReadyEmail(who, [parcel]),
    shipmentProblem: shippingEmails.shipmentProblemEmail(who, 'No band fits'),
    parcelAlert: shippingEmails.parcelAlertEmail(who, parcel, event, 'exception'),
    newReturn: shippingEmails.newReturnEmail(ret),
    returnProblem: shippingEmails.returnProblemEmail(ret, 'Carrier refused'),
    returnAlert: shippingEmails.returnAlertEmail(ret, event, 'exception'),
    returnReady: shippingEmails.returnReadyEmail(ret, event),
  };
  for (const [name, mail] of Object.entries(emails)) {
    assertPixel8Logo(name, mail.html);
    assert.ok(mail.html.indexOf(LOGO) < mail.html.indexOf('<h2'), `${name}: logo above the heading`);
  }
});

test('proof email: logo at the top, plain footer, no Metavision', () => {
  const html = proofEmailHtml({ approveUrl: 'https://pixel8multimedia.co.uk/api/personalisation/approve?pid=p&token=t', details: '<tr><td>Style</td><td>A</td></tr>' });
  assertPixel8Logo('proof', html);
  assert.ok(html.indexOf(LOGO) < html.indexOf('Your proof is ready'), 'logo above the heading');
  assert.ok(html.includes('Pixel8 Multimedia · Made in the UK'));
  assert.doesNotMatch(html, /metavision/i);
  assert.ok(html.includes('src="cid:proof"'), 'the proof image is still attached inline');
});

test('commission emails: customer confirmation, team notification, digital delivery', () => {
  const base = { customerName: 'Grace', serviceTitle: 'Cartoonify Me', orderRef: 'PX-AB12CD34', total: 49, deliveryType: 'both' };
  assertPixel8Logo('commission customer', customerEmailHtml({ ...base, hasShipping: true }));
  assertPixel8Logo('commission team', teamEmailHtml({ ...base, customerEmail: 'grace@example.com', commissionId: 'c1' }));
  assertPixel8Logo('commission delivery', buildDeliveryEmailHtml('Grace', 'Cartoonify Me', 'PX-AB12CD34', [{ url: 'https://x/dl', filename: 'art.png' }]));
});

test('contact emails (team + acknowledgement) and the newsletter confirmation', () => {
  assertPixel8Logo('contact team', buildTeamEmail({ name: 'Ada', email: 'ada@example.com', subject: 'general', message: 'Hi', refCode: 'ABC' }));
  assertPixel8Logo('contact ack', buildAckEmail({ name: 'Ada', refCode: 'ABC' }));
  const { html } = confirmationEmail({
    brand: { name: 'Pixel8 Multimedia', logoUrl: emailLogoUrl(), headerBg: '#000000', accent: '#F07828', siteUrl: 'https://pixel8multimedia.co.uk' },
    copy: { subject: 's', preheader: 'p', heading: 'h', intro: 'i', button: 'b', signoff: 'x' },
    confirmUrl: 'https://pixel8multimedia.co.uk/api/newsletter-confirm?t=1',
  });
  assert.ok(html.includes(`src="${LOGO}"`));
  assert.ok(!html.includes('Pixel8_Logo.png'));
});

/* ------------------------------------------------------------------ inline (webhook.mjs) */

const fnDir = fileURLToPath(new URL('../netlify/functions/', import.meta.url));
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('shop order emails (webhook.mjs): the confirmation header and the team alert both use the logo', () => {
  const src = code(read(join(fnDir, 'webhook.mjs')));
  assert.ok(src.includes("import { emailLogoImg } from './_shared/email-logo.mjs';"));
  const confirm = src.slice(src.indexOf('subject: `Order Confirmed'), src.indexOf('Customer confirmation email sent'));
  assert.ok(confirm.indexOf('${emailLogoImg()}') > 0 && confirm.indexOf('${emailLogoImg()}') < confirm.indexOf('Thanks for your order'), 'confirmation: logo in the header');
  assert.doesNotMatch(confirm, /background-clip|PIXEL<span/, 'confirmation: the CSS gradient text is gone');
  const team = src.slice(src.indexOf("const teamEmail = setting('TEAM_EMAIL')"), src.indexOf('Team notification sent'));
  assert.ok(team.indexOf('${emailLogoImg()}') > 0 && team.indexOf('${emailLogoImg()}') < team.indexOf('NEW ORDER RECEIVED'), 'team alert: logo at the top');
  assert.doesNotMatch(src, OTHER_BRANDS);
});

test('no function still points an email at Pixel8_Logo.png or hardcodes a logo URL', () => {
  const files = [];
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) { if (n !== 'node_modules') walk(p); } else if (/\.(m?js|mts|cjs|ts)$/.test(n)) files.push(p);
    }
  };
  walk(fnDir);
  assert.ok(files.length > 20);
  for (const f of files) {
    const src = code(read(f));
    assert.ok(!src.includes('Pixel8_Logo'), `${f} still uses Pixel8_Logo.png`);
    if (!f.endsWith('site-config.mjs')) assert.ok(!src.includes('email-logo-400.png'), `${f} hardcodes the logo URL instead of using email-logo.mjs`);
  }
});
