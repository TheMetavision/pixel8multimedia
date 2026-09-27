/**
 * netlify/functions/_shared/print-spec.mjs
 *
 * THE print spec. Sizes, formats, their labels, wrap depths and output settings
 * live here and nowhere else: checkout, the webhook, the proof email, the print
 * renderer and the site (src/data/products.ts re-exports these) all import it.
 *
 * Printer: Epson SC-P6500DE on a 24" roll. The widest sheet it can print is
 * 23.5", which is why the 20" gallery wrap is 1.75" rather than 2.5":
 * 20 + 2 × 1.75 = 23.5.
 */

export const DPI = 300;

export const SIZE_KEYS = ['small', 'medium', 'large'];
export const FORMAT_KEYS = ['poster', 'canvasStandard', 'canvasGallery'];

/** Square faces, inches per side. */
export const SIZE_INCHES = { small: 12, medium: 16, large: 20 };

export const SIZE_LABELS = {
  small: 'Small (12×12")',
  medium: 'Medium (16×16")',
  large: 'Large (20×20")',
};
/** Just the dimensions, for places that already say "Small" etc. */
export const SIZE_DIMENSIONS = { small: '12x12', medium: '16x16', large: '20x20' };
export const SIZE_SHORT_LABELS = { small: '12×12"', medium: '16×16"', large: '20×20"' };

export const FORMAT_LABELS = {
  poster: 'Poster Print',
  canvasStandard: 'Canvas (Standard Frame)',
  canvasGallery: 'Canvas (Gallery Frame)',
};

/** Wrap per edge, inches: the artwork's surround that folds round the frame. */
export const WRAP_INCHES = {
  poster: { small: 0, medium: 0, large: 0 },
  canvasStandard: { small: 1.5, medium: 1.5, large: 1.5 },
  canvasGallery: { small: 2.5, medium: 2.5, large: 1.75 }, // 20" capped by the 23.5" roll
};

/** Widest printable sheet, inches. */
export const MAX_SHEET_INCHES = 23.5;

export const isSizeKey = (k) => SIZE_KEYS.includes(k);
export const isFormatKey = (k) => FORMAT_KEYS.includes(k);

/**
 * Pixel geometry of one print.
 * @returns {{ faceIn, wrapIn, sheetIn, facePx, wrapPx, sheetPx }}
 */
export function printGeometry(sizeKey, formatKey) {
  if (!isSizeKey(sizeKey)) throw new Error(`print spec: unknown size "${sizeKey}"`);
  if (!isFormatKey(formatKey)) throw new Error(`print spec: unknown format "${formatKey}"`);
  const faceIn = SIZE_INCHES[sizeKey];
  const wrapIn = WRAP_INCHES[formatKey][sizeKey];
  const sheetIn = faceIn + 2 * wrapIn;
  if (sheetIn > MAX_SHEET_INCHES) throw new Error(`print spec: ${sheetIn}" sheet exceeds the ${MAX_SHEET_INCHES}" roll`);
  const facePx = Math.round(faceIn * DPI);
  const wrapPx = Math.round(wrapIn * DPI);
  return { faceIn, wrapIn, sheetIn, facePx, wrapPx, sheetPx: facePx + 2 * wrapPx };
}

// ── Commission print sizes ───────────────────────────────────────────────────
// Commissions (service pages) are a separate set from shop prints: 3:2, in
// landscape or portrait as the service's artwork needs. 16×12 is retired —
// medium is 18×12. The KEYS are the shop's (small/medium/large), so existing
// commissions, service printUpcharges and Stripe metadata keep working; only
// the dimensions and labels differ. Square services (Back in Time, and
// Cartoonify via the default) use the shop's square set above.

/** [width, height] in inches. */
export const COMMISSION_SIZE_INCHES = {
  landscape: { small: [12, 8], medium: [18, 12], large: [24, 16] },
  portrait: { small: [8, 12], medium: [12, 18], large: [16, 24] },
};
const dims = (orientation, k) => COMMISSION_SIZE_INCHES[orientation][k];
const label = (name, [w, h]) => `${name} (${w}×${h}")`;
export const COMMISSION_SIZE_LABELS = {
  landscape: { small: label('Small', dims('landscape', 'small')), medium: label('Medium', dims('landscape', 'medium')), large: label('Large', dims('landscape', 'large')) },
  portrait: { small: label('Small', dims('portrait', 'small')), medium: label('Medium', dims('portrait', 'medium')), large: label('Large', dims('portrait', 'large')) },
};
/** "12x8"-style values, as the (legacy) commission form posts them. */
export const COMMISSION_SIZE_VALUES = {
  landscape: { small: '12x8', medium: '18x12', large: '24x16' },
  portrait: { small: '8x12', medium: '12x18', large: '16x24' },
};

// ── Customer-facing wording ──────────────────────────────────────────────────
// What the canvas wrap is, said the same way everywhere (PDP, Your Photo, T&Cs,
// FAQ, llms.txt). Accurate to the code: print-render.mjs's edgeColour() takes
// the average colour of a band around the design's edges.
export const WRAP_COPY = {
  short: 'Canvas edges are a solid colour wrap, sampled from the edges of the design. The full design stays on the front: nothing is wrapped round the frame, cropped or hidden.',
  terms: 'On canvas orders the full design is printed on the front of the canvas, and the edges that wrap around the frame are a solid colour sampled from the edges of the design. Nothing from your design is lost around the sides.',
};
export const POSTER_FINISH = 'satin';

/** FAQ answers that describe the wrap and finishes (tools/fix-label-copy.mjs writes them to Sanity). */
export const FAQ_COPY = {
  canvasWrap:
    `No. Our canvas prints use a solid colour wrap, so none of your design is lost.\n\n` +
    `Many canvas prints wrap the artwork itself around the wooden frame, which hides part of the design on the sides. We don't do that.\n\n` +
    `Instead, the full square design is printed on the front of the canvas, and the edges that fold around the frame are a solid colour sampled from the edges of the design, so they blend in as a border.\n\n` +
    `It's the same for our Standard and Gallery canvas frames: what you see on screen is what goes on your wall.`,
  finishes:
    `Three professional finishes:\n\n` +
    `Poster Print — sleek high-definition ${POSTER_FINISH}, ready for framing.\n\n` +
    `Canvas Standard Frame — a modern look, with a solid colour wrap on the edges sampled from the edges of the design, so the full design stays on the front and nothing is lost round the frame.\n\n` +
    `Canvas Gallery Frame — deep-edge premium presentation, with the same solid colour wrap so the full design stays on the front.`,
};

/** Output file settings. */
export const OUTPUT = {
  format: 'jpeg',
  mime: 'image/jpeg',
  ext: 'jpg',
  quality: 100,
  chromaSubsampling: '4:4:4',
  icc: 'srgb',
};
