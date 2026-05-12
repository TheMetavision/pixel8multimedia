#!/usr/bin/env node
/**
 * fill-tom-and-jerry.mjs
 *
 * Creates the missing Tom and Jerry Style F (Pop Art), G (Watercolour),
 * H (Noir), I (Geometric), J (Street Art) products in Sanity.
 * Category: animations.
 *
 * Picks (after conflict-check against existing 5 finals):
 *   Style F: Lichtenstein 0 — split-panel diptych with halftone dots (classic pop)
 *   Style G: Psychedelic 0  — close-up faces on swirly cosmic wash background
 *   Style H: Old Poster 0   — warm-toned dramatic pulp horror
 *            (NOT B&W to avoid conflict with already-B&W Styles B and E)
 *   Style I: Jack Kirby 0   — cosmic explosion chase scene, dynamic angles
 *   Style J: Banksy 1       — literal stencil graffiti on wall with tag mark
 *            (compositionally distinct from Style A's mural-on-brick Banksy)
 *
 * Run from project root:
 *   $env:SANITY_API_TOKEN = "sk-..."
 *   node scripts/fill-tom-and-jerry.mjs
 */

import { createClient } from '@sanity/client';
import { readFileSync, existsSync } from 'node:fs';

const PROJECT_ID = 'bqb4w421';
const DATASET = 'production';
const API_VERSION = '2024-01-01';

const SOURCE_DIR = 'C:\\Users\\chris\\Documents\\Pixel 8\\Products\\Tom and Jerry';

const FILLS = [
  {
    slot: 'f',
    sourceFile: 'Tom__Jerry_Roy_Lichenstein_style_--v_7_14e85062-c1ad-44ee-a222-b29d082abb4a_0.png',
    styleName: 'Pop Art',
    tagName: 'pop art',
    accentColor: '#FF1744',
  },
  {
    slot: 'g',
    sourceFile: 'Tom__Jerry_psychedelic_cartoon_style_--v_7_50cef650-523e-4aca-874a-5f1d07839c74_0.png',
    styleName: 'Watercolour',
    tagName: 'watercolour',
    accentColor: '#81D4FA',
  },
  {
    slot: 'h',
    sourceFile: 'Tom__Jerry_old_terrifying_movie_poster_--v_7_dbb512c6-06d4-4a30-a055-9eeafb865140_0.png',
    styleName: 'Noir',
    tagName: 'noir',
    accentColor: '#424242',
  },
  {
    slot: 'i',
    sourceFile: 'Tom__Jerry_in_the_style_of_Jack_Kirby_--v_7_6ce183de-0824-4c8c-89ea-cc2fa2144294_0.png',
    styleName: 'Geometric',
    tagName: 'geometric',
    accentColor: '#7C4DFF',
  },
  {
    slot: 'j',
    sourceFile: 'Tom__Jerry_in_the_style_of_Banksy_--v_7_ccfdc976-27ef-463d-b3bb-39a8d8cd7b3d_1.png',
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
    _id: `drafts.product-tom-and-jerry-style-${fill.slot}`,
    _type: 'product',
    title: `Tom and Jerry — ${fill.styleName}`,
    slug: { _type: 'slug', current: `tom-and-jerry-style-${fill.slot}` },
    category: 'animations',
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
    tags: ['animations', `style-${fill.slot}`, fill.tagName, 'animations'],
    description: [{
      _key: 'desc-0',
      _type: 'block',
      style: 'normal',
      markDefs: [],
      children: [{
        _key: 'span-0',
        _type: 'span',
        marks: [],
        text: `Tom and Jerry reimagined in our signature ${fill.styleName} style. Bold, original pop culture wall art — available as poster print, standard canvas, or gallery canvas. Made to order in the UK by Pixel8 Multimedia.`,
      }],
    }],
    seo: {
      metaTitle: `Tom and Jerry ${fill.styleName} Wall Art | Pixel8 Multimedia`,
      metaDescription: `Tom and Jerry ${fill.styleName} pop culture wall art. Poster prints and canvas made to order in the UK.`,
    },
    images: [{
      _key: 'img-0',
      _type: 'image',
      alt: `Tom and Jerry ${fill.styleName} wall art by Pixel8 Multimedia`,
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
  console.log(`📤  Uploading: tom-and-jerry-style-${fill.slot}.png`);
  const buf = readFileSync(path);
  const asset = await client.assets.upload('image', buf, {
    filename: `tom-and-jerry-style-${fill.slot}.png`,
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
  console.log('\n🎉  All fills complete. Open Sanity Studio, review the 5 new drafts, and Publish.');
}

main().catch((err) => {
  console.error('💥  Failed:', err.message);
  process.exit(1);
});
