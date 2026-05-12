#!/usr/bin/env node
/**
 * fill-batman.mjs
 *
 * Creates the missing Batman Style I (Geometric) and Style J (Street Art)
 * products in Sanity.
 *
 * Picks (after conflict-check against existing 8 Batman finals):
 *   Style I: chromecore Batman (orange field, purple/chrome armour)
 *   Style J: lowbrow swirly Batman (yellow swirls, blue figure)
 *            -- avoids conflict with Style A which is also a Banksy stencil
 *
 * Run from project root:
 *   $env:SANITY_API_TOKEN = "sk-..."
 *   node scripts/fill-batman.mjs
 */

import { createClient } from '@sanity/client';
import { readFileSync, existsSync } from 'node:fs';

const PROJECT_ID = 'bqb4w421';
const DATASET = 'production';
const API_VERSION = '2024-01-01';

const SOURCE_DIR = 'C:\\Users\\chris\\Documents\\Pixel 8\\Products\\Batman';

const FILLS = [
  {
    slot: 'i',
    sourceFile: 'Bat-Man_in_the_style_of_2000s_chromecore_--v_7_1f714907-b4e4-4bbd-bba7-9987037a169a_0.png',
    title: 'Batman — Geometric',
    slug: 'batman-style-i',
    style: 'style-i',
    accentColor: '#7C4DFF',
    styleName: 'Geometric',
    tagName: 'geometric',
    imageFilename: 'batman-style-i.png',
  },
  {
    slot: 'j',
    sourceFile: 'Bat-Man_lowbrow_art_style_--v_7_e7fbf553-85f6-46c2-a123-8a541d1ec9cf_0.png',
    title: 'Batman — Street Art',
    slug: 'batman-style-j',
    style: 'style-j',
    accentColor: '#76FF03',
    styleName: 'Street Art',
    tagName: 'street art',
    imageFilename: 'batman-style-j.png',
  },
];

const token = process.env.SANITY_API_TOKEN;
if (!token) {
  console.error('❌  SANITY_API_TOKEN env var not set.');
  process.exit(1);
}

const client = createClient({
  projectId: PROJECT_ID,
  dataset: DATASET,
  apiVersion: API_VERSION,
  token,
  useCdn: false,
});

function buildDocument(fill, assetId) {
  return {
    _id: `drafts.product-batman-style-${fill.slot}`,
    _type: 'product',
    title: fill.title,
    slug: { _type: 'slug', current: fill.slug },
    category: 'tv-movies',
    style: fill.style,
    accentColor: fill.accentColor,
    featured: false,
    sortOrder: 0,
    prices: {
      poster:         { small: 9.99,  medium: 12.99, large: 16.99 },
      canvasStandard: { small: 27.99, medium: 32.99, large: 44.99 },
      canvasGallery:  { small: 29.99, medium: 35.99, large: 47.99 },
    },
    sizes: { small: '12x8', medium: '16x12', large: '24x16' },
    tags: ['tv-movies', `style-${fill.slot}`, fill.tagName, 'tv / movies'],
    description: [{
      _key: 'desc-0',
      _type: 'block',
      style: 'normal',
      markDefs: [],
      children: [{
        _key: 'span-0',
        _type: 'span',
        marks: [],
        text: `Batman reimagined in our signature ${fill.styleName} style. Bold, original pop culture wall art — available as poster print, standard canvas, or gallery canvas. Made to order in the UK by Pixel8 Multimedia.`,
      }],
    }],
    seo: {
      metaTitle: `Batman ${fill.styleName} Wall Art | Pixel8 Multimedia`,
      metaDescription: `Batman ${fill.styleName} pop culture wall art. Poster prints and canvas made to order in the UK.`,
    },
    images: [{
      _key: 'img-0',
      _type: 'image',
      alt: `Batman ${fill.styleName} wall art by Pixel8 Multimedia`,
      asset: { _type: 'reference', _ref: assetId },
    }],
  };
}

async function processFill(fill) {
  const path = `${SOURCE_DIR}\\${fill.sourceFile}`;
  if (!existsSync(path)) {
    throw new Error(`Source PNG not found: ${path}`);
  }
  console.log(`\n--- Style ${fill.slot.toUpperCase()} (${fill.styleName}) ---`);
  console.log(`📤  Uploading: ${fill.imageFilename}`);
  const buf = readFileSync(path);
  const asset = await client.assets.upload('image', buf, {
    filename: fill.imageFilename,
    contentType: 'image/png',
  });
  console.log(`✅  Asset: ${asset._id}`);

  const doc = buildDocument(fill, asset._id);
  console.log(`📝  Creating draft: ${doc._id}`);
  const result = await client.createOrReplace(doc);
  console.log(`✅  Draft: ${result._id}`);
}

async function main() {
  for (const fill of FILLS) {
    await processFill(fill);
  }
  console.log('\n🎉  All fills complete. Open Sanity Studio, review the 2 new drafts, and Publish.');
}

main().catch((err) => {
  console.error('💥  Failed:', err.message);
  process.exit(1);
});
