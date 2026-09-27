/**
 * Upload metadata stripping, and Turnstile on every public form.
 *
 *   node tools/builder/forms-hardening-tests.mjs
 *
 * A. Real JPEG/PNG/WebP files carrying GPS, EXIF, XMP, IPTC and text chunks
 *    go through _shared/strip-metadata.mjs: the metadata goes, orientation
 *    and ICC stay, pixels are unchanged. HEIC is refused.
 * B. Every protected endpoint (contact, newsletter, commission upload,
 *    commission checkout, Your Photo upload) is called for real with
 *    siteverify mocked and all other network blocked: a missing or invalid
 *    token is refused (403); a valid one gets past the check.
 */
import { createRequire } from 'node:module';
import { crc32 } from 'node:zlib';
import http from 'node:http';
import https from 'node:https';

const sharp = createRequire(import.meta.url)('sharp');
let pass = 0, fail = 0;
const ok = (c, l, e = '') => {
  if (c) { pass++; console.log(`  PASS  ${l}${e !== '' ? ' — ' + e : ''}`); }
  else { fail++; console.log(`  FAIL  ${l}${e !== '' ? ' — ' + e : ''}`); }
};
const say = console.log.bind(console);

// ── Environment for the handlers, set BEFORE they are imported ─────────────
process.env.TURNSTILE_SECRET_KEY = 'test-secret-value';
process.env.PERSONALISATION_SALT = 'test-salt';
process.env.SANITY_TOKEN = 'test-token';
process.env.SANITY_API_TOKEN = 'test-token';
process.env.RESEND_API_KEY = 're_test_key';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
delete process.env.MAILERLITE_API_KEY;
delete process.env.NETLIFY_BLOBS_CONTEXT;

// No real network: siteverify is mocked, everything else fails fast.
const siteverifyCalls = [];
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://challenges.cloudflare.com/turnstile/v0/siteverify')) {
    const { response, secret } = JSON.parse(init.body);
    siteverifyCalls.push({ response, secret });
    const good = response === 'good-token';
    return new Response(JSON.stringify(good
      ? { success: true, hostname: 'pixel8multimedia.co.uk' }
      : { success: false, 'error-codes': ['invalid-input-response'], hostname: 'pixel8multimedia.co.uk' }), { status: 200 });
  }
  throw new Error(`network disabled in tests (${String(url).slice(0, 40)})`);
};
for (const mod of [http, https]) mod.request = () => { throw new Error('network disabled in tests'); };

const { stripMetadata, readExif, FRIENDLY_HEIC } = await import('../../netlify/functions/_shared/strip-metadata.mjs');
const { storeUpload } = await import('../../netlify/functions/_shared/commission-uploads.mjs');
const { verifyTurnstile } = await import('../../netlify/functions/_shared/turnstile.mjs');
const { makeGrant, verifyGrant, GRANT_TTL_MS } = await import('../../netlify/functions/_shared/commission-grant.mjs');

const exifOf = (m) => (m.exif ? readExif(m.exif.subarray(Math.max(0, m.exif.indexOf('Exif')) + (m.exif.indexOf('Exif') >= 0 ? 6 : 0))) : { hasGps: false });
const rawPixels = (buf) => sharp(buf).raw().toBuffer();
const uprightPixels = (buf) => sharp(buf).rotate().raw().toBuffer();
const base = await sharp({ create: { width: 60, height: 40, channels: 3, background: '#2a6fb0' } })
  .composite([{ input: { create: { width: 20, height: 10, channels: 3, background: '#e03030' } }, left: 0, top: 0 }]).png().toBuffer();
const GPS = { IFD0: { Make: 'PhoneCo', Model: 'Model X' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '0/1 7/1 0/1' } };
const XMP = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" dc:creator="A Person"/></rdf:RDF></x:xmpmeta>';

/** Insert raw JPEG segments (IPTC APP13, a comment) straight after SOI. */
function withJpegSegments(jpeg) {
  const seg = (marker, text) => { const p = Buffer.from(text, 'latin1'); const h = Buffer.from([0xff, marker, 0, 0]); h.writeUInt16BE(p.length + 2, 2); return Buffer.concat([h, p]); };
  return Buffer.concat([jpeg.subarray(0, 2), seg(0xed, 'Photoshop 3.0\0IPTC: A Person, London'), seg(0xfe, 'taken at 10 Downing St'), jpeg.subarray(2)]);
}
/** Insert PNG text chunks before IEND. */
function withPngText(png) {
  const chunk = (type, data) => { const d = Buffer.from(data, 'latin1'); const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(type, 'latin1'), d]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const iend = png.length - 12;
  return Buffer.concat([png.subarray(0, iend), chunk('tEXt', 'Author\0A Person'), chunk('iTXt', 'XML:com.adobe.xmp\0\0\0\0\0' + XMP), chunk('tIME', '\x07\xea\x09\x1b\x0c\x00\x00'), png.subarray(iend)]);
}
const scanData = (jpeg) => { for (let i = 2; i < jpeg.length;) { const m = jpeg[i + 1]; if (m === 0xda) return jpeg.subarray(i); i += 2 + jpeg.readUInt16BE(i + 2); } return null; };
const pngChunkTypes = (png) => { const t = []; for (let i = 8; i < png.length;) { const len = png.readUInt32BE(i); t.push(png.toString('latin1', i + 4, i + 8)); i += 12 + len; } return t; };
const idat = (png) => { const out = []; for (let i = 8; i < png.length;) { const len = png.readUInt32BE(i); if (png.toString('latin1', i + 4, i + 8) === 'IDAT') out.push(png.subarray(i, i + 12 + len)); i += 12 + len; } return Buffer.concat(out); };

say('\nA1. JPEG\n');
{
  const src = withJpegSegments(await sharp(base).withMetadata({ orientation: 6 }).withExif(GPS).withXmp(XMP).withIccProfile('srgb').jpeg({ quality: 90 }).toBuffer());
  const m0 = await sharp(src).metadata();
  ok(exifOf(m0).hasGps && m0.xmp && m0.orientation === 6 && src.includes(Buffer.from('Photoshop 3.0')), 'fixture really has GPS, XMP, IPTC, a comment and orientation 6');
  const r = await stripMetadata(src, 'image/jpeg', { sharp });
  const m1 = await sharp(r.buffer).metadata();
  ok(!exifOf(m1).hasGps && !m1.xmp && !r.buffer.includes(Buffer.from('Photoshop 3.0')) && !r.buffer.includes(Buffer.from('Downing')) && !r.buffer.includes(Buffer.from('PhoneCo')),
    'no GPS, no camera make, no XMP, no IPTC, no comment', r.removed.join(' | '));
  ok(m1.orientation === 6 && m1.exif && m1.exif.length < 40, 'orientation kept (only the orientation: a 32-byte EXIF block)', `${m1.exif?.length} bytes`);
  ok(Boolean(m1.icc), 'ICC colour profile kept');
  ok(scanData(src).equals(scanData(r.buffer)) && !r.reencoded, 'lossless: the compressed image data is byte-identical (no re-encode)');
  ok((await rawPixels(src)).equals(await rawPixels(r.buffer)) && (await uprightPixels(src)).equals(await uprightPixels(r.buffer)), 'pixel-identical, and displays the same way up');
  ok(m1.width === m0.width && m1.height === m0.height, 'same dimensions');

  const plain = await sharp(base).withExif(GPS).jpeg().toBuffer();
  const rp = await stripMetadata(plain, 'image/jpeg', { sharp });
  ok(!(await sharp(rp.buffer).metadata()).exif, 'orientation 1: no EXIF block at all');
}

say('\nA2. PNG\n');
{
  const src = withPngText(await sharp(base).withExif(GPS).withIccProfile('srgb').png().toBuffer());
  const types0 = pngChunkTypes(src);
  ok(types0.includes('eXIf') && types0.includes('tEXt') && types0.includes('iTXt') && types0.includes('tIME') && types0.includes('iCCP'), 'fixture has eXIf, tEXt, iTXt (XMP), tIME, iCCP', types0.join(','));
  const r = await stripMetadata(src, 'image/png', { sharp });
  const types1 = pngChunkTypes(r.buffer);
  ok(!types1.some((t) => ['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME'].includes(t)) && types1.includes('iCCP'), 'eXIf/tEXt/iTXt/tIME gone, iCCP kept', types1.join(','));
  ok(idat(src).equals(idat(r.buffer)) && !r.reencoded && (await rawPixels(src)).equals(await rawPixels(r.buffer)), 'lossless: IDAT byte-identical, pixel-identical');
  ok(!r.buffer.includes(Buffer.from('A Person')), 'the author text is gone');

  const rotated = await sharp(base).withMetadata({ orientation: 6 }).withExif(GPS).png().toBuffer();
  const rr = await stripMetadata(rotated, 'image/png', { sharp });
  const mr = await sharp(rr.buffer).metadata();
  ok(rr.reencoded && !mr.exif && (mr.orientation ?? 1) === 1 && mr.width === 40 && mr.height === 60, 'orientation 6: rotated upright (PNG has no orientation-only option), no EXIF', `${mr.width}×${mr.height}`);
  ok((await uprightPixels(rotated)).equals(await rawPixels(rr.buffer)), 'and pixel-identical to the upright original (PNG is lossless)');
}

say('\nA3. WebP\n');
{
  const src = await sharp(base).withExif(GPS).withXmp(XMP).withIccProfile('srgb').webp({ quality: 90 }).toBuffer();
  const m0 = await sharp(src).metadata();
  ok(exifOf(m0).hasGps && m0.xmp, 'fixture has GPS and XMP');
  const r = await stripMetadata(src, 'image/webp', { sharp });
  const m1 = await sharp(r.buffer).metadata();
  ok(!m1.exif && !m1.xmp && Boolean(m1.icc) && !r.reencoded, 'EXIF and XMP gone, ICC kept, not re-encoded');
  ok((r.buffer[20] & 0x0c) === 0, 'VP8X EXIF/XMP flags cleared');
  ok((await rawPixels(src)).equals(await rawPixels(r.buffer)), 'pixel-identical');

  const rotated = await sharp(base).withMetadata({ orientation: 6 }).withExif(GPS).webp({ quality: 90 }).toBuffer();
  const rr = await stripMetadata(rotated, 'image/webp', { sharp });
  const mr = await sharp(rr.buffer).metadata();
  ok(rr.reencoded && !mr.exif && mr.width === 40 && (await uprightPixels(rotated)).equals(await rawPixels(rr.buffer)), 'orientation 6: rotated upright, written as LOSSLESS WebP, pixels equal the upright original');
}

say('\nA4. HEIC, and the upload path end to end\n');
{
  let e = null;
  try { await stripMetadata(Buffer.from('ftypheic'), 'image/heic', { sharp }); } catch (x) { e = x; }
  ok(e?.name === 'MetadataError' && e.customerMessage === FRIENDLY_HEIC, 'HEIC refused with the friendly message');

  const stored = new Map();
  const store = { async set(k, d, o) { stored.set(k, { d: Buffer.from(d), o }); } };
  const uuid = (() => { let n = 0; return () => `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`; })();
  const deps = { store, uuid, strip: (b, t) => stripMetadata(b, t, { sharp }), imageSize: async (b) => { const m = await sharp(b).metadata(); return { width: m.width, height: m.height }; } };
  const jpeg = await sharp(base).withExif(GPS).jpeg().toBuffer();
  const r = await storeUpload({ bytes: jpeg, contentType: 'image/jpeg', fieldKey: 'f' }, deps);
  const saved = stored.get(r.uploadKey);
  ok(r.ok && !exifOf(await sharp(saved.d).metadata()).hasGps && saved.o.metadata.bytes === saved.d.length && r.hadGps === true,
    'storeUpload stores the STRIPPED bytes (no GPS); metadata.bytes is the stored size');
  const h = await storeUpload({ bytes: Buffer.from('heic'), contentType: 'image/heic' }, deps);
  ok(!h.ok && h.status === 400 && h.error === FRIENDLY_HEIC, 'a HEIC upload gets a 400 with the friendly message, nothing stored');
  const broken = await storeUpload({ bytes: Buffer.from('not a jpeg at all'), contentType: 'image/jpeg' }, deps);
  ok(!broken.ok && broken.status === 400 && !/marker|segment/.test(broken.error), 'a corrupt file: generic message, no technical detail', broken.error);

  // Your Photo: the browser re-encodes through a canvas, and the server
  // re-encodes with sharp — which writes no EXIF unless asked to.
  const yp = await sharp(await sharp(base).withMetadata({ orientation: 6 }).withExif(GPS).jpeg().toBuffer()).rotate().resize(40, 40).toColourspace('srgb').jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  const mYP = await sharp(yp).metadata();
  ok(!mYP.exif && !mYP.xmp && (mYP.orientation ?? 1) === 1, 'Your Photo\'s server pipeline (as in personalisation-upload) keeps no EXIF/GPS and applies orientation');
}

say('\nB1. THE SHARED CHECK\n');
{
  const logs = [];
  const log = (m) => logs.push(m);
  ok((await verifyTurnstile('x', { context: 't', secret: '', log })).skipped, 'no secret configured → skipped (dev / pre-launch)');
  ok(!(await verifyTurnstile('', { context: 't', log })).ok, 'no token → refused');
  const bad = await verifyTurnstile('bad-token', { context: 't', log });
  ok(!bad.ok && bad.codes.join() === 'invalid-input-response', 'invalid token → refused with Cloudflare\'s code');
  ok((await verifyTurnstile('good-token', { context: 't', log })).ok, 'valid token → accepted');
  ok(logs.length === 2 && logs.every((l) => !l.includes('bad-token') && !l.includes('test-secret-value')) && /codes=\[invalid-input-response\] hostname=pixel8multimedia\.co\.uk/.test(logs[1]),
    'the log has the error codes and hostname — never the token or secret', logs[1]);
  const down = await verifyTurnstile('good-token', { context: 't', log, fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  ok(!down.ok, 'siteverify unreachable → refused (fails closed)');

  const id = '11111111-2222-3333-4444-555555555555';
  const g = makeGrant(id);
  ok(verifyGrant(g) === id, 'grant: verifies for its uploadId');
  ok(verifyGrant(g.slice(0, -2) + (g.endsWith('AA') ? 'BB' : 'AA')) === null, 'grant: a tampered signature is refused');
  ok(verifyGrant(g, { now: Date.now() + GRANT_TTL_MS + 1000 }) === null, 'grant: refused after it expires');
  ok(verifyGrant(g, { salt: 'another-salt' }) === null, 'grant: refused under a different secret');
}

say('\nB2. EVERY ENDPOINT: MISSING / INVALID / VALID TOKEN\n');
{
  const contact = (await import('../../netlify/functions/contact.mts')).default;
  const newsletter = (await import('../../netlify/functions/newsletter.mts')).default;
  const upload = (await import('../../netlify/functions/upload.mts')).default;
  const checkout = (await import('../../netlify/functions/commission-checkout.mts')).default;
  const yourPhoto = (await import('../../netlify/functions/personalisation-upload.mts')).default;
  const ctx = {};
  const jpeg = await sharp(base).jpeg().toBuffer();
  const UID = '11111111-2222-3333-4444-555555555555';
  const status = async (p) => { try { const r = await p; return { s: r.status, b: await r.json().catch(() => ({})) }; } catch (e) { return { s: 'threw', b: { error: e.message } }; } };

  const json = (url, body) => new Request(`https://x${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const form = (url, fields) => { const fd = new FormData(); for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.append(k, v); return new Request(`https://x${url}`, { method: 'POST', body: fd }); };
  const contactBody = (t) => ({ name: 'Test', email: 'test@example.com', subject: 'general', message: 'Hello', website: '', ...(t ? { turnstile: t } : {}) });
  const newsBody = (t) => ({ email: 'test@example.com', source: 'footer', ...(t ? { turnstile: t } : {}) });
  const uploadForm = (extra) => form('/.netlify/functions/upload', { file: new File([jpeg], 'x.jpg', { type: 'image/jpeg' }), fieldKey: 'f', uploadId: UID, ...extra });
  const checkoutBody = (extra) => ({ serviceSlug: 'prankz', name: 'Test', email: 'test@example.com', orderType: 'digital', uploadedAssets: [], ...extra });
  const ypForm = (t) => form('/api/personalisation/upload', { file: new File([jpeg], 'x.jpg', { type: 'image/jpeg' }), consent: 'true', ...(t ? { turnstile: t } : {}) });

  const cases = [
    ['contact', (t) => contact(json('/api/contact', contactBody(t)), ctx)],
    ['newsletter', (t) => newsletter(json('/api/newsletter', newsBody(t)), ctx)],
    ['commission upload', (t) => upload(uploadForm(t ? { turnstile: t } : {}), ctx)],
    ['commission checkout', (t) => checkout(json('/.netlify/functions/commission-checkout', checkoutBody(t ? { turnstile: t } : {})), ctx)],
    ['Your Photo upload', (t) => yourPhoto(ypForm(t))],
  ];
  for (const [name, call] of cases) {
    const missing = await status(call(null));
    const invalid = await status(call('bad-token'));
    const before = siteverifyCalls.length;
    const valid = await status(call('good-token'));
    ok(missing.s === 403 && invalid.s === 403, `${name}: missing and invalid token → 403`, `${missing.s}/${invalid.s} "${invalid.b.error}"`);
    ok(valid.s !== 403 && siteverifyCalls.length === before + 1 && siteverifyCalls.at(-1).response === 'good-token',
      `${name}: a valid token gets past the check`, `then ${valid.s}${valid.b.error ? ` "${valid.b.error}"` : ''} (no real network in the test)`);
    ok(invalid.b.error === 'Verification failed — please try again.', `${name}: generic message to the customer`);
  }

  // Honeypot still first on contact.
  const hp = await status(contact(json('/api/contact', { ...contactBody(null), website: 'http://spam' }), ctx));
  ok(hp.s === 200 && hp.b.success === true, 'contact honeypot still quietly "succeeds" for bots, before Turnstile');

  // Commission grant paths.
  const g = makeGrant(UID);
  const withGrant = await status(upload(uploadForm({ grant: g }), ctx));
  ok(withGrant.s !== 403, 'commission upload: a valid grant for this visit passes without a token', `then ${withGrant.s}`);
  const otherGrant = await status(upload(uploadForm({ grant: makeGrant('99999999-2222-3333-4444-555555555555') }), ctx));
  ok(otherGrant.s === 403, 'commission upload: a grant for another visit is refused');
  const key = (id) => `commission-upload/${id}/00000000-0000-0000-0000-000000000001.jpg`;
  const coGrant = await status(checkout(json('/.netlify/functions/commission-checkout', checkoutBody({ uploadGrant: g, uploadedAssets: [{ fieldKey: 'f', uploadKey: key(UID) }] })), ctx));
  ok(coGrant.s !== 403, 'checkout: the visit\'s grant passes when every photo belongs to that visit', `then ${coGrant.s}`);
  const coMismatch = await status(checkout(json('/.netlify/functions/commission-checkout', checkoutBody({ uploadGrant: g, uploadedAssets: [{ fieldKey: 'f', uploadKey: key('99999999-2222-3333-4444-555555555555') }] })), ctx));
  ok(coMismatch.s === 403, 'checkout: a grant does not cover photos from another visit');
}

say(`\n${pass} passed, ${fail} failed.`);
process.exitCode = fail ? 1 : 0;
