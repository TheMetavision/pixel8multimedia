/**
 * Adds Prankz! FAQs.
 *
 * Run once:
 *   cd C:\Users\chris\Projects\pixel8
 *   $env:SANITY_TOKEN = (Get-Content .env | Select-String "^SANITY_TOKEN=").Line -replace "^SANITY_TOKEN=", ""
 *   node scripts/add-prankz-faqs.mjs
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
    _id: 'faq-prz-pricing',
    _type: 'faq',
    question: 'How does pricing work for Prankz?',
    answer:
      `Three base options:\n\n` +
      `• Digital still — £19.99. A photorealistic fake image delivered as a digital file.\n` +
      `• Animation (music) — £79.99. A 30-second animated short with a custom soundtrack. Includes the digital still.\n` +
      `• Animation (music + voiceover) — £99.99. As above, with an AI-generated voiceover. Includes the digital still.\n\n` +
      `Want a physical version? Add prints (poster or canvas) at standard product prices — the £19.99 artwork fee is waived because the artwork is already paid for in the base order.\n\n` +
      `Standalone single print orders include the £19.99 artwork fee.`,
    category: 'custom-services',
    displayOrder: 80,
  },
  {
    _id: 'faq-prz-content-limits',
    _type: 'faq',
    question: 'What kinds of pranks won\'t you do?',
    answer:
      `We make harmless, reversible, prank-safe content. We won\'t produce:\n\n` +
      `• Sexual, explicit, or nude content of any kind\n` +
      `• Content that depicts violence against the subject\n` +
      `• Defamatory scenarios involving real public figures (politicians, celebrities, etc.) used in ways that could harm their reputation\n` +
      `• Content depicting criminal acts\n` +
      `• Targeted harassment material — if it reads as bullying rather than a prank, we\'ll decline\n` +
      `• Anything involving minors in compromising scenarios\n` +
      `• Recreations of trademarked or copyrighted scenes\n\n` +
      `Before placing your order you\'ll be asked to confirm the prank is harmless and that you have the subject\'s photo legitimately. We review every commission and reserve the right to refuse — if your concept crosses a line, we\'ll get in touch to discuss before processing, and offer a refund if it can\'t go ahead.`,
    category: 'custom-services',
    displayOrder: 81,
  },
  {
    _id: 'faq-prz-animation-process',
    _type: 'faq',
    question: 'How does the animated prank work?',
    answer:
      `Your 30-second animated short turns the still prank into a moving sequence — typically a setup, an escalation, and a reveal that builds to the punchline.\n\n` +
      `In the brief you can direct the scene action, mood, camera, pacing, and music style — or leave any of those to us. We custom-generate the soundtrack for each piece, so you won\'t get a stock track.\n\n` +
      `What animation can do beautifully: build the comic timing, sell the realism of the absurd scenario, deliver the reveal with cinematic weight.\n\n` +
      `What it can\'t do: lip-sync voiceover to the victim\'s mouth (the camera will cut away during dialogue), complex multi-character interactions, or recreate copyrighted media.`,
    category: 'custom-services',
    displayOrder: 82,
  },
  {
    _id: 'faq-prz-voiceover',
    _type: 'faq',
    question: 'How do voiceovers work in the animation?',
    answer:
      `If you choose Animation with Voiceover (£99.99), you have two options for the script:\n\n` +
      `• Write it yourself — around 80 words for 30 seconds.\n` +
      `• Leave it to us — we\'ll write a script that suits the scenario and tone.\n\n` +
      `You pick the voice character (news anchor, documentary narrator, sports commentator, reality TV narrator, old movie newsreel announcer, custom) and accent. Or leave both to us.\n\n` +
      `We use AI voice generation. The voiceover is mixed with the music and timed against the animation, but we don\'t lip-sync to character mouths.`,
    category: 'custom-services',
    displayOrder: 83,
  },
  {
    _id: 'faq-prz-source-photo',
    _type: 'faq',
    question: 'What kind of photo should I upload of the victim?',
    answer:
      `The better the photo, the better the prank. Aim for:\n\n` +
      `• Clear, well-lit, in focus — no blur or extreme shadows\n` +
      `• Front-facing or three-quarter angle — full-profile shots are harder to work with\n` +
      `• Higher resolution wherever possible — phone snaps in good light usually work\n` +
      `• Multiple photos can help if you have them — include alternate angles in the notes\n\n` +
      `You must have the photo legitimately — photos shared with you by the subject, group chat snaps, social media photos of people you actually know. We\'re making a prank for a friend, not a deepfake of a stranger.`,
    category: 'custom-services',
    displayOrder: 84,
  },
];

async function run() {
  if (!process.env.SANITY_TOKEN) {
    console.error('❌ SANITY_TOKEN env var not set.');
    process.exit(1);
  }

  console.log(`📝 Adding ${NEW_FAQS.length} Prankz! FAQs...\n`);

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
