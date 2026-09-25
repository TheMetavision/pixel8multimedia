// netlify/functions/personalisation-upload.mts
//
// POST /api/personalisation/upload   multipart/form-data
//   file      the cropped square photo (JPEG/PNG/WebP, ≤ LIMITS.maxUploadBytes)
//   consent   "true" — the customer ticked the consent box
//   crop      optional JSON {x,y,size} recorded for reference only
//   turnstile optional Cloudflare Turnstile token (verified when TURNSTILE_SECRET_KEY is set)
//
// → { ok, pid, expiresAt }
//
// The browser does the square crop (canvas → JPEG) so what arrives is already
// square; this function re-encodes it anyway — max 2048px, EXIF stripped,
// sRGB — so every downstream step sees one predictable file.

import sharp from 'sharp';
import {
  LIMITS, CONSENT_VERSION, sanity, images, newPid, docId, blobKey, sha256,
  ipHash, nowIso, hoursFromNow, json, bad, toArrayBuffer,
} from './_shared/personalisation.mts';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

// Logs why verification failed (Cloudflare error-codes and hostname only —
// never the secret or the token) so the reason shows in the function log.
// remoteip is not sent: siteverify wants the raw client IP, and the old code
// passed our salted hash instead.
async function verifyTurnstile(token: string | null): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // not configured → skip (dev / pre-launch)
  if (!token) {
    console.warn('personalisation-upload: turnstile failed codes=[missing-input-response] hostname=- (no token in form)');
    return false;
  }
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token }),
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json()) as { success?: boolean; 'error-codes'?: string[]; hostname?: string };
    if (data.success === true) return true;
    console.warn(
      `personalisation-upload: turnstile failed codes=[${(data['error-codes'] || []).join(',')}] hostname=${data.hostname || '-'} http=${res.status}`,
    );
    return false;
  } catch (err: any) {
    console.error('personalisation-upload: turnstile siteverify unreachable', err?.name || '', err?.message || '');
    return false;
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return bad('Method not allowed', 405);
  if (!process.env.SANITY_TOKEN) return bad('Server misconfigured.', 500);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return bad('Expected multipart/form-data.');
  }

  if (String(form.get('consent')) !== 'true') {
    return bad('Please confirm you own the photo and agree to how it will be processed.');
  }
  const ip = ipHash(req);
  if (!(await verifyTurnstile(form.get('turnstile') as string | null))) {
    return bad('Verification failed — please try again.', 403);
  }

  const file = form.get('file');
  if (!file || typeof file === 'string') return bad('No file in request.');
  const f = file as File;
  if (!ALLOWED.has(f.type)) return bad('Please upload a JPG, PNG or WebP image.');
  if (f.size > LIMITS.maxUploadBytes) {
    return bad(`That file is ${(f.size / 1048576).toFixed(1)} MB — the limit is ${LIMITS.maxUploadBytes / 1048576} MB.`, 413);
  }

  // Normalise: square, ≤ 2048px, no EXIF, sRGB JPEG.
  let square: Buffer;
  let width = 0;
  try {
    const input = Buffer.from(await f.arrayBuffer());
    const meta = await sharp(input).rotate().metadata();
    const w = meta.width || 0;
    const h = meta.height || 0;
    if (w < 512 || h < 512) return bad('That photo is too small — please use one at least 512 pixels wide.');
    const side = Math.min(w, h, LIMITS.squarePx);
    square = await sharp(input)
      .rotate()
      .resize(side, side, { fit: 'cover', position: 'attention' }) // no-op if already square
      .toColourspace('srgb')
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer();
    width = side;
  } catch (err: any) {
    console.error('personalisation-upload: decode failed', err?.message);
    return bad("We couldn't read that image. Please try a different photo.");
  }

  const pid = newPid();
  const key = blobKey.square(pid);
  const expiresAt = hoursFromNow(LIMITS.unpaidTtlHours);
  const hash = sha256(square);

  let crop: unknown = undefined;
  try {
    const raw = form.get('crop');
    if (typeof raw === 'string' && raw) {
      const c = JSON.parse(raw);
      crop = { x: Number(c.x) || 0, y: Number(c.y) || 0, size: Number(c.size) || 0 };
    }
  } catch { /* ignore malformed crop */ }

  await images().set(key, toArrayBuffer(square), { metadata: { pid, sha256: hash, width } });

  await sanity.createIfNotExists({
    _id: docId(pid),
    _type: 'pendingPersonalisation',
    pid,
    status: 'uploaded',
    photoKey: key,
    photoSha256: hash,
    ...(crop ? { crop } : {}),
    renders: [],
    callsUsed: 0,
    switchesUsed: 0,
    consentAt: nowIso(),
    consentVersion: CONSENT_VERSION,
    ipHash: ip,
    expiresAt,
    createdAt: nowIso(),
  });

  console.log(`personalisation-upload: ${pid} ${width}px ${(square.length / 1024).toFixed(0)} KB`);
  return json(200, { ok: true, pid, expiresAt });
}

export const config = { path: '/api/personalisation/upload' };
