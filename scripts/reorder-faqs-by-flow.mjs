// scripts/reorder-faqs-by-flow.mjs
//
// Renumbers displayOrder within each service's FAQ group following the
// logical flow:
//
//   1. Source photo / input requirements      (source-photo, drawing, upload)
//   2. Process / how it works                  (process, animation, song-process, leave-to-us)
//   3. Pricing                                  (pricing, bundle, artwork-fee)
//   4. Delivery / output                        (delivery, format, gift, prints, voiceover)
//   5. Everything else                          (fallback bucket)
//
// Uses a keyword classifier on _id + question. Re-runnable: writes drafts
// only. Review in Studio, bulk-publish when satisfied.
//
// Usage:
//   $env:SANITY_TOKEN = "your-editor-token"
//   node scripts/reorder-faqs-by-flow.mjs

import { createClient } from '@sanity/client';

const client = createClient({
  projectId: 'bqb4w421',
  dataset: 'production',
  apiVersion: '2024-12-01',
  token: process.env.SANITY_TOKEN,
  useCdn: false,
});

// Bucket order: lower bucket = earlier in display
const BUCKETS = {
  SOURCE: 1,
  PROCESS: 2,
  PRICING: 3,
  DELIVERY: 4,
  OTHER: 5,
};

function classify(faq) {
  const id = (faq._id || '').toLowerCase();
  const q = (faq.question || '').toLowerCase();
  const a = (faq.answer || '').toLowerCase();

  // 1. Source — input / upload / photo / drawing requirements
  if (
    /source-photo|source-drawing|photo-quality|moments\b/.test(id) ||
    /what kind of (photo|drawing|image)|what should i upload|how many moments|source photo|reference photo|upload/.test(q)
  ) {
    return BUCKETS.SOURCE;
  }

  // 2. Process — how it works
  if (
    /process|animation-process|song-process|leave-to-us|content-limits|character-choice|multiple-scenes|collections|styles|moments|animation-length|title\b/.test(id) ||
    /how does .* work|how is the song|how do the animated|leave the creative|how long are the animated|how does .* actually work/.test(q)
  ) {
    return BUCKETS.PROCESS;
  }

  // 3. Pricing — bundles, artwork fees
  if (
    /pricing|bundle|artwork-fee|upgrade|savings|prints-mixed/.test(id) ||
    /how does pricing|what's the difference between|why is the bundle|what's the £|can i order a print after/.test(q)
  ) {
    return BUCKETS.PRICING;
  }

  // 4. Delivery — output, format, gift, voiceover, final product
  if (
    /voiceover|format|gift|delivery|prints?-/.test(id) ||
    /how do voiceovers|what does the final|gift|delivery|deliver/.test(q)
  ) {
    return BUCKETS.DELIVERY;
  }

  return BUCKETS.OTHER;
}

async function main() {
  // Load all FAQs that have a service reference set
  const faqs = await client.fetch(
    `*[_type == "faq" && defined(service)]{_id, _type, _rev, _createdAt, _updatedAt, category, displayOrder, question, answer, service}`
  );

  console.log(`Loaded ${faqs.length} service-linked FAQs.`);

  // Group by service._ref
  const byService = new Map();
  for (const faq of faqs) {
    const ref = faq.service?._ref;
    if (!ref) continue;
    if (!byService.has(ref)) byService.set(ref, []);
    byService.get(ref).push(faq);
  }

  let updated = 0;
  let skipped = 0;

  for (const [serviceRef, group] of byService) {
    // Sort each group by bucket, then by question alphabetically within bucket
    // (stable, predictable; pricing always before delivery, etc)
    group.sort((a, b) => {
      const ba = classify(a);
      const bb = classify(b);
      if (ba !== bb) return ba - bb;
      return (a.question || '').localeCompare(b.question || '');
    });

    // Renumber: start at 10, step 10 (so editors can insert manually later)
    let order = 10;
    for (const faq of group) {
      if (faq.displayOrder === order) {
        skipped++;
        order += 10;
        continue;
      }
      const draftId = faq._id.startsWith('drafts.')
        ? faq._id
        : `drafts.${faq._id}`;
      const existingDraft = await client.getDocument(draftId).catch(() => null);
      const baseDoc = existingDraft || (await client.getDocument(faq._id));

      const newDoc = { ...baseDoc, _id: draftId, displayOrder: order };
      try {
        await client.createOrReplace(newDoc);
        console.log(
          `[${serviceRef.slice(0, 8)}] ${faq._id} → order=${order} (bucket ${classify(faq)})  "${faq.question}"`
        );
        updated++;
      } catch (err) {
        console.error(`ERROR ${faq._id}: ${err.message}`);
      }
      order += 10;
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Updated:  ${updated}`);
  console.log(`Skipped:  ${skipped}`);
  console.log('\nDrafts created. Review in Studio, then bulk-publish.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
