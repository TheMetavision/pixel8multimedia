/**
 * tools/commission-artwork/migrate-lib.mjs
 *
 * The logic of tools/migrate-commission-artwork.mjs, with its I/O injected so
 * the tests can run it against mocks. The same shape as the customer-photos
 * migration (commission-photos/migrate-lib.mjs), for the finished file:
 *
 *   1. download the ORIGINAL bytes (?dlRaw=, authenticated) and check size
 *      and sha1 against the asset doc
 *   2. write them to Blobs "commission-artwork" exactly as the upload page
 *      does (parts + a 'complete' manifest) at a DETERMINISTIC id, so a
 *      re-run lands on the same keys; skipped if already there, intact
 *   3. read every part back and compare the sha256 — a mismatch stops
 *      everything before Sanity is touched
 *   4. TRANSACTION 1: on the commission (and its draft, if any) add the
 *      finishedArtwork entry and remove EVERY reference to the asset. A
 *      reference from any other document stops the run.
 *   5. re-query references: none may remain
 *   6. TRANSACTION 2: delete the asset (Sanity checks a delete against the
 *      references that exist BEFORE its transaction, so 4 and 6 can't share one)
 *
 * The download name is derived from the orderRef ("<orderRef>-artwork-1.png"),
 * never the asset's original filename. A commission whose emailed link is
 * still live (delivered < 30 days ago) is skipped unless includeLive: its old
 * link reads the Sanity file, which step 6 deletes.
 */
import { createHash } from 'node:crypto';
import {
  PART_SIZE, TYPES, partCount, partKey, manifestKey, extOf, safeFilename,
} from '../../netlify/functions/_shared/artwork-keys.mjs';
import { artworkEntry } from '../../netlify/functions/_shared/commission-artwork.mjs';
import { refPaths, unsetPathsFor } from '../commission-photos/migrate-lib.mjs';

export const LINK_DAYS = 30;
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const EXT_BY_MIME = Object.fromEntries(Object.entries(TYPES).map(([e, m]) => [m, e]));

/** Same id every run for the same asset. */
export const migratedUploadId = (assetId) => sha256(`pixel8-commission-artwork:${assetId}`).slice(0, 32);

/**
 * @param commissions [{ _id, orderRef, status, deliveredAt, hasDraft, artworkCount,
 *                       file: { assetId, bytes, sha1, mime, ext, url } }]
 */
export function planArtwork(commissions, { now = Date.now(), includeLive = false } = {}) {
  const items = [];
  const problems = [];
  for (const c of commissions) {
    const f = c.file || {};
    const ext = (f.ext && TYPES[f.ext.toLowerCase()] ? f.ext.toLowerCase() : '') || EXT_BY_MIME[f.mime] || '';
    if (!f.assetId) { problems.push(`${c._id}: finishedFile has no asset`); continue; }
    if (!ext) { problems.push(`${c._id}: file type ${f.mime || '?'} (.${f.ext || '?'}) isn't an accepted artwork type`); continue; }
    if (!c.orderRef) { problems.push(`${c._id}: no orderRef`); continue; }
    const liveUntil = c.deliveredAt ? Date.parse(c.deliveredAt) + LINK_DAYS * 86400000 : 0;
    if (liveUntil > now && !includeLive) {
      problems.push(`${c._id}: its download link is live until ${new Date(liveUntil).toISOString().slice(0, 10)} — migrate after that (or pass --include-live)`);
      continue;
    }
    const uploadId = migratedUploadId(f.assetId);
    items.push({
      commissionId: c._id, orderRef: c.orderRef, hasDraft: Boolean(c.hasDraft), assetId: f.assetId,
      url: f.url, bytes: f.bytes, sha1: f.sha1 || null, contentType: TYPES[ext], uploadId,
      filename: safeFilename({ orderRef: c.orderRef, ext, n: (c.artworkCount || 0) + 1 }),
      parts: partCount(f.bytes), linkExpired: liveUntil ? liveUntil <= now : null,
    });
  }
  return { items, problems };
}

/** Is the file already in Blobs, byte for byte? (Hash of the parts read back.) */
async function storedSha(store, item) {
  const h = createHash('sha256');
  let total = 0;
  for (let n = 0; n < item.parts; n++) {
    const buf = await store.get(partKey(item.orderRef, item.uploadId, n), { type: 'arrayBuffer' });
    if (!buf) return null;
    total += buf.byteLength;
    h.update(Buffer.from(buf));
  }
  return total === item.bytes ? h.digest('hex') : null;
}

/** The finishedArtwork patches for transaction 1 (throws on a stranger's reference). */
export function referencePatches(item, entry, docs) {
  const allowed = new Set([item.commissionId, `drafts.${item.commissionId}`]);
  const stranger = docs.find((d) => !allowed.has(d._id));
  if (stranger) throw new Error(`the asset is also referenced by ${stranger._id} (${stranger._type}) — not migrating it`);
  return docs.map((d) => ({
    id: d._id,
    rev: d._rev,
    unset: unsetPathsFor(d, item.assetId).map((p) => (p === 'finishedFile.asset' ? 'finishedFile' : p)),
    append: (d.finishedArtwork || []).some((a) => a._key === entry._key) ? null : entry,
  }));
}

/**
 * deps: mode 'dry'|'validate'|'apply', fetchBytes(item) → Buffer,
 *       store { get(k,{type}), set(k,bytes,{metadata}), setJSON }, refsTo(assetId),
 *       commitRefs(patches,{dryRun}) → resulting docs, deleteAsset(assetId), now()
 */
export async function migrateArtwork(item, deps) {
  const manifest = {
    uploadId: item.uploadId, orderRef: item.orderRef, filename: item.filename, contentType: item.contentType,
    size: item.bytes, partSize: PART_SIZE, parts: item.parts, state: 'complete', listed: true,
    migratedFrom: 'sanity', createdAt: new Date(deps.now()).toISOString(),
  };
  if (deps.mode === 'dry') return { sha: '', uploaded: false, alreadyThere: false, patched: [], deleted: false, entry: null };

  const bytes = await deps.fetchBytes(item);
  if (bytes.byteLength !== item.bytes) throw new Error(`downloaded ${bytes.byteLength} bytes but the asset says ${item.bytes} — not the original file`);
  if (item.sha1 && createHash('sha1').update(bytes).digest('hex') !== item.sha1) {
    throw new Error('downloaded bytes do not match the asset sha1hash — not the original file');
  }
  const sha = sha256(bytes);
  manifest.sha256 = sha;
  manifest.completedAt = manifest.createdAt;
  const entry = artworkEntry(manifest);

  const alreadyThere = (await storedSha(deps.store, item)) === sha;
  let uploaded = false;
  if (deps.mode === 'apply') {
    if (!alreadyThere) {
      for (let n = 0; n < item.parts; n++) {
        const part = bytes.subarray(n * PART_SIZE, Math.min(bytes.byteLength, (n + 1) * PART_SIZE));
        await deps.store.set(partKey(item.orderRef, item.uploadId, n), part, { metadata: { bytes: part.byteLength, sha256: sha256(part) } });
      }
      uploaded = true;
    }
    const back = await storedSha(deps.store, item);
    if (back !== sha) throw new Error(`hash mismatch after upload (source ${sha.slice(0, 12)}…, stored ${String(back).slice(0, 12)}…) — Sanity not touched`);
    await deps.store.setJSON(manifestKey(item.orderRef, item.uploadId), manifest);
  }

  // ── Transaction 1: list the Blobs file; remove every reference to the asset.
  const docs = await deps.refsTo(item.assetId);
  const patches = referencePatches(item, entry, docs);
  const dryRun = deps.mode !== 'apply';
  const after = patches.length ? await deps.commitRefs(patches, { dryRun }) : [];
  const still = (after || []).filter((d) => refPaths(d, item.assetId).length);
  if (still.length) throw new Error(`after the update ${still.map((d) => d._id).join(', ')} would still reference the asset — stopping`);
  if (dryRun) return { sha, uploaded, alreadyThere, patched: patches.map((p) => p.id), deleted: false, entry };

  // ── Transaction 2: delete the asset, only once nothing references it.
  const remaining = await deps.refsTo(item.assetId);
  if (remaining.length) {
    throw new Error(`still referenced by ${remaining.map((d) => d._id).join(', ')} after the update — the file is in Blobs; the asset is left for a re-run`);
  }
  await deps.deleteAsset(item.assetId);
  return { sha, uploaded, alreadyThere, patched: patches.map((p) => p.id), deleted: true, entry };
}
