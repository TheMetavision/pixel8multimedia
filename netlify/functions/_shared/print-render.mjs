/**
 * netlify/functions/_shared/print-render.mjs
 *
 * One print-ready file from one source image. Used for stock masters and
 * personalised renders alike; every number comes from print-spec.mjs.
 *
 *   face  = size × 300 px. The WHOLE source is fitted inside (contain, never
 *           crop), Lanczos3. If the source isn't square the leftover is padded
 *           with the wrap colour.
 *   wrap  = a solid border of wrap-per-edge × 300 px on every side: the
 *           override colour if one is given, otherwise the mean colour of the
 *           source's own edges (see edgeColour).
 *   file  = JPEG, quality 100, 4:4:4, sRGB ICC profile embedded, 300 dpi.
 *
 * Memory: it's one sharp pipeline (resize → extend → encode), which libvips
 * runs demand-driven in tiles, so the 7050 px sheet is never held uncompressed
 * more than once. Callers in functions should also call lowMemorySharp().
 */
import sharp from 'sharp';
import { DPI, OUTPUT, printGeometry } from './print-spec.mjs';
import { isHexColour } from './print-keys.mjs';

/** Keep libvips lean inside a function: no operation cache, one worker thread. */
export function lowMemorySharp() {
  sharp.cache(false);
  sharp.concurrency(1);
}

export { isHexColour };
const HEX_RE = /^#?([0-9a-f]{6})$/i;
export function parseHex(s) {
  const m = HEX_RE.exec(String(s).trim());
  if (!m) throw new Error(`not a hex colour: ${s}`);
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
export const toHex = ({ r, g, b }) =>
  `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

/**
 * Mean colour of the image's border: four strips 2% deep (at least 8 px),
 * each averaged, then the four averaged. Moved here from
 * personalisation-print-background, same maths; it now decodes the image once
 * and measures the strips in memory instead of re-decoding per strip.
 */
export async function edgeColour(img) {
  const { data, info } = await sharp(img).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: ch } = info;
  const band = Math.max(8, Math.round(Math.min(w, h) * 0.02));
  const stripMean = (x0, y0, sw, sh) => {
    const sum = [0, 0, 0];
    for (let y = y0; y < y0 + sh; y++) {
      let i = (y * w + x0) * ch;
      for (let x = 0; x < sw; x++, i += ch) { sum[0] += data[i]; sum[1] += data[i + 1]; sum[2] += data[i + 2]; }
    }
    const n = sw * sh;
    return sum.map((s) => s / n);
  };
  const strips = [
    stripMean(0, 0, w, band),           // top
    stripMean(0, h - band, w, band),    // bottom
    stripMean(0, 0, band, h),           // left
    stripMean(w - band, 0, band, h),    // right
  ];
  const avg = (c) => strips.reduce((t, s) => t + s[c], 0) / strips.length;
  return { r: Math.round(avg(0)), g: Math.round(avg(1)), b: Math.round(avg(2)) };
}

/**
 * @param {object} p
 * @param {Buffer} p.source      the master or (upscaled) personalised render
 * @param {string} p.sizeKey     small | medium | large
 * @param {string} p.formatKey   poster | canvasStandard | canvasGallery
 * @param {string} [p.wrapColour] '#rrggbb' override; default = edgeColour(source)
 * @param {string} [p.identity]  the source's identity, carried into the result
 * @returns {Promise<{ buffer: Buffer, width, height, facePx, wrapPx, dpi, wrapColour, wrapSource, identity, padded, bytes, sourceWidth, sourceHeight }>}
 */
export async function renderPrint({ source, sizeKey, formatKey, wrapColour, identity = '' }) {
  const g = printGeometry(sizeKey, formatKey);
  const meta = await sharp(source).metadata();
  if (!meta.width || !meta.height) throw new Error('source image is unreadable');

  const override = wrapColour ? parseHex(wrapColour) : null;
  const colour = override || await edgeColour(source);
  const bg = { ...colour, alpha: 1 };
  const padded = meta.width !== meta.height;

  let img = sharp(source)
    .flatten({ background: bg }) // any transparency takes the wrap colour, never black
    .resize(g.facePx, g.facePx, { fit: 'contain', background: bg, kernel: 'lanczos3' });
  if (g.wrapPx > 0) {
    // sharp always applies extend AFTER resize, so this pads the fitted face.
    img = img.extend({ top: g.wrapPx, bottom: g.wrapPx, left: g.wrapPx, right: g.wrapPx, background: bg });
  }
  const buffer = await img
    .toColourspace('srgb')
    .withIccProfile(OUTPUT.icc)
    .withMetadata({ density: DPI })
    // optimiseCoding off: Huffman optimisation makes libjpeg hold every DCT
    // coefficient of the whole image before writing — measured at ~635 MB
    // for the 7050 px sheet, against ~57 MB without it. Same pixels; the
    // file is ~8% larger (38 → 41 MB for the heaviest master).
    .jpeg({ quality: OUTPUT.quality, chromaSubsampling: OUTPUT.chromaSubsampling, optimiseCoding: false })
    .toBuffer();

  return {
    buffer,
    width: g.sheetPx,
    height: g.sheetPx,
    facePx: g.facePx,
    wrapPx: g.wrapPx,
    dpi: DPI,
    wrapColour: toHex(colour),
    wrapSource: override ? 'override' : 'edge',
    identity,
    padded,
    bytes: buffer.length,
    sourceWidth: meta.width,
    sourceHeight: meta.height,
  };
}
