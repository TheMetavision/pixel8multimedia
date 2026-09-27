/**
 * The print renderer and spec, checked on real pixels.
 *
 *   node tools/builder/print-render-tests.mjs
 *
 * Renders all 9 size × finish combinations and reads the files back: exact
 * pixel sizes, the whole source inside the face, wrap width and colour, the
 * override, 300 dpi, an sRGB ICC profile and 4:4:4 chroma.
 */
import { createRequire } from 'node:module';
import { renderPrint, edgeColour, lowMemorySharp, parseHex, toHex } from '../../netlify/functions/_shared/print-render.mjs';
import { printGeometry, WRAP_INCHES, SIZE_KEYS, FORMAT_KEYS, MAX_SHEET_INCHES } from '../../netlify/functions/_shared/print-spec.mjs';

const sharp = createRequire(import.meta.url)('sharp');
lowMemorySharp();

let pass = 0, fail = 0;
const ok = (c, l, e = '') => {
  if (c) { pass++; console.log(`  PASS  ${l}${e !== '' ? ' — ' + e : ''}`); }
  else { fail++; console.log(`  FAIL  ${l}${e !== '' ? ' — ' + e : ''}`); }
};
const say = console.log.bind(console);
const near = (a, b, tol = 3) => Math.abs(a - b) <= tol;
const nearRGB = (p, c, tol = 3) => near(p[0], c.r, tol) && near(p[1], c.g, tol) && near(p[2], c.b, tol);

/** A 1000 px source: four coloured quadrants and a diagonal, with a 30 px #204060 border. */
async function makeSource(w = 1000, h = 1000) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#204060"/>
    <rect x="30" y="30" width="${w / 2 - 30}" height="${h / 2 - 30}" fill="#e02020"/>
    <rect x="${w / 2}" y="30" width="${w / 2 - 30}" height="${h / 2 - 30}" fill="#20c020"/>
    <rect x="30" y="${h / 2}" width="${w / 2 - 30}" height="${h / 2 - 30}" fill="#f0e030"/>
    <rect x="${w / 2}" y="${h / 2}" width="${w / 2 - 30}" height="${h / 2 - 30}" fill="#8030c0"/>
    <line x1="30" y1="30" x2="${w - 30}" y2="${h - 30}" stroke="#ffffff" stroke-width="12"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
/** RGB of one pixel of an encoded image. */
async function pixel(buf, x, y) {
  const { data } = await sharp(buf).extract({ left: x, top: y, width: 1, height: 1 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return [data[0], data[1], data[2]];
}

const EXPECT = {
  small: { poster: 3600, canvasStandard: 4500, canvasGallery: 5100 },
  medium: { poster: 4800, canvasStandard: 5700, canvasGallery: 6300 },
  large: { poster: 6000, canvasStandard: 6900, canvasGallery: 7050 },
};

say('\n1. THE SPEC\n');
{
  for (const s of SIZE_KEYS) for (const f of FORMAT_KEYS) {
    const g = printGeometry(s, f);
    ok(g.sheetPx === EXPECT[s][f] && g.sheetIn <= MAX_SHEET_INCHES, `${s} ${f}: ${g.sheetPx} px (${g.sheetIn}")`);
  }
  ok(WRAP_INCHES.canvasGallery.large === 1.75 && WRAP_INCHES.canvasGallery.small === 2.5 && WRAP_INCHES.canvasStandard.large === 1.5,
    'wrap: standard 1.5", gallery 2.5" (1.75" at 20" for the 23.5" roll)');
  let threw = false; try { printGeometry('xl', 'poster'); } catch { threw = true; }
  ok(threw, 'an unknown size throws rather than defaulting');
}

const src = await makeSource();
const border = { r: 0x20, g: 0x40, b: 0x60 };

say('\n2. ALL 9 COMBINATIONS, READ BACK\n');
for (const s of SIZE_KEYS) for (const f of FORMAT_KEYS) {
  const r = await renderPrint({ source: src, sizeKey: s, formatKey: f, identity: 'test' });
  const m = await sharp(r.buffer).metadata();
  const g = printGeometry(s, f);
  // The embedded profile is libvips' built-in sRGB (ICC v4); its description
  // is a UTF-16 'mluc' string, so look for "sRGB" in UTF-16BE.
  const isSrgb = Boolean(m.icc) && m.icc.includes(Buffer.from('\u0000s\u0000R\u0000G\u0000B', 'latin1'))
    && m.icc.toString('latin1', 16, 20) === 'RGB ';
  ok(m.width === EXPECT[s][f] && m.height === EXPECT[s][f] && m.format === 'jpeg' && m.density === 300
    && m.chromaSubsampling === '4:4:4' && isSrgb && m.space === 'srgb',
    `${s.padEnd(6)} ${f.padEnd(14)} ${m.width}×${m.height} jpeg ${m.density}dpi ${m.chromaSubsampling} ICC ${isSrgb ? `sRGB v${m.icc[8]}.${m.icc[9] >> 4}` : 'MISSING'}`);
  if (g.wrapPx) {
    // auto wrap = the source's border colour, exactly wrapPx wide
    const inWrap = await pixel(r.buffer, Math.floor(g.wrapPx / 2), Math.floor(r.height / 2));
    ok(nearRGB(inWrap, border), `  wrap is the artwork's edge colour ${toHex(border)}`, toHex({ r: inWrap[0], g: inWrap[1], b: inWrap[2] }));
  }
}

say('\n3. THE WHOLE SOURCE IS IN THE FACE\n');
{
  const r = await renderPrint({ source: src, sizeKey: 'medium', formatKey: 'canvasGallery' });
  const g = printGeometry('medium', 'canvasGallery');
  const face = await sharp(r.buffer).extract({ left: g.wrapPx, top: g.wrapPx, width: g.facePx, height: g.facePx })
    .resize(1000, 1000, { kernel: 'lanczos3' }).removeAlpha().raw().toBuffer();
  const orig = await sharp(src).removeAlpha().raw().toBuffer();
  let diff = 0; for (let i = 0; i < orig.length; i++) diff += Math.abs(orig[i] - face[i]);
  const mean = diff / orig.length;
  ok(mean < 2, 'face downscaled to 1000 px matches the source (nothing cropped, nothing shifted)', `mean abs diff ${mean.toFixed(2)}`);

  // Corners of the face are the source's corners (border colour), not cropped content.
  const corner = await pixel(r.buffer, g.wrapPx + 5, g.wrapPx + 5);
  ok(nearRGB(corner, border), 'face corner is the source corner');

  // A non-square source: fitted whole (contain), padded with the wrap colour.
  const wide = await makeSource(1000, 800);
  const rw = await renderPrint({ source: wide, sizeKey: 'small', formatKey: 'poster' });
  const top = await pixel(rw.buffer, 1800, 5);           // above the fitted image: pad
  const mid = await pixel(rw.buffer, 1800, 1800);        // centre: artwork (white diagonal area / quadrant)
  ok(rw.padded && nearRGB(top, border) && !nearRGB(mid, border), 'a 5:4 source is fitted whole and padded, never cropped');
}

say('\n4. WRAP WIDTH, COLOUR, OVERRIDE\n');
{
  const override = '#00ff7f';
  const r = await renderPrint({ source: src, sizeKey: 'large', formatKey: 'canvasStandard', wrapColour: override });
  const g = printGeometry('large', 'canvasStandard');
  const c = parseHex(override);
  const y = Math.floor(r.height / 2);
  const lastWrap = await pixel(r.buffer, g.wrapPx - 1, y);
  const firstFace = await pixel(r.buffer, g.wrapPx, y);
  const rightWrap = await pixel(r.buffer, r.width - g.wrapPx, y);
  const lastFace = await pixel(r.buffer, r.width - g.wrapPx - 1, y);
  ok(nearRGB(lastWrap, c) && nearRGB(rightWrap, c), `override ${override} fills the wrap on both sides`);
  ok(nearRGB(firstFace, border) && nearRGB(lastFace, border), `wrap is exactly ${g.wrapPx} px: the next pixel in is the artwork`);
  ok(r.wrapColour === override && r.wrapSource === 'override', 'result reports the override');
  const auto = await renderPrint({ source: src, sizeKey: 'large', formatKey: 'canvasStandard' });
  ok(auto.wrapColour === toHex(border) && auto.wrapSource === 'edge', 'no override: wrap colour from the edges', auto.wrapColour);
  const e = await edgeColour(src);
  ok(toHex(e) === toHex(border), 'edgeColour measures the border ring', toHex(e));
  const poster = await renderPrint({ source: src, sizeKey: 'small', formatKey: 'poster', wrapColour: override });
  ok(poster.wrapPx === 0 && poster.width === 3600, 'poster: no wrap even with an override');
}

say(`\n${pass} passed, ${fail} failed.`);
process.exitCode = fail ? 1 : 0;
