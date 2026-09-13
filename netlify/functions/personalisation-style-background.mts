// netlify/functions/personalisation-style-background.mts
//
// POST /api/personalisation/style-background   { pid, styleKey }   (internal only)
//
// Netlify runs any function whose file name ends in "-background" with a 15
// minute budget and answers the caller 202 immediately. This is where the
// 30–45s Gemini call lives. Outcome lands on the session doc:
//
//   success → renders[] += {styleKey, blobKey, ms}, status 'ready'
//   blocked → renders[] += {styleKey, error}, status 'failed', failCode 'blocked'
//   other   → one retry inside styleImage; then renders[] += {error}, status 'failed'
//
// A failed call is refunded on callsUsed — the customer isn't charged a go
// for something Google refused. It still counts against the daily guards.

import {
  sanity, images, docId, blobKey, getSession, isInternal, nowIso, bad, json, toArrayBuffer,
} from './_shared/personalisation.mts';
import { styleImage, StyleError, isStyleKey } from './_shared/styles.mjs';

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return bad('Method not allowed', 405);
  if (!isInternal(req)) return bad('Forbidden', 403);

  const { pid, styleKey } = (await req.json()) as { pid?: string; styleKey?: string };
  if (!pid || !styleKey || !isStyleKey(styleKey)) return bad('Bad request');

  const s = await getSession(pid);
  if (!s || !s.photoKey) {
    console.error(`style-background: no session/photo for ${pid}`);
    return bad('No session', 404);
  }

  const key = `${styleKey}-${Date.now()}`;
  try {
    const src = await images().get(s.photoKey, { type: 'arrayBuffer' });
    if (!src) throw new Error('square.jpg missing from Blobs');

    const out = await styleImage({ styleKey, buffer: Buffer.from(src), mimeType: 'image/jpeg' });
    const renderKey = blobKey.render(pid, styleKey);
    await images().set(renderKey, toArrayBuffer(out.buffer), { metadata: { pid, styleKey, model: out.model, ms: out.ms } });

    await sanity
      .patch(docId(pid))
      .setIfMissing({ renders: [] })
      .append('renders', [{ _key: key, styleKey, blobKey: renderKey, model: out.model, ms: out.ms, createdAt: nowIso() }])
      .set({ status: 'ready', selectedStyleKey: styleKey })
      .unset(['failCode', 'failMessage'])
      .commit();

    console.log(`style-background: ${pid} ${styleKey} ok ${out.ms}ms ${(out.buffer.length / 1024).toFixed(0)}KB`);
    return json(200, { ok: true });
  } catch (err: any) {
    const blocked = err instanceof StyleError && err.isInputBlocked;
    const detail = err instanceof StyleError ? err.describe() : (err?.message || String(err));
    const failCode = blocked ? 'blocked' : 'error';
    const failMessage = blocked
      ? "We can only work with your own photos. This one was refused by our image safety check — that usually means it contains a well-known person, a film still or a copyrighted image. Please try a different photo."
      : "Styling didn't work that time. Please try again — if it keeps happening, try a different style or photo.";

    console.error(`style-background: ${pid} ${styleKey} FAILED — ${detail}`);
    await sanity
      .patch(docId(pid))
      .setIfMissing({ renders: [] })
      .append('renders', [{ _key: key, styleKey, error: detail.slice(0, 300), createdAt: nowIso() }])
      .set({ status: 'failed', failCode, failMessage })
      .dec({ callsUsed: 1 })
      .commit();
    return json(200, { ok: false, failCode });
  }
}

export const config = { path: '/api/personalisation/style-background' };
