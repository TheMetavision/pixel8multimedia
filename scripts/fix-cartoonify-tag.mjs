#!/usr/bin/env node
/**
 * fix-cartoonify-tag.mjs
 *
 * Fixes the mistagged example image on the Cartoonify Me! service.
 * The service description promises "Cyberpunk" as a cartoon style, but
 * the corresponding image is tagged "Futurepunk". The image itself
 * (neon city, Japanese signage, glowing tech) is clearly Cyberpunk.
 *
 * Run from project root:
 *   $env:SANITY_API_TOKEN = "sk-..."
 *   node scripts/fix-cartoonify-tag.mjs
 *
 * Options:
 *   --dry-run    Show current state, no writes
 */

import { createClient } from '@sanity/client';

const PROJECT_ID = 'bqb4w421';
const DATASET = 'production';
const API_VERSION = '2024-01-01';
const DOC_ID = 'TCQSYEAsAR6vcKomk2Q6RP';        // Cartoonify Me! service
const EXAMPLE_KEY = '09af6ef45ea9';             // outer examples[] item _key
const IMAGE_KEY = '694f333a9e75';               // inner images[] item _key

const dryRun = process.argv.includes('--dry-run');

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

async function main() {
  console.log('🎨 Fixing Cartoonify Me! example tag: Futurepunk → Cyberpunk');
  if (dryRun) console.log('   (DRY RUN — no writes)');

  // Read the current tag (correctly traverses the array filters)
  const current = await client.fetch(
    `*[_id == $id][0].examples[_key == $exKey][0].images[_key == $imgKey][0].tag`,
    { id: DOC_ID, exKey: EXAMPLE_KEY, imgKey: IMAGE_KEY }
  );
  console.log(`Current tag value: ${JSON.stringify(current)}`);

  if (current === 'Cyberpunk') {
    console.log('✅ Already correct — nothing to do.');
    return;
  }
  if (current !== 'Futurepunk') {
    console.warn(`⚠️  Unexpected tag value: ${JSON.stringify(current)}. Aborting to avoid clobbering.`);
    console.warn('   If you want to force-overwrite anyway, edit the script and remove this check.');
    process.exit(1);
  }

  if (dryRun) {
    console.log('[DRY] Would set tag to "Cyberpunk"');
    return;
  }

  // Patch — uses array-item key selectors to target the specific image
  await client
    .patch(DOC_ID)
    .set({ [`examples[_key=="${EXAMPLE_KEY}"].images[_key=="${IMAGE_KEY}"].tag`]: 'Cyberpunk' })
    .commit({ visibility: 'async' });

  console.log('✅ Tag updated to "Cyberpunk".');
  console.log('   Service page renders content live (prerender=false), so the change');
  console.log('   should be visible immediately at /services/cartoonify-me — no rebuild needed.');
}

main().catch(e => {
  console.error('💥  Fatal:', e);
  process.exit(1);
});
