// Every commission service goes through CommissionWorkflow. A service with no
// briefing fields gets the built-in name / email / photos fields and still
// produces a checkout body commission-checkout accepts; services with a brief
// behave exactly as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  briefFieldsFor, hasBriefQuestions, validateBrief, checkoutPayload,
  CONTACT_FIELDS, PHOTOS_FIELD,
} from '../src/lib/commission-wizard.mjs';
import { DIGITAL_CONSENT_VERSION } from '../netlify/functions/_shared/digital-consent.mjs';
import { photoRequiredFor } from '../netlify/functions/_shared/commission-photos.mjs';

// Line endings normalised: with core.autocrlf the working copy may be CRLF.
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '');
const keys = (fields) => fields.map((f) => f.key);

const noBrief = { slug: 'new-service', title: 'New Service', briefingFields: [] };
const photo = (n) => ({ uploadKey: `pending/${n}/photo.jpg`, name: `photo${n}.jpg` });

/** What commission-checkout checks before it creates anything (the rules, not a copy of its code). */
function serverWouldAccept(body) {
  if (!body.serviceSlug || !body.name || !body.email) return 'missing service, name or email';
  if (!/^\S+@\S+\.\S+$/.test(body.email)) return 'bad email';
  const hasPrint = (body.prints || []).some((p) => p.format && p.size);
  if (photoRequiredFor(body.serviceSlug, hasPrint) && !(body.uploadedAssets || []).length) return 'no photo';
  if (body.orderType !== 'singlePrint' && body.digitalSupplyConsent !== true) return 'no digital consent';
  return null;
}

test('no-brief service: the brief step is just name, email and photos', () => {
  for (const briefingFields of [[], undefined, null]) {
    const fields = briefFieldsFor(briefingFields, 'digital', {});
    assert.deepEqual(keys(fields), ['customerName', 'customerEmail', 'photos']);
    assert.equal(hasBriefQuestions(fields), false);
  }
  assert.equal(PHOTOS_FIELD.fieldType, 'photos');
  assert.equal(PHOTOS_FIELD.required, true);
});

test('no-brief fallback always asks for photos, except Your Song Your Story (the server’s rule)', () => {
  assert.deepEqual(keys(briefFieldsFor([], 'digital', { serviceSlug: 'new-service' })), ['customerName', 'customerEmail', 'photos']);
  assert.deepEqual(keys(briefFieldsFor([], 'digital', { serviceSlug: 'stills-to-reels' })), ['customerName', 'customerEmail', 'photos']);
  assert.deepEqual(keys(briefFieldsFor([], 'digital', { serviceSlug: 'your-song-your-story' })), ['customerName', 'customerEmail']);
  assert.equal(photoRequiredFor('new-service', false), true);
  assert.equal(photoRequiredFor('your-song-your-story', false), false);
  assert.equal(photoRequiredFor('your-song-your-story', true), true, 'a lyrics print needs a photo again');
});

test('no-brief service: validation asks for name, email and a photo, then passes', () => {
  const fields = briefFieldsFor([], 'digital', {});
  assert.match(validateBrief(fields, {}, {}), /Your name/);
  assert.match(validateBrief(fields, { customerName: 'Ada' }, {}), /Your email/);
  assert.match(validateBrief(fields, { customerName: 'Ada', customerEmail: 'not-an-email' }, {}), /valid email/);
  assert.match(validateBrief(fields, { customerName: 'Ada', customerEmail: 'ada@example.com' }, {}), /at least 1 photo/);
  assert.equal(validateBrief(fields, { customerName: 'Ada', customerEmail: 'ada@example.com' }, { photos: [photo(1)] }), null);
});

test('no-brief service, digital: a valid checkout body (consent, opt-out, photos, no brief text)', () => {
  const fields = briefFieldsFor([], 'digital', {});
  const body = checkoutPayload({
    service: noBrief, orderType: 'digital', fields,
    briefValues: { customerName: ' Ada Lovelace ', customerEmail: 'ada@example.com ' },
    briefFiles: { photos: [photo(1), photo(2)] },
    includesDigital: true, digitalConsent: true, digitalConsentVersion: DIGITAL_CONSENT_VERSION,
    marketingOptOut: true,
  });
  assert.deepEqual(body, {
    serviceSlug: 'new-service',
    serviceTitle: 'New Service',
    orderType: 'digital',
    includePrintsWithAnimation: false,
    bundleCollection: 'primary',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    phone: '',
    brief: '',
    briefData: [
      { key: 'customerName', label: 'Your name', value: ' Ada Lovelace ' },
      { key: 'customerEmail', label: 'Your email', value: 'ada@example.com ' },
    ],
    prints: [],
    uploadedAssets: [
      { fieldKey: 'photos', uploadKey: 'pending/1/photo.jpg' },
      { fieldKey: 'photos', uploadKey: 'pending/2/photo.jpg' },
    ],
    digitalSupplyConsent: true,
    digitalConsentVersion: DIGITAL_CONSENT_VERSION,
    marketingOptOut: true,
  });
  assert.equal(serverWouldAccept(body), null);
});

test('no-brief service, single print with a Groupon voucher: prints and claim token, no digital consent', () => {
  const fields = briefFieldsFor([], 'singlePrint', {});
  const body = checkoutPayload({
    service: noBrief, orderType: 'singlePrint', fields,
    briefValues: { customerName: 'Ada', customerEmail: 'ada@example.com' },
    briefFiles: { photos: [photo(1)] },
    prints: [{ styleKey: '', format: 'poster', size: 'small' }, { format: 'canvas', size: 'large' }],
    orderInvolvesPrints: true, includesDigital: false,
    grouponClaim: { token: 'claim-token-1', valuePence: 2500 },
  });
  assert.deepEqual(body.prints, [{ styleKey: '', format: 'poster', size: 'small' }], 'single print sends one row');
  assert.equal(body.grouponClaimToken, 'claim-token-1');
  assert.equal('digitalSupplyConsent' in body, false);
  assert.equal(body.marketingOptOut, false, 'unticked by default');
  assert.equal(serverWouldAccept(body), null);
});

test('a body the server would refuse is caught by the brief step first', () => {
  const fields = briefFieldsFor([], 'digital', {});
  const values = { customerName: 'Ada', customerEmail: 'ada@example.com' };
  const body = checkoutPayload({ service: noBrief, orderType: 'digital', fields, briefValues: values, briefFiles: {}, includesDigital: true, digitalConsent: true });
  assert.equal(serverWouldAccept(body), 'no photo');
  assert.ok(validateBrief(fields, values, {}), 'the wizard would not have let it through');
});

/* ------------------------------------------------------------------ services with a brief: unchanged */

const ysys = [
  { key: 'customerName', label: 'Name', fieldType: 'text', required: true },
  { key: 'customerEmail', label: 'Email', fieldType: 'email', required: true },
  { key: 'songTitle', label: 'Song title', fieldType: 'text', required: true },
  { key: 'style', label: 'Style', fieldType: 'styleSwatch', required: false },
  { key: 'backgroundPhoto', label: 'Background photo', fieldType: 'photo', required: true, showFor: ['singlePrint', 'bundle'] },
  { key: 'gift', label: 'Is it a gift?', fieldType: 'checkbox', required: false },
];

test('service with a brief: no extra fields, showFor and style rules as before', () => {
  assert.deepEqual(keys(briefFieldsFor(ysys, 'digital', {})), ['customerName', 'customerEmail', 'songTitle', 'gift'], 'no style picker on digital, no photo on the audio-only path, nothing built in');
  assert.deepEqual(keys(briefFieldsFor(ysys, 'bundle', {})), ['customerName', 'customerEmail', 'songTitle', 'style', 'backgroundPhoto', 'gift']);
  assert.deepEqual(keys(briefFieldsFor(ysys, 'singlePrint', {})), ['customerName', 'customerEmail', 'songTitle', 'backgroundPhoto', 'gift']);
  assert.equal(hasBriefQuestions(briefFieldsFor(ysys, 'digital', {})), true);
});

test('service with a brief but no name/email fields: the built-in ones are added at the front', () => {
  const fields = briefFieldsFor([{ key: 'songTitle', label: 'Song title', fieldType: 'text' }], 'digital', {});
  assert.deepEqual(keys(fields), ['customerName', 'customerEmail', 'songTitle']);
  assert.deepEqual(fields.slice(0, 2), CONTACT_FIELDS);
});

test('brief text and briefData as before: contact details out of the summary, in the data; checkboxes Yes/No', () => {
  const fields = briefFieldsFor(ysys, 'digital', {});
  const body = checkoutPayload({
    service: { slug: 'your-song-your-story', title: 'Your Song Your Story' }, orderType: 'digital', fields,
    briefValues: { customerName: 'Ada', customerEmail: 'ada@example.com', songTitle: 'Analytical Engine Blues', gift: true },
    includesDigital: true, digitalConsent: true,
  });
  assert.equal(body.brief, 'Song title: Analytical Engine Blues\nIs it a gift?: Yes');
  assert.deepEqual(body.briefData.map((d) => [d.key, d.value]), [
    ['customerName', 'Ada'], ['customerEmail', 'ada@example.com'], ['songTitle', 'Analytical Engine Blues'], ['gift', 'Yes'],
  ]);
  assert.equal(serverWouldAccept(body), null, 'YSYS audio-only needs no photo');
});

/* ------------------------------------------------------------------ the wiring */

test('every enabled service renders the wizard; the old form is gone', () => {
  const page = code(read('../src/pages/services/[slug].astro'));
  assert.match(page, /const showCommissionWorkflow = service\.commissionEnabled !== false;/);
  assert.equal(/briefingFields\.length > 0/.test(page), false);
  for (const toggle of ['hasFileUpload', 'hasDigitalDelivery', 'hasPrintOrder']) {
    assert.equal(page.includes(toggle), false, `${toggle} no longer read by the service page`);
    assert.equal(read('../src/lib/queries.ts').includes(toggle), false, `${toggle} no longer queried`);
    assert.equal(read('../studio/schemas/service.ts').includes(toggle), false, `${toggle} removed from the schema`);
  }
  assert.match(page, /<CommissionWorkflow client:load service=\{serviceForWizard\} \/>/);
  assert.equal(existsSync(new URL('../src/components/CommissionForm.jsx', import.meta.url)), false);
  assert.equal(existsSync(new URL('../src/styles/commission-form.css', import.meta.url)), false);
});

test('the wizard uses the shared brief and payload code', () => {
  const wiz = code(read('../src/components/CommissionWorkflow.jsx'));
  assert.match(wiz, /briefFieldsFor\(briefingFields, orderType, \{ serviceSlug: service\.slug \}\)/);
  assert.match(wiz, /return validateBrief\(filteredBriefingFields, briefValues, briefFiles\);/);
  assert.match(wiz, /const payload = checkoutPayload\(\{/);
  assert.match(wiz, /body: JSON\.stringify\(payload\)/);
  assert.equal(/doesn't have a briefing form configured/.test(wiz), false);
});

test('commission-checkout reads the keys the payload sends, and only JSON', () => {
  const src = code(read('../netlify/functions/commission-checkout.mts'));
  assert.match(src, /body = await req\.json\(\)/);
  assert.match(src, /const photoRequired = photoRequiredFor\(serviceSlug, orderHasPrint\);/, 'same photo rule as the wizard');
  assert.equal(/req\.formData\(\)/.test(src), false);
  for (const k of ['serviceSlug', 'name', 'email', 'phone', 'brief', 'orderType', 'grouponClaimToken', 'includePrintsWithAnimation', 'bundleCollection', 'prints', 'briefData', 'uploadedAssets', 'digitalSupplyConsent', 'marketingOptOut']) {
    assert.ok(src.includes(`body.${k}`), `server reads body.${k}`);
  }
});
