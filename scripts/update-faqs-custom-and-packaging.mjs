/**
 * Patch two FAQ answers:
 *
 * 1. "Can I order a custom piece?" — original answer only mentioned 3 services
 *    and used the made-up term "Bespoke Commissions". Rewrite to reference
 *    the full range of 12 commission services without listing them all.
 *
 * 2. "How are orders packaged?" — replace "corner-protected" with
 *    "bubble-wrapped" to match actual fulfilment practice.
 *
 * Run once:
 *   cd C:\Users\chris\Projects\pixel8
 *   $env:SANITY_TOKEN = (Get-Content .env | Select-String "^SANITY_TOKEN=").Line -replace "^SANITY_TOKEN=", ""
 *   node scripts/update-faqs-custom-and-packaging.mjs
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

// ── FAQ 1: Can I order a custom piece? ──────────────────────────────────────
const CUSTOM_FAQ_ID = 'pqsf8ly4J5ZHPrl9Dk3i9B';
const NEW_CUSTOM_ANSWER =
  `Absolutely. We offer twelve commission services covering portraits, photo restoration, scene recreations, ` +
  `life-story timelines, song writing and animations. Browse them all on our Services page — each has its own ` +
  `brief form, pricing, and turnaround.`;

// ── FAQ 2: How are orders packaged? ─────────────────────────────────────────
const PACKAGING_FAQ_ID = 'zOkJuNZVmyYz76wu4mZsUD';
const NEW_PACKAGING_ANSWER =
  `Posters are rolled in protective tubes. Canvas prints are bubble-wrapped and boxed. ` +
  `Every order is packaged to arrive in perfect condition.`;

async function run() {
  if (!process.env.SANITY_TOKEN) {
    console.error('❌ SANITY_TOKEN env var not set.');
    process.exit(1);
  }

  console.log('📝 Rewriting "Can I order a custom piece?" FAQ...');
  await client.patch(CUSTOM_FAQ_ID).set({ answer: NEW_CUSTOM_ANSWER }).commit();
  console.log(`   ✓ Patched FAQ ${CUSTOM_FAQ_ID}`);

  console.log('\n📝 Rewriting "How are orders packaged?" FAQ...');
  await client.patch(PACKAGING_FAQ_ID).set({ answer: NEW_PACKAGING_ANSWER }).commit();
  console.log(`   ✓ Patched FAQ ${PACKAGING_FAQ_ID}`);

  console.log('\n✅ Done. Both FAQs updated.');
  console.log(`\n📝 Trigger a Netlify rebuild (or wait for the Sanity webhook) to flush the live site.`);
}

run().catch((err) => {
  console.error('\n❌ Failed:', err.message);
  if (err.response) console.error('   Response:', err.response.body);
  process.exit(1);
});
