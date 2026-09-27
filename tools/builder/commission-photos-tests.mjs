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
import { stripMetadata, FRIENDLY_HEIC } from '../../netlify/functions/_shared/strip-metadata.mjs';
import { planMigration, migratePhoto, deleteOrphans, deterministicUuid, refPaths } from '../commission-photos/migrate-lib.mjs';

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
// Metadata stripping has its own tests (forms-hardening-tests.mjs); here it passes bytes through.
const strip = async (buffer) => ({ buffer, removed: [], hadGps: false });

say('\n1. UPLOAD → BLOBS, NO FILENAME\n');
{
  const store = memStore();
  const bytes = Buffer.from('fake-jpeg-bytes');
  const r = await storeUpload(
    { bytes, contentType: 'image/jpeg', fieldKey: 'sourcePhotos', uploadId: UID },
    { store, uuid, strip, now: () => new Date('2026-09-27T10:00:00Z'), imageSize: async () => ({ width: 3000, height: 2000 }) },
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

  const heic = await storeUpload({ bytes, contentType: 'image/heic', uploadId: UID }, { store, uuid, strip: (b, t) => stripMetadata(b, t) });
  ok(!heic.ok && heic.status === 400 && heic.error === FRIENDLY_HEIC, 'HEIC refused with a friendly message (HEIC metadata cannot be stripped here; the browser converts it first where it can)');
  const bad = await storeUpload({ bytes, contentType: 'application/pdf' }, { store, uuid, strip });
  ok(!bad.ok && bad.status === 400, 'a PDF is refused, 400');
  const big = await storeUpload({ bytes: new Uint8Array(MAX_FILE_SIZE + 1), contentType: 'image/png' }, { store, uuid, strip });
  ok(!big.ok && big.status === 413, 'over 10 MB refused, 413 (same limit as before)');
  const minted = await storeUpload({ bytes, contentType: 'image/png', uploadId: '../../evil' }, { store, uuid, strip });
  ok(minted.ok && isUploadKey(minted.uploadKey) && !minted.uploadKey.includes('evil'), 'a bogus uploadId is replaced, never put in the key');
}

say('\n2. CHECKOUT ACCEPTS ONLY REAL KEYS\n');
{
  const store = memStore();
  const up = await storeUpload({ bytes: Buffer.from('x'), contentType: 'image/png', fieldKey: 'f', uploadId: UID }, { store, uuid, strip });
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
  const ASSET = 'image-abc-10x10-png';
  const CID = 'commission.PX-TEST';
  const bytes = Buffer.from('the customer photo bytes');
  const entryRef = (k) => ({ _type: 'object', _key: k, fieldKey: 'sourcePhoto', asset: { _type: 'reference', _ref: ASSET } });

  /** A tiny in-memory Sanity: documents, references($id), patches, deletes — with Sanity's rule that
   *  a delete is checked against references as they were BEFORE its transaction. */
  function fakeSanity(docs) {
    const db = new Map(docs.map((d) => [d._id, structuredClone(d)]));
    const refsIn = (d, id) => refPaths(d, id).length > 0;
    const unset = (doc, path) => {
      const m = /^(\w+)(?:\[_key=="([^"]+)"\])?$/.exec(path);
      if (!m) throw new Error(`test fake can't unset ${path}`);
      if (m[2]) doc[m[1]] = (doc[m[1]] || []).filter((x) => x._key !== m[2]);
      else delete doc[m[1]];
    };
    const api = {
      db, commits: [], deletes: [],
      refsTo: async (id) => [...db.values()].filter((d) => refsIn(d, id)).map((d) => structuredClone(d)),
      commitRefs: async (patches, { dryRun }) => {
        api.commits.push({ ids: patches.map((p) => p.id), dryRun });
        const out = patches.map((p) => {
          const doc = structuredClone(db.get(p.id));
          if (doc._rev !== p.rev) throw new Error('revision mismatch');
          if (p.append) doc.uploadedPhotos = [...(doc.uploadedPhotos || []), p.append];
          for (const path of p.unset) unset(doc, path);
          return doc;
        });
        if (!dryRun) for (const d of out) db.set(d._id, { ...d, _rev: `${d._rev}+` });
        return out;
      },
      deleteAsset: async (id) => {
        if ([...db.values()].some((d) => refsIn(d, id))) throw new Error(`cannot be deleted as there are references to it`);
        api.deletes.push(id);
      },
      deleteAssets: async (ids, { dryRun }) => { if (!dryRun) api.deletes.push(...ids); },
    };
    return api;
  }
  const photoFor = (extra = {}) => planMigration([{ _id: CID, entries: [
    { _key: 'e1', fieldKey: 'sourcePhoto', assetId: ASSET, bytes: bytes.length, mime: 'image/png', w: 10, h: 10, url: 'u' },
  ], ...extra }], []).photos[0];
  const fetchBytes = async () => bytes;

  const p = photoFor();
  ok(isUploadKey(p.newKey) && p.newKey === photoFor().newKey, 'deterministic key that the site accepts (safe to re-run)', p.newKey);
  ok(deterministicUuid('a') !== deterministicUuid('b'), 'different assets → different keys');

  // Sanity's actual rule, as seen on the real data: removing the last reference
  // and deleting the asset can't happen in one transaction.
  {
    const s = fakeSanity([{ _id: CID, _rev: 'r1', _type: 'commission', uploadedFiles: [entryRef('e1')] }]);
    let e = null; try { await s.deleteAsset(ASSET); } catch (x) { e = x; }
    ok(e && /references/.test(e.message), 'the fake enforces Sanity\'s rule: no delete while referenced');
  }

  {
    const s = fakeSanity([{ _id: CID, _rev: 'r1', _type: 'commission', uploadedFiles: [entryRef('e1')] }]);
    const st = memStore();
    const dry = await migratePhoto(p, { mode: 'dry', store: st, fetchBytes, ...s });
    ok(st.sets === 0 && s.commits.length === 0 && s.deletes.length === 0 && !('originalName' in dry.entry), 'dry run: nothing written to Blobs or Sanity');
  }

  {
    const s = fakeSanity([{ _id: CID, _rev: 'r1', _type: 'commission', uploadedFiles: [entryRef('e1')] }]);
    const st = memStore();
    await migratePhoto(p, { mode: 'validate', store: st, fetchBytes, ...s });
    ok(st.sets === 0 && s.commits.length === 1 && s.commits[0].dryRun === true && s.deletes.length === 0,
      '--validate: no Blobs write; transaction 1 sent as dryRun; no delete attempted');
  }

  {
    const s = fakeSanity([{ _id: CID, _rev: 'r1', _type: 'commission', uploadedFiles: [entryRef('e1')] }]);
    const st = memStore();
    const r = await migratePhoto(p, { mode: 'apply', store: st, fetchBytes, ...s });
    const doc = s.db.get(CID);
    ok(r.deleted && s.deletes.join() === ASSET && doc.uploadedFiles.length === 0 && doc.uploadedPhotos[0].key === p.newKey && sha(st.m.get(p.newKey).data) === sha(bytes),
      'apply: Blobs verified → transaction 1 moves the entry → transaction 2 deletes the asset');
  }

  {
    // A DRAFT of the commission also references the asset.
    const s = fakeSanity([
      { _id: CID, _rev: 'r1', _type: 'commission', uploadedFiles: [entryRef('e1')] },
      { _id: `drafts.${CID}`, _rev: 'd1', _type: 'commission', uploadedFiles: [entryRef('e1')], notes: 'staff editing' },
    ]);
    const r = await migratePhoto(photoFor({ hasDraft: true }), { mode: 'apply', store: memStore(), fetchBytes, ...s });
    const draft = s.db.get(`drafts.${CID}`);
    ok(r.deleted && r.patched.sort().join() === [CID, `drafts.${CID}`].sort().join() && draft.uploadedFiles.length === 0 && draft.uploadedPhotos.length === 1 && draft.notes === 'staff editing',
      'a draft referencing it is updated in the same transaction; only then is the asset deleted', r.patched.join(' + '));
  }

  {
    // A leftover legacy image field holding the same asset.
    const s = fakeSanity([{ _id: CID, _rev: 'r1', _type: 'commission', uploadedFiles: [entryRef('e1')],
      sourcePhoto: { _type: 'image', asset: { _type: 'reference', _ref: ASSET } } }]);
    const r = await migratePhoto(p, { mode: 'apply', store: memStore(), fetchBytes, ...s });
    ok(r.deleted && !('sourcePhoto' in s.db.get(CID)), 'a leftover legacy image field is removed too, so the delete can succeed');
  }

  {
    // Transaction 1 succeeded, transaction 2 didn't (e.g. network) → re-run finishes it.
    const s = fakeSanity([{ _id: CID, _rev: 'r1', _type: 'commission', uploadedFiles: [entryRef('e1')] }]);
    const failingDelete = { ...s, deleteAsset: async () => { throw new Error('socket hang up'); } };
    let e = null;
    try { await migratePhoto(p, { mode: 'apply', store: memStore(), fetchBytes, ...failingDelete }); } catch (x) { e = x; }
    const between = s.db.get(CID);
    ok(e && between.uploadedPhotos?.[0]?.key === p.newKey && between.uploadedFiles.length === 0, 'between the two steps: the commission already points at Blobs (safe)');
    // Re-run: the photo is no longer in the plan (its uploadedFiles entry is gone); the asset is an orphan.
    const replan = planMigration([{ _id: CID, entries: [] }], [{ _id: ASSET, size: bytes.length, mimeType: 'image/png', _createdAt: 'x' }]);
    ok(replan.photos.length === 0 && replan.orphans.length === 1, 're-run: nothing left to move; the asset is picked up as an orphan');
    const o = await deleteOrphans(replan.orphans, { mode: 'apply', ...s });
    ok(o.deleted.join() === ASSET && s.deletes.join() === ASSET, 're-run: the orphan phase finishes the delete (nothing references it any more)');
  }

  {
    // An "orphan" that turns out to be referenced (e.g. by a draft).
    const s = fakeSanity([{ _id: `drafts.${CID}`, _rev: 'd1', _type: 'commission', uploadedFiles: [entryRef('e1')] }]);
    const o = await deleteOrphans([{ _id: ASSET }, { _id: 'image-free-1x1-jpg' }], { mode: 'apply', ...s });
    ok(o.skipped.length === 1 && o.skipped[0].id === ASSET && o.skipped[0].by.join() === `drafts.${CID}` && s.deletes.join() === 'image-free-1x1-jpg',
      'an orphan that is referenced (even by a draft) is skipped and reported; the rest are deleted');
    const d = await deleteOrphans([{ _id: 'image-free-1x1-jpg' }], { mode: 'dry', ...fakeSanity([]) });
    ok(d.deleted.length === 1, 'orphans in a dry run: listed, not deleted');
  }

  {
    // Referenced by some unrelated document → refuse, touch nothing.
    const s = fakeSanity([
      { _id: CID, _rev: 'r1', _type: 'commission', uploadedFiles: [entryRef('e1')] },
      { _id: 'blogPost.x', _rev: 'b1', _type: 'blogPost', hero: { _type: 'image', asset: { _type: 'reference', _ref: ASSET } } },
    ]);
    let e = null;
    try { await migratePhoto(p, { mode: 'apply', store: memStore(), fetchBytes, ...s }); } catch (x) { e = x; }
    ok(e && /also referenced by blogPost\.x/.test(e.message) && s.commits.length === 0 && s.deletes.length === 0, 'a reference from another document stops the run before any Sanity change', e?.message);
  }

  {
    const s = fakeSanity([{ _id: CID, _rev: 'r1', _type: 'commission', uploadedFiles: [entryRef('e1')] }]);
    const liar = memStore();
    liar.get = async () => Buffer.from('something else entirely');
    let e = null;
    try { await migratePhoto(p, { mode: 'apply', store: liar, fetchBytes, ...s }); } catch (x) { e = x; }
    ok(e && /hash mismatch/.test(e.message) && s.commits.length === 0 && s.deletes.length === 0, 'hash mismatch after upload → refused, Sanity NOT touched');

    const stale = memStore({ [p.newKey]: { data: Buffer.from('corrupt'), metadata: { sha256: sha(bytes) } } });
    const fixed = await migratePhoto(p, { mode: 'apply', store: stale, fetchBytes, ...fakeSanity([{ _id: CID, _rev: 'r1', _type: 'commission', uploadedFiles: [entryRef('e1')] }]) });
    ok(!fixed.alreadyThere && stale.sets === 1 && sha(stale.m.get(p.newKey).data) === sha(bytes), 're-run over a corrupt blob: re-uploaded and verified, not skipped');

    let e2 = null;
    try { await migratePhoto(p, { mode: 'apply', store: memStore(), fetchBytes: async () => Buffer.from('short'), ...fakeSanity([]) }); } catch (x) { e2 = x; }
    ok(e2 && /bytes/.test(e2.message), 'downloaded size ≠ asset size → refused before anything is written');
  }
}

say('\n6. ORIGINAL BYTES ONLY\n');
{
  // Sanity's image CDN re-encodes JPEGs (same size problem seen on the real data), so
  // the migration downloads ?dlRaw= and checks the asset's sha1hash.
  const bytes = Buffer.from('the customer photo bytes');
  const p = planMigration([{ _id: 'commission.PX-SHA', entries: [{ _key: 'e1', fieldKey: 'f', assetId: 'image-s-1x1-jpg', bytes: bytes.length,
    sha1: createHash('sha1').update(bytes).digest('hex'), mime: 'image/jpeg', url: 'u' }] }], []).photos[0];
  let e = null; let touched = 0;
  const same = Buffer.from('THE CUSTOMER PHOTO BYTES'); // same length, different content (a re-encode)
  try { await migratePhoto(p, { mode: 'apply', store: memStore(), fetchBytes: async () => same, refsTo: async () => { touched++; return []; } }); } catch (x) { e = x; }
  ok(e && /sha1hash/.test(e.message) && touched === 0, 'same size but different bytes (not the original) → refused before Blobs or Sanity', e?.message);
}

say(`\n${pass} passed, ${fail} failed.`);
process.exitCode = fail ? 1 : 0;
