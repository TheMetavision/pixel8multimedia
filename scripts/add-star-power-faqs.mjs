/**
 * Adds Star Power FAQs.
 *
 * Run once:
 *   cd C:\Users\chris\Projects\pixel8
 *   $env:SANITY_TOKEN = (Get-Content .env | Select-String "^SANITY_TOKEN=").Line -replace "^SANITY_TOKEN=", ""
 *   node scripts/add-star-power-faqs.mjs
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
    _id: 'faq-sp-pricing',
    _type: 'faq',
    question: 'How does pricing work for Star Power?',
    answer:
      `Two ways to order:\n\n` +
      `• **Digital still** — £14.99. Your cinematic movie-poster artwork delivered as a high-resolution digital file, ready to print yourself or share digitally.\n\n` +
      `• **Single Print** — from £14.99. Choose poster or canvas in your preferred size. Includes the £5 artwork fee.\n\n` +
      `• **Bundle (digital + prints)** — from £24.98. Get the digital file plus any number of prints. The £5 artwork fee is waived on every print.\n\n` +
      `Standalone single print orders include the £5 artwork fee. Bundle orders waive that fee per print.`,
    category: 'custom-services',
    displayOrder: 120,
  },
  {
    _id: 'faq-sp-format',
    _type: 'faq',
    question: 'What does the final artwork look like?',
    answer:
      `Star Power outputs are designed as **portrait-orientation movie posters** — taller than they are wide, mimicking the classic cinema poster ratio.\n\n` +
      `Available print sizes:\n` +
      `• Small — 8×12"\n` +
      `• Medium — 12×18"\n` +
      `• Large — 18×24"\n\n` +
      `Each poster includes dramatic lighting, an epic backdrop, a stylised title treatment (with your chosen title or one we invent), and your subject placed front and centre as the star. Think real cinema poster aesthetic — not a photograph in a frame.`,
    category: 'custom-services',
    displayOrder: 121,
  },
  {
    _id: 'faq-sp-styles',
    _type: 'faq',
    question: 'What poster styles can I choose from?',
    answer:
      `Ten styles to choose from, or leave the decision to us:\n\n` +
      `• **Action / blockbuster** — bold colour, explosive backdrops, dynamic poses\n` +
      `• **Animation / family** — bright, playful, Pixar/DreamWorks-inspired\n` +
      `• **Fantasy / epic** — magical landscapes, sword-and-sorcery vibes\n` +
      `• **Adventure / exploration** — Indiana Jones territory, treasure-map energy\n` +
      `• **Sci-fi / futuristic** — neon, technology, otherworldly atmosphere\n` +
      `• **Horror / thriller** — moody, atmospheric, suspense-driven (still family-friendly)\n` +
      `• **Comedy / feel-good** — light-hearted, warm tones, funny posing\n` +
      `• **Drama / classic** — restrained palette, serious cinema gravitas\n` +
      `• **Sports / inspirational** — triumphant, motion-driven, underdog energy\n` +
      `• **Romance / period piece** — elegant, soft lighting, classic film aesthetic\n\n` +
      `You can also optionally name a specific film or TV show as a visual reference. We work from a huge library of mainstream titles — if you\'ve picked something obscure we\'ll discuss alternatives.`,
    category: 'custom-services',
    displayOrder: 122,
  },
  {
    _id: 'faq-sp-title',
    _type: 'faq',
    question: 'Can I choose the title on the poster?',
    answer:
      `Yes. The brief includes an optional "Poster title / tagline" field where you can suggest:\n\n` +
      `• A specific title: "JAKE: THE LEGEND", "BRUNO — ROGUE AGENT", "EMMA & THE LOST KINGDOM"\n` +
      `• Just the subject\'s name and we\'ll craft the surrounding treatment\n` +
      `• A tagline alongside the title: "One dog. One quest. Many treats."\n\n` +
      `Or leave it blank entirely — we\'ll invent something fitting based on your subject\'s name, the role, and the chosen style.`,
    category: 'custom-services',
    displayOrder: 123,
  },
  {
    _id: 'faq-sp-source-photo',
    _type: 'faq',
    question: 'What kind of photo should I upload?',
    answer:
      `The clearer your source photo, the better your final poster. Aim for:\n\n` +
      `• Clear, well-lit, in focus — no blur or extreme shadows\n` +
      `• Facing the camera (or three-quarter angle works)\n` +
      `• Higher resolution wherever possible — phone snaps in good light work fine\n` +
      `• Plain background helps but isn\'t essential — we replace the background entirely\n\n` +
      `For pets: a head-on shot showing their face clearly works best. For kids: any good portrait. For groups: include a note about which person should be the lead.\n\n` +
      `Have multiple options? Upload your favourite and mention in the notes that you can send more if needed.`,
    category: 'custom-services',
    displayOrder: 124,
  },
  {
    _id: 'faq-sp-gift',
    _type: 'faq',
    question: 'Is Star Power good for a gift?',
    answer:
      `Yes — it\'s one of the most popular gift commissions we do. Common scenarios:\n\n` +
      `• Birthday gift for a film-loving child — turn them into the lead of their favourite genre\n` +
      `• Pet portrait with personality — your dog as an action hero, your cat as a Bond villain\n` +
      `• Father\'s Day / Mother\'s Day — parent as the hero of their own blockbuster\n` +
      `• Anniversary gift — couple as a romantic-drama poster\n` +
      `• Retirement / leaving gift — colleague immortalised as the star of their career\n\n` +
      `Bundle the digital file with a framed poster or canvas print for an unforgettable wrapped gift. The digital file is great for sharing or framing yourself; the print arrives ready to hang.`,
    category: 'custom-services',
    displayOrder: 125,
  },
];

async function run() {
  if (!process.env.SANITY_TOKEN) {
    console.error('❌ SANITY_TOKEN env var not set.');
    process.exit(1);
  }

  console.log(`📝 Adding ${NEW_FAQS.length} Star Power FAQs...\n`);

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
