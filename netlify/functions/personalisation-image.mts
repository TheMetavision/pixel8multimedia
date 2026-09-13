// netlify/functions/personalisation-image.mts
//
// GET /api/personalisation/image?pid=…&kind=square            the cropped photo
// GET /api/personalisation/image?pid=…&kind=<styleKey>        watermarked preview (1024px)
// GET /api/personalisation/image?pid=…&kind=<styleKey>&w=400  smaller preview
//
// The browser never receives an un-watermarked render before purchase: the
// 2K PNG stays in Blobs, and what's served is a downscaled JPEG with a tiled
// "PIXEL8 PREVIEW" mark. The proof email and print pipeline read Blobs
// directly, not this endpoint.

import sharp from 'sharp';
import { images, blobKey, isPid, bad } from './_shared/personalisation.mts';
import { isStyleKey } from './_shared/styles.mjs';

const MAX_W = 1024;

function watermarkSvg(size: number): Buffer {
  // Staggered grid, no clean gap bigger than a thumbnail; faint dark stroke
  // keeps it legible on pale artwork as well as dark.
  const font = Math.round(size / 30);
  const rowStep = Math.round(size / 7);
  const colStep = Math.round(size / 2.4);
  const rows: string[] = [];
  let i = 0;
  for (let y = rowStep * 0.6; y < size + rowStep; y += rowStep, i++) {
    const offset = (i % 2) * (colStep / 2);
    for (let x = -colStep + offset; x < size + colStep; x += colStep) {
      rows.push(
        `<text x="${x}" y="${y}" font-family="Arial,Helvetica,sans-serif" font-size="${font}" font-weight="700" ` +
        `fill="white" fill-opacity="0.24" stroke="black" stroke-opacity="0.18" stroke-width="1" ` +
        `transform="rotate(-24 ${x} ${y})">PIXEL8 PREVIEW</text>`,
      );
    }
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${rows.join('')}</svg>`);
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return bad('Method not allowed', 405);
  const url = new URL(req.url);
  const pid = url.searchParams.get('pid');
  const kind = url.searchParams.get('kind') || '';
  const w = Math.min(MAX_W, Math.max(200, Number(url.searchParams.get('w')) || MAX_W));
  if (!isPid(pid)) return bad('Invalid session.');

  const headers = {
    'Content-Type': 'image/jpeg',
    'Cache-Control': 'private, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  };

  if (kind === 'square') {
    const buf = await images().get(blobKey.square(pid), { type: 'arrayBuffer' });
    if (!buf) return bad('Not found', 404);
    const out = await sharp(Buffer.from(buf)).resize(w, w).jpeg({ quality: 85 }).toBuffer();
    return new Response(out, { headers });
  }

  if (!isStyleKey(kind)) return bad('Unknown image.');
  const buf = await images().get(blobKey.render(pid, kind), { type: 'arrayBuffer' });
  if (!buf) return bad('Not ready', 404);

  const out = await sharp(Buffer.from(buf))
    .resize(w, w, { fit: 'cover' })
    .composite([{ input: watermarkSvg(w), blend: 'over' }])
    .jpeg({ quality: 82 })
    .toBuffer();
  return new Response(out, { headers });
}

export const config = { path: '/api/personalisation/image' };
