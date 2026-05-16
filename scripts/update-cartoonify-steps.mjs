/**
 * Patches Cartoonify Me "How It Works" step wording to reflect the new
 * pricing model where digital includes all styles by default.
 *
 *   Step 1 — unchanged
 *   Step 2 — was: "Choose your preferred cartoon style or upgrade to include all styles in one download."
 *            now: "Decide how you want it — digital files in every style, or a physical print in your favourite."
 *   Step 3 — was: "We'll transform it into a vibrant, high-resolution artwork — delivered as a digital file, with optional print upgrades."
 *            now: "We'll transform it into a vibrant, high-resolution artwork — delivered digitally, with prints shipped to your door if you ordered any."
 *
 * Run once:
 *   cd C:\Users\chris\Projects\pixel8
 *   $env:SANITY_TOKEN = (Get-Content .env | Select-String "^SANITY_TOKEN=").Line -replace "^SANITY_TOKEN=", ""
 *   node scripts/update-cartoonify-steps.mjs
 */

import { createClient } from '@sanity/client';

const client = createClient({
  projectId: 'bqb4w421',
  dataset: 'production',
  apiVersion: '2024-12-01',
  token: process.env.SANITY_TOKEN,
  useCdn: false,
});

const CARTOONIFY_ID = 'TCQSYEAsAR6vcKomk2Q6RP';

const NEW_STEP_2 =
  'Decide how you want it — digital files in every style, or a physical print in your favourite.';

const NEW_STEP_3 =
  "We'll transform it into a vibrant, high-resolution artwork — delivered digitally, with prints shipped to your door if you ordered any.";

async function run() {
  if (!process.env.SANITY_TOKEN) {
    console.error('❌ SANITY_TOKEN env var not set.');
    process.exit(1);
  }

  console.log('📝 Updating Cartoonify Me steps to reflect new pricing model...\n');

  // Patch step 2 (_key: "step-1") and step 3 (_key: "step-2") by their _key.
  // The text field on each step lives at .text on the matched array item.
  await client
    .patch(CARTOONIFY_ID)
    .set({
      'steps[_key=="step-1"].text': NEW_STEP_2,
      'steps[_key=="step-2"].text': NEW_STEP_3,
    })
    .commit();

  console.log('   ✓ Step 2 updated');
  console.log(`     → "${NEW_STEP_2}"`);
  console.log('');
  console.log('   ✓ Step 3 updated');
  console.log(`     → "${NEW_STEP_3}"`);
  console.log('');
  console.log('✅ Cartoonify Me steps updated.');
  console.log('\n📝 Trigger a Netlify rebuild (or wait for the Sanity webhook) to flush the live site.');
}

run().catch((err) => {
  console.error('\n❌ Failed:', err.message);
  if (err.response) console.error('   Response:', err.response.body);
  process.exit(1);
});
