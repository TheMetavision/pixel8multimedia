/**
 * Story Of Your Life — auto-tag all example images as "Original".
 *
 * Iterates every example on SOYL and sets `tag = "Original"` on every image
 * EXCEPT those already tagged "Digital Still" / "Collage" (case-insensitive).
 * Leaves the collage tag untouched.
 *
 * Idempotent — re-running is safe and only updates tags that have changed.
 *
 * This pairs with the page template's categoriseImages() logic, which
 * detects collage mode purely by the "digital still"/"collage" tag and
 * treats every other image as a source photo regardless of its specific tag.
 *
 * Run once:
 *   cd C:\Users\chris\Projects\pixel8
 *   $env:SANITY_TOKEN = (Get-Content .env | Select-String "^SANITY_TOKEN=").Line -replace "^SANITY_TOKEN=", ""
 *   node scripts/tag-soyl-source-photos.mjs
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
const SOURCE_TAG = 'Original';

function isCollageTag(tag) {
  if (!tag) return false;
  return tag.toLowerCase().includes('collage');
}

async function run() {
  if (!process.env.SANITY_TOKEN) {
    console.error('❌ SANITY_TOKEN env var not set.');
    process.exit(1);
  }

  console.log('📖 Fetching Story Of Your Life examples...\n');
  const service = await client.getDocument(SERVICE_ID);
  if (!service) {
    console.error(`❌ Service not found: ${SERVICE_ID}`);
    process.exit(1);
  }

  const examples = Array.isArray(service.examples) ? service.examples : [];
  if (examples.length === 0) {
    console.log('No examples to process.');
    return;
  }

  let totalImages = 0;
  let totalUpdates = 0;
  let totalSkipped = 0;

  // Build the new examples array
  const updatedExamples = examples.map((example) => {
    const images = Array.isArray(example.images) ? example.images : [];
    if (images.length === 0) {
      console.log(`📂 ${example.label || '(unlabelled)'} — no images`);
      return example;
    }

    let updatesInExample = 0;
    const updatedImages = images.map((img) => {
      totalImages++;

      if (isCollageTag(img.tag)) {
        totalSkipped++;
        return img;
      }
      if (img.tag === SOURCE_TAG) {
        // Already correctly tagged — no-op
        return img;
      }
      // Update or set the tag
      updatesInExample++;
      totalUpdates++;
      return { ...img, tag: SOURCE_TAG };
    });

    console.log(`📂 ${example.label || '(unlabelled)'} — ${images.length} images, ${updatesInExample} retagged`);
    return { ...example, images: updatedImages };
  });

  if (totalUpdates === 0) {
    console.log(`\n✓ All ${totalImages} images already tagged correctly. Nothing to do.`);
    return;
  }

  console.log(`\n📝 Updating service: ${totalUpdates} retagged, ${totalSkipped} collage tag(s) preserved...`);
  await client.patch(SERVICE_ID).set({ examples: updatedExamples }).commit();

  console.log(`\n✅ Done. ${totalUpdates} image tag(s) updated to "${SOURCE_TAG}".`);
  console.log(`   ${totalSkipped} collage image(s) left untouched.`);
  console.log('\n📝 Trigger a Netlify rebuild to flush the live site.');
}

run().catch((err) => {
  console.error('\n❌ Failed:', err.message);
  if (err.response) console.error('   Response:', err.response.body);
  process.exit(1);
});
