/**
 * Adds Back in Time FAQs.
 *
 * Run once:
 *   cd C:\Users\chris\Projects\pixel8
 *   $env:SANITY_TOKEN = (Get-Content .env | Select-String "^SANITY_TOKEN=").Line -replace "^SANITY_TOKEN=", ""
 *   node scripts/add-back-in-time-faqs.mjs
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
    _id: 'faq-bit-collections',
    _type: 'faq',
    question: 'What are the two collections?',
    answer:
      `Back in Time offers two distinct era collections — you can buy either or both:\n\n` +
      `**Modern Decades** — six recent decades:\n` +
      `• 1950s — Post-war glamour, full skirts, soft colour palette\n` +
      `• 1960s — Mod fashion, bold patterns, bright pop colours\n` +
      `• 1970s — Disco glam, earthy tones, wide collars and flares\n` +
      `• 1980s — Neon, big hair, statement shoulders, MTV gloss\n` +
      `• 1990s — Grunge meets minimalism, film-grain colour cast\n` +
      `• 2000s — Low-rise denim, frosted tips, early-digital photography\n\n` +
      `**Historical Periods** — six classic eras:\n` +
      `• Roman — Togas, laurel wreaths, Roman empire grandeur (~AD 100)\n` +
      `• Medieval — Knights, courtly robes, castle settings (~1300s)\n` +
      `• Renaissance — Oil-painting portrait look (~1500s)\n` +
      `• Georgian — Regency-era empire-waist gowns, cravats (~1810s)\n` +
      `• Victorian — High collars, sepia photography (1837-1901)\n` +
      `• Edwardian — Titanic-era elegance (1901-1910)`,
    category: 'custom-services',
    displayOrder: 100,
  },
  {
    _id: 'faq-bit-pricing',
    _type: 'faq',
    question: 'How does pricing work for Back in Time?',
    answer:
      `Three digital options:\n\n` +
      `• **Modern Decades** — £14.99. All 6 modern era variants delivered as separate digital files.\n` +
      `• **Historical Periods** — £14.99. All 6 historical era variants delivered as separate digital files.\n` +
      `• **Both Collections** — £24.99. All 12 era variants. Saves £4.99 vs buying separately.\n\n` +
      `Want any era on your wall? Add prints (poster or canvas) at standard product prices — the £5 artwork fee is waived per print when you bundle with a digital collection.\n\n` +
      `Just want one era as a print? **Single Print** orders include the £5 artwork fee (from £14.99 total).`,
    category: 'custom-services',
    displayOrder: 101,
  },
  {
    _id: 'faq-bit-process',
    _type: 'faq',
    question: 'How does Back in Time actually work?',
    answer:
      `You upload one clear photo of your subject. We use that photo to generate era-appropriate versions of the same person — preserving their likeness while updating the fashion, hair, lighting, colour palette, and even the photographic style to match each era.\n\n` +
      `For example, your Victorian portrait will look like a genuine 1880s studio photograph (sepia, formal posing, period clothing). Your 1980s version will pop with neon, big hair, and that distinctive MTV-era colour grade.\n\n` +
      `The subject of the photo stays recognisably them — only the time period changes.`,
    category: 'custom-services',
    displayOrder: 102,
  },
  {
    _id: 'faq-bit-source-photo',
    _type: 'faq',
    question: 'What kind of photo should I upload?',
    answer:
      `The clearer your source photo, the better each era variant. Aim for:\n\n` +
      `• Clear, well-lit, in focus — no blur or extreme shadows\n` +
      `• Facing the camera (or three-quarter angle works)\n` +
      `• Plain or simple background ideally — we restyle the whole scene anyway, but cleaner inputs = cleaner outputs\n` +
      `• Higher resolution wherever possible — phone snaps in good light work fine\n` +
      `• Multiple people OK — just include a note about whether you want them all styled the same era or differently`,
    category: 'custom-services',
    displayOrder: 103,
  },
  {
    _id: 'faq-bit-prints-mixed',
    _type: 'faq',
    question: 'Can I order prints of eras from both collections?',
    answer:
      `Yes. If you choose the **Both Collections + Prints** bundle path, you can pick any era from either collection for each print you add. Want your Victorian portrait as a canvas AND your 1970s version as a poster? No problem.\n\n` +
      `If you choose the Single Print path, you can also pick any era from either collection for that one print — the £5 artwork fee applies because you haven\'t paid for a digital bundle.`,
    category: 'custom-services',
    displayOrder: 104,
  },
];

async function run() {
  if (!process.env.SANITY_TOKEN) {
    console.error('❌ SANITY_TOKEN env var not set.');
    process.exit(1);
  }

  console.log(`📝 Adding ${NEW_FAQS.length} Back in Time FAQs...\n`);

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
