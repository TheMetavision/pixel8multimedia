/**
 * Strip 'cameraMovement' and 'pacing' briefingFields from animation-enabled services.
 *
 * Rationale: these are studio-craft decisions, not customer choices. Removing them
 * tidies the brief without losing useful input — mood, music genre, scene direction,
 * and VO fields all remain.
 *
 * Affected services (6):
 *   - The Missing Moment
 *   - Crayon To Creation
 *   - Prankz
 *   - The Day I Met...
 *   - Scene Stealer
 *   - Story Of Your Life
 *
 * Past commission docs are NOT scrubbed — the fields will still exist on historical
 * records, just no longer appear in future briefs.
 *
 * Idempotent — re-running after stripping is a no-op (0 fields removed).
 *
 * Run once:
 *   cd C:\Users\chris\Projects\pixel8
 *   $env:SANITY_TOKEN = (Get-Content .env | Select-String "^SANITY_TOKEN=").Line -replace "^SANITY_TOKEN=", ""
 *   node scripts/strip-camera-pacing.mjs
 */

import { createClient } from '@sanity/client';

const client = createClient({
  projectId: 'bqb4w421',
  dataset: 'production',
  apiVersion: '2024-12-01',
  token: process.env.SANITY_TOKEN,
  useCdn: false,
});

// Field keys to remove (studio-craft decisions)
const FIELDS_TO_REMOVE = ['cameraMovement', 'pacing'];

// Service slugs whose briefingFields should be patched
const TARGET_SLUGS = [
  'the-missing-moment',
  'crayon-to-creation',
  'prankz',
  'the-day-i-met',
  'scene-stealer',
  'story-of-your-life',
];

async function patchService(slug) {
  // Fetch by slug
  const services = await client.fetch(
    '*[_type == "service" && slug.current == $slug][0]{_id, title, briefingFields}',
    { slug }
  );
  if (!services) {
    console.error(`  ✗ ${slug} — service not found`);
    return { slug, removed: 0, error: 'not found' };
  }
  const { _id, title, briefingFields } = services;
  const fields = Array.isArray(briefingFields) ? briefingFields : [];
  if (fields.length === 0) {
    console.log(`  - ${slug} — no briefingFields, skipped`);
    return { slug, removed: 0 };
  }

  const filtered = fields.filter((f) => !FIELDS_TO_REMOVE.includes(f.key));
  const removed = fields.length - filtered.length;

  if (removed === 0) {
    console.log(`  ✓ ${slug} — already clean`);
    return { slug, removed: 0 };
  }

  await client.patch(_id).set({ briefingFields: filtered }).commit();
  console.log(`  ✓ ${slug} (${title}) — removed ${removed} field(s)`);
  return { slug, removed };
}

async function run() {
  if (!process.env.SANITY_TOKEN) {
    console.error('❌ SANITY_TOKEN env var not set.');
    process.exit(1);
  }

  console.log(`📝 Stripping ${FIELDS_TO_REMOVE.join(', ')} from ${TARGET_SLUGS.length} services...\n`);

  let totalRemoved = 0;
  for (const slug of TARGET_SLUGS) {
    const r = await patchService(slug);
    totalRemoved += r.removed;
  }

  console.log(`\n${totalRemoved === 0 ? '✓ Nothing to do — all services already clean.' : `✅ ${totalRemoved} field(s) removed across ${TARGET_SLUGS.length} services.`}`);
  console.log('\n📝 Trigger a Netlify rebuild to flush the live site.');
}

run().catch((err) => {
  console.error('\n❌ Failed:', err.message);
  if (err.response) console.error('   Response:', err.response.body);
  process.exit(1);
});
