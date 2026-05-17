/**
 * Adds Your Song Your Story FAQs covering pricing structure, song production,
 * lyrics print process, and file delivery.
 *
 * Run once:
 *   cd C:\Users\chris\Projects\pixel8
 *   $env:SANITY_TOKEN = (Get-Content .env | Select-String "^SANITY_TOKEN=").Line -replace "^SANITY_TOKEN=", ""
 *   node scripts/add-your-song-your-story-faqs.mjs
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
    _id: 'faq-ysys-pricing',
    _type: 'faq',
    question: 'How does pricing work for Your Song Your Story?',
    answer:
      `The song and the printed lyrics piece are two separate products:\n\n` +
      `• Custom song — £19.99. We generate a custom song in your chosen genre and deliver it as a high-quality MP3 and WAV file via secure download link.\n\n` +
      `• Lyrics print — £10 artwork fee + print product price. We lay your song title and lyrics over a photo of your choice and print it on poster or canvas in three sizes.\n\n` +
      `The £10 artwork fee is a ONE-TIME charge per order — if you want the same lyrics layout printed at multiple sizes (e.g. small poster for the desk, large canvas for the wall), the artwork fee is still only charged once.\n\n` +
      `Unlike some of our other services, ordering the song and a print at the same time does NOT waive the £10 artwork fee. The song production and the print artwork are different processes — both have real cost behind them.`,
    category: 'custom-services',
    displayOrder: 40,
  },
  {
    _id: 'faq-ysys-song-process',
    _type: 'faq',
    question: 'How is the song created?',
    answer:
      `You tell us who the song is about and what should be referenced — names, dates, milestones, places, inside jokes, the emotional arc. The more specific your brief, the more personal the song.\n\n` +
      `You also pick a music genre (pop, rock, acoustic, country, rap and more — anything goes) and decide whether you want to provide a song title or leave that to us.\n\n` +
      `We then write custom lyrics built around your brief and produce the track in your chosen style. The finished song is delivered as MP3 + WAV via a secure download link — typically within 5-7 working days.`,
    category: 'custom-services',
    displayOrder: 41,
  },
  {
    _id: 'faq-ysys-print-process',
    _type: 'faq',
    question: 'How does the lyrics print work?',
    answer:
      `If you add a print to your order, you upload a photo as the background — a portrait, a landscape, a meaningful place, the recipient — anything you like. We then lay the song title and full lyrics over the top with typography that complements the photo.\n\n` +
      `Higher-resolution photos make for better prints. Both portrait and landscape photos work — we fit the layout to whichever print size you choose.\n\n` +
      `Prints are available in three sizes (12×8, 16×12, 24×16) and three finishes (poster, canvas standard, canvas gallery). All sizes share the same lyrics layout — so if you want the same piece on the wall AND on a desk, you only pay the £10 artwork fee once.`,
    category: 'custom-services',
    displayOrder: 42,
  },
  {
    _id: 'faq-ysys-file-formats',
    _type: 'faq',
    question: 'What file formats do I get for the song?',
    answer:
      `We deliver both MP3 (compressed, ~10MB, universally compatible) and WAV (uncompressed, ~30-50MB, broadcast-quality audio). If you only want one, pick it in the brief.\n\n` +
      `Files are sent via a secure download link rather than email attachment. The link stays active for 30 days after delivery — download the files to your own storage to keep them.`,
    category: 'custom-services',
    displayOrder: 43,
  },
];

async function run() {
  if (!process.env.SANITY_TOKEN) {
    console.error('❌ SANITY_TOKEN env var not set.');
    process.exit(1);
  }

  console.log(`📝 Adding ${NEW_FAQS.length} Your Song Your Story FAQs...\n`);

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
