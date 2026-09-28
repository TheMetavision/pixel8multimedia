/**
 * netlify/edge-lib/artwork-stream.mjs
 *
 * For the artwork download edge function (and its tests, which run it in
 * Node): check a signed download link, and stream a multi-part artwork file
 * back as one file. Web APIs only (Web Crypto, ReadableStream) so it runs on
 * Deno at the edge. Lives outside netlify/edge-functions/ so Netlify doesn't
 * treat it as a function.
 */
import { manifestKey, partKey, partLength, disposition } from '../functions/_shared/artwork-keys.mjs';

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Compare without leaking length or position through timing. */
function safeEqual(a, b) {
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/**
 * The same check commission-download has always made: HMAC-SHA256 (hex) of
 * "<id>:<file>:<exp>" with DOWNLOAD_LINK_SECRET, and exp (ms) not passed.
 * @returns {Promise<{ ok: true } | { ok: false, status: 400|403|410|500, reason }>}
 */
export async function verifyDownloadLink({ id, file, exp, sig }, secret, now = Date.now()) {
  if (!secret) return { ok: false, status: 500, reason: 'not configured' };
  if (!id || !file || !exp || !sig) return { ok: false, status: 400, reason: 'missing parameters' };
  const expMs = Number.parseInt(exp, 10);
  if (!Number.isFinite(expMs) || now > expMs) return { ok: false, status: 410, reason: 'expired' };
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const want = hex(await crypto.subtle.sign('HMAC', key, enc.encode(`${id}:${file}:${exp}`)));
  return safeEqual(String(sig), want) ? { ok: true } : { ok: false, status: 403, reason: 'bad signature' };
}

/** The manifest, if the file is complete; otherwise null. */
export async function completeManifest(store, orderRef, uploadId) {
  const m = await store.get(manifestKey(orderRef, uploadId), { type: 'json' }).catch(() => null);
  return m && m.state === 'complete' && m.orderRef === orderRef && m.uploadId === uploadId ? m : null;
}

/**
 * The parts, in order, as one stream. Each part is fetched only when the one
 * before it is used up, and its length is checked: a short or missing part
 * errors the stream rather than sending a file that looks whole.
 */
export function streamParts(store, m) {
  let n = 0;
  let reader = null;
  let got = 0;
  return new ReadableStream({
    async pull(controller) {
      for (;;) {
        if (!reader) {
          if (n >= m.parts) { controller.close(); return; }
          const s = await store.get(partKey(m.orderRef, m.uploadId, n), { type: 'stream' });
          if (!s) { controller.error(new Error(`part ${n} is missing`)); return; }
          reader = s.getReader();
          got = 0;
        }
        const { done, value } = await reader.read();
        if (done) {
          if (got !== partLength(m.size, n)) { controller.error(new Error(`part ${n} is ${got} bytes`)); return; }
          reader = null; n++;
          continue;
        }
        got += value.byteLength;
        controller.enqueue(value);
        return;
      }
    },
    cancel(reason) { return reader?.cancel(reason); },
  });
}

/** Headers for the whole file. */
export const downloadHeaders = (m) => ({
  'Content-Type': m.contentType || 'application/octet-stream',
  'Content-Length': String(m.size),
  'Content-Disposition': disposition(m.filename),
  'Cache-Control': 'no-store, private',
  'X-Content-Type-Options': 'nosniff',
});
