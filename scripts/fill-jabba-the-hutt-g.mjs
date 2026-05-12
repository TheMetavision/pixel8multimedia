#!/usr/bin/env node
/**
 * fill-jabba-the-hutt-g.mjs
 *
 * Creates the missing Jabba The Hutt Style G (Watercolour) product in Sanity
 * by uploading the local "style G.png" (already-curated final) and creating
 * the product document with all fields matching the catalogue convention.
 *
 * Run from project root:
 *   $env:SANITY_API_TOKEN = "sk-..."
 *   node scripts/fill-jabba-the-hutt-g.mjs
 *
 * Safe to re-run (uses createOrReplace).
 */

import { createClient } from '@sanity/client';
import { readFileSync, existsSync } from 'node:fs';

// ---- CONFIG -------------------------------------------------------------
const PROJECT_ID = 'bqb4w421';
const DATASET = 'production';
const API_VERSION = '2024-01-01';

// Source PNG: the already-curated "style G.png" from the local folder
const SOURCE_PNG = 'C:\\Users\\chris\\Documents\\Pixel 8\\Products\\Jabba The Hutt\\style G.png';

// New product spec
const NEW_DOC = {
  _id: 'product-jabba-the-hutt-style-g',
  _type: 'product',
  title: 'Jabba The Hutt — Watercolour',
  slug: { _type: 'slug', current: 'jabba-the-hutt-style-g' },
  category: 'tv-movies',
  style: 'style-g',
  accentColor: '#81D4FA',          // catalogue convention for style-g (Watercolour)
  featured: false,
  sortOrder: 0,
  prices: {
    poster:         { small: 9.99,  medium: 12.99, large: 16.99 },
    canvasStandard: { small: 27.99, medium: 32.99, large: 44.99 },
    canvasGallery:  { small: 29.99, medium: 35.99, large: 47.99 },
  },
  sizes: { small: '12x8', medium: '16x12', large: '24x16' },
  tags: ['tv-movies', 'style-g', 'watercolour', 'tv / movies'],
  description: [{
    _key: 'desc-0',
    _type: 'block',
    style: 'normal',
    markDefs: [],
    children: [{
      _key: 'span-0',
      _type: 'span',
      marks: [],
      text: 'Jabba The Hutt reimagined in our signature Watercolour style. Bold, original pop culture wall art — available as poster print, standard canvas, or gallery canvas. Made to order in the UK by Pixel8 Multimedia.',
    }],
  }],
  seo: {
    metaTitle: 'Jabba The Hutt Watercolour Wall Art | Pixel8 Multimedia',
    metaDescription: 'Jabba The Hutt Watercolour pop culture wall art. Poster prints and canvas made to order in the UK.',
  },
};

const IMAGE_ALT = 'Jabba The Hutt Watercolour wall art by Pixel8 Multimedia';
const IMAGE_FILENAME = 'jabba-the-hutt-style-g.png';

// ------------------------------------------------------------------------

const token = process.env.SANITY_API_TOKEN;
if (!token) {
  console.error('❌  SANITY_API_TOKEN env var not set.');
  process.exit(1);
}

if (!existsSync(SOURCE_PNG)) {
  console.error(`❌  Source PNG not found at:\n   ${SOURCE_PNG}`);
  process.exit(1);
}

const client = createClient({
  projectId: PROJECT_ID,
  dataset: DATASET,
  apiVersion: API_VERSION,
  token,
  useCdn: false,
});

async function main() {
  console.log(`📤  Uploading image to Sanity: ${IMAGE_FILENAME}`);
  const buf = readFileSync(SOURCE_PNG);
  const asset = await client.assets.upload('image', buf, {
    filename: IMAGE_FILENAME,
    contentType: 'image/png',
  });
  console.log(`✅  Asset uploaded:\n   _id: ${asset._id}`);

  NEW_DOC.images = [{
    _key: 'img-0',
    _type: 'image',
    alt: IMAGE_ALT,
    asset: { _type: 'reference', _ref: asset._id },
  }];

  const draftId = `drafts.${NEW_DOC._id}`;
  const draftDoc = { ...NEW_DOC, _id: draftId };

  console.log(`📝  Creating draft document: ${draftId}`);
  const result = await client.createOrReplace(draftDoc);
  console.log(`✅  Draft created:\n   _id: ${result._id}`);

  console.log('\n🎉  Done. Open Sanity Studio, sanity-check the draft, and Publish.');
}

main().catch((err) => {
  console.error('💥  Failed:', err);
  process.exit(1);
});
