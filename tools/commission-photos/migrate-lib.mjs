/**
 * tools/commission-photos/migrate-lib.mjs
 *
 * The logic of tools/migrate-commission-photos.mjs, with its I/O injected so
 * the tests can run it against mocks.
 *
 * One photo at a time:
 *   1. download the ORIGINAL bytes (?dlRaw=, authenticated: the plain CDN URL
 *      re-encodes JPEGs) and check size and sha1 against the asset doc
 *   2. write them to Blobs at a DETERMINISTIC key (so a re-run lands on the
 *      same key), unless a blob with the same bytes is already there
 *   3. read the blob back and compare sha256 — a mismatch stops everything
 *      before Sanity is touched
 *   4. TRANSACTION 1: on every document that references the asset (the
 *      commission and its draft, if any), add the uploadedPhotos entry and
 *      remove EVERY reference to the asset — the uploadedFiles entry (and its
 *      stored filename) and any leftover image field. A reference from any
 *      other document stops the run.
 *   5. re-query references($assetId): it must now be empty
 *   6. TRANSACTION 2: delete the asset.
 * Sanity checks a delete against the references that exist BEFORE its
 * transaction, so 4 and 6 can't share one. Between them the photo is safe:
 * the commission already points at Blobs, and the asset (unreferenced, still
 * labelled commission-upload) is deleted by a re-run's orphan phase, which
 * re-checks for references first.
 *
 * Then the orphan commission-upload assets are deleted, each re-checked for
 * references (published or draft) immediately before.
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
 * @param commissions  [{ _id, hasDraft, entries: [{ _key, fieldKey, assetId, bytes, sha1, mime, w, h, url }] }]
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
        sha1: e.sha1 || null,
        mime: e.mime,
        width: e.w ?? null,
        height: e.h ?? null,
        newKey: `commission-upload/${deterministicUuid(c._id)}/${deterministicUuid(e.assetId)}.${ext}`,
      });
    }
  }
  return { photos, orphans, problems };
}

/** Every JSONMatch path in `value` whose _ref is `id`. */
export function refPaths(value, id, path = '') {
  const out = [];
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      const seg = item && typeof item === 'object' && item._key ? `[_key=="${item._key}"]` : `[${i}]`;
      out.push(...refPaths(item, id, `${path}${seg}`));
    });
  } else if (value && typeof value === 'object') {
    if (value._ref === id) out.push(path);
    for (const [k, v] of Object.entries(value)) {
      if (k === '_ref') continue;
      out.push(...refPaths(v, id, path ? `${path}.${k}` : k));
    }
  }
  return out;
}

/**
 * What to unset so a document no longer references the asset: an image
 * object ({ asset: { _ref } }) goes whole (the uploadedFiles entry with its
 * filename, or a leftover image field); a bare reference goes as itself.
 */
export function unsetPathsFor(doc, assetId) {
  return [...new Set(refPaths(doc, assetId).map((p) => (p.endsWith('.asset') ? p.slice(0, -'.asset'.length) : p)))];
}

/**
 * The patches for transaction 1.
 * @param docs  every document that references the asset (published and drafts), in full
 * @returns {{ patches: Array<{ id, rev, unset, append }> }}  throws if a document
 *          other than the commission or its draft references it
 */
export function referencePatches(photo, entry, docs) {
  const allowed = new Set([photo.commissionId, `drafts.${photo.commissionId}`]);
  const stranger = docs.find((d) => !allowed.has(d._id));
  if (stranger) throw new Error(`the asset is also referenced by ${stranger._id} (${stranger._type}) — not migrating it`);
  return {
    patches: docs.map((d) => ({
      id: d._id,
      rev: d._rev,
      unset: unsetPathsFor(d, photo.assetId),
      append: (d.uploadedPhotos || []).some((p) => p._key === entry._key) ? null : entry,
    })),
  };
}

/**
 * Migrate one photo.
 * deps:
 *   fetchBytes(photo)              → Buffer (the asset's bytes)
 *   store                          { getMetadata, get(key,{type:'arrayBuffer'}), set }
 *   refsTo(assetId)                → every document referencing it (published AND drafts), in full
 *   commitRefs(patches, {dryRun})  → transaction 1; resolves to the resulting documents
 *   deleteAsset(assetId)           → transaction 2
 *   mode                           'dry' | 'validate' | 'apply'
 * @returns {Promise<{ uploaded, alreadyThere, sha, entry, patched: string[], deleted: boolean }>}
 *          throws on any problem
 */
export async function migratePhoto(photo, deps) {
  const entry = {
    _type: 'commissionPhoto', _key: photo.entryKey, fieldKey: photo.fieldKey, key: photo.newKey,
    contentType: photo.mime, bytes: photo.bytes, width: photo.width, height: photo.height,
  };
  if (deps.mode === 'dry') return { uploaded: false, alreadyThere: false, sha: '', entry, patched: [], deleted: false };

  const bytes = await deps.fetchBytes(photo);
  if (bytes.byteLength !== photo.bytes) {
    throw new Error(`downloaded ${bytes.byteLength} bytes but the asset says ${photo.bytes} — not the original file`);
  }
  if (photo.sha1 && createHash('sha1').update(bytes).digest('hex') !== photo.sha1) {
    throw new Error('downloaded bytes do not match the asset sha1hash — not the original file');
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

  // ── Transaction 1: point every referencing doc at Blobs; remove every reference.
  const docs = await deps.refsTo(photo.assetId);
  const { patches } = referencePatches(photo, entry, docs);
  const dryRun = deps.mode !== 'apply';
  const after = patches.length ? await deps.commitRefs(patches, { dryRun }) : [];
  const still = (after || []).filter((d) => refPaths(d, photo.assetId).length);
  if (still.length) throw new Error(`after the update ${still.map((d) => d._id).join(', ')} would still reference the asset — stopping`);

  if (dryRun) {
    // The delete can't be dry-run: in a dry run transaction 1 didn't happen,
    // so the reference is still there. The check above (every referencing
    // document drops it) is exactly what the real delete needs.
    return { uploaded, alreadyThere, sha, entry, patched: patches.map((p) => p.id), deleted: false };
  }

  // ── Transaction 2: delete the asset, only once nothing references it.
  const remaining = await deps.refsTo(photo.assetId);
  if (remaining.length) {
    throw new Error(`still referenced by ${remaining.map((d) => d._id).join(', ')} after the update — the photo is in Blobs; the asset is left for a re-run`);
  }
  await deps.deleteAsset(photo.assetId);
  return { uploaded, alreadyThere, sha, entry, patched: patches.map((p) => p.id), deleted: true };
}

/**
 * Orphans: delete only those with NO references at all (published or draft),
 * re-checked now rather than trusted from the plan.
 * deps: refsTo(assetId) → docs;  deleteAssets(ids, {dryRun});  mode
 * @returns {Promise<{ deleted: string[], skipped: Array<{ id, by: string[] }> }>}
 */
export async function deleteOrphans(orphans, deps) {
  const ok = [];
  const skipped = [];
  for (const o of orphans) {
    const refs = await deps.refsTo(o._id);
    if (refs.length) skipped.push({ id: o._id, by: refs.map((d) => d._id) });
    else ok.push(o._id);
  }
  if (ok.length && deps.mode !== 'dry') await deps.deleteAssets(ok, { dryRun: deps.mode !== 'apply' });
  return { deleted: ok, skipped };
}
