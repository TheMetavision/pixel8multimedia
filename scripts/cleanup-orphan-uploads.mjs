// scripts/cleanup-orphan-uploads.mjs
//
// Deletes Sanity image assets that were uploaded via the commission wizard
// (/.netlify/functions/upload) but never ended up referenced by a commission
// document. This happens when a customer uploads photos then abandons the
// checkout — Sanity stores the asset, billing keeps ticking, no one uses it.
//
// Filter criteria for "delete this asset":
//   - asset.label == 'commission-upload'                  (tagged by upload.mts)
//   - asset._createdAt is older than MIN_AGE_HOURS hours  (gives in-flight customers time to finish)
//   - no commission document references this asset        (truly orphaned)
//
// Safe to re-run. Dry-run by default — pass --execute to actually delete.
//
// Usage:
//   cd C:\Users\chris\Projects\pixel8
//   $env:SANITY_TOKEN = "your-editor-token"
//   node scripts/cleanup-orphan-uploads.mjs            # dry run, lists candidates
//   node scripts/cleanup-orphan-uploads.mjs --execute  # actually deletes

import { createClient } from '@sanity/client';

const PROJECT_ID = 'bqb4w421';
const DATASET = 'production';
const MIN_AGE_HOURS = 24;      // skip assets newer than this
const BATCH_SIZE = 50;         // delete in batches to keep API calls polite

const execute = process.argv.includes('--execute');

if (!process.env.SANITY_TOKEN) {
  console.error('ERROR: SANITY_TOKEN env var not set.');
  console.error('  $env:SANITY_TOKEN = "sk..."');
  process.exit(1);
}

const client = createClient({
  projectId: PROJECT_ID,
  dataset: DATASET,
  apiVersion: '2024-12-01',
  token: process.env.SANITY_TOKEN,
  useCdn: false,
});

async function main() {
  console.log(`\nPixel8 orphan-upload cleanup`);
  console.log(`Mode: ${execute ? 'EXECUTE (will delete)' : 'DRY RUN (no changes)'}`);
  console.log(`Age threshold: ${MIN_AGE_HOURS}h`);
  console.log('Querying Sanity…\n');

  const cutoff = new Date(Date.now() - MIN_AGE_HOURS * 60 * 60 * 1000).toISOString();

  // Find candidate assets: tagged as commission-upload, old enough.
  // The asset doc's incoming reference list (`*[references(^._id)]`) tells us
  // whether any commission still uses it. If zero refs, it's orphaned.
  const orphans = await client.fetch(
    `*[
      _type == "sanity.imageAsset"
      && label == "commission-upload"
      && _createdAt < $cutoff
      && count(*[references(^._id)]) == 0
    ]{ _id, _createdAt, title, originalFilename, size }`,
    { cutoff }
  );

  if (orphans.length === 0) {
    console.log('No orphan uploads found. Nothing to do.');
    return;
  }

  let totalBytes = 0;
  for (const o of orphans) totalBytes += o.size || 0;
  const totalMb = (totalBytes / 1024 / 1024).toFixed(2);

  console.log(`Found ${orphans.length} orphaned uploads (${totalMb} MB total):\n`);
  for (const o of orphans.slice(0, 20)) {
    console.log(`  ${o._id}`);
    console.log(`    created: ${o._createdAt}`);
    console.log(`    title:   ${o.title || '(none)'}`);
    console.log(`    file:    ${o.originalFilename || '(unknown)'}`);
    console.log(`    size:    ${o.size ? `${(o.size / 1024).toFixed(0)} KB` : '?'}`);
    console.log('');
  }
  if (orphans.length > 20) console.log(`  …and ${orphans.length - 20} more.\n`);

  if (!execute) {
    console.log('Dry run complete. Re-run with --execute to delete these assets.');
    return;
  }

  console.log('Deleting…\n');
  let deleted = 0;
  let failed = 0;
  for (let i = 0; i < orphans.length; i += BATCH_SIZE) {
    const batch = orphans.slice(i, i + BATCH_SIZE);
    const tx = client.transaction();
    for (const o of batch) tx.delete(o._id);
    try {
      await tx.commit();
      deleted += batch.length;
      console.log(`  Deleted batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} assets)`);
    } catch (err) {
      // If batch fails, try individually so one bad ID doesn't sink the others.
      console.warn(`  Batch failed (${err.message}). Retrying individually…`);
      for (const o of batch) {
        try {
          await client.delete(o._id);
          deleted++;
        } catch (e) {
          failed++;
          console.warn(`    Could not delete ${o._id}: ${e.message}`);
        }
      }
    }
  }

  console.log(`\nDone. Deleted: ${deleted}. Failed: ${failed}.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
