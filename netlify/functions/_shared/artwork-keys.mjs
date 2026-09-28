/**
 * netlify/functions/_shared/artwork-keys.mjs
 *
 * Finished commission artwork in the private Blobs store "commission-artwork".
 * Dependency-free on purpose: the download edge function imports it.
 *
 *   artwork/<orderRef>/<uploadId>/manifest.json   what the file is, and its state
 *   artwork/<orderRef>/<uploadId>/part-000000     the bytes, PART_SIZE per part
 *   artwork/<orderRef>/<uploadId>/part-000001     (the last part may be shorter)
 *
 * Parts, because a function request body is capped at about 6 MB (about
 * 4.5 MB of binary once Netlify base64-encodes it): the browser sends one
 * part per request. The download edge function streams them back in order
 * as one file.
 *
 * Manifest: { uploadId, orderRef, filename, contentType, size, partSize,
 *   parts, sha256 (declared by the browser at completion), state:
 *   'uploading' | 'verifying' | 'complete' | 'failed', error?, createdAt,
 *   completedAt?, migratedFrom? }
 * The filename is typed by the admin or derived from the orderRef; never the
 * customer's name, and never the original file's name.
 *
 * The signed download link's `file` parameter for Blobs artwork is
 * "blob:<orderRef>/<uploadId>" (a Sanity-hosted file's is its asset id).
 */

export const ARTWORK_STORE = 'commission-artwork';
/** 4,000,000 bytes: base64 ≈ 5.33 MB, under the ~6 MB request limit with room for headers. */
export const PART_SIZE = 4_000_000;
export const MAX_FILE_BYTES = 2 * 1024 ** 3;

/** Allowed file types, by extension; the content type comes from here, not the browser. */
export const TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic', psd: 'image/vnd.adobe.photoshop',
  pdf: 'application/pdf',
  mp4: 'video/mp4', m4v: 'video/x-m4v', mov: 'video/quicktime', webm: 'video/webm',
  zip: 'application/zip',
};

const ORDER_RE = /^[A-Za-z0-9_-]{3,40}$/;
const UPLOAD_RE = /^[0-9a-f]{32}$/;
export const isOrderRef = (s) => typeof s === 'string' && ORDER_RE.test(s);
export const isArtworkId = (s) => typeof s === 'string' && UPLOAD_RE.test(s);

export const artworkPrefix = (orderRef, uploadId) => `artwork/${orderRef}/${uploadId}/`;
export const manifestKey = (orderRef, uploadId) => `${artworkPrefix(orderRef, uploadId)}manifest.json`;
export const partKey = (orderRef, uploadId, n) => `${artworkPrefix(orderRef, uploadId)}part-${String(n).padStart(6, '0')}`;
export const partCount = (size) => Math.max(1, Math.ceil(size / PART_SIZE));
/** The exact length part n must have. */
export const partLength = (size, n) => (n < partCount(size) - 1 ? PART_SIZE : size - PART_SIZE * (partCount(size) - 1));

export const fileRefFor = (orderRef, uploadId) => `blob:${orderRef}/${uploadId}`;
/** @returns {{ orderRef, uploadId } | null} */
export function parseFileRef(ref) {
  const m = /^blob:([A-Za-z0-9_-]{3,40})\/([0-9a-f]{32})$/.exec(String(ref || ''));
  return m ? { orderRef: m[1], uploadId: m[2] } : null;
}

export const extOf = (name) => (/\.([A-Za-z0-9]{1,5})$/.exec(String(name || '')) || [])[1]?.toLowerCase() || '';

/**
 * The stored download name. `typed`: what the admin typed (letters, digits,
 * . _ - only; the extension is forced to the file's). Otherwise
 * "<orderRef>-artwork-<n>.<ext>".
 */
export function safeFilename({ typed, orderRef, ext, n = 1 }) {
  const base = String(typed || '').trim().replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 80);
  return `${base || `${orderRef}-artwork-${n}`}.${ext}`;
}

/** A Content-Disposition value that can't break out of its quotes. */
export const disposition = (filename) => `attachment; filename="${String(filename).replace(/[^A-Za-z0-9._-]/g, '-')}"`;
