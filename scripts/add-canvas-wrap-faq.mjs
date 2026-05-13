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
  answer:
    `No. Our canvas prints use a "block colour wrap" technique to protect your design.\n\n` +
    `Standard canvas prints wrap the actual artwork around the wooden frame edges — meaning a portion of the design ends up hidden behind the sides of the canvas. We don't do this.\n\n` +
    `Instead, we sample the dominant colour from your chosen artwork and use that colour as a solid wrap on all four sides. The full square design sits on the front face of the canvas, completely intact, and the wrapped edges blend seamlessly into the artwork as a coloured frame border.\n\n` +
    `This works equally well for our Standard and Gallery canvas frames, and means what you see on screen is exactly what you receive on your wall.`,
  category: 'product-info',
  displayOrder: 18, // After existing displayOrder 14-17 in product-info
};

// Update the existing "What finishes are available?" FAQ to correctly
// describe the wrap behaviour.
const FINISHES_FAQ_ID = 'pqsf8ly4J5ZHPrl9Dk3jpJ';
const UPDATED_FINISHES_ANSWER =
  `Three professional finishes:\n\n` +
  `Poster Print — sleek high-definition matte, ready for framing.\n\n` +
  `Canvas Standard Frame — modern look with a complementary block colour wrap on the edges (rather than wrapping the artwork itself round the frame, we sample the design's dominant colour and use that on the sides, so none of the design is lost).\n\n` +
  `Canvas Gallery Frame — deep-edge premium presentation, with the same block-colour wrap technique to preserve the full design on the front face.`;

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
