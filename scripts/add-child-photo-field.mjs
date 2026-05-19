/**
 * Crayon To Creation — add optional child-photos field + amend copy.
 *
 * Changes (4):
 *   1. Insert new briefingField "childPhotos" (photos, 1-5, optional)
 *      immediately after "sourceDrawing"
 *   2. Update description to mention the child-in-scene option
 *   3. Update importantNote with a sentence about the child option
 *   4. Update step 1 text to mention uploading child photos
 *
 * Idempotent — re-running after the migration is a no-op (no field added if
 * it exists, no text patches applied if they're already in place).
 *
 * Run once:
 *   cd C:\Users\chris\Projects\pixel8
 *   $env:SANITY_TOKEN = (Get-Content .env | Select-String "^SANITY_TOKEN=").Line -replace "^SANITY_TOKEN=", ""
 *   node scripts/add-c2c-child-photo.mjs
 */

import { createClient } from '@sanity/client';

const client = createClient({
  projectId: 'bqb4w421',
  dataset: 'production',
  apiVersion: '2024-12-01',
  token: process.env.SANITY_TOKEN,
  useCdn: false,
});

const SERVICE_ID = '15hxv4Rz0BxauBoW2SzsD1';

const NEW_FIELD = {
  _key: 'bf-c2c-child-photos',
  _type: 'briefingField',
  fieldType: 'photos',
  key: 'childPhotos',
  label: 'Photos of your child (optional)',
  helperText:
    "Want your child in the scene with their creation? Upload 1–5 clear photos — different angles help with likeness. Leave blank and we'll just bring the drawing to life on its own.",
  required: false,
  minPhotos: 1,
  maxPhotos: 5,
};

const NEW_DESCRIPTION =
  "Turn your child's imagination into something truly special. We bring their hand-drawn creations to life as vibrant 3D characters — and (optionally) place your child right there in the scene with them. Each piece preserves the charm and personality of the original drawing. Choose a digital still, add a print for the wall, or commission a 30-second animated short.";

const NEW_IMPORTANT_NOTE =
  "About Crayon To Creation: We transform your child's drawing into a fully realised 3D character in a cinematic scene — keeping the personality and charm of the original while rendering it with professional production quality. When you provide photos of your child, we can place them in the scene with their creation — bringing the moment of imagination meets reality to life. For animated films, we add subtle motion — character animation, camera moves, environmental effects — over 30 seconds. What we can do beautifully: bring the character to life in their own world. What we can't do: lip-sync to a voiceover, complex multi-character interactions, full feature-film animation. Soundtracks are custom-generated based on your chosen mood — pick a style or leave it to us. Voiceovers (when selected) are AI-generated; you can write the script yourself or we'll write one that fits the drawing and the scene.";

const NEW_STEP_1 = "Upload your child's drawing — and optionally photos of your child.";

async function run() {
  if (!process.env.SANITY_TOKEN) {
    console.error('❌ SANITY_TOKEN env var not set.');
    process.exit(1);
  }

  console.log('📖 Fetching Crayon To Creation service doc...\n');
  const doc = await client.getDocument(SERVICE_ID);
  if (!doc) {
    console.error(`❌ Service not found: ${SERVICE_ID}`);
    process.exit(1);
  }

  const patch = {};
  let changes = [];

  // 1. Insert new field after sourceDrawing
  const fields = Array.isArray(doc.briefingFields) ? [...doc.briefingFields] : [];
  const exists = fields.some((f) => f.key === 'childPhotos');
  if (exists) {
    console.log('  briefingFields — childPhotos field already present, skipping insert');
  } else {
    const drawingIdx = fields.findIndex((f) => f.key === 'sourceDrawing');
    if (drawingIdx === -1) {
      console.error('  ✗ sourceDrawing field not found — cannot determine insert position');
      process.exit(1);
    }
    fields.splice(drawingIdx + 1, 0, NEW_FIELD);
    patch.briefingFields = fields;
    changes.push(`briefingFields — inserted childPhotos at index ${drawingIdx + 1}`);
  }

  // 2. Description
  if ((doc.description || '') !== NEW_DESCRIPTION) {
    patch.description = NEW_DESCRIPTION;
    changes.push('description — updated');
  } else {
    console.log('  description — already matches, no change');
  }

  // 3. importantNote
  if ((doc.importantNote || '') !== NEW_IMPORTANT_NOTE) {
    patch.importantNote = NEW_IMPORTANT_NOTE;
    changes.push('importantNote — updated');
  } else {
    console.log('  importantNote — already matches, no change');
  }

  // 4. Step 1 text — match by sortOrder/index rather than exact text
  const steps = Array.isArray(doc.steps) ? [...doc.steps] : [];
  if (steps.length > 0) {
    if (steps[0].text === NEW_STEP_1) {
      console.log('  steps[0].text — already matches, no change');
    } else {
      steps[0] = { ...steps[0], text: NEW_STEP_1 };
      patch.steps = steps;
      changes.push('steps[0].text — updated');
    }
  } else {
    console.warn('  ⚠ steps array not found — skipping step 1 update');
  }

  if (changes.length === 0) {
    console.log('\n✓ Nothing to do — all changes already applied.');
    return;
  }

  console.log('\n📝 Applying changes:');
  changes.forEach((c) => console.log(`  • ${c}`));

  await client.patch(SERVICE_ID).set(patch).commit();
  console.log('\n✅ Patch committed.');
  console.log('\n📝 Trigger a Netlify rebuild to flush the live site.');
}

run().catch((err) => {
  console.error('\n❌ Failed:', err.message);
  if (err.response) console.error('   Response:', err.response.body);
  process.exit(1);
});
