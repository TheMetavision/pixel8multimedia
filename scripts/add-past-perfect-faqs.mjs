/**
 * Adds Past Perfect FAQs.
 *
 * Run once:
 *   cd C:\Users\chris\Projects\pixel8
 *   $env:SANITY_TOKEN = (Get-Content .env | Select-String "^SANITY_TOKEN=").Line -replace "^SANITY_TOKEN=", ""
 *   node scripts/add-past-perfect-faqs.mjs
 *
 * Idempotent — uses deterministic IDs.
 */

import { createClient } from '@sanity/client';

const client = createClient({
  projectId: 'bqb4w421',
  dataset: 'production',
  apiVersion: '2024-12-01',
  token: process.env.SANITY_TOKEN,
  useCdn: false,
});

const NEW_FAQS = [
  {
    _id: 'faq-pp-pricing',
    _type: 'faq',
    question: 'How does pricing work for Past Perfect?',
    answer:
      `The full restoration costs a flat £9.99, which includes:\n\n` +
      `• Damage repair (tears, scratches, fading, water damage, missing sections)\n` +
      `• Optional colourisation if your photo is black-and-white or sepia\n` +
      `• Detail and tone enhancement\n` +
      `• The high-resolution digital file delivered via secure download link\n\n` +
      `If you want a physical print as well, just add it to your order. Prints are charged at our standard product prices with no additional artwork fee — the restoration work is already paid for in the £9.99.\n\n` +
      `One photo per commission. If you have several to restore, place one order per photo.`,
    category: 'custom-services',
    displayOrder: 50,
  },
  {
    _id: 'faq-pp-what-we-fix',
    _type: 'faq',
    question: 'What kind of damage can you fix?',
    answer:
      `Most common photo damage is repairable: tears, creases, scratches, fading, water spots, light leaks, mould, missing corners, and faded colour casts.\n\n` +
      `Significant damage (large missing areas of a face, severe physical destruction, very low-resolution source scans) means we have to reconstruct from what's there — the result will be a faithful restoration of recoverable detail, but areas we have to rebuild may not be perfectly identical to the original.\n\n` +
      `If you're unsure whether your photo is recoverable, get in touch first with a phone snap of the original — we'll tell you honestly what we can and can't do before you place an order.`,
    category: 'custom-services',
    displayOrder: 51,
  },
  {
    _id: 'faq-pp-colourisation',
    _type: 'faq',
    question: 'How does the colourisation work?',
    answer:
      `Colourisation is included in the £9.99 if you ask for it. We add historically appropriate colour to skin tones, clothing, hair, and surroundings based on the era and any context you provide.\n\n` +
      `If you know specific details — "my grandfather had red hair", "that dress was navy blue", "the curtains were green" — include them in the brief and we'll match them. Without that detail, we make plausible era-appropriate choices.\n\n` +
      `You can choose colourisation, no colourisation (clean B&W restoration only), or only colourisation (no damage to repair). All three options are the same £9.99 price.`,
    category: 'custom-services',
    displayOrder: 52,
  },
  {
    _id: 'faq-pp-source-photos',
    _type: 'faq',
    question: 'What kind of photo can I upload?',
    answer:
      `The better your source photo, the better the restoration. In order of preference:\n\n` +
      `• A flatbed scan at 600dpi or higher — the gold standard\n` +
      `• A phone photo of the original, taken in even daylight with no flash glare\n` +
      `• An existing digital file you have on your phone or computer\n\n` +
      `If you're photographing an old print with your phone, lay it flat in good natural light, avoid shadows, and shoot directly from above. Multiple shots from different angles can help us if part of the photo is faded.`,
    category: 'custom-services',
    displayOrder: 53,
  },
];

async function run() {
  if (!process.env.SANITY_TOKEN) {
    console.error('❌ SANITY_TOKEN env var not set.');
    process.exit(1);
  }

  console.log(`📝 Adding ${NEW_FAQS.length} Past Perfect FAQs...\n`);

  for (const faq of NEW_FAQS) {
    await client.createOrReplace(faq);
    console.log(`   ✓ "${faq.question}"`);
  }

  console.log(`\n✅ Done. ${NEW_FAQS.length} FAQs added to custom-services category.`);
  console.log('\n📝 Trigger a Netlify rebuild to flush the live site.');
}

run().catch((err) => {
  console.error('\n❌ Failed:', err.message);
  if (err.response) console.error('   Response:', err.response.body);
  process.exit(1);
});
