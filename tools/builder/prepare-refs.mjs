/**
 * Copy the harness refs into the function bundle at a sane size.
 *
 *   node tools/builder/prepare-refs.mjs [--size 1024] [--quality 85]
 *
 * Reads  tools/builder/refs/<slug>/*.{png,jpg,webp}   (4096px masters, gitignored)
 * Writes netlify/functions/_shared/refs/<slug>/<n>.jpg (committed, bundled)
 *
 * Gemini gains nothing from 4096px refs and four of them per style would push
 * the function bundle past its limits; 1024px JPEGs keep the whole set under
 * ~10 MB. Run again whenever a ref changes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, 'refs');
const DEST = path.resolve(HERE, '..', '..', 'netlify', 'functions', '_shared', 'refs');

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i === -1 ? dflt : Number(args[i + 1]);
};
const SIZE = opt('--size', 1024);
const QUALITY = opt('--quality', 85);
const EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);

if (!fs.existsSync(SRC)) {
  console.error(`No refs at ${SRC}`);
  process.exit(1);
}

let total = 0;
let bytes = 0;
for (const slug of fs.readdirSync(SRC).sort()) {
  const from = path.join(SRC, slug);
  if (!fs.statSync(from).isDirectory()) continue;
  const files = fs.readdirSync(from).filter((f) => EXT.has(path.extname(f).toLowerCase())).sort();
  if (!files.length) { console.warn(`  ! ${slug}: no refs, skipped`); continue; }

  const to = path.join(DEST, slug);
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(to, { recursive: true });

  for (let i = 0; i < files.length; i++) {
    const out = path.join(to, `${String(i + 1).padStart(2, '0')}.jpg`);
    await sharp(path.join(from, files[i]))
      .rotate()
      .resize(SIZE, SIZE, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: QUALITY, mozjpeg: true })
      .toFile(out);
    bytes += fs.statSync(out).size;
    total++;
  }
  console.log(`  ${slug.padEnd(18)} ${files.length} refs`);
}
console.log(`\n  ${total} refs → ${DEST}  (${(bytes / 1024 / 1024).toFixed(1)} MB)\n`);
