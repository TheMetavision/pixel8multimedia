/**
 * netlify/functions/_shared/print-sources.mjs
 *
 * What an order line prints from, and how that source is identified.
 *
 *   stock line         the master in Blobs "print-masters", key = product slug.
 *                      Identity = the sha256 in its metadata (set by
 *                      tools/print-masters/upload-masters.mjs).
 *   personalised line  the styled render in Blobs "personalisation",
 *                      personalisation/<pid>/<styleKey>.png, upscaled for print.
 *                      Identity = pid + style + a hash of the render's etag.
 *   historic line      no formatKey/sizeKey (ordered before keyed lines):
 *                      no print data, and never an alert.
 *
 * Store access is injected (a getStore-like function) so tests can use fakes.
 */
import { createHash } from 'node:crypto';
import { isFormatKey, isSizeKey } from './print-spec.mjs';

export const MASTERS_STORE = 'print-masters';
export const PERSONALISATION_STORE = 'personalisation';

/** Mirrors blobKey.render in _shared/personalisation.mts. */
export const renderKey = (pid, styleKey) => `personalisation/${pid}/${styleKey}.png`;

const short = (s, n = 16) => createHash('sha256').update(String(s)).digest('hex').slice(0, n);

/**
 * The print-relevant facts of one Sanity order line.
 * @returns {{ kind: 'historic' } | { kind: 'invalid', reason } |
 *           { kind: 'stock', sizeKey, formatKey, slug, style, wrapColour } |
 *           { kind: 'personalised', sizeKey, formatKey, pid, styleKey, style, wrapColour }}
 */
export function lineSpec(line) {
  if (!line || !line.formatKey || !line.sizeKey) return { kind: 'historic' };
  if (!isFormatKey(line.formatKey) || !isSizeKey(line.sizeKey)) {
    return { kind: 'invalid', reason: `unknown format/size ${line.formatKey}/${line.sizeKey}` };
  }
  const base = { sizeKey: line.sizeKey, formatKey: line.formatKey, wrapColour: line.wrapColour || '' };
  if (line.personalisationId) {
    if (!line.styleKey) return { kind: 'invalid', reason: 'personalised line has no style' };
    return { kind: 'personalised', ...base, pid: line.personalisationId, styleKey: line.styleKey, style: line.styleKey };
  }
  if (!line.productSlug) return { kind: 'invalid', reason: 'stock line has no productSlug' };
  const letter = (line.styleLetter || (/-style-([a-j])$/.exec(line.productSlug) || [])[1] || '').toLowerCase();
  return { kind: 'stock', ...base, slug: line.productSlug, style: letter || 'x' };
}

/**
 * Does the source exist, and what is its identity? Metadata only — no bytes.
 * @param spec      from lineSpec
 * @param stores    (name) => store with getMetadata(key)
 * @returns {{ exists: boolean, identity?: string, key?: string, store?: string }}
 */
export async function sourceInfo(spec, stores) {
  if (spec.kind === 'stock') {
    const m = await stores(MASTERS_STORE).getMetadata(spec.slug);
    if (!m) return { exists: false, store: MASTERS_STORE, key: spec.slug };
    const sha = m.metadata?.sha256;
    return { exists: true, store: MASTERS_STORE, key: spec.slug, identity: sha ? sha.slice(0, 16) : `etag${short(m.etag, 12)}` };
  }
  if (spec.kind === 'personalised') {
    const key = renderKey(spec.pid, spec.styleKey);
    const m = await stores(PERSONALISATION_STORE).getMetadata(key);
    if (!m) return { exists: false, store: PERSONALISATION_STORE, key };
    return { exists: true, store: PERSONALISATION_STORE, key, identity: `${spec.pid}-${spec.styleKey}-${short(m.etag, 10)}` };
  }
  return { exists: false };
}

/** The source bytes, as a Buffer (null if gone). */
export async function loadSource(info, stores) {
  const buf = await stores(info.store).get(info.key, { type: 'arrayBuffer' });
  return buf ? Buffer.from(buf) : null;
}

/**
 * Personalised renders are 2048 px; make them print-sized. Moved from
 * personalisation-print-background: UPSCALE_SERVICE_URL if set (a Real-ESRGAN
 * style service), otherwise Lanczos plus a light unsharp pass. Either way the
 * renderer then fits the result to the face exactly, so a service that returns
 * more pixels than asked for can no longer break the layout.
 */
export async function upscaleForPrint(input, targetPx, { sharp, fetchImpl = fetch, env = process.env } = {}) {
  const service = env.UPSCALE_SERVICE_URL;
  if (service) {
    try {
      const res = await fetchImpl(service, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          ...(env.UPSCALE_SERVICE_TOKEN ? { Authorization: `Bearer ${env.UPSCALE_SERVICE_TOKEN}` } : {}),
        },
        body: new Uint8Array(input),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`upscale service ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const meta = await sharp(buf).metadata();
      if ((meta.width || 0) < targetPx) throw new Error(`upscale service returned ${meta.width}px`);
      return { buffer: buf, method: 'service' };
    } catch (err) {
      console.warn(`print: upscale service failed (${err?.message}), using sharp`);
    }
  }
  const buffer = await sharp(input)
    .resize(targetPx, targetPx, { kernel: 'lanczos3', fit: 'contain' })
    .sharpen({ sigma: 0.8, m1: 0.5, m2: 0.7 })
    .png({ compressionLevel: 1 })
    .toBuffer();
  return { buffer, method: 'sharp' };
}

/**
 * For the Stripe webhook: which new keyed lines have NO print source?
 * Quick and fail-open: all checks run in parallel under one deadline; if the
 * store errors or the deadline passes, nothing is flagged (the order must never
 * wait on, or fail because of, this check).
 *
 * @param lines   Sanity order lines (as written by orderLineFromItem)
 * @returns {Promise<{ missing: Set<number>, error?: string }>}  indexes into lines
 */
export async function findMissingSources(lines, stores, { timeoutMs = 1500 } = {}) {
  const checks = lines.map(async (line, i) => {
    const spec = lineSpec(line);
    if (spec.kind !== 'stock' && spec.kind !== 'personalised') return null; // historic/invalid: never flagged
    const info = await sourceInfo(spec, stores);
    return info.exists ? null : i;
  });
  let timer;
  const deadline = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs); });
  try {
    const results = await Promise.race([Promise.all(checks), deadline]);
    return { missing: new Set(results.filter((i) => i !== null)) };
  } catch (err) {
    return { missing: new Set(), error: err?.message || String(err) };
  } finally {
    clearTimeout(timer);
  }
}
