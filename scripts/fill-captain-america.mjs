#!/usr/bin/env node
/**
 * fill-captain-america.mjs
 *
 * Creates the missing Captain America Style I (Geometric) and Style J (Street Art)
 * products in Sanity.
 *
 * Picks (after conflict-check against existing 8 Captain America finals):
 *   Style I: Frank Miller 0 — red field with fragmented red/white figure planes
 *            (geometric reading, distinct from all 8 existing)
 *   Style J: Lee Monade 1 — screen-print poster with orange/purple stripes
 *            (avoids Banksy stencil duplication with existing Style A)
 *
 * Run from project root:
 *   $env:SANITY_API_TOKEN = "sk-..."
 *   node scripts/fill-captain-america.mjs
 */

import { createClient } from '@sanity/client';
import { readFileSync, existsSync } from 'node:fs';

const PROJECT_ID = 'bqb4w421';
const DATASET = 'production';
const API_VERSION = '2024-01-01';

const SOURCE_DIR = 'C:\\Users\\chris\\Documents\\Pixel 8\\Products\\Captain America';

const FILLS = [
  {
    slot: 'i',
    sourceFile: 'Captain_America_in_the_style_of_Frank_Miller_--v_7_c5f43249-8db2-49ba-95ed-80b5075dae05_0.png',
    title: 'Captain America — Geometric',
    slug: 'captain-america-style-i',
    style: 'style-i',
    accentColor: '#7C4DFF',
    styleName: 'Geometric',
    tagName: 'geometric',
    imageFilename: 'captain-america-style-i.png',
  },
  {
    slot: 'j',
    sourceFile: 'Captain_America_poster_made_by_Lee_Monade_--v_7_0ae26373-9659-48f1-8d0d-8a8f3f928f2f_1.png',
    title: 'Captain America — Street Art',
    slug: 'captain-america-style-j',
    style: 'style-j',
    accentColor: '#76FF03',
    styleName: 'Street Art',
    tagName: 'street art',
    imageFilename: 'captain-america-style-j.png',
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
    _id: `drafts.product-captain-america-style-${fill.slot}`,
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
        text: `Captain America reimagined in our signature ${fill.styleName} style. Bold, original pop culture wall art — available as poster print, standard canvas, or gallery canvas. Made to order in the UK by Pixel8 Multimedia.`,
      }],
    }],
    seo: {
      metaTitle: `Captain America ${fill.styleName} Wall Art | Pixel8 Multimedia`,
      metaDescription: `Captain America ${fill.styleName} pop culture wall art. Poster prints and canvas made to order in the UK.`,
    },
    images: [{
      _key: 'img-0',
      _type: 'image',
      alt: `Captain America ${fill.styleName} wall art by Pixel8 Multimedia`,
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
