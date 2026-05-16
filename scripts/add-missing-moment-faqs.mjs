/**
 * Adds Missing Moment FAQs covering pricing model, animation process,
 * voiceover handling, and bundle savings.
 *
 * Run once:
 *   cd C:\Users\chris\Projects\pixel8
 *   $env:SANITY_TOKEN = (Get-Content .env | Select-String "^SANITY_TOKEN=").Line -replace "^SANITY_TOKEN=", ""
 *   node scripts/add-missing-moment-faqs.mjs
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
    _id: 'faq-mm-pricing-overview',
    _type: 'faq',
    question: 'How does pricing work for The Missing Moment?',
    answer:
      `There are three base options:\n\n` +
      `• Digital still — £19.99. We composite the missing person into your original photo and deliver the digital file.\n` +
      `• Animation (music) — £79.99. The same composited image, animated into a 30-second short with a custom soundtrack. Includes the digital still.\n` +
      `• Animation (music + voiceover) — £99.99. As above, but with an AI-generated voiceover from a script you provide. Includes the digital still.\n\n` +
      `You can add physical prints to any of these orders. Prints are charged at our product price only — the £19.99 artwork creation fee is waived because you've already paid for it in the base order.\n\n` +
      `If you want just a print without any digital or animation order, the artwork fee is added on top of the print price.`,
    category: 'custom-services',
    displayOrder: 30,
  },
  {
    _id: 'faq-mm-artwork-fee',
    _type: 'faq',
    question: "What's the £19.99 artwork fee for?",
    answer:
      `The artwork fee covers the work of creating the missing-moment composite — researching reference photos, matching lighting and scale, blending the new person seamlessly into the original photo, and handling the back-and-forth on getting the likeness right.\n\n` +
      `It's charged once per order, not per print. If you're buying the Digital Still (£19.99) or Animation (£79.99/£99.99), the artwork fee is already covered by that base price — so any prints you add to the same order are charged at our standard product price only.\n\n` +
      `If you're buying a print ONLY (no digital, no animation), the £19.99 artwork fee is added on top of the print product price.`,
    category: 'custom-services',
    displayOrder: 31,
  },
  {
    _id: 'faq-mm-animation-process',
    _type: 'faq',
    question: 'How do the animated films work?',
    answer:
      `Your 30-second animated short uses your finished "missing moment" composite as its starting point, then adds subtle cinematic motion — gentle character animation, slow camera moves, soft environmental effects (snow, light shifts, ambient movement).\n\n` +
      `In your brief you tell us what should happen in those 30 seconds, the mood, pacing, camera movement preference, and the music genre. We custom-generate the soundtrack for each piece — you won't get a stock track from a library, and you can't request a specific copyrighted song.\n\n` +
      `What animation can do beautifully: emotionally resonant, slow-paced moments where the missing person becomes part of the scene.\n\n` +
      `What it can't do: lip-syncing voiceover to character mouths, realistic full-body action, or complex multi-person interactions beyond a brief moment. Set your expectations toward cinematic memory rather than feature-film animation.`,
    category: 'custom-services',
    displayOrder: 32,
  },
  {
    _id: 'faq-mm-voiceover',
    _type: 'faq',
    question: 'How do voiceovers work in the animation?',
    answer:
      `If you choose the Animation with Voiceover option (£99.99), you'll provide a written script — usually around 80 words for a 30-second piece. You also pick the voice characteristics (warm female, older male, etc.) and accent (British RP, Northern, American, Australian, and more).\n\n` +
      `We then generate the voiceover using a high-quality AI voice service. The voiceover is mixed with the music and timed against the animation so it feels natural — though we don't lip-sync to character mouths.\n\n` +
      `If you have very specific direction (a particular pause, emphasis, or tone shift), include it in the voiceover notes field — we'll do our best to match it. We currently don't offer customer-recorded voiceovers or human voice actors.`,
    category: 'custom-services',
    displayOrder: 33,
  },
];

async function run() {
  if (!process.env.SANITY_TOKEN) {
    console.error('❌ SANITY_TOKEN env var not set.');
    process.exit(1);
  }

  console.log(`📝 Adding ${NEW_FAQS.length} Missing Moment FAQs...\n`);

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
