#!/usr/bin/env node
/**
 * fill-tony-montana.mjs
 *
 * Creates 7 missing Tony Montana products in Sanity: Styles D, E, F, G, H, I, J.
 * Category: tv-movies.
 *
 * Picks (after conflict-check against existing 3 finals — A chromecore,
 * B Banksy stencil on brick, C Dr Seuss cartoon):
 *   D Pixel Art:    Josh Agle 0    — flat blocky bar scene, mid-century
 *   E Abstract:     Lowbrow 0      — figure on pink swirl, abstract energy
 *   F Pop Art:      Lichtenstein 0 — yellow halftone dots, classic pop
 *   G Watercolour:  Jeff Soto 0    — painterly aged-paper portrait
 *   H Noir:         Frank Miller 0 — heavy shadow B/W comic noir
 *   I Geometric:    Jack Kirby 0   — angular comic-panel composition
 *   J Street Art:   Psychedelic 0  — bold vivid hand-illustrated (Obey-like)
 *                                    avoids Banksy duplication with Style B
 *
 * Run from project root:
 *   $env:SANITY_API_TOKEN = "sk-..."
 *   node scripts/fill-tony-montana.mjs
 */

import { createClient } from '@sanity/client';
import { readFileSync, existsSync } from 'node:fs';

const PROJECT_ID = 'bqb4w421';
const DATASET = 'production';
const API_VERSION = '2024-01-01';

const SOURCE_DIR = 'C:\\Users\\chris\\Documents\\Pixel 8\\Products\\Tony Montana';

const FILLS = [
  {
    slot: 'd',
    sourceFile: 'Tony_Montana_in_the_style_of_Josh_Agle_--v_7_4137aa0a-817d-40e4-9c65-23a53827fb09_0.png',
    styleName: 'Pixel Art',
    tagName: 'pixel art',
    accentColor: '#00E5FF',
  },
  {
    slot: 'e',
    sourceFile: 'Tony_Montana_lowbrow_art_style_--v_7_81797fac-02ec-41f2-867c-3b79ec80616b_0.png',
    styleName: 'Abstract Burst',
    tagName: 'abstract burst',
    accentColor: '#FFD600',
  },
  {
    slot: 'f',
    sourceFile: 'Tony_Montana_Roy_Lichenstein_style_--v_7_633584d0-785c-4260-b890-30625a3e1b5b_0.png',
    styleName: 'Pop Art',
    tagName: 'pop art',
    accentColor: '#FF1744',
  },
  {
    slot: 'g',
    sourceFile: 'Tony_Montana_Jeff_Soto_style_--v_7_3b303cde-caa0-4eaa-9ae4-6eaa41f56547_0.png',
    styleName: 'Watercolour',
    tagName: 'watercolour',
    accentColor: '#81D4FA',
  },
  {
    slot: 'h',
    sourceFile: 'Tony_Montana_in_the_style_of_Frank_Miller_--v_7_e254c061-057c-46cd-ac20-a7364db2579b_0.png',
    styleName: 'Noir',
    tagName: 'noir',
    accentColor: '#424242',
  },
  {
    slot: 'i',
    sourceFile: 'Tony_Montana_in_the_style_of_Jack_Kirby_--v_7_6f3db7ca-517e-4406-bca3-03c8cd667a98_0.png',
    styleName: 'Geometric',
    tagName: 'geometric',
    accentColor: '#7C4DFF',
  },
  {
    slot: 'j',
    sourceFile: 'Tony_Montana_psychedelic_cartoon_style_--v_7_693444bc-effc-410e-adce-d3777dacc7c6_0.png',
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
    _id: `drafts.product-tony-montana-style-${fill.slot}`,
    _type: 'product',
    title: `Tony Montana — ${fill.styleName}`,
    slug: { _type: 'slug', current: `tony-montana-style-${fill.slot}` },
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
        text: `Tony Montana reimagined in our signature ${fill.styleName} style. Bold, original pop culture wall art — available as poster print, standard canvas, or gallery canvas. Made to order in the UK by Pixel8 Multimedia.`,
      }],
    }],
    seo: {
      metaTitle: `Tony Montana ${fill.styleName} Wall Art | Pixel8 Multimedia`,
      metaDescription: `Tony Montana ${fill.styleName} pop culture wall art. Poster prints and canvas made to order in the UK.`,
    },
    images: [{
      _key: 'img-0',
      _type: 'image',
      alt: `Tony Montana ${fill.styleName} wall art by Pixel8 Multimedia`,
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
  console.log(`📤  Uploading: tony-montana-style-${fill.slot}.png`);
  const buf = readFileSync(path);
  const asset = await client.assets.upload('image', buf, {
    filename: `tony-montana-style-${fill.slot}.png`,
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
  console.log('\n🎉  All fills complete. Open Sanity Studio, review the 7 new drafts, and Publish.');
}

main().catch((err) => {
  console.error('💥  Failed:', err.message);
  process.exit(1);
});
