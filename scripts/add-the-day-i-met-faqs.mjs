/**
 * Adds The Day I Met... FAQs.
 *
 * Run once:
 *   cd C:\Users\chris\Projects\pixel8
 *   $env:SANITY_TOKEN = (Get-Content .env | Select-String "^SANITY_TOKEN=").Line -replace "^SANITY_TOKEN=", ""
 *   node scripts/add-the-day-i-met-faqs.mjs
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
    _id: 'faq-tdim-pricing',
    _type: 'faq',
    question: 'How does pricing work for The Day I Met...?',
    answer:
      `Three base options:\n\n` +
      `• Digital still — £19.99. A photorealistic image of the subject "meeting" your chosen celebrity, delivered as a digital file.\n` +
      `• Animation (music) — £79.99. A 30-second animated short with a custom soundtrack. Includes the digital still.\n` +
      `• Animation (music + voiceover) — £99.99. As above, with an AI-generated narrator describing the fictional meeting. Includes the digital still.\n\n` +
      `Want it on the wall? Add prints (poster or canvas) at standard product prices — the £19.99 artwork fee is waived because the artwork is already paid for in the base order.\n\n` +
      `Standalone single print orders include the £19.99 artwork fee.`,
    category: 'custom-services',
    displayOrder: 90,
  },
  {
    _id: 'faq-tdim-content-limits',
    _type: 'faq',
    question: 'What kinds of celebrity meetings won\'t you create?',
    answer:
      `These images are fictional artistic recreations made for entertainment. We will not produce:\n\n` +
      `• Sexual, explicit, or nude content involving any real person\n` +
      `• Content involving celebrity children or any minors\n` +
      `• Defamatory scenarios that could harm the celebrity\'s reputation\n` +
      `• Anything depicting violence or criminal acts\n` +
      `• Content designed to deceive viewers into believing the encounter actually happened\n` +
      `• Content involving deceased public figures in distressing or undignified contexts\n` +
      `• Fake endorsements presented as real\n\n` +
      `Before placing your order you\'ll be asked to confirm the image is for personal entertainment only. We review every commission and reserve the right to refuse — if your concept crosses a line, we\'ll get in touch to discuss before processing, and offer a refund if it can\'t go ahead.`,
    category: 'custom-services',
    displayOrder: 91,
  },
  {
    _id: 'faq-tdim-voice-policy',
    _type: 'faq',
    question: 'Will the celebrity actually "speak" in the animation?',
    answer:
      `No. If you choose the voiceover option (£99.99), you get an AI-generated NARRATOR describing the fictional meeting in third person — not the celebrity\'s own voice.\n\n` +
      `Why? Voice rights are an active legal area. Major celebrities have voice protections that are enforced — we won\'t put words in their mouths, even fictionally.\n\n` +
      `The narrator can be a documentary voice, news anchor, sports commentator, movie trailer voice, storyteller, or reality TV narrator. Or describe a custom voice in the notes. The result feels like a "behind-the-scenes" or "this happened" framing without claiming the celebrity said anything.`,
    category: 'custom-services',
    displayOrder: 92,
  },
  {
    _id: 'faq-tdim-animation-process',
    _type: 'faq',
    question: 'How does the animated version work?',
    answer:
      `Your 30-second animated short brings the still meeting to life with cinematic motion — character animation, camera moves, environmental detail (lights, crowd reactions, atmosphere).\n\n` +
      `In the brief you can direct the scene action, mood, camera, pacing, and music genre — or leave any of those to us. We custom-generate the soundtrack for each piece, so you won\'t get a stock track.\n\n` +
      `What animation can do beautifully: sell the realism of the encounter, capture the energy of the meeting, and create something that genuinely feels cinematic.\n\n` +
      `What it can\'t do: lip-sync the narrator\'s voice to the celebrity\'s mouth (we cut away during dialogue), recreate copyrighted scenes from real films, or generate hours of footage. The 30-second runtime is the right length for a memorable moment.`,
    category: 'custom-services',
    displayOrder: 93,
  },
  {
    _id: 'faq-tdim-source-photo',
    _type: 'faq',
    question: 'What kind of photo should I upload?',
    answer:
      `The better your source photo, the more convincing the meeting. Aim for:\n\n` +
      `• Clear, well-lit, in focus — no blur or extreme shadows\n` +
      `• Facing the camera (or three-quarter angle works) — full profile shots are harder\n` +
      `• Full or half-body if you want a full standing shot in the scene\n` +
      `• Higher resolution wherever possible — phone snaps in good light usually work\n\n` +
      `Background doesn\'t matter — we replace it entirely with the chosen "meeting" scene. Clothing IS preserved in the final image, so if you\'d prefer to look different (smarter, more casual, etc.), include that direction in your notes and use a photo of yourself in that style.`,
    category: 'custom-services',
    displayOrder: 94,
  },
];

async function run() {
  if (!process.env.SANITY_TOKEN) {
    console.error('❌ SANITY_TOKEN env var not set.');
    process.exit(1);
  }

  console.log(`📝 Adding ${NEW_FAQS.length} The Day I Met... FAQs...\n`);

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
