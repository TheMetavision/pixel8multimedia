/**
 * Adds Crayon To Creation FAQs.
 *
 * Run once:
 *   cd C:\Users\chris\Projects\pixel8
 *   $env:SANITY_TOKEN = (Get-Content .env | Select-String "^SANITY_TOKEN=").Line -replace "^SANITY_TOKEN=", ""
 *   node scripts/add-crayon-to-creation-faqs.mjs
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
    _id: 'faq-c2c-pricing',
    _type: 'faq',
    question: 'How does pricing work for Crayon To Creation?',
    answer:
      `Three base options to choose from:\n\n` +
      `• Digital still — £19.99. We transform the drawing into a cinematic 3D character in their own scene and deliver the digital file.\n` +
      `• Animation (music) — £79.99. A 30-second animated short with a custom soundtrack. Includes the digital still.\n` +
      `• Animation (music + voiceover) — £99.99. As above, with an AI-generated voiceover. Includes the digital still.\n\n` +
      `Want a physical version? Add prints (poster or canvas) to any of these orders. Prints are charged at our standard product prices — the £19.99 artwork fee is waived because the artwork is already paid for in the base order.\n\n` +
      `Standalone single print orders (no digital, no animation) include the £19.99 artwork fee.`,
    category: 'custom-services',
    displayOrder: 60,
  },
  {
    _id: 'faq-c2c-leave-to-us',
    _type: 'faq',
    question: 'I don\'t know what scene, music or voice to pick — what happens?',
    answer:
      `Every creative field on the brief has a "Leave it to you" option, and the scene description and voiceover script are both completely optional.\n\n` +
      `If you leave things to us, we'll bring the drawing to life based on what your child has put on the page. The character's personality, the colour palette, the energy — it's all there to read. Our job is to scale it up.\n\n` +
      `If you do want to direct things — "the dragon flies over the castle and breathes blue fire, with epic orchestral music" — we'll honour your direction precisely. Both routes get the same level of care.`,
    category: 'custom-services',
    displayOrder: 61,
  },
  {
    _id: 'faq-c2c-animation-process',
    _type: 'faq',
    question: 'How does the animated film work?',
    answer:
      `Your 30-second animated short uses your finished 3D character in their scene, then adds subtle cinematic motion — character animation, camera moves, environmental effects (light shifts, weather, atmosphere).\n\n` +
      `In the brief you can direct the scene action, mood, camera movement, pacing, and music genre — or leave any of those to us. We custom-generate the soundtrack for each piece — you won't get a stock track from a library, and you can't request a specific copyrighted song.\n\n` +
      `What animation can do beautifully: bring the character to life in their own world with cinematic motion and atmosphere.\n\n` +
      `What it can't do: lip-sync voiceover to character mouths, full feature-film-quality action sequences, or complex multi-character choreography. Set expectations toward "magical short" rather than Pixar.`,
    category: 'custom-services',
    displayOrder: 62,
  },
  {
    _id: 'faq-c2c-voiceover',
    _type: 'faq',
    question: 'How do voiceovers work in the animation?',
    answer:
      `If you choose Animation with Voiceover (£99.99), you have two options for the script:\n\n` +
      `• Write it yourself — around 80 words for a 30-second piece, in your own voice.\n` +
      `• Leave it to us — we'll write a script that fits the drawing and the scene. Magical, narrated, child-friendly.\n\n` +
      `You pick the voice characteristics (warm female, young man, child narrator, custom — and more) and accent (British RP, Northern, American, Australian, others). Or leave both to us.\n\n` +
      `We use AI voice generation. The voiceover is mixed with the music and timed against the animation — but we don't lip-sync to character mouths.\n\n` +
      `If you have very specific direction (a particular pause, emphasis, or tone shift), include it in the voiceover notes — we'll do our best to match it.`,
    category: 'custom-services',
    displayOrder: 63,
  },
  {
    _id: 'faq-c2c-source-drawing',
    _type: 'faq',
    question: 'What kind of drawing should I upload?',
    answer:
      `Almost any drawing works — pencil, crayon, pen, paint, finger-painting, you name it. The key is getting a clear photo:\n\n` +
      `• Lay the drawing flat in good daylight\n` +
      `• Avoid shadows, glare, or your phone's flash\n` +
      `• Shoot straight down from above\n` +
      `• Get as close as you can while keeping the whole drawing in frame\n\n` +
      `A flatbed scan is the gold standard if you have one. Multiple drawings of the same character help us understand the personality better — feel free to mention it in the notes if you have others on file.`,
    category: 'custom-services',
    displayOrder: 64,
  },
];

async function run() {
  if (!process.env.SANITY_TOKEN) {
    console.error('❌ SANITY_TOKEN env var not set.');
    process.exit(1);
  }

  console.log(`📝 Adding ${NEW_FAQS.length} Crayon To Creation FAQs...\n`);

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
