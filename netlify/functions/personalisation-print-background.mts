// netlify/functions/personalisation-print-background.mts
//
// POST /api/personalisation/print-background   { pid }   (internal only)
//
// Started when a customer approves their proof. Turns the approved 2048px
// render into the print file for the FIRST line this design was ordered on
// (doc.format / doc.size), on the shared print pipeline:
//
//   1. upscale to the face size (_shared/print-sources.mjs upscaleForPrint:
//      UPSCALE_SERVICE_URL if set, otherwise Lanczos + a light unsharp)
//   2. render with _shared/print-render.mjs to the shared spec
//      (_shared/print-spec.mjs): face = size × 300 px, solid wrap in the
//      artwork's edge colour (1.5" standard; 2.5" gallery, 1.75" at 20"),
//      JPEG q100 4:4:4, sRGB ICC, 300 dpi
//   3. store as personalisation/<pid>/print.jpg and record printKey etc.
//
// Every OTHER ordered line (see orderedLines) — and this one too — can also be
// made on demand from the order in Studio (/admin/print-file/<order>/<line>),
// which is how a design ordered in two sizes gets two files.
//
// Sessions built before this change keep their personalisation/<pid>/print.png
// and printKey; /admin/personalisation/print still serves those.

import sharp from 'sharp';
import {
  sanity, images, docId, blobKey, getSession, isInternal, nowIso, json, bad, toArrayBuffer,
} from './_shared/personalisation.mts';
import { printGeometry, isFormatKey, isSizeKey } from './_shared/print-spec.mjs';
import { renderPrint, lowMemorySharp } from './_shared/print-render.mjs';
import { upscaleForPrint } from './_shared/print-sources.mjs';

/** The JPEG print file for a pid (the old PNG was blobKey.print). */
const printJpgKey = (pid: string) => `personalisation/${pid}/print.jpg`;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return bad('Method not allowed', 405);
  if (!isInternal(req)) return bad('Forbidden', 403);

  const { pid } = (await req.json()) as { pid?: string };
  if (!pid) return bad('Bad request');

  const s = await getSession(pid);
  if (!s || !s.selectedStyleKey) return bad('Session not ready', 404);
  const doc = s as any;

  try {
    lowMemorySharp();
    const format = isFormatKey(doc.format) ? doc.format : 'poster';
    // No silent 12" fallback any more: a session without a real size can't
    // be printed correctly, so it fails visibly instead.
    if (!isSizeKey(doc.size)) throw new Error(`session has no valid size ("${doc.size ?? ''}")`);
    const { facePx } = printGeometry(doc.size, format);

    const src = await images().get(blobKey.render(pid, s.selectedStyleKey), { type: 'arrayBuffer' });
    if (!src) throw new Error('render missing from storage');

    const t0 = Date.now();
    const { buffer: art, method } = await upscaleForPrint(Buffer.from(src), facePx, { sharp });
    const out = await renderPrint({ source: art, sizeKey: doc.size, formatKey: format });

    const key = printJpgKey(pid);
    await images().set(key, toArrayBuffer(out.buffer), {
      metadata: {
        pid, styleKey: s.selectedStyleKey, format, size: doc.size, px: out.width, dpi: out.dpi,
        wrapColour: out.wrapColour, method, bytes: out.bytes,
      },
    });

    await sanity
      .patch(docId(pid))
      .set({
        printKey: key,
        printPx: out.width,
        printWrapColour: out.wrapColour,
        printMethod: method,
        printBuiltAt: nowIso(),
      })
      .unset(['printTriggerError', 'printError']) // it ran after all, and succeeded
      .commit();

    console.log(`print: ${pid} ${format} ${doc.size} ${out.width}px via ${method} in ${Date.now() - t0}ms (${(out.bytes / 1048576).toFixed(1)}MB)`);
    return json(200, { ok: true, px: out.width, method });
  } catch (err: any) {
    console.error(`print: ${pid} FAILED — ${err?.message}`);
    await sanity.patch(docId(pid)).set({ printError: String(err?.message).slice(0, 300) }).commit().catch(() => {});
    return json(200, { ok: false });
  }
}

export const config = { path: '/api/personalisation/print-background' };
