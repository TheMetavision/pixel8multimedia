// netlify/functions/personalisation-print-background.mts
//
// POST /api/personalisation/print-background   { pid }   (internal only)
//
// Turns the approved 2048px render into a print-ready file:
//
//   1. upscale 2048 → 4096 (see UPSCALE below)
//   2. poster  → the square as-is
//      canvas  → the square centred on a larger sheet, the surround filled
//                with a block colour sampled from the artwork's own edges, so
//                the wrap matches and nothing from the design is lost round
//                the sides
//   3. store as personalisation/<pid>/print.png and record printKey + the
//      finished pixel size on the session
//
// UPSCALE: if UPSCALE_SERVICE_URL is set, the render is POSTed there and the
// returned image is used — that's where a Real-ESRGAN service plugs in. With
// no service configured it falls back to a high-quality Lanczos resize plus a
// light unsharp pass, which holds up well on these styles because they're
// flat colour and hard edges rather than photographic detail. At 4096px that
// is 341 ppi at 12", 256 at 16" and 205 at 20" — all comfortably above the
// 150 ppi canvas printers ask for.

import sharp from 'sharp';
import {
  sanity, images, docId, blobKey, getSession, isInternal, nowIso, json, bad, toArrayBuffer,
} from './_shared/personalisation.mts';

const PRINT_PX = Number(process.env.PERSONALISATION_PRINT_PX) || 4096;

// Inches of wrap on each side: frame depth plus a grip allowance for stapling.
const WRAP_INCHES: Record<string, number> = {
  poster: 0,
  canvasStandard: 1.0,   // 0.75" depth + 0.25" grip
  canvasGallery: 1.75,   // 1.5" depth + 0.25" grip
};
const SIZE_INCHES: Record<string, number> = { small: 12, medium: 16, large: 20 };

async function upscale(input: Buffer): Promise<{ buffer: Buffer; method: string }> {
  const service = process.env.UPSCALE_SERVICE_URL;
  if (service) {
    try {
      const res = await fetch(service, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          ...(process.env.UPSCALE_SERVICE_TOKEN ? { Authorization: `Bearer ${process.env.UPSCALE_SERVICE_TOKEN}` } : {}),
        },
        body: new Uint8Array(input),
      });
      if (!res.ok) throw new Error(`upscale service ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const meta = await sharp(buf).metadata();
      if ((meta.width || 0) < PRINT_PX) throw new Error(`upscale service returned ${meta.width}px`);
      return { buffer: buf, method: 'service' };
    } catch (err: any) {
      // Never fail a print because the upscaler is down — fall back and say so.
      console.warn(`print: upscale service failed (${err?.message}), using sharp`);
    }
  }
  const buffer = await sharp(input)
    .resize(PRINT_PX, PRINT_PX, { kernel: 'lanczos3' })
    .sharpen({ sigma: 0.8, m1: 0.5, m2: 0.7 })
    .toBuffer();
  return { buffer, method: 'sharp' };
}

/**
 * Mean colour of a border ring — what the canvas wrap is filled with.
 *
 * Note: sharp's .stats() measures the *input* image and ignores a chained
 * .extract(), so each strip has to be materialised with .toBuffer() before
 * being measured. Without that you get the average of the whole design, which
 * is a quietly wrong wrap colour on every canvas.
 */
async function edgeColour(img: Buffer, size: number): Promise<{ r: number; g: number; b: number }> {
  const band = Math.max(8, Math.round(size * 0.02));
  const strips = [
    { left: 0, top: 0, width: size, height: band },                    // top
    { left: 0, top: size - band, width: size, height: band },          // bottom
    { left: 0, top: 0, width: band, height: size },                    // left
    { left: size - band, top: 0, width: band, height: size },          // right
  ];
  const means = await Promise.all(
    strips.map(async (s) => {
      const strip = await sharp(img).extract(s).toBuffer();
      const { channels } = await sharp(strip).stats();
      return channels.slice(0, 3).map((c: { mean: number }) => c.mean);
    }),
  );
  const avg = (i: number) => means.reduce((t: number, m: number[]) => t + m[i], 0) / means.length;
  return { r: Math.round(avg(0)), g: Math.round(avg(1)), b: Math.round(avg(2)) };
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return bad('Method not allowed', 405);
  if (!isInternal(req)) return bad('Forbidden', 403);

  const { pid } = (await req.json()) as { pid?: string };
  if (!pid) return bad('Bad request');

  const s = await getSession(pid);
  if (!s || !s.selectedStyleKey) return bad('Session not ready', 404);
  const doc = s as any;

  try {
    const src = await images().get(blobKey.render(pid, s.selectedStyleKey), { type: 'arrayBuffer' });
    if (!src) throw new Error('render missing from storage');

    const t0 = Date.now();
    const { buffer: art, method } = await upscale(Buffer.from(src));

    const format = doc.format || 'poster';
    const wrapIn = WRAP_INCHES[format] ?? 0;
    let out = art;
    let finalPx = PRINT_PX;
    let wrapHex: string | undefined;

    if (wrapIn > 0) {
      const artIn = SIZE_INCHES[doc.size] || 12;
      const ppi = PRINT_PX / artIn;
      const pad = Math.round(wrapIn * ppi);
      finalPx = PRINT_PX + pad * 2;
      const c = await edgeColour(art, PRINT_PX);
      wrapHex = `#${[c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
      out = await sharp({
        create: { width: finalPx, height: finalPx, channels: 3, background: c },
      })
        .composite([{ input: art, left: pad, top: pad }])
        .png({ compressionLevel: 6 })
        .toBuffer();
    } else {
      out = await sharp(art).png({ compressionLevel: 6 }).toBuffer();
    }

    const key = blobKey.print(pid);
    await images().set(key, toArrayBuffer(out), {
      metadata: { pid, styleKey: s.selectedStyleKey, format, size: doc.size || '', px: finalPx, method },
    });

    await sanity
      .patch(docId(pid))
      .set({
        printKey: key,
        printPx: finalPx,
        printWrapColour: wrapHex,
        printMethod: method,
        printBuiltAt: nowIso(),
      })
      .unset(['printTriggerError', 'printError']) // it ran after all, and succeeded
      .commit();

    console.log(`print: ${pid} ${format} ${finalPx}px via ${method} in ${Date.now() - t0}ms (${(out.length / 1048576).toFixed(1)}MB)`);
    return json(200, { ok: true, px: finalPx, method });
  } catch (err: any) {
    console.error(`print: ${pid} FAILED — ${err?.message}`);
    await sanity.patch(docId(pid)).set({ printError: String(err?.message).slice(0, 300) }).commit().catch(() => {});
    return json(200, { ok: false });
  }
}

export const config = { path: '/api/personalisation/print-background' };
