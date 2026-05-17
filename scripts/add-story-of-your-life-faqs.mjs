/**
 * Adds Story Of Your Life FAQs.
 *
 * Run once:
 *   cd C:\Users\chris\Projects\pixel8
 *   $env:SANITY_TOKEN = (Get-Content .env | Select-String "^SANITY_TOKEN=").Line -replace "^SANITY_TOKEN=", ""
 *   node scripts/add-story-of-your-life-faqs.mjs
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
    _id: 'faq-soyl-pricing',
    _type: 'faq',
    question: 'How does pricing work for Story Of Your Life?',
    answer:
      `Three base options:\n\n` +
      `• Digital collage still — £14.99. We arrange your 6–12 chosen moments into one beautifully composed image and deliver the digital file.\n` +
      `• Animated story (music) — £109.99. A cinematic animation of up to 60 seconds with a custom soundtrack. Includes the digital collage still.\n` +
      `• Animated story (music + voiceover) — £139.99. As above, with an AI-generated voiceover drawn from your moment brief. Includes the digital collage still.\n\n` +
      `Want it on the wall? Add prints (poster or canvas) to any of these orders. Prints are charged at our standard product prices — the £14.99 artwork fee is waived because the collage is already paid for in the base order.\n\n` +
      `Standalone single print orders include the £14.99 artwork fee.`,
    category: 'custom-services',
    displayOrder: 70,
  },
  {
    _id: 'faq-soyl-moments',
    _type: 'faq',
    question: 'How many moments should I choose?',
    answer:
      `You can pick 6, 8, 10, or 12 moments. The number drives both the collage layout AND the animation length, so:\n\n` +
      `• Fewer moments (6–8) = each moment gets more time and visual space. Better for short, punchy stories or where some moments are particularly significant.\n` +
      `• More moments (10–12) = a fuller life arc with quicker pacing. Better for biographical pieces covering many years.\n\n` +
      `For each moment, give us the approximate year and a brief description ("1962 — born in Manchester / 1968 — first day at school / 1979 — wedding day"). One reference photo per moment is ideal, but we can work with what you have. Older or lower-quality photos are fine — we'll enhance them.`,
    category: 'custom-services',
    displayOrder: 71,
  },
  {
    _id: 'faq-soyl-animation-length',
    _type: 'faq',
    question: 'How long are the animated stories?',
    answer:
      `Up to 60 seconds. The exact length depends on how many moments you chose and the pacing you requested — but the final piece will never exceed 60 seconds.\n\n` +
      `For 6 moments at a slow, lingering pace, you'll get close to the full 60 seconds with each moment dwelling on screen. For 12 moments at a snappier pace, the same 60 seconds covers more ground.\n\n` +
      `Length is fixed at 60 seconds maximum because we've found longer pieces start to lose emotional impact and feel like a slideshow rather than a story.`,
    category: 'custom-services',
    displayOrder: 72,
  },
  {
    _id: 'faq-soyl-leave-to-us',
    _type: 'faq',
    question: 'Can I leave the creative decisions to you?',
    answer:
      `Yes — every creative field on the brief has a "Leave it to you" option, and the scene direction and voiceover script are both optional.\n\n` +
      `If you leave things to us, we'll structure the narrative based on your moment brief. The progression of years, the emotional arc, the visual style — it's all there in the photos and the moments you've described. Our job is to bring them together.\n\n` +
      `If you do want to direct things ("dwell on the wedding, hint at the loss in the closing moments, end on the grandchildren"), include it in the scene direction field and we'll honour it.`,
    category: 'custom-services',
    displayOrder: 73,
  },
  {
    _id: 'faq-soyl-photo-quality',
    _type: 'faq',
    question: 'My photos are old and damaged. Will they still work?',
    answer:
      `Yes. We enhance and harmonise every photo before placing it in the collage or animation, so older or lower-quality photos sit naturally alongside newer ones. Fading, scratches, colour casts — all manageable as part of the process.\n\n` +
      `If you have a particularly damaged photo that you want fully restored as a separate deliverable, look at our Past Perfect service — that's purpose-built for full photo restoration with optional colourisation.\n\n` +
      `For Story Of Your Life, just upload what you have. We work with the available material.`,
    category: 'custom-services',
    displayOrder: 74,
  },
];

async function run() {
  if (!process.env.SANITY_TOKEN) {
    console.error('❌ SANITY_TOKEN env var not set.');
    process.exit(1);
  }

  console.log(`📝 Adding ${NEW_FAQS.length} Story Of Your Life FAQs...\n`);

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
