// scripts/link-faqs-to-services.mjs
//
// One-shot migration: links every "custom-services" FAQ to its corresponding
// service via the new `service` reference field.
//
// Mapping is derived from the _id prefix conventions already in use:
//   faq-bit-*            -> back-in-time
//   faq-cartoonify-*     -> cartoonify-me
//   faq-c2c-*            -> crayon-to-creation
//   faq-pp-*             -> past-perfect
//   faq-prz-*            -> prankz
//   faq-ss-*             -> scene-stealer
//   faq-sp-*             -> star-power
//   faq-s2r-*            -> stills-to-reels
//   faq-soyl-*           -> story-of-your-life
//   faq-tdim-*           -> the-day-i-met
//   faq-mm-*             -> the-missing-moment
//   faq-ysys-*           -> your-song-your-story
//
// Saves edits as drafts. Review in Studio before publishing.
//
// Usage:
//   cd C:\Users\chris\Projects\pixel8
//   $env:SANITY_TOKEN = "your-editor-token"
//   node scripts/link-faqs-to-services.mjs
//
//   Add --publish to skip the draft step (NOT recommended on first run).

import { createClient } from '@sanity/client';

const client = createClient({
  projectId: 'bqb4w421',
  dataset: 'production',
  apiVersion: '2024-12-01',
  token: process.env.SANITY_TOKEN,
  useCdn: false,
});

const SLUG_BY_PREFIX = {
  'faq-bit-': 'back-in-time',
  'faq-cartoonify-': 'cartoonify-me',
  'faq-c2c-': 'crayon-to-creation',
  'faq-pp-': 'past-perfect',
  'faq-prz-': 'prankz',
  'faq-ss-': 'scene-stealer',
  'faq-sp-': 'star-power',
  'faq-s2r-': 'stills-to-reels',
  'faq-soyl-': 'story-of-your-life',
  'faq-tdim-': 'the-day-i-met',
  'faq-mm-': 'the-missing-moment',
  'faq-ysys-': 'your-song-your-story',
};

// Explicit ID-to-slug overrides for FAQs that don't follow the prefix
// convention (e.g. those created via Sanity MCP which assigns UUIDs).
const SLUG_BY_ID = {
  '690c600a-4b53-44bc-89f2-6350a6750478': 'the-day-i-met',
};

// FAQs that intentionally have NO service reference — they're general
// questions about the whole services offering, displayed in a "General"
// section above the per-service ones on the FAQ page.
const GENERAL_FAQ_IDS = new Set([
  'faq-custom-services-overview',
  'pqsf8ly4J5ZHPrl9Dk3jGb',
]);

function slugFromId(id) {
  // Strip any "drafts." prefix when matching
  const bare = id.startsWith('drafts.') ? id.slice('drafts.'.length) : id;
  // Check explicit ID overrides first (for UUIDs etc.)
  if (SLUG_BY_ID[bare]) return SLUG_BY_ID[bare];
  // Then prefix conventions
  for (const [prefix, slug] of Object.entries(SLUG_BY_PREFIX)) {
    if (bare.startsWith(prefix)) return slug;
  }
  return null;
}

async function main() {
  const publish = process.argv.includes('--publish');

  // 1. Load all services so we can map slug -> _id
  const services = await client.fetch(
    `*[_type == "service"]{_id, "slug": slug.current, title}`
  );
  const serviceIdBySlug = Object.fromEntries(
    services.map((s) => [s.slug, s._id])
  );

  // 2. Load all custom-services FAQs (full doc — we need _type, _rev, etc)
  const faqs = await client.fetch(
    `*[_type == "faq" && category == "custom-services"]{_id, _type, _rev, _createdAt, _updatedAt, category, displayOrder, question, answer, service}`
  );

  console.log(`Loaded ${faqs.length} FAQs to evaluate.`);

  let linked = 0;
  let skippedGeneral = 0;
  let skippedNoPrefix = 0;
  let skippedAlreadyLinked = 0;
  let errors = 0;

  for (const faq of faqs) {
    if (GENERAL_FAQ_IDS.has(faq._id)) {
      skippedGeneral++;
      continue;
    }
    const slug = slugFromId(faq._id);
    if (!slug) {
      console.warn(`SKIP — no prefix match for _id: ${faq._id}`);
      skippedNoPrefix++;
      continue;
    }
    const serviceId = serviceIdBySlug[slug];
    if (!serviceId) {
      console.warn(`SKIP — slug "${slug}" not found in services list (FAQ: ${faq._id})`);
      errors++;
      continue;
    }
    if (faq.service?._ref === serviceId) {
      skippedAlreadyLinked++;
      continue;
    }

    const draftId = faq._id.startsWith('drafts.') ? faq._id : `drafts.${faq._id}`;
    const existingDraft = await client.getDocument(draftId).catch(() => null);
    const baseDoc = existingDraft || (await client.getDocument(faq._id));

    const newDoc = {
      ...baseDoc,
      _id: draftId,
      service: { _type: 'reference', _ref: serviceId },
    };

    try {
      if (publish) {
        // Direct write to published doc
        await client.patch(faq._id).set({ service: { _type: 'reference', _ref: serviceId } }).commit();
      } else {
        await client.createOrReplace(newDoc);
      }
      console.log(`LINKED ${faq._id} -> ${slug}`);
      linked++;
    } catch (err) {
      console.error(`ERROR ${faq._id}: ${err.message}`);
      errors++;
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Linked:                    ${linked}`);
  console.log(`Already linked (skipped):  ${skippedAlreadyLinked}`);
  console.log(`General FAQs (skipped):    ${skippedGeneral}`);
  console.log(`No prefix match (skipped): ${skippedNoPrefix}`);
  console.log(`Errors:                    ${errors}`);
  console.log(publish ? '\nPublished directly.' : '\nDrafts created. Review in Studio, then bulk-publish.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
