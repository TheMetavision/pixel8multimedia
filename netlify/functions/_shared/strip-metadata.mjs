/**
 * netlify/functions/_shared/strip-metadata.mjs
 *
 * Remove location and camera metadata (EXIF, XMP, IPTC, text chunks) from a
 * customer's photo before it is stored — losslessly: the image data itself is
 * copied byte for byte, never re-encoded, except in the one case noted below.
 *
 *   JPEG  Walks the segments up to the scan. Keeps what's needed to show the
 *         picture: quantisation/Huffman tables, frame header, JFIF (APP0),
 *         the ICC colour profile (APP2 "ICC_PROFILE"), Adobe colour transform
 *         (APP14). Drops APP1 (EXIF, XMP), APP13 (IPTC/Photoshop), every other
 *         APPn (MPF thumbnails, maker data) and comments. If the photo had an
 *         EXIF orientation other than 1, a new minimal EXIF block holding ONLY
 *         the orientation is written back, so it still displays upright. The
 *         scan data is copied unchanged: pixel-identical.
 *   PNG   Keeps an allowlist of chunks (image data, palette, transparency,
 *         colour: iCCP/sRGB/gAMA/cHRM/cICP…, pHYs, animation). Drops eXIf,
 *         tEXt/zTXt/iTXt (incl. XMP), tIME and anything unknown.
 *   WebP  Drops the EXIF and "XMP " chunks and clears their flags in VP8X.
 *   PNG/WebP with an EXIF orientation other than 1: those formats have no
 *         lossless way to keep just the orientation, so the pixels are rotated
 *         upright with sharp and written LOSSLESSLY (PNG, or lossless WebP),
 *         keeping the ICC profile. The only path that re-encodes.
 *   HEIC/HEIF  Refused: sharp here can't decode HEIC, so it can't be checked
 *         or stripped. (The commission form converts HEIC to JPEG in browsers
 *         that can; others are asked for a JPG — see FRIENDLY_HEIC.)
 */

// Defined in a browser-safe module (this file uses Buffer at import time, so
// the commission form must not import it); re-exported for existing callers.
import { FRIENDLY_HEIC } from './upload-messages.mjs';
export { FRIENDLY_HEIC };

/** `customerMessage` is safe to show; `message` may be technical (for the log). */
export class MetadataError extends Error {
  constructor(message, customerMessage = "We couldn't read that image. Please try a different photo.") {
    super(message);
    this.name = 'MetadataError';
    this.customerMessage = customerMessage;
  }
}

// ── EXIF (TIFF) reading ─────────────────────────────────────────────────────

/** Orientation and whether a GPS block exists, from a TIFF/EXIF buffer. */
export function readExif(tiff) {
  const out = { orientation: undefined, hasGps: false };
  if (!tiff || tiff.length < 8) return out;
  const le = tiff[0] === 0x49 && tiff[1] === 0x49;
  const be = tiff[0] === 0x4d && tiff[1] === 0x4d;
  if (!le && !be) return out;
  const u16 = (o) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  try {
    const ifd = u32(4);
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      const tag = u16(e);
      if (tag === 0x0112) out.orientation = u16(e + 8);
      if (tag === 0x8825) out.hasGps = true;
    }
  } catch { /* truncated EXIF: treat as nothing useful */ }
  return out;
}

/** A minimal little-endian EXIF APP1 payload holding only the orientation. */
function orientationOnlyExif(orientation) {
  const b = Buffer.alloc(6 + 8 + 2 + 12 + 4);
  b.write('Exif\0\0', 0, 'latin1');
  b.write('II', 6, 'latin1');
  b.writeUInt16LE(42, 8);
  b.writeUInt32LE(8, 10);              // IFD0 at offset 8 of the TIFF data
  b.writeUInt16LE(1, 14);              // one entry
  b.writeUInt16LE(0x0112, 16);         // Orientation
  b.writeUInt16LE(3, 18);              // SHORT
  b.writeUInt32LE(1, 20);              // count 1
  b.writeUInt16LE(orientation, 24);    // value (left-justified)
  b.writeUInt32LE(0, 28);              // no next IFD
  return b;
}

const segment = (marker, payload) => {
  const head = Buffer.alloc(4);
  head[0] = 0xff; head[1] = marker; head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
};
const startsWith = (buf, off, s) => buf.toString('latin1', off, off + s.length) === s;

// ── JPEG ────────────────────────────────────────────────────────────────────

export function stripJpeg(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new MetadataError('not a JPEG');
  const kept = [];
  const removed = [];
  let orientation;
  let hasGps = false;
  let i = 2;
  let insertAt = 0; // index in `kept` after which the orientation EXIF goes
  while (i < buf.length) {
    if (buf[i] !== 0xff) throw new MetadataError('corrupt JPEG (marker expected)');
    while (buf[i + 1] === 0xff) i++;          // fill bytes
    const marker = buf[i + 1];
    if (marker === 0xd9) { kept.push(buf.subarray(i, i + 2)); i += 2; break; }
    if (marker === 0xda) { kept.push(buf.subarray(i)); i = buf.length; break; } // scan + rest: unchanged
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { kept.push(buf.subarray(i, i + 2)); i += 2; continue; }
    if (i + 4 > buf.length) throw new MetadataError('corrupt JPEG (truncated segment)');
    const len = buf.readUInt16BE(i + 2);
    const seg = buf.subarray(i, i + 2 + len);
    const p = i + 4; // payload start
    let keep = true;
    let what = '';
    if (marker === 0xe0) {
      keep = startsWith(buf, p, 'JFIF\0');
      what = keep ? '' : 'APP0 (JFXX thumbnail)';
      if (keep) insertAt = kept.length + 1;
    } else if (marker === 0xe1) {
      keep = false;
      if (startsWith(buf, p, 'Exif\0\0')) {
        const x = readExif(buf.subarray(p + 6, i + 2 + len));
        orientation = x.orientation ?? orientation;
        hasGps = hasGps || x.hasGps;
        what = `APP1 EXIF${x.hasGps ? ' (with GPS)' : ''}`;
      } else what = startsWith(buf, p, 'http://ns.adobe.com/xap/1.0/') ? 'APP1 XMP' : 'APP1';
    } else if (marker === 0xe2) {
      keep = startsWith(buf, p, 'ICC_PROFILE\0');
      if (!keep) what = 'APP2 (MPF/other)';
    } else if (marker === 0xed) { keep = false; what = 'APP13 IPTC'; }
    else if (marker === 0xee) { keep = startsWith(buf, p, 'Adobe'); if (!keep) what = 'APP14'; }
    else if (marker >= 0xe3 && marker <= 0xef) { keep = false; what = `APP${marker - 0xe0}`; }
    else if (marker === 0xfe) { keep = false; what = 'COM (comment)'; }
    if (keep) kept.push(seg); else removed.push(what);
    i += 2 + len;
  }
  const parts = [Buffer.from([0xff, 0xd8]), ...kept];
  if (orientation && orientation !== 1) {
    parts.splice(1 + insertAt, 0, segment(0xe1, orientationOnlyExif(orientation)));
  }
  return { buffer: Buffer.concat(parts), removed, orientation: orientation ?? 1, hadGps: hasGps, reencoded: false };
}

// ── PNG ─────────────────────────────────────────────────────────────────────

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'cHRM', 'gAMA', 'iCCP', 'sBIT', 'sRGB',
  'cICP', 'mDCv', 'cLLi', 'bKGD', 'pHYs', 'hIST', 'sPLT', 'acTL', 'fcTL', 'fdAT']);

export function stripPng(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new MetadataError('not a PNG');
  const kept = [PNG_SIG];
  const removed = [];
  let orientation;
  let hasGps = false;
  let i = 8;
  while (i < buf.length) {
    if (i + 12 > buf.length) throw new MetadataError('corrupt PNG (truncated chunk)');
    const len = buf.readUInt32BE(i);
    const type = buf.toString('latin1', i + 4, i + 8);
    const chunk = buf.subarray(i, i + 12 + len);
    if (type === 'eXIf') {
      const x = readExif(buf.subarray(i + 8, i + 8 + len));
      orientation = x.orientation; hasGps = x.hasGps;
    }
    if (PNG_KEEP.has(type)) kept.push(chunk);
    else removed.push(type === 'iTXt' && buf.toString('latin1', i + 8, i + 8 + 17) === 'XML:com.adobe.xmp' ? 'iTXt XMP' : type);
    i += 12 + len;
    if (type === 'IEND') break;
  }
  return { buffer: Buffer.concat(kept), removed, orientation: orientation ?? 1, hadGps: hasGps, reencoded: false };
}

// ── WebP ────────────────────────────────────────────────────────────────────

export function stripWebp(buf) {
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') throw new MetadataError('not a WebP');
  const chunks = [];
  const removed = [];
  let orientation;
  let hasGps = false;
  let i = 12;
  while (i + 8 <= buf.length) {
    const fourcc = buf.toString('latin1', i, i + 4);
    const size = buf.readUInt32LE(i + 4);
    const padded = size + (size & 1);
    const chunk = Buffer.from(buf.subarray(i, i + 8 + padded));
    if (fourcc === 'EXIF') {
      let data = buf.subarray(i + 8, i + 8 + size);
      if (startsWith(data, 0, 'Exif\0\0')) data = data.subarray(6);
      const x = readExif(data);
      orientation = x.orientation; hasGps = x.hasGps;
      removed.push(`EXIF${hasGps ? ' (with GPS)' : ''}`);
    } else if (fourcc === 'XMP ') removed.push('XMP');
    else {
      if (fourcc === 'VP8X') chunk[8] &= ~(0x08 | 0x04); // clear the EXIF and XMP flags
      chunks.push(chunk);
    }
    i += 8 + padded;
  }
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1'); head.writeUInt32LE(4 + body.length, 4); head.write('WEBP', 8, 'latin1');
  return { buffer: Buffer.concat([head, body]), removed, orientation: orientation ?? 1, hadGps: hasGps, reencoded: false };
}

// ── Dispatch ────────────────────────────────────────────────────────────────

/**
 * @param {Buffer} buf
 * @param {string} contentType
 * @param {{ sharp?: Function }} deps  sharp, only for rotating a PNG/WebP with an EXIF orientation
 * @returns {Promise<{ buffer: Buffer, removed: string[], orientation: number, hadGps: boolean, reencoded: boolean }>}
 */
export async function stripMetadata(buf, contentType, { sharp } = {}) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (contentType === 'image/heic' || contentType === 'image/heif') throw new MetadataError('HEIC/HEIF refused', FRIENDLY_HEIC);
  if (contentType === 'image/jpeg') return stripJpeg(b);
  if (contentType === 'image/png' || contentType === 'image/webp') {
    const first = contentType === 'image/png' ? stripPng(b) : stripWebp(b);
    if (first.orientation === 1 || !sharp) return first;
    // Rotate upright from the ORIGINAL (which still carries the orientation),
    // write losslessly, then strip that output too (sharp adds no EXIF here).
    const img = sharp(b).rotate().keepIccProfile();
    const out = contentType === 'image/png' ? await img.png().toBuffer() : await img.webp({ lossless: true }).toBuffer();
    const again = contentType === 'image/png' ? stripPng(out) : stripWebp(out);
    return { ...again, removed: first.removed, hadGps: first.hadGps, orientation: first.orientation, reencoded: true };
  }
  throw new MetadataError(`unsupported type ${contentType}`);
}
