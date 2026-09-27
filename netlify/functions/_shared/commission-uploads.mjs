/**
 * netlify/functions/_shared/commission-uploads.mjs
 *
 * Customers' commission photos, in the PRIVATE Netlify Blobs store
 * "commission-uploads" (they used to be Sanity image assets, which are
 * public by URL and anonymously listable).
 *
 *   key       commission-upload/<uploadId>/<uuid>.<ext>
 *             uploadId groups one visit to the commission form; the file
 *             part is random. No original filename anywhere — customers
 *             name files after people.
 *   metadata  { uploadId, fieldKey, contentType, bytes, width, height, uploadedAt }
 *
 * Location and camera metadata (EXIF incl. GPS, XMP, IPTC, text chunks) is
 * removed before storing — losslessly, see strip-metadata.mjs. HEIC/HEIF is
 * refused with a friendly message (it can't be checked here).
 *
 * The commission doc stores, per photo: fieldKey, key, contentType, bytes,
 * width, height (field uploadedPhotos). Staff view them through the
 * /admin/commission-photo/… edge function.
 *
 * I/O is injected (store, sharp, uuid, now) so the tests can drive it.
 */

export const UPLOADS_STORE = 'commission-uploads';
export const KEY_PREFIX = 'commission-upload/';

/** Same limits as before the move (upload.mts / CommissionWorkflow.jsx). */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const ALLOWED_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

/** Abandoned uploads (no commission refers to them) are deleted after this. */
export const ABANDONED_AFTER_MS = 48 * 60 * 60 * 1000;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID_RE = new RegExp(`^${UUID}$`);
export const UPLOAD_KEY_RE = new RegExp(`^commission-upload/${UUID}/${UUID}\\.(jpg|png|webp|heic|heif)$`);
export const isUploadId = (s) => typeof s === 'string' && UUID_RE.test(s);
export const isUploadKey = (s) => typeof s === 'string' && UPLOAD_KEY_RE.test(s);

/**
 * Validate, strip metadata from, and store one uploaded photo.
 * @param {{ bytes: Uint8Array|Buffer, contentType: string, fieldKey?: string, uploadId?: string }} input
 * @param {{ store, uuid: () => string, now?: () => Date, imageSize?: (buf) => Promise<{width,height}|null>,
 *           strip: (buf, type) => Promise<{ buffer, removed, hadGps }> }} deps
 * @returns {Promise<{ ok: true, uploadKey, uploadId, fieldKey, contentType, bytes, width, height } | { ok: false, status, error }>}
 */
export async function storeUpload(input, deps) {
  const ext = ALLOWED_TYPES[input.contentType];
  if (!ext) {
    return { ok: false, status: 400, error: `Unsupported file type: ${input.contentType || 'unknown'}. Use JPG, PNG, WebP, or HEIC.` };
  }
  const bytes = input.bytes?.byteLength ?? 0;
  if (!bytes) return { ok: false, status: 400, error: 'No file in request.' };
  if (bytes > MAX_FILE_SIZE) {
    return { ok: false, status: 413, error: `File too large (${(bytes / 1048576).toFixed(1)}MB). The single-file limit is ${MAX_FILE_SIZE / 1048576}MB.` };
  }
  let clean;
  try {
    clean = await deps.strip(input.bytes, input.contentType);
  } catch (err) {
    return { ok: false, status: 400, error: err?.customerMessage || "We couldn't read that image. Please try a different photo." };
  }
  const stored = clean.buffer;
  const uploadId = isUploadId(input.uploadId) ? input.uploadId : deps.uuid();
  const fieldKey = String(input.fieldKey || 'unknown').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60) || 'unknown';
  const uploadKey = `${KEY_PREFIX}${uploadId}/${deps.uuid()}.${ext}`;

  let size = null;
  try { size = deps.imageSize ? await deps.imageSize(stored) : null; } catch { size = null; }
  const metadata = {
    uploadId, fieldKey, contentType: input.contentType, bytes: stored.length,
    width: size?.width ?? null, height: size?.height ?? null,
    uploadedAt: (deps.now ? deps.now() : new Date()).toISOString(),
  };
  await deps.store.set(uploadKey, stored, { metadata });
  return {
    ok: true, uploadKey, uploadId, fieldKey, contentType: metadata.contentType, bytes: stored.length,
    width: metadata.width, height: metadata.height,
    stripped: clean.removed || [], hadGps: Boolean(clean.hadGps), // for the log only; not stored
  };
}

/**
 * Turn the keys the browser sends at checkout into commission-doc entries,
 * checking each one really is in the store (a guessed or expired key is refused).
 * @returns {Promise<{ ok: true, photos: Array } | { ok: false, error: string }>}
 */
export async function photosForCommission(refs, { store, makeKey }) {
  const photos = [];
  for (const r of refs) {
    if (!isUploadKey(r?.uploadKey)) return { ok: false, error: 'A photo reference was invalid. Please remove it and upload it again.' };
    const m = await store.getMetadata(r.uploadKey);
    if (!m) return { ok: false, error: 'One of your photos has expired. Please remove it and upload it again.' };
    const md = m.metadata || {};
    photos.push({
      _type: 'commissionPhoto',
      _key: makeKey(),
      fieldKey: String(r.fieldKey || md.fieldKey || 'unknown').slice(0, 60),
      key: r.uploadKey,
      contentType: md.contentType || null,
      bytes: md.bytes ?? null,
      width: md.width ?? null,
      height: md.height ?? null,
    });
  }
  return { ok: true, photos };
}

/**
 * Hourly: delete uploads no commission refers to, once they're older than
 * ABANDONED_AFTER_MS. Never deletes a key in `attachedKeys`. Stops starting
 * new work when `timeLeft()` runs low (the sweep has 30 s in all).
 *
 * @param deps.store         list({prefix}) → { blobs: [{ key }] }, getMetadata, delete
 * @param deps.attachedKeys  Set of keys referenced by any commission (incl. drafts)
 * @returns {Promise<{ checked, deleted, kept, attached, deferred }>}
 */
export async function sweepAbandonedUploads({ store, attachedKeys, now = Date.now(), maxAgeMs = ABANDONED_AFTER_MS, timeLeft = () => Infinity, minTimeMs = 1500, dry = false }) {
  const r = { checked: 0, deleted: 0, kept: 0, attached: 0, deferred: 0 };
  const { blobs } = await store.list({ prefix: KEY_PREFIX });
  for (const b of blobs) {
    if (timeLeft() < minTimeMs) { r.deferred++; continue; }
    r.checked++;
    if (attachedKeys.has(b.key)) { r.attached++; continue; }
    const m = await store.getMetadata(b.key);
    const at = Date.parse(m?.metadata?.uploadedAt || '');
    // No readable upload time: treat as old rather than keeping a customer photo for ever.
    const age = Number.isFinite(at) ? now - at : Infinity;
    if (age < maxAgeMs) { r.kept++; continue; }
    if (!dry) await store.delete(b.key);
    r.deleted++;
  }
  return r;
}
