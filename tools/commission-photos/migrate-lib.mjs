/**
 * tools/commission-photos/migrate-lib.mjs
 *
 * The logic of tools/migrate-commission-photos.mjs, with its I/O injected so
 * the tests can run it against mocks.
 *
 * One photo at a time, all-or-nothing:
 *   1. download the Sanity asset's bytes; check the size matches the asset doc
 *   2. write them to Blobs at a DETERMINISTIC key (so a re-run lands on the
 *      same key), unless a blob with the same sha256 is already there
 *   3. read the blob back and compare sha256 — a mismatch stops everything
 *      before Sanity is touched
 *   4. ONE Sanity transaction: append the entry to uploadedPhotos, remove it
 *      from uploadedFiles (the stored original filename goes with it), patch
 *      the draft too if there is one, and delete the asset
 * Then the orphan commission-upload assets are deleted.
 */
import { createHash } from 'node:crypto';

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** A UUID-shaped id derived from a seed, so re-runs produce the same keys. */
export function deterministicUuid(seed) {
  const h = sha256(`pixel8-commission-photo:${seed}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' };

/**
 * @param commissions  [{ _id, _rev, hasDraft, entries: [{ _key, fieldKey, assetId, bytes, mime, w, h, url }] }]
 * @param orphans      [{ _id, size, mimeType, _createdAt }]
 */
export function planMigration(commissions, orphans) {
  const photos = [];
  const problems = [];
  for (const c of commissions) {
    for (const e of c.entries || []) {
      const ext = EXT[e.mime];
      if (!e.assetId || !ext) { problems.push(`${c._id} ${e._key}: unsupported or missing asset (${e.mime || 'no asset'})`); continue; }
      photos.push({
        commissionId: c._id,
        hasDraft: Boolean(c.hasDraft),
        entryKey: e._key,
        fieldKey: e.fieldKey || 'unknown',
        assetId: e.assetId,
        url: e.url,
        bytes: e.bytes,
        mime: e.mime,
        width: e.w ?? null,
        height: e.h ?? null,
        newKey: `commission-upload/${deterministicUuid(c._id)}/${deterministicUuid(e.assetId)}.${ext}`,
      });
    }
  }
  return { photos, orphans, problems };
}

/**
 * Migrate one photo.
 * deps:
 *   fetchBytes(photo)                   → Buffer (the asset's bytes)
 *   store                               { getMetadata, get(key,{type:'arrayBuffer'}), set }
 *   commitPhoto(photo, entry, {dryRun}) → Sanity transaction (patch + delete asset)
 *   mode                                'dry' | 'validate' | 'apply'
 * @returns {Promise<{ uploaded: boolean, alreadyThere: boolean, sha: string }>}  throws on any problem
 */
export async function migratePhoto(photo, deps) {
  const entry = {
    _type: 'commissionPhoto', _key: photo.entryKey, fieldKey: photo.fieldKey, key: photo.newKey,
    contentType: photo.mime, bytes: photo.bytes, width: photo.width, height: photo.height,
  };
  if (deps.mode === 'dry') return { uploaded: false, alreadyThere: false, sha: '', entry };

  const bytes = await deps.fetchBytes(photo);
  if (bytes.byteLength !== photo.bytes) {
    throw new Error(`downloaded ${bytes.byteLength} bytes but the asset says ${photo.bytes}`);
  }
  const sha = sha256(bytes);

  const existing = await deps.store.getMetadata(photo.newKey);
  let alreadyThere = existing?.metadata?.sha256 === sha;
  let uploaded = false;
  if (deps.mode === 'apply') {
    // Trust the bytes, not the metadata: a blob left by a run that failed
    // its read-back must be re-sent, not skipped for ever.
    if (alreadyThere) {
      const cur = await deps.store.get(photo.newKey, { type: 'arrayBuffer' });
      alreadyThere = Boolean(cur) && sha256(Buffer.from(cur)) === sha;
    }
    if (!alreadyThere) {
      await deps.store.set(photo.newKey, bytes, {
        metadata: {
          uploadId: photo.newKey.split('/')[1], fieldKey: photo.fieldKey, contentType: photo.mime,
          bytes: photo.bytes, width: photo.width, height: photo.height, sha256: sha,
          uploadedAt: new Date().toISOString(), migratedFrom: 'sanity',
        },
      });
      uploaded = true;
    }
    const back = await deps.store.get(photo.newKey, { type: 'arrayBuffer' });
    const backSha = back ? sha256(Buffer.from(back)) : 'missing';
    if (backSha !== sha) {
      throw new Error(`hash mismatch after upload (source ${sha.slice(0, 12)}…, stored ${backSha.slice(0, 12)}…) — Sanity not touched`);
    }
  }
  await deps.commitPhoto(photo, entry, { dryRun: deps.mode !== 'apply' });
  return { uploaded, alreadyThere, sha, entry };
}
