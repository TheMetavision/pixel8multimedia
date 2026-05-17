/**
 * Removes briefing fields across services:
 *   - `customerPhone` — removed from ALL services that have it
 *   - `locationPhotos` — removed from Missing Moment (the only service that has it)
 *
 * Per the audit at deploy time (May 17 2026):
 *   - Phone field: present on The Missing Moment, Story Of Your Life
 *   - Location photos field: present on The Missing Moment only
 *
 * Run once:
 *   cd C:\Users\chris\Projects\pixel8
 *   $env:SANITY_TOKEN = (Get-Content .env | Select-String "^SANITY_TOKEN=").Line -replace "^SANITY_TOKEN=", ""
 *   node scripts/remove-phone-and-location-fields.mjs
 *
 * Idempotent — safe to re-run. Strips by `key`, not by index, so it works even
 * if the order of briefingFields changes.
 *
 * Note: this only removes the briefing FIELDS. The customer-facing wizard
 * payload still passes `phone` if present and the commission-checkout function
 * still writes it to the doc when present. So old commission docs keep their
 * phone numbers; new commissions just never collect them.
 */

import { createClient } from '@sanity/client';

const client = createClient({
  projectId: 'bqb4w421',
  dataset: 'production',
  apiVersion: '2024-12-01',
  token: process.env.SANITY_TOKEN,
  useCdn: false,
});

const FIELDS_TO_REMOVE = ['customerPhone', 'locationPhotos'];

async function run() {
  if (!process.env.SANITY_TOKEN) {
    console.error('❌ SANITY_TOKEN env var not set.');
    process.exit(1);
  }

  console.log('📝 Scanning all services for fields to remove...');
  console.log(`   Fields targeted: ${FIELDS_TO_REMOVE.join(', ')}\n`);

  // Fetch every service with briefing fields
  const services = await client.fetch(
    `*[_type == "service" && defined(briefingFields)]{
      _id, title, "slug": slug.current, briefingFields
    }`
  );

  let totalPatched = 0;
  let totalRemoved = 0;

  for (const service of services) {
    const original = service.briefingFields || [];
    const cleaned = original.filter((f) => !FIELDS_TO_REMOVE.includes(f?.key));
    const removedCount = original.length - cleaned.length;

    if (removedCount === 0) {
      continue;
    }

    const removedKeys = original
      .filter((f) => FIELDS_TO_REMOVE.includes(f?.key))
      .map((f) => f.key)
      .join(', ');

    console.log(`   • ${service.title} (${service.slug}) — removing: ${removedKeys}`);

    await client
      .patch(service._id)
      .set({ briefingFields: cleaned })
      .commit();

    totalPatched += 1;
    totalRemoved += removedCount;
  }

  if (totalPatched === 0) {
    console.log('   No matching fields found — nothing to remove. (Already clean.)');
  } else {
    console.log(`\n✅ Done. Patched ${totalPatched} service(s), removed ${totalRemoved} briefing field(s).`);
  }

  console.log('\n📝 Trigger a Netlify rebuild (or wait for the Sanity webhook) to flush the live site.');
}

run().catch((err) => {
  console.error('\n❌ Failed:', err.message);
  if (err.response) console.error('   Response:', err.response.body);
  process.exit(1);
});
