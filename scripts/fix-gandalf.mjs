#!/usr/bin/env node
/**
 * fix-gandalf.mjs
 *
 * Fixes Gandalf's catalogue entries which were skipped by the main rename
 * because the underlying Sanity document IDs are MISSPELLED:
 *   doc IDs:  product-gandolf-style-* (misspelled)
 *   slugs:    gandalf-style-*         (correct)
 *
 * This is a legacy artifact from an earlier Gandolf→Gandalf cleanup that
 * fixed slugs but never migrated the document IDs.
 *
 * What this script does (all in one go):
 *   1. For each of the 10 misspelled docs, read the full content
 *   2. Write a NEW draft under the CORRECT doc ID (product-gandalf-style-X)
 *      with the Phase 2 rename applied (title, description, SEO, alt, tags)
 *   3. Publish the new draft
 *   4. Delete the misspelled old document (both draft and published if any)
 *
 * Run from project root:
 *   $env:SANITY_API_TOKEN = "sk-..."
 *   node scripts/fix-gandalf.mjs
 *
 * Options:
 *   --dry-run     Print what would happen, no writes
 *
 * Reads:   scripts/subnames.json  (for Gandalf's themed sub-names)
 */

import { createClient } from '@sanity/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PROJECT_ID = 'bqb4w421';
const DATASET = 'production';
const API_VERSION = '2024-01-01';
const MANIFEST_PATH = resolve('scripts/subnames.json');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const gandalf = manifest.characters.gandalf;
if (!gandalf) {
  console.error('❌  Gandalf not in subnames.json');
  process.exit(1);
}

const STYLE_ORDER = manifest._meta.styleOrder;
const STYLE_NAMES = manifest._meta.styleNames;
const STALE_STYLE_TAGS = new Set([
  'neon glow', 'minimalist cool', 'retro vibes', 'pixel art',
  'abstract burst', 'pop art', 'watercolour', 'noir', 'geometric', 'street art',
]);

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

async function fixOne(slot) {
  const subName = gandalf.subNames[STYLE_ORDER.indexOf(slot)];
  const styleUpper = slot.toUpperCase();
  const styleLabel = STYLE_NAMES[slot];

  const OLD_ID = `product-gandolf-style-${slot}`;     // misspelled, what currently exists
  const NEW_ID = `product-gandalf-style-${slot}`;     // correctly spelled, the target
  const OLD_DRAFT_ID = `drafts.${OLD_ID}`;
  const NEW_DRAFT_ID = `drafts.${NEW_ID}`;

  console.log(`\n--- Style ${styleUpper} (${styleLabel}) → "${subName}" ---`);

  // Step 1: Fetch the existing misspelled doc (try draft first, then published)
  let source = null;
  if (!dryRun) {
    source = await client.getDocument(OLD_DRAFT_ID);
    if (!source) source = await client.getDocument(OLD_ID);
  }
  if (!source && !dryRun) {
    console.log(`  ⚠️  No source doc found at ${OLD_ID} — skipping`);
    return { skipped: true };
  }

  // Step 2: Build the renamed doc under the NEW (correctly-spelled) doc ID
  const renamedPublished = source ? {
    ...source,
    _id: NEW_ID,
    title: `Gandalf — Style ${styleUpper}: ${subName}`,
    slug: { _type: 'slug', current: `gandalf-style-${slot}` },
    description: [{
      _key: 'desc-0',
      _type: 'block',
      style: 'normal',
      markDefs: [],
      children: [{
        _key: 'span-0',
        _type: 'span',
        marks: [],
        text: `Gandalf reimagined in our exclusive Style ${styleUpper} "${subName}" design. Bold, original pop culture wall art — available as poster print, standard canvas, or gallery canvas. Made to order in the UK by Pixel8 Multimedia.`,
      }],
    }],
    seo: {
      ...(source.seo || {}),
      metaTitle: `Gandalf ${subName} Wall Art — Style ${styleUpper} | Pixel8 Multimedia`,
      metaDescription: `Gandalf "${subName}" design — exclusive Style ${styleUpper} from Pixel8. Poster prints and canvas made to order in the UK.`,
    },
    images: (source.images || []).map((img, i) => ({
      ...img,
      alt: i === 0 ? `Gandalf ${subName} Style ${styleUpper} wall art by Pixel8 Multimedia` : img.alt,
    })),
    tags: (source.tags || []).filter(t => !STALE_STYLE_TAGS.has(t.toLowerCase())),
  } : null;

  if (renamedPublished) {
    delete renamedPublished._rev;
    delete renamedPublished._createdAt;
    delete renamedPublished._updatedAt;
  }

  if (dryRun) {
    console.log(`  [DRY] Would create published doc at ${NEW_ID}`);
    console.log(`  [DRY] Would delete old docs: ${OLD_ID} and ${OLD_DRAFT_ID}`);
    console.log(`  [DRY] New title: "Gandalf — Style ${styleUpper}: ${subName}"`);
    return { dryRun: true };
  }

  // Step 3: Atomic transaction — create new published, delete old IDs (both draft + published forms)
  const tx = client.transaction()
    .createOrReplace(renamedPublished)
    .delete(OLD_ID)
    .delete(OLD_DRAFT_ID)
    .delete(NEW_DRAFT_ID);  // also clean up any stray new-id draft if one exists

  await tx.commit({ visibility: 'async' });
  console.log(`  ✅ Created ${NEW_ID}, deleted ${OLD_ID}`);
  return { ok: true };
}

async function main() {
  console.log('🧙 Gandalf catalogue fix — renaming AND migrating misspelled doc IDs');
  if (dryRun) console.log('   (DRY RUN — no writes)');

  let ok = 0, skip = 0, err = 0;
  const errors = [];

  for (const slot of STYLE_ORDER) {
    try {
      const r = await fixOne(slot);
      if (r.ok || r.dryRun) ok++;
      else if (r.skipped) skip++;
    } catch (e) {
      err++;
      errors.push({ slot, msg: e.message });
      console.log(`  ❌ Style ${slot.toUpperCase()}: ${e.message}`);
    }
    if (!dryRun) await new Promise(r => setTimeout(r, 100));
  }

  console.log('\n' + '='.repeat(60));
  console.log(`Summary: ${ok}/10 ok, ${skip} skipped, ${err} errors`);
  if (errors.length) {
    console.log('\nErrors:');
    for (const e of errors) console.log(`  Style ${e.slot.toUpperCase()}: ${e.msg}`);
  }
  if (!dryRun && ok > 0) {
    console.log('\n🎉  Gandalf migration complete.');
    console.log('   Old doc IDs (product-gandolf-*) have been removed.');
    console.log('   New doc IDs (product-gandalf-*) exist with the Phase 2 rename applied.');
    console.log('   The catalogue should now show 10 Gandalf products at the correct slugs.');
  }
}

main().catch(e => {
  console.error('💥  Fatal:', e);
  process.exit(1);
});
