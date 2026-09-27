/**
 * Customer commission photos in private Blobs.
 *
 *   node tools/builder/commission-photos-tests.mjs
 *
 * Upload → store (metadata, no filename); checkout's key check; the admin
 * photo route's auth; the hourly sweep of abandoned uploads; and the
 * migration's dry run and hash check.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  storeUpload, photosForCommission, sweepAbandonedUploads, isUploadKey, MAX_FILE_SIZE, ABANDONED_AFTER_MS,
} from '../../netlify/functions/_shared/commission-uploads.mjs';
import { planMigration, migratePhoto, deterministicUuid } from '../commission-photos/migrate-lib.mjs';

let pass = 0, fail = 0;
const ok = (c, l, e = '') => {
  if (c) { pass++; console.log(`  PASS  ${l}${e !== '' ? ' — ' + e : ''}`); }
  else { fail++; console.log(`  FAIL  ${l}${e !== '' ? ' — ' + e : ''}`); }
};
const say = console.log.bind(console);
const sha = (b) => createHash('sha256').update(b).digest('hex');

function memStore(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    m, sets: 0, deletes: [],
    async set(k, data, o = {}) { this.sets++; m.set(k, { data: Buffer.from(data), metadata: o.metadata || {} }); },
    async get(k) { return m.has(k) ? m.get(k).data : null; },
    async getMetadata(k) { return m.has(k) ? { etag: '"e"', metadata: m.get(k).metadata } : null; },
    async delete(k) { this.deletes.push(k); m.delete(k); },
    async list({ prefix }) { return { blobs: [...m.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; },
  };
}
let n = 0;
const uuid = () => `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`;
const UID = '11111111-2222-3333-4444-555555555555';

say('\n1. UPLOAD → BLOBS, NO FILENAME\n');
{
  const store = memStore();
  const bytes = Buffer.from('fake-jpeg-bytes');
  const r = await storeUpload(
    { bytes, contentType: 'image/jpeg', fieldKey: 'sourcePhotos', uploadId: UID },
    { store, uuid, now: () => new Date('2026-09-27T10:00:00Z'), imageSize: async () => ({ width: 3000, height: 2000 }) },
  );
  const saved = store.m.get(r.uploadKey);
  ok(r.ok && isUploadKey(r.uploadKey) && r.uploadKey.startsWith(`commission-upload/${UID}/`) && r.uploadKey.endsWith('.jpg'), 'key commission-upload/<uploadId>/<uuid>.jpg', r.uploadKey);
  ok(saved && JSON.stringify(Object.keys(saved.metadata).sort()) === JSON.stringify(['bytes', 'contentType', 'fieldKey', 'height', 'uploadId', 'uploadedAt', 'width']),
    'metadata: uploadId, fieldKey, contentType, bytes, width, height, uploadedAt', Object.keys(saved?.metadata || {}).join(','));
  ok(saved.metadata.bytes === bytes.length && saved.metadata.width === 3000 && saved.metadata.uploadedAt === '2026-09-27T10:00:00.000Z', 'values recorded');
  const everything = JSON.stringify({ r, meta: saved.metadata });
  ok(!/name/i.test(everything.replace(/fieldKey|uploadedAt/g, '')), 'no filename anywhere in the response or metadata');
  const src = readFileSync(new URL('../../netlify/functions/upload.mts', import.meta.url), 'utf8');
  ok(!/f\.name|originalName|filename/.test(src.replace(/^\s*\/\/.*$/gm, '')), 'upload.mts never reads or sends the original filename (code, comments aside)');
  ok(!/originalName/.test(readFileSync(new URL('../../src/components/CommissionWorkflow.jsx', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '')), 'the wizard no longer sends originalName');

  const heic = await storeUpload({ bytes, contentType: 'image/heic', uploadId: UID }, { store, uuid, imageSize: async () => { throw new Error('no decoder'); } });
  ok(heic.ok && heic.width === null && heic.uploadKey.endsWith('.heic'), 'HEIC accepted even if its size can\'t be read (as before)');
  const bad = await storeUpload({ bytes, contentType: 'application/pdf' }, { store, uuid });
  ok(!bad.ok && bad.status === 400, 'a PDF is refused, 400');
  const big = await storeUpload({ bytes: new Uint8Array(MAX_FILE_SIZE + 1), contentType: 'image/png' }, { store, uuid });
  ok(!big.ok && big.status === 413, 'over 10 MB refused, 413 (same limit as before)');
  const minted = await storeUpload({ bytes, contentType: 'image/png', uploadId: '../../evil' }, { store, uuid });
  ok(minted.ok && isUploadKey(minted.uploadKey) && !minted.uploadKey.includes('evil'), 'a bogus uploadId is replaced, never put in the key');
}

say('\n2. CHECKOUT ACCEPTS ONLY REAL KEYS\n');
{
  const store = memStore();
  const up = await storeUpload({ bytes: Buffer.from('x'), contentType: 'image/png', fieldKey: 'f', uploadId: UID }, { store, uuid });
  const good = await photosForCommission([{ fieldKey: 'f', uploadKey: up.uploadKey }], { store, makeKey: () => 'k1' });
  ok(good.ok && good.photos[0].key === up.uploadKey && good.photos[0].contentType === 'image/png' && !('originalName' in good.photos[0]), 'known key → entry with key, type, bytes, size; no filename');
  const gone = await photosForCommission([{ uploadKey: `commission-upload/${UID}/${UID}.png` }], { store, makeKey: () => 'k' });
  ok(!gone.ok && /expired/.test(gone.error), 'a well-formed key that isn\'t in the store → refused');
  const forged = await photosForCommission([{ uploadKey: 'personalisation/abc/print.png' }], { store, makeKey: () => 'k' });
  ok(!forged.ok && /invalid/.test(forged.error), 'a key outside commission-upload/ → refused');
}

say('\n3. ADMIN PHOTO ROUTE NEEDS BASIC AUTH\n');
{
  const ENV = { ADMIN_USER: 'admin', ADMIN_PASSWORD: 'pw' };
  globalThis.Netlify = { env: { get: (k) => ENV[k] } };
  const edge = await import('../../netlify/edge-functions/commission-photo.ts');
  const adminAuth = await import('../../netlify/edge-functions/admin-auth.ts');
  const url = `https://x/admin/commission-photo/${UID}/${UID}.jpg`;
  ok((await edge.default(new Request(url))).status === 401, 'no credentials → 401 from the photo route itself');
  ok((await edge.default(new Request(url, { headers: { authorization: `Basic ${btoa('admin:nope')}` } }))).status === 401, 'wrong credentials → 401');
  ok((await adminAuth.default(new Request(url), { next: async () => new Response('x') })).status === 401, 'and admin-auth also answers 401 for it');
  ok(new URLPattern({ pathname: adminAuth.config.path }).test({ pathname: new URL(url).pathname }) && edge.config.path.startsWith('/admin/'), 'the route is under admin-auth\'s /admin/*');
  const trav = await edge.default(new Request('https://x/admin/commission-photo/..%2F..%2Fpersonalisation%2Fx%2Fprint.png', { headers: { authorization: `Basic ${btoa('admin:pw')}` } }));
  ok(trav.status === 400, 'authenticated, but a path outside commission-upload/ → 400');
}

say('\n4. HOURLY SWEEP OF ABANDONED UPLOADS\n');
{
  const now = Date.parse('2026-09-27T12:00:00Z');
  const at = (hoursAgo) => new Date(now - hoursAgo * 3600e3).toISOString();
  const k = (i) => `commission-upload/${UID}/00000000-0000-0000-0000-00000000000${i}.jpg`;
  const store = memStore({
    [k(1)]: { data: Buffer.from('a'), metadata: { uploadedAt: at(72) } }, // old, abandoned → delete
    [k(2)]: { data: Buffer.from('b'), metadata: { uploadedAt: at(72) } }, // old, but on a commission → keep
    [k(3)]: { data: Buffer.from('c'), metadata: { uploadedAt: at(2) } },  // young → keep
    [k(4)]: { data: Buffer.from('d'), metadata: {} },                     // no timestamp → treated as old
    ['elsewhere/key']: { data: Buffer.from('e'), metadata: { uploadedAt: at(999) } },
  });
  const r = await sweepAbandonedUploads({ store, attachedKeys: new Set([k(2)]), now });
  ok(store.deletes.includes(k(1)) && store.deletes.includes(k(4)), `old abandoned uploads deleted (>${ABANDONED_AFTER_MS / 3600e3} h, or no timestamp)`);
  ok(!store.deletes.includes(k(2)), 'an upload attached to a commission is NEVER deleted, however old');
  ok(!store.deletes.includes(k(3)), 'a recent upload (customer may still be filling the form) is kept');
  ok(!store.deletes.includes('elsewhere/key') && r.deleted === 2 && r.attached === 1 && r.kept === 1, 'only commission-upload/ keys are considered', JSON.stringify(r));
  const s2 = memStore({ [k(1)]: { data: Buffer.from('a'), metadata: { uploadedAt: at(72) } } });
  const d = await sweepAbandonedUploads({ store: s2, attachedKeys: new Set(), now, dry: true });
  ok(d.deleted === 1 && s2.deletes.length === 0, 'dry run: counts, deletes nothing');
  const s3 = memStore({ [k(1)]: { data: Buffer.from('a'), metadata: { uploadedAt: at(72) } } });
  const t = await sweepAbandonedUploads({ store: s3, attachedKeys: new Set(), now, timeLeft: () => 500 });
  ok(t.deferred === 1 && s3.deletes.length === 0, 'out of time in the sweep\'s 30 s → deferred to next hour');
}

say('\n5. MIGRATION\n');
{
  const bytes = Buffer.from('the customer photo bytes');
  const plan = planMigration([{ _id: 'commission.PX-TEST', hasDraft: true, entries: [
    { _key: 'e1', fieldKey: 'sourcePhoto', assetId: 'image-abc-10x10-png', bytes: bytes.length, mime: 'image/png', w: 10, h: 10, url: 'u' },
  ] }], [{ _id: 'image-orphan-1x1-jpg', size: 9, mimeType: 'image/jpeg', _createdAt: '2026-06-02T00:00:00Z' }]);
  const p = plan.photos[0];
  ok(isUploadKey(p.newKey) && p.newKey === planMigration([{ _id: 'commission.PX-TEST', entries: [{ _key: 'e1', assetId: 'image-abc-10x10-png', mime: 'image/png' }] }], []).photos[0].newKey,
    'deterministic key that the site accepts (safe to re-run)', p.newKey);
  ok(deterministicUuid('a') !== deterministicUuid('b'), 'different assets → different keys');

  const commits = [];
  const commitPhoto = async (photo, entry, o) => { commits.push({ photo, entry, ...o }); };
  const fetchBytes = async () => bytes;

  const s1 = memStore();
  const dry = await migratePhoto(p, { mode: 'dry', store: s1, fetchBytes, commitPhoto });
  ok(s1.sets === 0 && commits.length === 0 && dry.entry.key === p.newKey && !('originalName' in dry.entry), 'dry run: nothing written to Blobs or Sanity');

  const s2 = memStore();
  await migratePhoto(p, { mode: 'validate', store: s2, fetchBytes, commitPhoto });
  ok(s2.sets === 0 && commits.length === 1 && commits[0].dryRun === true, '--validate: no Blobs write; the Sanity transaction is sent with dryRun');

  commits.length = 0;
  const s3 = memStore();
  const applied = await migratePhoto(p, { mode: 'apply', store: s3, fetchBytes, commitPhoto });
  ok(s3.sets === 1 && sha(s3.m.get(p.newKey).data) === sha(bytes) && s3.m.get(p.newKey).metadata.sha256 === sha(bytes) && commits[0].dryRun === false,
    'apply: copied to Blobs, verified, then committed');
  ok(applied.entry.fieldKey === 'sourcePhoto' && applied.entry.bytes === bytes.length && applied.entry.contentType === 'image/png', 'new entry: fieldKey, key, contentType, bytes, pixel size');

  commits.length = 0;
  const again = await migratePhoto(p, { mode: 'apply', store: s3, fetchBytes, commitPhoto });
  ok(again.alreadyThere && s3.sets === 1, 're-run: the identical blob is not uploaded again');

  commits.length = 0;
  const liar = memStore();
  liar.get = async () => Buffer.from('something else entirely');
  let err = null;
  try { await migratePhoto(p, { mode: 'apply', store: liar, fetchBytes, commitPhoto }); } catch (e) { err = e; }
  ok(err && /hash mismatch/.test(err.message) && commits.length === 0, 'hash mismatch after upload → refused, Sanity NOT touched', err?.message);

  // A bad blob left behind (metadata claims the right sha, bytes are wrong):
  // a re-run must re-send it, not skip it.
  commits.length = 0;
  const stale = memStore({ [p.newKey]: { data: Buffer.from('corrupt'), metadata: { sha256: sha(bytes) } } });
  const fixed = await migratePhoto(p, { mode: 'apply', store: stale, fetchBytes, commitPhoto });
  ok(!fixed.alreadyThere && stale.sets === 1 && sha(stale.m.get(p.newKey).data) === sha(bytes) && commits.length === 1,
    're-run over a corrupt blob: re-uploaded and verified, not skipped');

  commits.length = 0;
  let err2 = null;
  try { await migratePhoto(p, { mode: 'apply', store: memStore(), fetchBytes: async () => Buffer.from('short'), commitPhoto }); } catch (e) { err2 = e; }
  ok(err2 && /bytes/.test(err2.message) && commits.length === 0, 'downloaded size ≠ asset size → refused before anything is written');

  ok(plan.orphans.length === 1 && plan.orphans[0]._id === 'image-orphan-1x1-jpg', 'orphans listed by id');
}

say(`\n${pass} passed, ${fail} failed.`);
process.exitCode = fail ? 1 : 0;
