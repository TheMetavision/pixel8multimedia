/**
 * Delete the 12 "personalised" products from the Pixel8 store.
 *
 * RUN THIS LAST — only after:
 *   1. Schema is deployed (npx sanity schemas deploy && npx sanity deploy)
 *   2. populate-services.mjs has run successfully
 *   3. Frontend commission workflow is deployed and tested live
 *   4. You've manually placed a test order through the new workflow
 *
 * Once deleted, anything that referenced `category == "personalised"` in
 * the /store query will return 0 results. The shop page already filters
 * these out in the new version, so this cleanup just removes dead data.
 *
 * Run:
 *   cd C:\Users\chris\Projects\pixel8
 *   $env:SANITY_TOKEN = "<editor token>"
 *   node scripts/delete-personalised-products.mjs
 *
 * The script:
 *   1. Lists the 12 personalised products
 *   2. Prompts for confirmation (type "DELETE" to proceed)
 *   3. Unpublishes each one
 *   4. Discards drafts for each one
 *   5. Reports success/failure per product
 */

import { createClient } from '@sanity/client';
import readline from 'readline';

const client = createClient({
  projectId: 'bqb4w421',
  dataset: 'production',
  apiVersion: '2024-01-01',
  token: process.env.SANITY_TOKEN,
  useCdn: false,
});

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans); }));
}

async function run() {
  if (!process.env.SANITY_TOKEN) {
    console.error('❌ SANITY_TOKEN env var not set.');
    process.exit(1);
  }

  console.log('🔍 Finding personalised products in /store…');
  const personalised = await client.fetch(
    `*[_type == "product" && category == "personalised"]{ _id, title, "slug": slug.current }`
  );

  if (personalised.length === 0) {
    console.log('   No personalised products found. Nothing to do.');
    return;
  }

  console.log(`\n   Found ${personalised.length} personalised products:\n`);
  personalised.forEach((p, i) => {
    console.log(`     ${i + 1}. ${p.title}  (${p._id})`);
  });

  console.log('\n⚠  This will permanently delete all of the above.');
  console.log('   The new commission workflow on /services/[slug] is the replacement.');
  console.log('   You should have placed at least one test order through it before running this.\n');
  const answer = await prompt('Type "DELETE" to confirm: ');
  if (answer !== 'DELETE') {
    console.log('   Cancelled.');
    return;
  }

  let succeeded = 0;
  let failed = 0;
  for (const p of personalised) {
    try {
      // Delete both published and draft versions
      await client.delete(p._id);
      await client.delete(`drafts.${p._id}`).catch(() => {}); // draft may not exist
      console.log(`   ✓ Deleted ${p.title}`);
      succeeded++;
    } catch (err) {
      console.log(`   ✗ Failed ${p.title}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n✅ Done. ${succeeded} deleted, ${failed} failed.`);
  console.log(`\n📝 Trigger a Netlify rebuild to flush the /store page.`);
}

run().catch((err) => {
  console.error('\n❌ Failed:', err.message);
  process.exit(1);
});
