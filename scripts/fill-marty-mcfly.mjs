#!/usr/bin/env node
/**
 * fill-marty-mcfly.mjs
 *
 * Creates 8 missing Marty McFly products in Sanity: Styles C, D, E, F, G, H, I, J.
 * Category: tv-movies.
 *
 * Picks (after conflict-check against existing 2 finals — A Banksy stencil,
 * B cute cartoon on watercolour wash):
 *   C Retro Vibes:  Lee Monade 0   — pink/orange/blue 80s screen-print poster
 *   D Pixel Art:    Josh Agle 0    — flat mid-century suburbia construction
 *   E Abstract:     Jeff Soto 0    — surreal eyeball/tentacle explosion burst
 *   F Pop Art:      Lichtenstein 0 — yellow/red halftone-dot, sunglasses portrait
 *   G Watercolour:  Frank Miller 0 — painterly hoverboard sketch on white
 *   H Noir:         Old Poster 0   — stormy lightning atmospheric portrait
 *   I Geometric:    Jack Kirby 0   — comic-panel skating action, angular composition
 *   J Street Art:   Psychedelic 0  — bold hand-illustrated (Obey-style) swirly poster
 *                                    avoids Banksy duplication with Style A
 *
 * Run from project root:
 *   $env:SANITY_API_TOKEN = "sk-..."
 *   node scripts/fill-marty-mcfly.mjs
 */

import { createClient } from '@sanity/client';
import { readFileSync, existsSync } from 'node:fs';

const PROJECT_ID = 'bqb4w421';
const DATASET = 'production';
const API_VERSION = '2024-01-01';

const SOURCE_DIR = 'C:\\Users\\chris\\Documents\\Pixel 8\\Products\\Marty McFly';

const FILLS = [
  {
    slot: 'c',
    sourceFile: 'Marty_McFly_poster_made_by_Lee_Monade_--v_7_78450f99-25fb-4b25-be94-b26850def925_0.png',
    styleName: 'Retro Vibes',
    tagName: 'retro vibes',
    accentColor: '#FF6B35',
  },
  {
    slot: 'd',
    sourceFile: 'Marty_McFly_in_the_style_of_Josh_Agle_--v_7_235e346b-b872-4901-b659-f8865b9f43f7_0.png',
    styleName: 'Pixel Art',
    tagName: 'pixel art',
    accentColor: '#00E5FF',
  },
  {
    slot: 'e',
    sourceFile: 'Marty_McFly_Jeff_Soto_style_--v_7_edd401cc-1eba-4cc5-8159-fce7d2e00bc3_0.png',
    styleName: 'Abstract Burst',
    tagName: 'abstract burst',
    accentColor: '#FFD600',
  },
  {
    slot: 'f',
    sourceFile: 'Marty_McFly_Roy_Lichenstein_style_--v_7_24c6c6a3-6fd4-4ca6-be5f-a62249527e01_0.png',
    styleName: 'Pop Art',
    tagName: 'pop art',
    accentColor: '#FF1744',
  },
  {
    slot: 'g',
    sourceFile: 'Marty_McFly_in_the_style_of_Frank_Miller_--v_7_0d786973-27a0-43b3-a254-67d9042f71e0_0.png',
    styleName: 'Watercolour',
    tagName: 'watercolour',
    accentColor: '#81D4FA',
  },
  {
    slot: 'h',
    sourceFile: 'Marty_McFly_old_terrifying_movie_poster_--v_7_01f1b21e-8fbf-4cd2-a253-7cc341547272_0.png',
    styleName: 'Noir',
    tagName: 'noir',
    accentColor: '#424242',
  },
  {
    slot: 'i',
    sourceFile: 'Marty_McFly_in_the_style_of_Jack_Kirby_--v_7_2e30df29-afb7-4374-b662-1f2d2c4b7d67_0.png',
    styleName: 'Geometric',
    tagName: 'geometric',
    accentColor: '#7C4DFF',
  },
  {
    slot: 'j',
    sourceFile: 'Marty_McFly_psychedelic_cartoon_style_--v_7_1afe6d13-2762-4229-a123-edfd518a3cd7_0.png',
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
    _id: `drafts.product-marty-mcfly-style-${fill.slot}`,
    _type: 'product',
    title: `Marty McFly — ${fill.styleName}`,
    slug: { _type: 'slug', current: `marty-mcfly-style-${fill.slot}` },
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
        text: `Marty McFly reimagined in our signature ${fill.styleName} style. Bold, original pop culture wall art — available as poster print, standard canvas, or gallery canvas. Made to order in the UK by Pixel8 Multimedia.`,
      }],
    }],
    seo: {
      metaTitle: `Marty McFly ${fill.styleName} Wall Art | Pixel8 Multimedia`,
      metaDescription: `Marty McFly ${fill.styleName} pop culture wall art. Poster prints and canvas made to order in the UK.`,
    },
    images: [{
      _key: 'img-0',
      _type: 'image',
      alt: `Marty McFly ${fill.styleName} wall art by Pixel8 Multimedia`,
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
  console.log(`📤  Uploading: marty-mcfly-style-${fill.slot}.png`);
  const buf = readFileSync(path);
  const asset = await client.assets.upload('image', buf, {
    filename: `marty-mcfly-style-${fill.slot}.png`,
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
  console.log('\n🎉  All fills complete. Open Sanity Studio, review the 8 new drafts, and Publish.');
}

main().catch((err) => {
  console.error('💥  Failed:', err.message);
  process.exit(1);
});
