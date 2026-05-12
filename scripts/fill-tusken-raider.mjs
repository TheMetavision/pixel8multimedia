#!/usr/bin/env node
/**
 * fill-tusken-raider.mjs
 *
 * Creates the missing Tusken Raider Style G (Watercolour), H (Noir),
 * I (Geometric), and J (Street Art) products in Sanity. Category: tv-movies.
 *
 * Picks (after conflict-check against existing 6 finals):
 *   Style G: Lichtenstein 0 — pink-to-orange gradient sky, painterly portrait
 *   Style H: Old Poster 0  — vintage pulp horror, dramatic shadows
 *   Style I: Psychedelic 0 — vivid colour-block composite (purple/teal/pink,
 *            distinct from Style D's orange Bauhaus geometric)
 *   Style J: Banksy 1      — yellow flat-field full-body stencil silhouette
 *            (visually distinct from Style B's sketchy ink Banksy)
 *
 * Run from project root:
 *   $env:SANITY_API_TOKEN = "sk-..."
 *   node scripts/fill-tusken-raider.mjs
 */

import { createClient } from '@sanity/client';
import { readFileSync, existsSync } from 'node:fs';

const PROJECT_ID = 'bqb4w421';
const DATASET = 'production';
const API_VERSION = '2024-01-01';

const SOURCE_DIR = 'C:\\Users\\chris\\Documents\\Pixel 8\\Products\\Tusken Raider';

const FILLS = [
  {
    slot: 'g',
    sourceFile: 'Tusken_Raider_Roy_Lichenstein_style_--v_7_03a7b169-4d45-491a-90b8-2a4d5cc68e66_0.png',
    styleName: 'Watercolour',
    tagName: 'watercolour',
    accentColor: '#81D4FA',
  },
  {
    slot: 'h',
    sourceFile: 'Tusken_Raider_old_terrifying_movie_poster_--v_7_024f1e9b-d7b6-4999-b844-abfb2699cd55_0.png',
    styleName: 'Noir',
    tagName: 'noir',
    accentColor: '#424242',
  },
  {
    slot: 'i',
    sourceFile: 'Tusken_Raider_psychedelic_cartoon_style_--v_7_fc2aa5b5-1dd0-4957-a3d4-f7a966fd1e91_0.png',
    styleName: 'Geometric',
    tagName: 'geometric',
    accentColor: '#7C4DFF',
  },
  {
    slot: 'j',
    sourceFile: 'Tusken_Raider_in_the_style_of_Banksy_--v_7_e73f8e1a-ee27-4f6c-8326-2715ddee8369_1.png',
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
    _id: `drafts.product-tusken-raider-style-${fill.slot}`,
    _type: 'product',
    title: `Tusken Raider — ${fill.styleName}`,
    slug: { _type: 'slug', current: `tusken-raider-style-${fill.slot}` },
    category: 'tv-movies',
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
        text: `Tusken Raider reimagined in our signature ${fill.styleName} style. Bold, original pop culture wall art — available as poster print, standard canvas, or gallery canvas. Made to order in the UK by Pixel8 Multimedia.`,
      }],
    }],
    seo: {
      metaTitle: `Tusken Raider ${fill.styleName} Wall Art | Pixel8 Multimedia`,
      metaDescription: `Tusken Raider ${fill.styleName} pop culture wall art. Poster prints and canvas made to order in the UK.`,
    },
    images: [{
      _key: 'img-0',
      _type: 'image',
      alt: `Tusken Raider ${fill.styleName} wall art by Pixel8 Multimedia`,
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
  console.log(`📤  Uploading: tusken-raider-style-${fill.slot}.png`);
  const buf = readFileSync(path);
  const asset = await client.assets.upload('image', buf, {
    filename: `tusken-raider-style-${fill.slot}.png`,
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
  console.log('\n🎉  All fills complete. Open Sanity Studio, review the 4 new drafts, and Publish.');
}

main().catch((err) => {
  console.error('💥  Failed:', err.message);
  process.exit(1);
});
