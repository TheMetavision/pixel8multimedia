/**
 * Update product sizes in Sanity from rectangular (12x8 / 16x12 / 24x16)
 * to square (12x12 / 16x16 / 20x20).
 *
 * Run once:
 *   cd C:\Users\chris\Projects\pixel8
 *   $env:SANITY_TOKEN = "<your editor token>"
 *   node scripts/update-product-sizes.mjs
 *
 * Idempotent — safe to re-run. Always overwrites with the new values.
 *
 * BEFORE running:
 *   - Ensure the front-end code change to src/data/products.ts and the PDP
 *     is ready to deploy. If you patch Sanity but the front-end still expects
 *     "12x8", the product page will display stale labels until the next deploy.
 *   - Recommended order: patch Sanity first (instant), push code change second
 *     (Netlify rebuilds within ~2 minutes). The brief gap will simply show the
 *     new sizes via Sanity while the build is in progress.
 */

import { createClient } from '@sanity/client';

const client = createClient({
  projectId: 'bqb4w421',
  dataset: 'production',
  apiVersion: '2024-01-01',
  token: process.env.SANITY_TOKEN,
  useCdn: false,
});

const NEW_SIZES = {
  small: '12x12',
  medium: '16x16',
  large: '20x20',
};

async function run() {
  if (!process.env.SANITY_TOKEN) {
    console.error('❌ SANITY_TOKEN env var not set.');
    process.exit(1);
  }

  console.log('🔍 Finding products with non-square sizes...');
  const ids = await client.fetch(
    `*[_type == "product"]._id`
  );
  console.log(`   Found ${ids.length} product docs to update.\n`);

  // Batch into transactions of 100 for speed and safety.
  const BATCH_SIZE = 100;
  let patched = 0;

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const tx = client.transaction();
    for (const id of batch) {
      tx.patch(id, (p) => p.set({ sizes: NEW_SIZES }));
    }
    await tx.commit();
    patched += batch.length;
    console.log(`   ✓ Batch ${i / BATCH_SIZE + 1}: patched ${patched}/${ids.length}`);
  }

  console.log(`\n✅ Done. ${patched} products updated to ${JSON.stringify(NEW_SIZES)}`);
  console.log(`\n📝 Trigger a Netlify rebuild (or wait for the Sanity webhook) to flush the live site.`);
}

run().catch((err) => {
  console.error('\n❌ Failed:', err.message);
  if (err.response) console.error('   Response:', err.response.body);
  process.exit(1);
});
