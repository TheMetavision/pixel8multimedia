/**
 * Add the canvas-wrap FAQ to Sanity, and patch the existing
 * "What finishes are available?" FAQ to correctly describe the wrap.
 *
 * Run once:
 *   cd C:\Users\chris\Projects\pixel8
 *   $env:SANITY_TOKEN = (Get-Content .env | Select-String "^SANITY_TOKEN=").Line -replace "^SANITY_TOKEN=", ""
 *   node scripts/add-canvas-wrap-faq.mjs
 *
 * Idempotent — safe to re-run. The new FAQ is created with a deterministic ID
 * so re-running won't duplicate it; just overwrite.
 */

import { createClient } from '@sanity/client';
import { FAQ_COPY } from '../netlify/functions/_shared/print-spec.mjs';

const client = createClient({
  projectId: 'bqb4w421',
  dataset: 'production',
  apiVersion: '2024-01-01',
  token: process.env.SANITY_TOKEN,
  useCdn: false,
});

// Deterministic ID — re-runs are no-ops because we use createOrReplace.
const NEW_FAQ_ID = 'faq-canvas-wrap-design-preserved';

const NEW_FAQ = {
  _id: NEW_FAQ_ID,
  _type: 'faq',
  question: 'Will any of my design be lost around the edges of a canvas print?',
  // Wording lives in the shared print spec (one version everywhere).
  answer: FAQ_COPY.canvasWrap,
  category: 'product-info',
  displayOrder: 18, // After existing displayOrder 14-17 in product-info
};

// Update the existing "What finishes are available?" FAQ to correctly
// describe the wrap behaviour.
const FINISHES_FAQ_ID = 'pqsf8ly4J5ZHPrl9Dk3jpJ';
const UPDATED_FINISHES_ANSWER = FAQ_COPY.finishes;

async function run() {
  if (!process.env.SANITY_TOKEN) {
    console.error('❌ SANITY_TOKEN env var not set.');
    process.exit(1);
  }

  console.log('📝 Adding canvas-wrap FAQ...');
  await client.createOrReplace(NEW_FAQ);
  console.log(`   ✓ Created/replaced FAQ "${NEW_FAQ.question}"`);
  console.log(`     ID: ${NEW_FAQ_ID}`);
  console.log(`     Category: product-info, displayOrder: 18`);

  console.log('\n📝 Updating existing "What finishes are available?" answer...');
  await client
    .patch(FINISHES_FAQ_ID)
    .set({ answer: UPDATED_FINISHES_ANSWER })
    .commit();
  console.log(`   ✓ Patched FAQ ${FINISHES_FAQ_ID}`);

  console.log('\n✅ Done. Both FAQs now correctly describe the canvas wrap behaviour.');
  console.log(`\n📝 Trigger a Netlify rebuild (or wait for the Sanity webhook) to flush the live site.`);
}

run().catch((err) => {
  console.error('\n❌ Failed:', err.message);
  if (err.response) console.error('   Response:', err.response.body);
  process.exit(1);
});
