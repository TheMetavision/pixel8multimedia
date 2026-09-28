/**
 * netlify/functions/_shared/commission-artwork.mjs
 *
 * Chunked, resumable upload of finished commission artwork into the private
 * Blobs store "commission-artwork" (keys: artwork-keys.mjs).
 *
 *   init      → a manifest (state 'uploading'); a refresh finds the same one
 *               (the upload id is derived from the order, the file's size,
 *               modification time, extension and original name — the name is
 *               only hashed, never stored) and gets back the parts it already has
 *   part n    → exactly partLength bytes, whose sha256 matches the header
 *   complete  → every part present; the browser's whole-file sha256 recorded;
 *               state 'verifying'; the background verifier started
 *   verify    → (background) re-hash the stored parts in order; only on an
 *               exact match: state 'complete' and the file is listed on the
 *               commission (finishedArtwork, published doc AND draft). A
 *               mismatch: state 'failed', parts deleted, nothing listed.
 *
 * deps (injected; the tests use fakes):
 *   store            Blobs-like: get(k,{type:'json'|'stream'}), setJSON, set(k,bytes,{metadata}),
 *                    getMetadata, list({prefix}), delete
 *   now()            ms
 *   findCommission(orderRef) → { _id, orderRef, status, deliveryType, hasDraft, artwork: [...] } | null
 *   listArtwork(commission, entry) → add/replace the finishedArtwork entry (published + draft)
 *   trigger(body)    → Promise<{ ok, error? }> starts the background verifier
 *   sha256Stream()   → { update(buf), digest() → hex }   (node:crypto in production)
 */
import { createHash } from 'node:crypto';
import {
  PART_SIZE, MAX_FILE_BYTES, TYPES, isOrderRef, isArtworkId, artworkPrefix, manifestKey, partKey,
  partCount, partLength, extOf, safeFilename,
} from './artwork-keys.mjs';

const HEX64 = /^[0-9a-f]{64}$/;
const fail = (status, error) => ({ ok: false, status, error });

/** Stable per file, so a refresh resumes the same upload. The original name is only hashed. */
export function uploadIdFor({ orderRef, name, size, lastModified, ext }) {
  return createHash('sha256').update(`${orderRef}\n${name}\n${size}\n${lastModified}\n${ext}`).digest('hex').slice(0, 32);
}

const readManifest = (deps, orderRef, uploadId) =>
  deps.store.get(manifestKey(orderRef, uploadId), { type: 'json' }).catch(() => null);
const writeManifest = (deps, m) => deps.store.setJSON(manifestKey(m.orderRef, m.uploadId), m);

/** Part indexes already stored. */
export async function receivedParts(deps, orderRef, uploadId) {
  const { blobs } = await deps.store.list({ prefix: artworkPrefix(orderRef, uploadId) });
  return blobs.map((b) => /\/part-(\d{6})$/.exec(b.key)?.[1]).filter(Boolean).map(Number).sort((a, b) => a - b);
}

async function deleteParts(deps, orderRef, uploadId) {
  for (const n of await receivedParts(deps, orderRef, uploadId)) await deps.store.delete(partKey(orderRef, uploadId, n));
}

const publicView = (m, received) => ({
  ok: true, uploadId: m.uploadId, filename: m.filename, contentType: m.contentType, size: m.size,
  partSize: m.partSize, parts: m.parts, state: m.state, error: m.error, listed: m.listed,
  ...(received ? { received } : {}),
});

/**
 * Start, or resume, one file's upload.
 * @param input { orderRef, name (original, hashed only), size, lastModified, filename? (typed) }
 */
export async function initUpload(input, deps) {
  const { orderRef } = input;
  if (!isOrderRef(orderRef)) return fail(400, 'Bad order reference.');
  const size = Number(input.size);
  if (!Number.isInteger(size) || size < 1) return fail(400, 'Empty file.');
  if (size > MAX_FILE_BYTES) return fail(413, `Files are limited to ${MAX_FILE_BYTES / 1024 ** 3} GB.`);
  const ext = extOf(input.name);
  if (!TYPES[ext]) return fail(415, `.${ext || '?'} files aren't accepted. Images, PDF, video (mp4/mov/webm) or zip.`);
  const commission = await deps.findCommission(orderRef);
  if (!commission) return fail(404, `No commission ${orderRef}.`);

  const uploadId = uploadIdFor({ orderRef, name: String(input.name), size, lastModified: Number(input.lastModified) || 0, ext });
  const cur = await readManifest(deps, orderRef, uploadId);
  if (cur && cur.state !== 'failed') {
    return publicView(cur, cur.state === 'uploading' ? await receivedParts(deps, orderRef, uploadId) : undefined);
  }
  if (cur) await deleteParts(deps, orderRef, uploadId); // a failed attempt starts again from nothing

  const m = {
    uploadId, orderRef,
    filename: safeFilename({ typed: input.filename, orderRef, ext, n: (commission.artwork?.length || 0) + 1 }),
    contentType: TYPES[ext], size, partSize: PART_SIZE, parts: partCount(size),
    state: 'uploading', createdAt: new Date(deps.now()).toISOString(),
  };
  await writeManifest(deps, m);
  return publicView(m, []);
}

/** Store part n. Idempotent: sending the same part again just overwrites it. */
export async function putPart({ orderRef, uploadId, n, bytes, sha256 }, deps) {
  if (!isOrderRef(orderRef) || !isArtworkId(uploadId)) return fail(400, 'Bad upload id.');
  const m = await readManifest(deps, orderRef, uploadId);
  if (!m) return fail(404, 'Unknown upload — start again.');
  if (m.state !== 'uploading') return fail(409, `This upload is ${m.state}.`);
  const i = Number(n);
  if (!Number.isInteger(i) || i < 0 || i >= m.parts) return fail(400, `Part ${n} is out of range (0–${m.parts - 1}).`);
  const want = partLength(m.size, i);
  if (bytes.byteLength !== want) return fail(400, `Part ${i} is ${bytes.byteLength} bytes; expected ${want}.`);
  const got = createHash('sha256').update(bytes).digest('hex');
  if (got !== String(sha256 || '').toLowerCase()) return fail(400, `Part ${i} arrived damaged (sha256 mismatch) — resend it.`);
  await deps.store.set(partKey(orderRef, uploadId, i), bytes, { metadata: { bytes: want, sha256: got } });
  return { ok: true, n: i };
}

export async function uploadStatus({ orderRef, uploadId }, deps) {
  if (!isOrderRef(orderRef) || !isArtworkId(uploadId)) return fail(400, 'Bad upload id.');
  const m = await readManifest(deps, orderRef, uploadId);
  if (!m) return fail(404, 'Unknown upload.');
  return publicView(m, m.state === 'uploading' ? await receivedParts(deps, orderRef, uploadId) : undefined);
}

/** Every part is in: record the browser's hash and hand over to the verifier. */
export async function completeUpload({ orderRef, uploadId, sha256 }, deps) {
  if (!isOrderRef(orderRef) || !isArtworkId(uploadId)) return fail(400, 'Bad upload id.');
  const m = await readManifest(deps, orderRef, uploadId);
  if (!m) return fail(404, 'Unknown upload.');
  if (m.state === 'complete' && !m.listed) return listOnCommission(m, deps);
  if (m.state !== 'uploading') return publicView(m);
  const declared = String(sha256 || '').toLowerCase();
  if (!HEX64.test(declared)) return fail(400, 'A sha256 of the whole file is required.');
  const have = new Set(await receivedParts(deps, orderRef, uploadId));
  const missing = [...Array(m.parts).keys()].filter((i) => !have.has(i));
  if (missing.length) return { ...fail(409, `${missing.length} part(s) still missing.`), missing: missing.slice(0, 50) };

  await writeManifest(deps, { ...m, sha256: declared, state: 'verifying' });
  const r = await deps.trigger({ orderRef, uploadId });
  if (!r.ok) {
    await writeManifest(deps, { ...m, state: 'uploading' });
    return fail(502, `Could not start the check: ${r.error || 'unknown error'} — press Upload again.`);
  }
  return publicView({ ...m, sha256: declared, state: 'verifying' });
}

/**
 * The background check: re-hash the stored parts, in order, as one stream.
 * Only an exact match (every part's length, the total, and the sha256) makes
 * the file 'complete'.
 */
export async function verifyUpload({ orderRef, uploadId }, deps) {
  if (!isOrderRef(orderRef) || !isArtworkId(uploadId)) return fail(400, 'Bad upload id.');
  const m = await readManifest(deps, orderRef, uploadId);
  if (!m) return fail(404, 'Unknown upload.');
  if (m.state === 'complete') return m.listed ? publicView(m) : listOnCommission(m, deps);
  if (m.state !== 'verifying') return fail(409, `This upload is ${m.state}.`);

  const h = deps.sha256Stream ? deps.sha256Stream() : nodeSha256();
  let total = 0;
  let problem = '';
  for (let i = 0; i < m.parts && !problem; i++) {
    const stream = await deps.store.get(partKey(orderRef, uploadId, i), { type: 'stream' });
    if (!stream) { problem = `part ${i} is missing`; break; }
    let len = 0;
    for await (const chunk of stream) { const b = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk); len += b.byteLength; h.update(b); }
    if (len !== partLength(m.size, i)) problem = `part ${i} is ${len} bytes, expected ${partLength(m.size, i)}`;
    total += len;
  }
  const sha = problem ? '' : h.digest();
  if (!problem && total !== m.size) problem = `stored ${total} bytes, expected ${m.size}`;
  if (!problem && sha !== m.sha256) problem = 'sha256 of the stored file does not match the file that was sent';
  if (problem) {
    await writeManifest(deps, { ...m, state: 'failed', error: problem });
    await deleteParts(deps, orderRef, uploadId);
    return fail(422, problem);
  }
  const done = { ...m, state: 'complete', completedAt: new Date(deps.now()).toISOString() };
  await writeManifest(deps, done);
  return listOnCommission(done, deps);
}

/** The Sanity entry for a finished file (what Studio shows and delivery reads). */
export const artworkEntry = (m) => ({
  _type: 'commissionArtwork', _key: m.uploadId, uploadId: m.uploadId, filename: m.filename,
  contentType: m.contentType, bytes: m.size, sha256: m.sha256, uploadedAt: m.completedAt,
});

async function listOnCommission(m, deps) {
  try {
    const commission = await deps.findCommission(m.orderRef);
    if (!commission) throw new Error(`no commission ${m.orderRef}`);
    await deps.listArtwork(commission, artworkEntry(m));
    await writeManifest(deps, { ...m, listed: true, error: undefined });
    return publicView({ ...m, listed: true });
  } catch (err) {
    const error = `stored and verified, but not yet listed on the commission: ${String(err?.message || err).slice(0, 200)} — press Upload again to retry`;
    await writeManifest(deps, { ...m, listed: false, error });
    return fail(502, error);
  }
}

function nodeSha256() {
  const h = createHash('sha256');
  return { update: (b) => h.update(b), digest: () => h.digest('hex') };
}
