/**
 * Adds Scene Stealer FAQs.
 *
 * Run once:
 *   cd C:\Users\chris\Projects\pixel8
 *   $env:SANITY_TOKEN = (Get-Content .env | Select-String "^SANITY_TOKEN=").Line -replace "^SANITY_TOKEN=", ""
 *   node scripts/add-scene-stealer-faqs.mjs
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
    _id: 'faq-ss-pricing',
    _type: 'faq',
    question: 'How does pricing work for Scene Stealer?',
    answer:
      `Three base options:\n\n` +
      `• Digital still — £19.99. A photorealistic image of you as your chosen character in the film, delivered as a digital file.\n` +
      `• Animation (music) — £79.99. A 30-second animated short featuring you across a range of scenes from the chosen film, with a custom soundtrack. Includes the digital still.\n` +
      `• Animation (music + voiceover) — £99.99. As above, with an AI-generated narrator. Includes the digital still.\n\n` +
      `Want it on your wall? Add prints (poster or canvas) at standard product prices — the £19.99 artwork fee is waived because the artwork is already paid for in the base order.\n\n` +
      `Standalone single print orders include the £19.99 artwork fee.`,
    category: 'custom-services',
    displayOrder: 110,
  },
  {
    _id: 'faq-ss-film-library',
    _type: 'faq',
    question: 'Which films can I choose from?',
    answer:
      `We work from a huge library of mainstream and well-known films across all eras — Hollywood classics, modern blockbusters, cult favourites, sci-fi, action, romance, comedy, drama. If it\'s a film you\'ve heard of, there\'s a strong chance we can recreate it.\n\n` +
      `**More obscure choices** — independent films, very recent releases not yet widely distributed, foreign-language films with limited international release, or extremely niche titles — may not be in our library. If you\'ve picked something we can\'t recreate, we\'ll get in touch before processing and offer a full refund.\n\n` +
      `If you\'re unsure whether your chosen film will work, drop us a note in the brief or contact us before ordering.`,
    category: 'custom-services',
    displayOrder: 111,
  },
  {
    _id: 'faq-ss-multiple-scenes',
    _type: 'faq',
    question: 'Do I just get one scene, or multiple?',
    answer:
      `For the **digital still** (£19.99) you receive a single hero image of you as your chosen character in the film\'s most iconic moment.\n\n` +
      `For the **animation versions** (£79.99 and £99.99), your 30-second sequence features you across a RANGE of scenes from the chosen film — typically 3–5 different moments stitched together cinematically. We pick the most recognisable, visually striking beats unless you direct us otherwise in the brief.\n\n` +
      `So animation gives you genuine breadth across the film, not just one moment in motion.`,
    category: 'custom-services',
    displayOrder: 112,
  },
  {
    _id: 'faq-ss-content-limits',
    _type: 'faq',
    question: 'What scenes won\'t you recreate?',
    answer:
      `These images are fictional artistic recreations made for personal entertainment. We will not produce:\n\n` +
      `• Sexual, explicit, or nude scenes (regardless of how they appear in the original film)\n` +
      `• Scenes depicting graphic violence in detail\n` +
      `• Scenes involving minors in adult roles, sexualised contexts, or distressing situations\n` +
      `• Content from films where the IP holder is known to be actively litigious about AI recreations\n` +
      `• Content designed to deceive viewers into believing it\'s official film material\n` +
      `• Photorealistic likenesses of you AS a specific named actor (we depict you as the character, not as the actor in their exact likeness)\n\n` +
      `Before placing your order you\'ll be asked to confirm the image is for personal entertainment only. We review every commission and reserve the right to refuse — if your concept crosses a line, we\'ll get in touch to discuss before processing, and offer a refund if it can\'t go ahead.`,
    category: 'custom-services',
    displayOrder: 113,
  },
  {
    _id: 'faq-ss-voice-policy',
    _type: 'faq',
    question: 'Will the original actors\' voices be in the animation?',
    answer:
      `No. If you choose the voiceover option (£99.99), you get an AI-generated NARRATOR describing the scene in third person — like a movie trailer or behind-the-scenes feature. We do NOT impersonate the original actors\' voices.\n\n` +
      `Voice rights are an active legal area. Major actors have voice protections that are enforced. So you\'ll get a polished narrator — movie trailer voice, documentary narrator, behind-the-scenes presenter, etc. — but not Mark Hamill, not Michael J. Fox, not Olivia Newton-John.\n\n` +
      `Similarly, we can\'t use the original film score in the soundtrack. We generate a custom track that matches the vibe of your chosen scene.`,
    category: 'custom-services',
    displayOrder: 114,
  },
  {
    _id: 'faq-ss-character-choice',
    _type: 'faq',
    question: 'Which character should I pick?',
    answer:
      `You can pick any major or recognisable character from your chosen film. Common picks:\n\n` +
      `• The lead character (most popular — you become the hero/heroine of the story)\n` +
      `• The villain (great for action films)\n` +
      `• A supporting role you connect with personally\n` +
      `• An iconic minor character with memorable screen time\n\n` +
      `The character determines what costume, makeup, posing, and which scenes from the film we feature. If you pick a character who only appears briefly, we\'ll work within that — let us know in the brief if you\'d prefer broader scene coverage even with a minor character.\n\n` +
      `Be specific: "Marty McFly" rather than "the main guy", "Princess Leia in the white gown" rather than "Princess Leia" if you want a specific look.`,
    category: 'custom-services',
    displayOrder: 115,
  },
  {
    _id: 'faq-ss-source-photo',
    _type: 'faq',
    question: 'What kind of photo should I upload?',
    answer:
      `The clearer your source photo, the more convincing the result. Aim for:\n\n` +
      `• Clear, well-lit, in focus — no blur or extreme shadows\n` +
      `• Facing the camera (or three-quarter angle works)\n` +
      `• Full or half body if you want a full-shot final image\n` +
      `• Higher resolution wherever possible — phone snaps in good light usually work\n\n` +
      `Background and current clothing don\'t matter — we replace those entirely with the chosen scene and character costume. The key thing is that your face is clear.`,
    category: 'custom-services',
    displayOrder: 116,
  },
];

async function run() {
  if (!process.env.SANITY_TOKEN) {
    console.error('❌ SANITY_TOKEN env var not set.');
    process.exit(1);
  }

  console.log(`📝 Adding ${NEW_FAQS.length} Scene Stealer FAQs...\n`);

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
