#!/usr/bin/env node
/**
 * fill-eminem.mjs
 *
 * Creates 9 missing Eminem products in Sanity: Styles B, C, D, E, F, G, H, I, J.
 * Category: music. The biggest single fill batch — completes the catalogue.
 *
 * Picks (after conflict-check against existing Style A — mixed-media collage
 * portrait, pink/yellow/teal palette, newspaper layers from Banksy prompt):
 *   B Minimalist:  Frank Miller 0 — silhouette in red on black, restrained
 *   C Retro Vibes: Rizz 0         — hoodie portrait on orange, 2000s album cover
 *   D Pixel Art:   Josh Agle 3    — full-body Eminem on mic with chain, geometric tile bg
 *                                   (CLEARLY recognisable as Eminem; Josh Agle 0 was too
 *                                   abstract — face didn't read as him)
 *   E Abstract:    Psychedelic 0  — vivid swirly bursting energy
 *   F Pop Art:     Lichtenstein 0 — vivid pop palette, classic Lichtenstein
 *   G Watercolour: Dr Seuss 0     — soft pastel turquoise + painterly (Cat-in-Hat ref)
 *   H Noir:        Jack Kirby 0   — pure B/W intense portrait
 *   I Geometric:   Banksy 2       — crouched stencil on grey wall, angular flat shapes
 *   J Street Art:  Lee Monade 3   — red mic-rapping silhouette + paint splatter,
 *                                   iconic concert/street music poster aesthetic
 *
 * Run from project root:
 *   $env:SANITY_API_TOKEN = "sk-..."
 *   node scripts/fill-eminem.mjs
 */

import { createClient } from '@sanity/client';
import { readFileSync, existsSync } from 'node:fs';

const PROJECT_ID = 'bqb4w421';
const DATASET = 'production';
const API_VERSION = '2024-01-01';

const SOURCE_DIR = 'C:\\Users\\chris\\Documents\\Pixel 8\\Products\\Eminem';

const FILLS = [
  {
    slot: 'b',
    sourceFile: 'Eminem_in_the_style_of_Frank_Miller_--v_7_dae42c15-21d7-4bad-bc1d-3d03ab44aeb7_0.png',
    styleName: 'Minimalist Cool',
    tagName: 'minimalist cool',
    accentColor: '#E0E0E0',
  },
  {
    slot: 'c',
    sourceFile: 'Eminem_with_Rizz_--v_7_000e0192-cf77-44e4-9349-181930aa22e5_0.png',
    styleName: 'Retro Vibes',
    tagName: 'retro vibes',
    accentColor: '#FF6B35',
  },
  {
    slot: 'd',
    sourceFile: 'Eminem_in_the_style_of_Josh_Agle_--v_7_1085dfc3-b755-4214-979e-07877bd5df91_3.png',
    styleName: 'Pixel Art',
    tagName: 'pixel art',
    accentColor: '#00E5FF',
  },
  {
    slot: 'e',
    sourceFile: 'Eminem_psychedelic_cartoon_style_--v_7_2ed3eb8e-95c6-4f85-89e4-2681b4a932a9_0.png',
    styleName: 'Abstract Burst',
    tagName: 'abstract burst',
    accentColor: '#FFD600',
  },
  {
    slot: 'f',
    sourceFile: 'Eminem_Roy_Lichenstein_style_--v_7_2a383a02-27ce-439c-a4d6-d1d47f3ee4f1_0.png',
    styleName: 'Pop Art',
    tagName: 'pop art',
    accentColor: '#FF1744',
  },
  {
    slot: 'g',
    sourceFile: 'Eminem_in_the_style_of_Dr_Seuss_--v_7_3f165122-b87e-4c49-9691-4a12fa96e65c_0.png',
    styleName: 'Watercolour',
    tagName: 'watercolour',
    accentColor: '#81D4FA',
  },
  {
    slot: 'h',
    sourceFile: 'Eminem_in_the_style_of_Jack_Kirby_--v_7_e6274dd7-d111-478d-a4c6-bfd8a3c8072e_0.png',
    styleName: 'Noir',
    tagName: 'noir',
    accentColor: '#424242',
  },
  {
    slot: 'i',
    sourceFile: 'Eminem_in_the_style_of_Banksy_--v_7_0bcb091a-8ae0-4268-8128-52302c1f48b6_2.png',
    styleName: 'Geometric',
    tagName: 'geometric',
    accentColor: '#7C4DFF',
  },
  {
    slot: 'j',
    sourceFile: 'Eminem_poster_made_by_Lee_Monade_--v_7_78726f23-6412-48b4-9a8e-20d522f0d61b_3.png',
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
    _id: `drafts.product-eminem-style-${fill.slot}`,
    _type: 'product',
    title: `Eminem — ${fill.styleName}`,
    slug: { _type: 'slug', current: `eminem-style-${fill.slot}` },
    category: 'music',
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
    tags: ['music', `style-${fill.slot}`, fill.tagName, 'music'],
    description: [{
      _key: 'desc-0',
      _type: 'block',
      style: 'normal',
      markDefs: [],
      children: [{
        _key: 'span-0',
        _type: 'span',
        marks: [],
        text: `Eminem reimagined in our signature ${fill.styleName} style. Bold, original pop culture wall art — available as poster print, standard canvas, or gallery canvas. Made to order in the UK by Pixel8 Multimedia.`,
      }],
    }],
    seo: {
      metaTitle: `Eminem ${fill.styleName} Wall Art | Pixel8 Multimedia`,
      metaDescription: `Eminem ${fill.styleName} pop culture wall art. Poster prints and canvas made to order in the UK.`,
    },
    images: [{
      _key: 'img-0',
      _type: 'image',
      alt: `Eminem ${fill.styleName} wall art by Pixel8 Multimedia`,
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
  console.log(`📤  Uploading: eminem-style-${fill.slot}.png`);
  const buf = readFileSync(path);
  const asset = await client.assets.upload('image', buf, {
    filename: `eminem-style-${fill.slot}.png`,
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
  console.log('\n🎉  All 9 fills complete!');
  console.log('🏁  This was the FINAL batch — catalogue now at 1,042 products.');
  console.log('   Open Sanity Studio, review the 9 new drafts, and Publish.');
}

main().catch((err) => {
  console.error('💥  Failed:', err.message);
  process.exit(1);
});
