#!/usr/bin/env node
/**
 * fill-pluto.mjs
 *
 * Creates the missing Pluto Style H (Noir), Style I (Geometric), and
 * Style J (Street Art) products in Sanity. Category: animations.
 *
 * Picks (after conflict-check against existing 7 finals):
 *   Style H: Tim Burton 0 — moody atmospheric Pluto on dark field with moon
 *            (distinct from Style C which is white-furred Pluto on rocks)
 *   Style I: Jack Kirby 1 — Pluto on starry cosmic swirl with planets
 *            (Kirby family unused; geometric/cosmic composition)
 *   Style J: Rizz 0 — plush-toy 3D Pluto on flat beige with globe
 *            (designer-toy/urban-vinyl aesthetic, distinct from all 7)
 *
 * NOTE: Several Pluto reject drafts had identity drift (interpreted as the
 * planet rather than the Disney dog) so candidate pool was filtered.
 *
 * Run from project root:
 *   $env:SANITY_API_TOKEN = "sk-..."
 *   node scripts/fill-pluto.mjs
 */

import { createClient } from '@sanity/client';
import { readFileSync, existsSync } from 'node:fs';

const PROJECT_ID = 'bqb4w421';
const DATASET = 'production';
const API_VERSION = '2024-01-01';

const SOURCE_DIR = 'C:\\Users\\chris\\Documents\\Pixel 8\\Products\\Pluto';

const FILLS = [
  {
    slot: 'h',
    sourceFile: 'Pluto_in_the_style_of_Tim_Burton_--v_7_2bb6fa81-80e8-479b-a1fc-4d33ab9052c0_0.png',
    styleName: 'Noir',
    tagName: 'noir',
    accentColor: '#424242',
  },
  {
    slot: 'i',
    sourceFile: 'Pluto_in_the_style_of_Jack_Kirby_--v_7_32b53f97-14c9-4b9c-a61f-c3c761d8c7b8_1.png',
    styleName: 'Geometric',
    tagName: 'geometric',
    accentColor: '#7C4DFF',
  },
  {
    slot: 'j',
    sourceFile: 'Pluto_with_Rizz_--v_7_f67338e8-07f9-4405-8fbb-1ed4e3d177ab_0.png',
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
    _id: `drafts.product-pluto-style-${fill.slot}`,
    _type: 'product',
    title: `Pluto — ${fill.styleName}`,
    slug: { _type: 'slug', current: `pluto-style-${fill.slot}` },
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
        text: `Pluto reimagined in our signature ${fill.styleName} style. Bold, original pop culture wall art — available as poster print, standard canvas, or gallery canvas. Made to order in the UK by Pixel8 Multimedia.`,
      }],
    }],
    seo: {
      metaTitle: `Pluto ${fill.styleName} Wall Art | Pixel8 Multimedia`,
      metaDescription: `Pluto ${fill.styleName} pop culture wall art. Poster prints and canvas made to order in the UK.`,
    },
    images: [{
      _key: 'img-0',
      _type: 'image',
      alt: `Pluto ${fill.styleName} wall art by Pixel8 Multimedia`,
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
  console.log(`📤  Uploading: pluto-style-${fill.slot}.png`);
  const buf = readFileSync(path);
  const asset = await client.assets.upload('image', buf, {
    filename: `pluto-style-${fill.slot}.png`,
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
