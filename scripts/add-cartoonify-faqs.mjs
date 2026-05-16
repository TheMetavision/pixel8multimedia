/**
 * Add three FAQs explaining the new Cartoonify Me pricing model.
 * These belong in the custom-services category.
 *
 * Run once:
 *   cd C:\Users\chris\Projects\pixel8
 *   $env:SANITY_TOKEN = (Get-Content .env | Select-String "^SANITY_TOKEN=").Line -replace "^SANITY_TOKEN=", ""
 *   node scripts/add-cartoonify-faqs.mjs
 *
 * Idempotent — uses deterministic IDs so re-runs are no-ops via createOrReplace.
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
    _id: 'faq-cartoonify-digital-vs-print',
    _type: 'faq',
    question: "What's the difference between the digital bundle and a single print?",
    answer:
      `The digital bundle gives you the digital file in every available style — for Cartoonify Me, that's all seven (Simpsons, Rick & Morty, South Park, Anime, 3D Pixar, Steampunk, Cyberpunk). It's a flat £14.99 and there's no physical product.\n\n` +
      `A single print is one physical poster or canvas in one chosen style, delivered to your address. The digital file for that one style is included. The price is the shop product price plus a £5 artwork creation fee.\n\n` +
      `Most people who want a print get better value with the bundle option — see below.`,
    category: 'custom-services',
    displayOrder: 20,
  },
  {
    _id: 'faq-cartoonify-bundle-savings',
    _type: 'faq',
    question: 'Why is the bundle cheaper than buying separately?',
    answer:
      `When you order a print, the £5 artwork creation fee covers the work of making the digital file in your chosen style. If you've already paid for the digital bundle, that fee is already covered — so it's waived on every print you order in the same checkout.\n\n` +
      `Example: a single Poster Print Small standalone costs £14.99 (£9.99 product + £5 artwork). With the digital bundle, the same print costs £9.99 because the artwork fee is waived. So the bundle (£14.99) plus that print (£9.99) totals £24.98 — versus £29.98 if you bought them separately.\n\n` +
      `The savings stack. Order three prints with the bundle and you've saved £15 in artwork fees.`,
    category: 'custom-services',
    displayOrder: 21,
  },
  {
    _id: 'faq-cartoonify-upgrade-later',
    _type: 'faq',
    question: 'Can I order a print after buying just the digital?',
    answer:
      `Yes, but the £5 artwork fee waiver only applies at the original checkout. If you buy the digital bundle today and decide tomorrow you want a print, you'd be charged the full standalone print price (shop price + £5 artwork fee).\n\n` +
      `To get prints at the discounted price, choose the "Bundle + Prints" option at your first checkout and add every print you might want — the artwork fee is waived on all of them.`,
    category: 'custom-services',
    displayOrder: 22,
  },
];

async function run() {
  if (!process.env.SANITY_TOKEN) {
    console.error('❌ SANITY_TOKEN env var not set.');
    process.exit(1);
  }

  console.log(`📝 Adding ${NEW_FAQS.length} Cartoonify Me pricing FAQs...\n`);

  for (const faq of NEW_FAQS) {
    await client.createOrReplace(faq);
    console.log(`   ✓ Created/replaced: "${faq.question}"`);
  }

  console.log(`\n✅ Done. ${NEW_FAQS.length} FAQs added to the custom-services category.`);
  console.log('\n📝 Trigger a Netlify rebuild (or wait for the Sanity webhook) to flush the live site.');
}

run().catch((err) => {
  console.error('\n❌ Failed:', err.message);
  if (err.response) console.error('   Response:', err.response.body);
  process.exit(1);
});
