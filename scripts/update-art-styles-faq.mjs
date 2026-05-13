/**
 * Rewrite the stale "What art styles do you offer?" FAQ answer.
 *
 * The current answer references the deprecated named-style model
 * (Neon Glow, Minimalist Cool, Retro Vibes, Pixel Art, Pop Art, Watercolour,
 * Noir, Geometric, Street Art) — these don't exist anywhere else on the site
 * anymore. Customers reading this would expect to see those names and get
 * confused. Rewrite to reflect the current Option A-J model.
 *
 * Run once:
 *   cd C:\Users\chris\Projects\pixel8
 *   $env:SANITY_TOKEN = (Get-Content .env | Select-String "^SANITY_TOKEN=").Line -replace "^SANITY_TOKEN=", ""
 *   node scripts/update-art-styles-faq.mjs
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

const FAQ_ID = 'pqsf8ly4J5ZHPrl9Dk3gXO';

const NEW_ANSWER =
  `Every character in our shop comes in ten exclusive design options, labelled Option A through Option J. ` +
  `Each option is a distinctive interpretation of the character — different colour palettes, moods, and artistic treatments — ` +
  `so you can choose the one that fits your space. Browse any character page in the shop to see all ten options side by side.`;

async function run() {
  if (!process.env.SANITY_TOKEN) {
    console.error('❌ SANITY_TOKEN env var not set.');
    process.exit(1);
  }

  console.log('📝 Rewriting "What art styles do you offer?" FAQ...');
  await client
    .patch(FAQ_ID)
    .set({ answer: NEW_ANSWER })
    .commit();
  console.log(`   ✓ Patched FAQ ${FAQ_ID}`);
  console.log(`\n✅ Done. The art styles FAQ now reflects the current Option A-J model.`);
}

run().catch((err) => {
  console.error('\n❌ Failed:', err.message);
  if (err.response) console.error('   Response:', err.response.body);
  process.exit(1);
});
