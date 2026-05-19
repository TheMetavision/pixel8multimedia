/**
 * Story Of Your Life — add odd-numbered options (7, 9, 11) to the
 * "How many moments?" dropdown, keeping the existing 6/8/10/12 options.
 *
 * Final order: 6, 7, 8, 9, 10, 11, 12
 *
 * Idempotent — re-running after the update is a no-op.
 *
 * Run once:
 *   cd C:\Users\chris\Projects\pixel8
 *   $env:SANITY_TOKEN = (Get-Content .env | Select-String "^SANITY_TOKEN=").Line -replace "^SANITY_TOKEN=", ""
 *   node scripts/add-odd-moments.mjs
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
const FIELD_KEY = 'momentCount';

const NEW_OPTIONS = [
  '6 moments',
  '7 moments',
  '8 moments',
  '9 moments',
  '10 moments',
  '11 moments',
  '12 moments',
];

async function run() {
  if (!process.env.SANITY_TOKEN) {
    console.error('❌ SANITY_TOKEN env var not set.');
    process.exit(1);
  }

  console.log('📖 Fetching Story Of Your Life briefing fields...\n');
  const doc = await client.getDocument(SERVICE_ID);
  if (!doc) {
    console.error(`❌ Service not found: ${SERVICE_ID}`);
    process.exit(1);
  }

  const fields = Array.isArray(doc.briefingFields) ? doc.briefingFields : [];
  const fieldIdx = fields.findIndex((f) => f.key === FIELD_KEY);
  if (fieldIdx === -1) {
    console.error(`❌ Field "${FIELD_KEY}" not found on service.`);
    process.exit(1);
  }

  const current = fields[fieldIdx].options || [];
  const same =
    current.length === NEW_OPTIONS.length &&
    current.every((v, i) => v === NEW_OPTIONS[i]);

  if (same) {
    console.log('✓ Options already correct — nothing to do.');
    return;
  }

  console.log(`  Current options: ${current.join(', ')}`);
  console.log(`  New options:     ${NEW_OPTIONS.join(', ')}\n`);

  const updatedFields = fields.map((f, i) =>
    i === fieldIdx ? { ...f, options: NEW_OPTIONS } : f
  );

  await client.patch(SERVICE_ID).set({ briefingFields: updatedFields }).commit();

  console.log(`✅ Updated "${FIELD_KEY}" with ${NEW_OPTIONS.length} options.`);
  console.log('\n📝 Trigger a Netlify rebuild to flush the live site.');
}

run().catch((err) => {
  console.error('\n❌ Failed:', err.message);
  if (err.response) console.error('   Response:', err.response.body);
  process.exit(1);
});
