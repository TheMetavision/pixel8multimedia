/**
 * Fill in the example images on the personalisationStyle documents from the
 * harness run, so the builder's style pills show a real before/after instead
 * of a letter.
 *
 *   node tools/builder/seed-examples.mjs --photo 01-solo [--dry-run] [--force]
 *
 * Reads  tools/builder/style-tests/<slug>/<photo>.png   (the harness output)
 *        tools/builder/test-photos/<photo>.*            (the original)
 * Writes exampleAfter / exampleBefore on personalisationStyle.<styleKey>
 *
 * Pick a photo you own the rights to and are happy to show publicly — these
 * become customer-facing marketing images. The solo portrait is usually the
 * clearest at pill size; groups read as mush at 240px.
 *
 * Uploads are downsized to 1200px (plenty for a pill and a lightbox) and
 * tagged so they're easy to find in the Sanity media library later.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createClient } from '@sanity/client';
import { listPublicStyles } from '../../netlify/functions/_shared/styles.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const photo = (() => {
  const i = args.indexOf('--photo');
  return i === -1 ? '01-solo' : args[i + 1];
})();

const sanity = createClient({
  projectId: 'bqb4w421',
  dataset: process.env.SANITY_DATASET || 'production',
  apiVersion: '2026-04-14',
  token: process.env.SANITY_TOKEN,
  useCdn: false,
});

// styleKey → internal slug, read back from the styles module so this can't
// drift from the mapping.
const SLUG_BY_KEY = await (async () => {
  const src = fs.readFileSync(path.join(HERE, '..', '..', 'netlify', 'functions', '_shared', 'styles.mjs'), 'utf8');
  const map = {};
  for (const m of src.matchAll(/slug:\s*'([^']+)',\s*\n\s*styleKey:\s*'([^']+)'/g)) map[m[2]] = m[1];
  return map;
})();

function findFile(dir, stem) {
  if (!fs.existsSync(dir)) return null;
  const hit = fs.readdirSync(dir).find((f) => path.parse(f).name === stem && /\.(png|jpe?g|webp)$/i.test(f));
  return hit ? path.join(dir, hit) : null;
}

async function upload(file, label) {
  const buf = await sharp(file).resize(1200, 1200, { fit: 'inside' }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  return sanity.assets.upload('image', buf, {
    filename: `${label}.jpg`,
    contentType: 'image/jpeg',
    label: 'personalisation-example',
    title: label,
  });
}

const before = findFile(path.join(HERE, 'test-photos'), photo);
if (!before) {
  console.error(`\n  No original photo "${photo}" in tools/builder/test-photos.\n`);
  process.exit(1);
}

const styles = listPublicStyles();
console.log(`\n  Photo: ${path.basename(before)} · ${styles.length} styles${dryRun ? ' (dry run)' : ''}\n`);

let beforeAsset = null;
for (const s of styles) {
  const slug = SLUG_BY_KEY[s.key];
  const after = slug ? findFile(path.join(HERE, 'style-tests', slug), photo) : null;
  if (!after) {
    console.warn(`  ! ${s.key} (${s.label}) — no harness output for ${photo}, skipped`);
    continue;
  }

  const _id = `personalisationStyle.${s.key}`;
  const doc = await sanity.getDocument(_id).catch(() => null);
  if (!doc) { console.warn(`  ! ${s.key} — no document, run seed-styles.mjs first`); continue; }
  if (doc.exampleAfter && !force) { console.log(`  = ${s.key} ${s.label} — already has an example (use --force)`); continue; }

  console.log(`  → ${s.key} ${s.label}`);
  if (dryRun) continue;

  if (!beforeAsset) beforeAsset = await upload(before, `personalisation-example-original`);
  const afterAsset = await upload(after, `personalisation-example-${s.key}`);
  await sanity
    .patch(_id)
    .set({
      exampleBefore: { _type: 'image', asset: { _type: 'reference', _ref: beforeAsset._id } },
      exampleAfter: { _type: 'image', asset: { _type: 'reference', _ref: afterAsset._id } },
    })
    .commit();
}

console.log(dryRun ? '\n  Nothing written.\n' : '\n  Done — reload the builder to see the pills.\n');
