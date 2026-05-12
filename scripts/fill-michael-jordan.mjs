#!/usr/bin/env node
/**
 * fill-michael-jordan.mjs
 *
 * Creates the missing Michael Jordan Style H (Noir), Style I (Geometric),
 * and Style J (Street Art) products in Sanity. Category: sport.
 *
 * Picks (after conflict-check against existing 7 finals):
 *   Style H: Frank Miller variant — high-contrast B/W ink portrait (classic noir)
 *   Style I: Rizz variant — cyberpunk dual-profile with wireframe grid (geometric)
 *   Style J: Lee Monade variant — face on red/teal vertical stripes (poster art)
 *
 * Run from project root:
 *   $env:SANITY_API_TOKEN = "sk-..."
 *   node scripts/fill-michael-jordan.mjs
 */

import { createClient } from '@sanity/client';
import { readFileSync, existsSync } from 'node:fs';

const PROJECT_ID = 'bqb4w421';
const DATASET = 'production';
const API_VERSION = '2024-01-01';

const SOURCE_DIR = 'C:\\Users\\chris\\Documents\\Pixel 8\\Products\\Michael Jordan';

const FILLS = [
  {
    slot: 'h',
    sourceFile: 'Michael_Jordan_in_the_style_of_Frank_Miller_--v_7_defaa6a3-567b-44e0-b846-f8e998bda8d3_1.png',
    styleName: 'Noir',
    tagName: 'noir',
    accentColor: '#424242',
  },
  {
    slot: 'i',
    sourceFile: 'Michael_Jordan_with_Rizz_--v_7_4c8355f2-59bb-49fd-b06e-bac91464260e_0.png',
    styleName: 'Geometric',
    tagName: 'geometric',
    accentColor: '#7C4DFF',
  },
  {
    slot: 'j',
    sourceFile: 'Michael_Jordan_poster_made_by_Lee_Monade_--v_7_f04643c6-ff73-4323-a875-cc9ad2b026dc_0.png',
    styleName: 'Street Art',
    tagName: 'street art',
    accentColor: '#76FF03',
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
    _id: `drafts.product-michael-jordan-style-${fill.slot}`,
    _type: 'product',
    title: `Michael Jordan — ${fill.styleName}`,
    slug: { _type: 'slug', current: `michael-jordan-style-${fill.slot}` },
    category: 'sport',
    style: `style-${fill.slot}`,
    accentColor: fill.accentColor,
    featured: false,
    sortOrder: 0,
    prices: {
      poster:         { small: 9.99,  medium: 12.99, large: 16.99 },
      canvasStandard: { small: 27.99, medium: 32.99, large: 44.99 },
      canvasGallery:  { small: 29.99, medium: 35.99, large: 47.99 },
    },
    sizes: { small: '12x8', medium: '16x12', large: '24x16' },
    // Matches existing sport-category tag convention (duplicated 'sport' confirmed)
    tags: ['sport', `style-${fill.slot}`, fill.tagName, 'sport'],
    description: [{
      _key: 'desc-0',
      _type: 'block',
      style: 'normal',
      markDefs: [],
      children: [{
        _key: 'span-0',
        _type: 'span',
        marks: [],
        text: `Michael Jordan reimagined in our signature ${fill.styleName} style. Bold, original pop culture wall art — available as poster print, standard canvas, or gallery canvas. Made to order in the UK by Pixel8 Multimedia.`,
      }],
    }],
    seo: {
      metaTitle: `Michael Jordan ${fill.styleName} Wall Art | Pixel8 Multimedia`,
      metaDescription: `Michael Jordan ${fill.styleName} pop culture wall art. Poster prints and canvas made to order in the UK.`,
    },
    images: [{
      _key: 'img-0',
      _type: 'image',
      alt: `Michael Jordan ${fill.styleName} wall art by Pixel8 Multimedia`,
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
  console.log(`📤  Uploading: michael-jordan-style-${fill.slot}.png`);
  const buf = readFileSync(path);
  const asset = await client.assets.upload('image', buf, {
    filename: `michael-jordan-style-${fill.slot}.png`,
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
  console.log('\n🎉  All fills complete. Open Sanity Studio, review the 3 new drafts, and Publish.');
}

main().catch((err) => {
  console.error('💥  Failed:', err.message);
  process.exit(1);
});
