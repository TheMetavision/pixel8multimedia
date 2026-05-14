/**
 * Five FAQ updates in one batch:
 *
 * 1. "What materials do you print on?" — update wording to 'premium textured
 *    canvas' and 'satin photo paper'
 * 2. "What sizes are available?" — show only square sizes (12×12, 16×16, 20×20)
 * 3. "What finishes are available?" — change Poster Print description from
 *    'matte' to 'satin'
 * 4. "How long do custom commissions take?" — drop Priority/Rush wording
 * 5. Custom Services consolidation — delete "How does Photo Restoration work?"
 *    and "What is Stills to Reels?", create one generic "What custom commission
 *    services do you offer?" FAQ pointing at /services
 *
 * Run once:
 *   cd C:\Users\chris\Projects\pixel8
 *   $env:SANITY_TOKEN = (Get-Content .env | Select-String "^SANITY_TOKEN=").Line -replace "^SANITY_TOKEN=", ""
 *   node scripts/update-faqs-batch-2.mjs
 *
 * Idempotent — safe to re-run.
 */

import { createClient } from '@sanity/client';

const client = createClient({
  projectId: 'bqb4w421',
  dataset: 'production',
  apiVersion: '2024-01-01',
  token: process.env.SANITY_TOKEN,
  useCdn: false,
});

// ── 1. Materials ────────────────────────────────────────────────────────────
const MATERIALS_ID = 'pqsf8ly4J5ZHPrl9Dk3jXx';
const NEW_MATERIALS =
  `We use premium textured canvas and satin photo paper, ensuring rich colour depth and long-lasting prints that won't fade over time.`;

// ── 2. Sizes ────────────────────────────────────────────────────────────────
const SIZES_ID = 'zOkJuNZVmyYz76wu4mZwJU';
const NEW_SIZES =
  `All artwork is available in three square sizes: Small (12×12"), Medium (16×16"), and Large (20×20").`;

// ── 3. Finishes ─────────────────────────────────────────────────────────────
const FINISHES_ID = 'pqsf8ly4J5ZHPrl9Dk3jpJ';
const NEW_FINISHES =
  `Three professional finishes:\n\n` +
  `Poster Print — sleek high-definition satin, ready for framing.\n\n` +
  `Canvas Standard Frame — modern look with a complementary block colour wrap on the edges (rather than wrapping the artwork itself round the frame, we sample the design's dominant colour and use that on the sides, so none of the design is lost).\n\n` +
  `Canvas Gallery Frame — deep-edge premium presentation, with the same block-colour wrap technique to preserve the full design on the front face.`;

// ── 4. Turnaround ───────────────────────────────────────────────────────────
const TURNAROUND_ID = 'pqsf8ly4J5ZHPrl9Dk3jGb';
const NEW_TURNAROUND =
  `Standard turnaround is 5-7 working days, depending on the service. Each service page lists its own typical turnaround.`;

// ── 5a. Delete service-specific FAQs ────────────────────────────────────────
const FAQS_TO_DELETE = [
  'FWi5rTvmaPNs150cst2pWj', // How does Photo Restoration work?
  'FWi5rTvmaPNs150cst2pfF', // What is Stills to Reels?
];

// ── 5b. Create generic Custom Services FAQ ─────────────────────────────────
// Deterministic ID so re-runs are no-ops via createOrReplace.
const NEW_GENERIC_ID = 'faq-custom-services-overview';
const NEW_GENERIC_FAQ = {
  _id: NEW_GENERIC_ID,
  _type: 'faq',
  question: 'What custom commission services do you offer?',
  answer:
    `We offer twelve commission services covering portraits, photo restoration, scene recreations, ` +
    `life-story timelines, song writing and animations. Each service has its own dedicated page with ` +
    `examples, pricing, and a brief form. Browse the full range on our Services page.`,
  category: 'custom-services',
  displayOrder: 11, // Replaces the lowest displayOrder of the two deleted FAQs
};

async function run() {
  if (!process.env.SANITY_TOKEN) {
    console.error('❌ SANITY_TOKEN env var not set.');
    process.exit(1);
  }

  console.log('📝 1/5: Updating "What materials do you print on?"...');
  await client.patch(MATERIALS_ID).set({ answer: NEW_MATERIALS }).commit();
  console.log(`   ✓ Patched ${MATERIALS_ID}`);

  console.log('\n📝 2/5: Updating "What sizes are available?"...');
  await client.patch(SIZES_ID).set({ answer: NEW_SIZES }).commit();
  console.log(`   ✓ Patched ${SIZES_ID}`);

  console.log('\n📝 3/5: Updating "What finishes are available?"...');
  await client.patch(FINISHES_ID).set({ answer: NEW_FINISHES }).commit();
  console.log(`   ✓ Patched ${FINISHES_ID}`);

  console.log('\n📝 4/5: Updating "How long do custom commissions take?"...');
  await client.patch(TURNAROUND_ID).set({ answer: NEW_TURNAROUND }).commit();
  console.log(`   ✓ Patched ${TURNAROUND_ID}`);

  console.log('\n📝 5/5: Custom Services consolidation...');
  console.log('   Deleting service-specific FAQs:');
  for (const id of FAQS_TO_DELETE) {
    await client.delete(id);
    console.log(`   ✓ Deleted ${id}`);
  }
  console.log('   Creating generic Custom Services FAQ:');
  await client.createOrReplace(NEW_GENERIC_FAQ);
  console.log(`   ✓ Created/replaced ${NEW_GENERIC_ID}`);

  console.log('\n✅ Done. All 5 FAQ updates applied.');
  console.log(`\n📝 Trigger a Netlify rebuild (or wait for the Sanity webhook) to flush the live site.`);
}

run().catch((err) => {
  console.error('\n❌ Failed:', err.message);
  if (err.response) console.error('   Response:', err.response.body);
  process.exit(1);
});
