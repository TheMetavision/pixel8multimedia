/**
 * Story Of Your Life — rename product tier "digital collage [still]" to "Digital Collage".
 *
 * Strips the word "still" from the product name and applies Title Case. Across:
 *   - Service.importantNote
 *   - Service.description
 *   - FAQ "How does pricing work for Story Of Your Life?" answer
 *
 * Replacement rules (applied in order):
 *   1. "digital collage still" / "Digital collage still" / etc → "Digital Collage"
 *   2. "digital collage"        / "Digital collage"        / etc → "Digital Collage"
 *
 * The order matters: rule 1 catches the longer phrase first so we don't end up
 * with "Digital Collage still" from a partial rule-2 match.
 *
 * Idempotent — checks the resulting string against original; only patches when
 * something actually changes. Safe to re-run.
 *
 * Run once:
 *   cd C:\Users\chris\Projects\pixel8
 *   $env:SANITY_TOKEN = (Get-Content .env | Select-String "^SANITY_TOKEN=").Line -replace "^SANITY_TOKEN=", ""
 *   node scripts/fix-soyl-capitalisation.mjs
 */

import { createClient } from '@sanity/client';

const client = createClient({
  projectId: 'bqb4w421',
  dataset: 'production',
  apiVersion: '2024-12-01',
  token: process.env.SANITY_TOKEN,
  useCdn: false,
});

const SERVICE_ID = 'TCQSYEAsAR6vcKomk2Q7cu';
const FAQ_ID = 'faq-soyl-pricing';

// Order matters — longest match first.
function normalise(text) {
  if (!text) return text;
  return text
    .replace(/digital collage still/gi, 'Digital Collage')
    .replace(/digital collage/gi, 'Digital Collage');
}

async function patchServiceField(serviceId, field) {
  const doc = await client.getDocument(serviceId);
  if (!doc) {
    console.error(`❌ Service not found: ${serviceId}`);
    return 0;
  }
  const oldText = doc[field] || '';
  const newText = normalise(oldText);
  if (oldText === newText) {
    console.log(`  service.${field} — no changes needed`);
    return 0;
  }
  await client.patch(serviceId).set({ [field]: newText }).commit();
  // Count how many actual replacements happened (rough estimate from char diff)
  const oldMatches = (oldText.match(/digital collage( still)?/gi) || []).length;
  console.log(`  service.${field} — ${oldMatches} instance(s) updated`);
  return oldMatches;
}

async function patchFAQ() {
  const faq = await client.getDocument(FAQ_ID);
  if (!faq) {
    console.error(`❌ FAQ not found: ${FAQ_ID}`);
    return 0;
  }
  const oldAnswer = faq.answer || '';
  const newAnswer = normalise(oldAnswer);
  if (oldAnswer === newAnswer) {
    console.log('  FAQ answer — no changes needed');
    return 0;
  }
  await client.patch(FAQ_ID).set({ answer: newAnswer }).commit();
  const matches = (oldAnswer.match(/digital collage( still)?/gi) || []).length;
  console.log(`  FAQ answer — ${matches} instance(s) updated`);
  return matches;
}

async function run() {
  if (!process.env.SANITY_TOKEN) {
    console.error('❌ SANITY_TOKEN env var not set.');
    process.exit(1);
  }
  console.log('📝 Renaming product tier → "Digital Collage" (Title Case, no "Still")...\n');

  const a = await patchServiceField(SERVICE_ID, 'importantNote');
  const b = await patchServiceField(SERVICE_ID, 'description');
  const c = await patchFAQ();
  const total = a + b + c;

  if (total === 0) {
    console.log('\n✓ Nothing to update — all instances already correct.');
  } else {
    console.log(`\n✅ ${total} instance(s) updated across 2 documents.`);
    console.log('\n📝 Trigger a Netlify rebuild to flush the live site.');
  }
}

run().catch((err) => {
  console.error('\n❌ Failed:', err.message);
  if (err.response) console.error('   Response:', err.response.body);
  process.exit(1);
});
