/**
 * Populates Cartoonify Me with the new pricing model:
 *   - digitalPrice: £14.99 (all 7 styles, digital download bundle)
 *   - 7 styleOptions: The Simpsons, Rick & Morty, South Park, Anime, 3D Pixar, Steampunk, Cyberpunk
 *   - printUpcharges: standalone-print prices = shop price + £5 artwork fee
 *
 * Pricing model reference:
 *   Standalone print:   shop price + £5 artwork fee
 *   Digital bundle:     £14.99 flat (all styles)
 *   Bundle + prints:    £14.99 + shop prices (artwork fee waived since digital pays for it)
 *
 * Run once:
 *   cd C:\Users\chris\Projects\pixel8
 *   $env:SANITY_TOKEN = (Get-Content .env | Select-String "^SANITY_TOKEN=").Line -replace "^SANITY_TOKEN=", ""
 *   node scripts/setup-cartoonify-me-pricing.mjs
 *
 * Idempotent — safe to re-run.
 */

import { createClient } from '@sanity/client';

const client = createClient({
  projectId: 'bqb4w421',
  dataset: 'production',
  apiVersion: '2024-12-01',
  token: process.env.SANITY_TOKEN,
  useCdn: false,
});

const CARTOONIFY_ID = 'TCQSYEAsAR6vcKomk2Q6RP';

// Shop product prices — canonical reference (from src/data/products.ts PRICES)
const SHOP_PRICES = {
  poster:         { small:  9.99, medium: 12.99, large: 16.99 },
  canvasStandard: { small: 27.99, medium: 32.99, large: 44.99 },
  canvasGallery:  { small: 29.99, medium: 35.99, large: 47.99 },
};

const ARTWORK_FEE = 5.00;

// Standalone print pricing = shop + £5
const PRINT_UPCHARGES = {};
for (const [format, sizes] of Object.entries(SHOP_PRICES)) {
  PRINT_UPCHARGES[format] = {};
  for (const [size, price] of Object.entries(sizes)) {
    PRINT_UPCHARGES[format][size] = +(price + ARTWORK_FEE).toFixed(2);
  }
}

const STYLE_OPTIONS = [
  {
    _key: 'style-simpsons',
    _type: 'styleOption',
    key: 'simpsons',
    label: 'The Simpsons',
    helperText: 'Yellow skin, oversized eyes, Springfield colour palette.',
  },
  {
    _key: 'style-rick-morty',
    _type: 'styleOption',
    key: 'rick-morty',
    label: 'Rick & Morty',
    helperText: 'Loose linework, expressive proportions, sci-fi palette.',
  },
  {
    _key: 'style-south-park',
    _type: 'styleOption',
    key: 'south-park',
    label: 'South Park',
    helperText: 'Flat construction-paper aesthetic with bold outlines.',
  },
  {
    _key: 'style-anime',
    _type: 'styleOption',
    key: 'anime',
    label: 'Anime',
    helperText: 'Cel-shaded with expressive eyes and vibrant detail.',
  },
  {
    _key: 'style-3d-pixar',
    _type: 'styleOption',
    key: '3d-pixar',
    label: '3D Pixar',
    helperText: 'Stylised 3D render with soft cinematic lighting.',
  },
  {
    _key: 'style-steampunk',
    _type: 'styleOption',
    key: 'steampunk',
    label: 'Steampunk',
    helperText: 'Brass, gears, and Victorian-industrial aesthetic.',
  },
  {
    _key: 'style-cyberpunk',
    _type: 'styleOption',
    key: 'cyberpunk',
    label: 'Cyberpunk',
    helperText: 'Neon, chrome, and a dystopian-futuristic vibe.',
  },
];

async function run() {
  if (!process.env.SANITY_TOKEN) {
    console.error('❌ SANITY_TOKEN env var not set.');
    process.exit(1);
  }

  console.log('📝 Updating Cartoonify Me with new pricing model...\n');
  console.log('   digitalPrice:     £14.99 (all styles, digital bundle)');
  console.log('   styleOptions:     7 named styles');
  console.log('   printUpcharges:   shop prices + £5 artwork fee\n');

  await client
    .patch(CARTOONIFY_ID)
    .set({
      digitalPrice: 14.99,
      styleOptions: STYLE_OPTIONS,
      printUpcharges: PRINT_UPCHARGES,
    })
    .commit();

  console.log('✅ Cartoonify Me updated successfully.\n');
  console.log('Standalone print prices (= shop price + £5 artwork fee):');
  console.table(PRINT_UPCHARGES);
  console.log('\n📝 Trigger a Netlify rebuild (or wait for the Sanity webhook) to flush the live site.');
}

run().catch((err) => {
  console.error('\n❌ Failed:', err.message);
  if (err.response) console.error('   Response:', err.response.body);
  process.exit(1);
});
