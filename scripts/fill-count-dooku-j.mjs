#!/usr/bin/env node
/**
 * fill-count-dooku-j.mjs
 *
 * One-off script: creates the missing Count Dooku Style J (Street Art) product
 * in Sanity by uploading a local PNG as an asset and creating the product
 * document with all fields cloned from sibling count-dooku-style-i.
 *
 * Run from project root:
 *   node scripts/fill-count-dooku-j.mjs
 *
 * Requires SANITY_API_TOKEN in environment (.env file or shell var) with write access.
 * If you have a .env file in the studio folder, you can run it like:
 *   $env:SANITY_API_TOKEN = (Get-Content studio/.env | Select-String "SANITY_API_TOKEN" | ForEach-Object { ($_ -split "=")[1].Trim() })
 *   node scripts/fill-count-dooku-j.mjs
 */

import { createClient } from '@sanity/client';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ---- CONFIG -------------------------------------------------------------
const PROJECT_ID = 'bqb4w421';
const DATASET = 'production';
const API_VERSION = '2024-01-01';

// Source PNG: the chosen rejected render (Banksy red-splatter full body)
const SOURCE_PNG = 'C:\\Users\\chris\\Documents\\Pixel 8\\Products\\Count Dooku\\Count_Dooku_in_the_style_of_Banksy_--v_7_9413b36e-af74-46a3-b1c1-442914f442eb_1.png';

// New product spec
const NEW_DOC = {
  _id: 'product-count-dooku-style-j',
  _type: 'product',
  title: 'Count Dooku — Street Art',
  slug: { _type: 'slug', current: 'count-dooku-style-j' },
  category: 'tv-movies',
  style: 'style-j',
  accentColor: '#76FF03',          // catalogue convention for style-j
  featured: false,
  sortOrder: 0,
  prices: {
    poster:         { small: 9.99,  medium: 12.99, large: 16.99 },
    canvasStandard: { small: 27.99, medium: 32.99, large: 44.99 },
    canvasGallery:  { small: 29.99, medium: 35.99, large: 47.99 },
  },
  sizes: { small: '12x8', medium: '16x12', large: '24x16' },
  tags: ['tv-movies', 'style-j', 'street art', 'tv / movies'],
  description: [{
    _key: 'desc-0',
    _type: 'block',
    style: 'normal',
    markDefs: [],
    children: [{
      _key: 'span-0',
      _type: 'span',
      marks: [],
      text: 'Count Dooku reimagined in our signature Street Art style. Bold, original pop culture wall art — available as poster print, standard canvas, or gallery canvas. Made to order in the UK by Pixel8 Multimedia.',
    }],
  }],
  seo: {
    metaTitle: 'Count Dooku Street Art Wall Art | Pixel8 Multimedia',
    metaDescription: 'Count Dooku Street Art pop culture wall art. Poster prints and canvas made to order in the UK.',
  },
  // images[] is populated AFTER the asset is uploaded (see below)
};

const IMAGE_ALT = 'Count Dooku Street Art wall art by Pixel8 Multimedia';
const IMAGE_FILENAME = 'count-dooku-style-j.png';

// ------------------------------------------------------------------------

const token = process.env.SANITY_API_TOKEN;
if (!token) {
  console.error('❌  SANITY_API_TOKEN env var not set.');
  console.error('   Set it in your shell or .env, then re-run.');
  process.exit(1);
}

if (!existsSync(SOURCE_PNG)) {
  console.error(`❌  Source PNG not found at:\n   ${SOURCE_PNG}`);
  console.error('   Check the path and re-run.');
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
  console.log(`✅  Asset uploaded:\n   _id: ${asset._id}\n   url: ${asset.url}`);

  // Attach the asset reference to the document
  NEW_DOC.images = [{
    _key: 'img-0',
    _type: 'image',
    alt: IMAGE_ALT,
    asset: { _type: 'reference', _ref: asset._id },
  }];

  // Create as a DRAFT so you can review in Studio before publishing.
  // Sanity drafts have ids prefixed with "drafts."
  const draftId = `drafts.${NEW_DOC._id}`;
  const draftDoc = { ...NEW_DOC, _id: draftId };

  console.log(`📝  Creating draft document: ${draftId}`);
  // createOrReplace so re-runs are safe
  const result = await client.createOrReplace(draftDoc);
  console.log(`✅  Draft created:\n   _id: ${result._id}\n   _rev: ${result._rev}`);

  console.log('\n🎉  Done. Open Sanity Studio, find the draft, sanity-check it, and Publish.');
  console.log(`   Studio URL: https://pixel8-multimedia.sanity.studio/desk/product;${result._id}`);
}

main().catch((err) => {
  console.error('💥  Failed:', err);
  process.exit(1);
});
