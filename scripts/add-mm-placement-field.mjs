/**
 * The Missing Moment — add 'Where should the added person fit in the photo?' field.
 *
 * Inserts a new REQUIRED textarea field between the existing "Describe the
 * moment" (bf-mm-scene-brief) and "What should happen in the scene?"
 * (bf-mm-scene-action) fields. The new field captures position and pose for
 * the added person(s) — critical for the digital still path which currently
 * has no way to specify composition.
 *
 * Required on ALL paths (digital still, animation, animation+VO).
 *
 * Idempotent — checks for an existing field with the same key before
 * inserting. Safe to re-run.
 *
 * Run once:
 *   cd C:\Users\chris\Projects\pixel8
 *   $env:SANITY_TOKEN = (Get-Content .env | Select-String "^SANITY_TOKEN=").Line -replace "^SANITY_TOKEN=", ""
 *   node scripts/add-mm-placement-field.mjs
 */

import { createClient } from '@sanity/client';

const client = createClient({
  projectId: 'bqb4w421',
  dataset: 'production',
  apiVersion: '2024-12-01',
  token: process.env.SANITY_TOKEN,
  useCdn: false,
});

const SERVICE_ID = '15hxv4Rz0BxauBoW2SznOx';
const NEW_FIELD_KEY = 'addedPersonPlacement';
const INSERT_AFTER_KEY = 'sceneBrief'; // existing "Describe the moment" field

const NEW_FIELD = {
  _key: 'bf-mm-added-person-placement',
  _type: 'briefingField',
  key: NEW_FIELD_KEY,
  label: 'Where should the added person(s) fit in the photo?',
  fieldType: 'textarea',
  helperText: "Describe their position, pose, and how they relate to the others in the scene. E.g. 'Grandpa standing on the left with his hand on Mum's shoulder, both smiling at the camera' or 'Sat next to me at the table, leaning in like he's mid-conversation.'",
  required: true,
  // No showFor — required on every path (digital, animation, animation-vo).
};

async function run() {
  if (!process.env.SANITY_TOKEN) {
    console.error('❌ SANITY_TOKEN env var not set.');
    process.exit(1);
  }

  // Fetch current briefingFields so we can splice the new one in safely
  console.log('📖 Fetching current Missing Moment briefingFields...');
  const service = await client.getDocument(SERVICE_ID);
  if (!service) {
    console.error(`❌ Service not found: ${SERVICE_ID}`);
    process.exit(1);
  }
  const fields = Array.isArray(service.briefingFields) ? service.briefingFields : [];
  console.log(`   ${fields.length} existing briefing fields\n`);

  // Idempotency check — already present?
  const alreadyPresent = fields.some((f) => f.key === NEW_FIELD_KEY);
  if (alreadyPresent) {
    console.log(`✓ Field "${NEW_FIELD_KEY}" already present — nothing to do.`);
    return;
  }

  // Find the insertion point
  const insertAfterIndex = fields.findIndex((f) => f.key === INSERT_AFTER_KEY);
  if (insertAfterIndex === -1) {
    console.error(`❌ Couldn't find "${INSERT_AFTER_KEY}" field — aborting to avoid wrong placement.`);
    process.exit(1);
  }
  console.log(`📍 Inserting after position ${insertAfterIndex + 1} ("${fields[insertAfterIndex].label}")\n`);

  // Build new array with the field spliced in
  const updated = [
    ...fields.slice(0, insertAfterIndex + 1),
    NEW_FIELD,
    ...fields.slice(insertAfterIndex + 1),
  ];

  // Patch the service doc
  console.log(`📝 Patching service ${SERVICE_ID}...`);
  await client.patch(SERVICE_ID).set({ briefingFields: updated }).commit();

  console.log('\n✅ Field added successfully.');
  console.log('');
  console.log('New brief order:');
  updated.forEach((f, i) => {
    const arrow = f.key === NEW_FIELD_KEY ? ' ← NEW' : '';
    const requiredFlag = f.required ? ' *' : '';
    const showFor = Array.isArray(f.showFor) && f.showFor.length ? ` [${f.showFor.join(', ')}]` : '';
    console.log(`  ${(i + 1).toString().padStart(2)}. ${f.label}${requiredFlag}${showFor}${arrow}`);
  });
  console.log('');
  console.log('📝 Trigger a Netlify rebuild to flush the live site.');
}

run().catch((err) => {
  console.error('\n❌ Failed:', err.message);
  if (err.response) console.error('   Response:', err.response.body);
  process.exit(1);
});
