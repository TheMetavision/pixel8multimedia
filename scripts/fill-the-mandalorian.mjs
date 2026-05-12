#!/usr/bin/env node
/**
 * fill-the-mandalorian.mjs
 *
 * Creates the missing The Mandalorian Style F (Pop Art), G (Watercolour),
 * H (Noir), I (Geometric), J (Street Art) products in Sanity. Category: tv-movies.
 *
 * Picks (after conflict-check against existing 5 finals):
 *   Style F: Lichtenstein 1 — yellow/red dot-halftone pop (classic Lichtenstein)
 *   Style G: Jeff Soto 0    — painterly profile on ornate aged paper, sepia/blue
 *   Style H: Old Poster 3   — red sun w/ dragon-skull, dramatic noir
 *            (text-free unlike other poster variants; checked)
 *   Style I: Psychedelic 0  — bold ornamental colour-block pattern
 *            (Style D's Art Deco is geometric too — these have distinct palettes)
 *   Style J: Banksy 2       — back-facing figure on graffiti-tagged wall
 *            (visually distinct from Style A's red-splatter stencil)
 *
 * NOTE: Skipped Lee Monade & Old Poster variants containing "MANDALORIAN"
 * title text overlays — no other final in the catalogue has embedded text.
 *
 * Run from project root:
 *   $env:SANITY_API_TOKEN = "sk-..."
 *   node scripts/fill-the-mandalorian.mjs
 */

import { createClient } from '@sanity/client';
import { readFileSync, existsSync } from 'node:fs';

const PROJECT_ID = 'bqb4w421';
const DATASET = 'production';
const API_VERSION = '2024-01-01';

const SOURCE_DIR = 'C:\\Users\\chris\\Documents\\Pixel 8\\Products\\The Mandalorian';

const FILLS = [
  {
    slot: 'f',
    sourceFile: 'The_Mandalorian_Roy_Lichenstein_style_--v_7_09873cb3-e52a-483f-b566-54532f22b466_1.png',
    styleName: 'Pop Art',
    tagName: 'pop art',
    accentColor: '#FF1744',
  },
  {
    slot: 'g',
    sourceFile: 'The_Mandalorian_Jeff_Soto_style_--v_7_da91c2a2-b22d-4fc7-aab4-04d24ef7c64c_0.png',
    styleName: 'Watercolour',
    tagName: 'watercolour',
    accentColor: '#81D4FA',
  },
  {
    slot: 'h',
    sourceFile: 'The_Mandalorian_old_terrifying_movie_poster_--v_7_b702e26f-fcb5-49f9-9fcd-19a3bbfea9d0_3.png',
    styleName: 'Noir',
    tagName: 'noir',
    accentColor: '#424242',
  },
  {
    slot: 'i',
    sourceFile: 'The_Mandalorian_psychedelic_cartoon_style_--v_7_a4ed78f2-6e5d-45c1-b59d-042f512be5e1_0.png',
    styleName: 'Geometric',
    tagName: 'geometric',
    accentColor: '#7C4DFF',
  },
  {
    slot: 'j',
    sourceFile: 'The_Mandalorian_in_the_style_of_Banksy_--v_7_3cfd200a-6edb-4f2d-b71d-1ad3d4096b4d_2.png',
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
    _id: `drafts.product-the-mandalorian-style-${fill.slot}`,
    _type: 'product',
    title: `The Mandalorian — ${fill.styleName}`,
    slug: { _type: 'slug', current: `the-mandalorian-style-${fill.slot}` },
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
        text: `The Mandalorian reimagined in our signature ${fill.styleName} style. Bold, original pop culture wall art — available as poster print, standard canvas, or gallery canvas. Made to order in the UK by Pixel8 Multimedia.`,
      }],
    }],
    seo: {
      metaTitle: `The Mandalorian ${fill.styleName} Wall Art | Pixel8 Multimedia`,
      metaDescription: `The Mandalorian ${fill.styleName} pop culture wall art. Poster prints and canvas made to order in the UK.`,
    },
    images: [{
      _key: 'img-0',
      _type: 'image',
      alt: `The Mandalorian ${fill.styleName} wall art by Pixel8 Multimedia`,
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
  console.log(`📤  Uploading: the-mandalorian-style-${fill.slot}.png`);
  const buf = readFileSync(path);
  const asset = await client.assets.upload('image', buf, {
    filename: `the-mandalorian-style-${fill.slot}.png`,
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
