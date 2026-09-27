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

/** Output file settings. */
export const OUTPUT = {
  format: 'jpeg',
  mime: 'image/jpeg',
  ext: 'jpg',
  quality: 100,
  chromaSubsampling: '4:4:4',
  icc: 'srgb',
};
