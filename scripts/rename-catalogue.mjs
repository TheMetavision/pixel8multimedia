#!/usr/bin/env node
/**
 * rename-catalogue.mjs
 *
 * Renames all 1,030 character products in the Pixel8 catalogue to the new
 * "Character — Style X: Sub-Name" format. Patches 5 fields per product
 * (title, description, seo.metaTitle, seo.metaDescription, image alt),
 * strips stale style-name entries from tags[], and fixes 2 slug typos
 * (hans-solo → han-solo, c3-p0 → c-3po).
 *
 * EXCLUDES the 12 personalised products entirely.
 *
 * Reads:   scripts/subnames.json
 * Writes:  drafts.* in Sanity (review and publish via Studio)
 *
 * Run from project root:
 *   $env:SANITY_API_TOKEN = "sk-..."
 *   node scripts/rename-catalogue.mjs
 *
 * Options:
 *   --character=batman    Only patch one character (testing)
 *   --dry-run             Print what would happen, no DB writes
 *
 * Safe to re-run: createOrReplace is idempotent. Drafts get rebuilt cleanly.
 */

import { createClient } from '@sanity/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PROJECT_ID = 'bqb4w421';
const DATASET = 'production';
const API_VERSION = '2024-01-01';
const MANIFEST_PATH = resolve('scripts/subnames.json');

// ---- Parse args ----
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const charArg = args.find(a => a.startsWith('--character='));
const onlyCharacter = charArg ? charArg.split('=')[1] : null;

// ---- Load manifest ----
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const { _meta, characters } = manifest;
const STYLE_ORDER = _meta.styleOrder;       // ['a', 'b', ..., 'j']
const STYLE_NAMES = _meta.styleNames;       // { a: 'Neon Glow', ... }
const SLUG_FIXES = _meta.slugFixes || {};   // { 'hans-solo': 'han-solo', ... }

// Stale tag values that should be stripped from tags[] arrays
// (these are the old style labels, replaced by 'style-X' entries)
const STALE_STYLE_TAGS = new Set([
  'neon glow', 'minimalist cool', 'retro vibes', 'pixel art',
  'abstract burst', 'pop art', 'watercolour', 'noir', 'geometric', 'street art',
]);

// ---- Setup ----
const token = process.env.SANITY_API_TOKEN;
if (!token && !dryRun) {
  console.error('❌  SANITY_API_TOKEN env var not set.');
  process.exit(1);
}

const client = dryRun ? null : createClient({
  projectId: PROJECT_ID,
  dataset: DATASET,
  apiVersion: API_VERSION,
  token,
  useCdn: false,
});

// ---- Build the new fields for one product ----
function buildPatch({ displayName, finalSlug, slot, subName }) {
  const styleUpper = slot.toUpperCase();
  const styleLabel = STYLE_NAMES[slot];

  return {
    title: `${displayName} — Style ${styleUpper}: ${subName}`,
    'slug.current': finalSlug ? `${finalSlug}-style-${slot}` : undefined,  // only if slug fix applies
    description: [{
      _key: 'desc-0',
      _type: 'block',
      style: 'normal',
      markDefs: [],
      children: [{
        _key: 'span-0',
        _type: 'span',
        marks: [],
        text: `${displayName} reimagined in our exclusive Style ${styleUpper} "${subName}" design. Bold, original pop culture wall art — available as poster print, standard canvas, or gallery canvas. Made to order in the UK by Pixel8 Multimedia.`,
      }],
    }],
    'seo.metaTitle': `${displayName} ${subName} Wall Art — Style ${styleUpper} | Pixel8 Multimedia`,
    'seo.metaDescription': `${displayName} "${subName}" design — exclusive Style ${styleUpper} from Pixel8. Poster prints and canvas made to order in the UK.`,
    imageAlt: `${displayName} ${subName} Style ${styleUpper} wall art by Pixel8 Multimedia`,
  };
}

// ---- Patch one product ----
async function patchProduct(slug, charData, slot, slugFix) {
  const subName = charData.subNames[STYLE_ORDER.indexOf(slot)];
  const finalSlugBase = slugFix || slug;
  const oldDocId = `product-${slug}-style-${slot}`;
  const newDocId = slugFix ? `product-${finalSlugBase}-style-${slot}` : oldDocId;
  const draftId = `drafts.${newDocId}`;

  const patch = buildPatch({
    displayName: charData.displayName,
    finalSlug: slugFix ? finalSlugBase : null,
    slot,
    subName,
  });

  // Fetch existing doc to preserve all other fields (images, prices, sizes, etc.)
  // We need either the existing draft or the published doc as the base
  let existing;
  try {
    existing = await client.getDocument(draftId);
    if (!existing) {
      existing = await client.getDocument(newDocId);
    }
    if (!existing && slugFix) {
      // Try the OLD doc ID (before slug fix)
      existing = await client.getDocument(`drafts.${oldDocId}`);
      if (!existing) existing = await client.getDocument(oldDocId);
    }
  } catch (e) {
    // ignore
  }

  if (!existing) {
    console.warn(`  ⚠️  Style ${slot.toUpperCase()}: no existing doc found for ${slug}, skipping`);
    return { skipped: true };
  }

  // Build the new doc from existing + overrides
  const updatedImages = (existing.images || []).map((img, i) => ({
    ...img,
    alt: i === 0 ? patch.imageAlt : img.alt,
  }));

  // Tags: strip stale style-name entries
  const cleanedTags = (existing.tags || []).filter(t => !STALE_STYLE_TAGS.has(t.toLowerCase()));

  const newDoc = {
    ...existing,
    _id: draftId,
    _type: 'product',
    title: patch.title,
    slug: { _type: 'slug', current: `${finalSlugBase}-style-${slot}` },
    description: patch.description,
    seo: {
      ...(existing.seo || {}),
      metaTitle: patch['seo.metaTitle'],
      metaDescription: patch['seo.metaDescription'],
    },
    images: updatedImages,
    tags: cleanedTags,
  };

  // Strip Sanity-managed system fields that shouldn't be in createOrReplace input
  delete newDoc._rev;
  delete newDoc._createdAt;
  delete newDoc._updatedAt;

  if (dryRun) {
    console.log(`  [DRY] ${draftId} → "${patch.title}"`);
    return { dryRun: true };
  }

  await client.createOrReplace(newDoc);
  return { ok: true };
}

// ---- Main ----
async function main() {
  const entries = Object.entries(characters);
  const filtered = onlyCharacter
    ? entries.filter(([slug]) => slug === onlyCharacter)
    : entries;

  if (!filtered.length) {
    console.error(`❌  No character matched: ${onlyCharacter}`);
    process.exit(1);
  }

  console.log(`🎬  Starting rename: ${filtered.length} characters × 10 styles = ${filtered.length * 10} products`);
  if (dryRun) console.log('   (DRY RUN — no DB writes)');
  console.log('');

  let total = 0;
  let okCount = 0;
  let skipCount = 0;
  let errCount = 0;
  const errors = [];

  for (const [slug, charData] of filtered) {
    const slugFix = SLUG_FIXES[slug] || null;
    const fixNote = slugFix ? ` [slug fix: ${slug} → ${slugFix}]` : '';
    console.log(`\n📝  ${charData.displayName}${fixNote}`);

    for (const slot of STYLE_ORDER) {
      total++;
      try {
        const result = await patchProduct(slug, charData, slot, slugFix);
        if (result.ok) {
          okCount++;
          process.stdout.write(`  ✅ ${slot.toUpperCase()}  `);
        } else if (result.dryRun) {
          okCount++;
        } else if (result.skipped) {
          skipCount++;
        }
      } catch (e) {
        errCount++;
        errors.push({ slug, slot, msg: e.message });
        process.stdout.write(`  ❌ ${slot.toUpperCase()}  `);
      }
    }
    process.stdout.write('\n');

    // Tiny pause every character to be polite to the API
    if (!dryRun) await new Promise(r => setTimeout(r, 100));
  }

  console.log('\n' + '='.repeat(60));
  console.log(`Summary: ${okCount}/${total} ok, ${skipCount} skipped, ${errCount} errors`);
  if (errors.length) {
    console.log('\nErrors:');
    for (const e of errors) console.log(`  ${e.slug} style-${e.slot}: ${e.msg}`);
  }
  if (!dryRun && okCount > 0) {
    console.log('\n🎉  Drafts written. Open Sanity Studio, review, and bulk-publish.');
    console.log('   Tip: filter by document._updatedAt to see only the freshly patched docs.');
  }
}

main().catch(e => {
  console.error('💥  Fatal:', e);
  process.exit(1);
});
