/**
 * Past Perfect — pricing model migration.
 *
 *   - digitalPrice: £9.99 (includes the full restoration work)
 *   - artworkFee:   £9.99 (applies to standalone-print orders only)
 *   - artworkBundledWithDigital: TRUE (default — bundle path waives the fee)
 *   - artworkFeePerOrder:        FALSE (default — per-print, but moot here
 *                                       because we only allow 1 photo per order)
 *   - printUpcharges: standard in-house prices (matches Missing Moment)
 *   - printSizeLabels: rectangular (12×8 / 16×12 / 24×16)
 *
 * Briefing fields:
 *   - LEFT UNTOUCHED per spec — the existing 6 fields are well-designed for
 *     this service. We don't write briefingFields here so the current Sanity
 *     data stays exactly as-is.
 *
 * Steps + description + importantNote — refreshed to match the new pricing
 * model.
 *
 * Run once:
 *   cd C:\Users\chris\Projects\pixel8
 *   $env:SANITY_TOKEN = (Get-Content .env | Select-String "^SANITY_TOKEN=").Line -replace "^SANITY_TOKEN=", ""
 *   node scripts/setup-past-perfect.mjs
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

const SERVICE_ID = '15hxv4Rz0BxauBoW2Sznha';

// Standard in-house pricing (matches Missing Moment / Your Song Your Story)
const PRINT_UPCHARGES = {
  poster:         { small:  9.99, medium: 12.99, large: 16.99 },
  canvasStandard: { small: 26.99, medium: 31.99, large: 44.99 },
  canvasGallery:  { small: 28.99, medium: 33.99, large: 46.99 },
};

const PRINT_SIZE_LABELS = {
  small: 'Small (12×8")',
  medium: 'Medium (16×12")',
  large: 'Large (24×16")',
};

const STEPS = [
  {
    _key: 'step-pp-0',
    _type: 'object',
    text: 'Upload your damaged or black-and-white photo.',
  },
  {
    _key: 'step-pp-1',
    _type: 'object',
    text: 'Tell us what you need — repair only, repair plus colourisation, or pure colourisation.',
  },
  {
    _key: 'step-pp-2',
    _type: 'object',
    text: 'We restore the photo to a high-resolution digital file.',
  },
  {
    _key: 'step-pp-3',
    _type: 'object',
    text: 'Receive your file via secure download link — and add prints at standard product prices if you want a physical copy.',
  },
];

const IMPORTANT_NOTE =
  'About the price: the £9.99 covers the full restoration work — damage repair, colourisation if requested, and the high-resolution digital file delivered via secure download link. Print options are listed at our standard product prices with no additional artwork fee, since the restoration work is already paid for in the digital order. One photo per commission — restoring several photos means placing one order per photo.';

const DESCRIPTION =
  'Restore treasured memories with professional photo repair and colourisation. We remove scratches, fading, and damage, then enhance detail and tone to bring every face and moment back to life. £9.99 covers the full restoration; add a print at standard product prices to put it on the wall.';

async function run() {
  if (!process.env.SANITY_TOKEN) {
    console.error('❌ SANITY_TOKEN env var not set.');
    process.exit(1);
  }

  console.log('📝 Updating Past Perfect with new pricing model...\n');
  console.log('   digitalPrice:               £9.99 (covers full restoration)');
  console.log('   artworkFee:                 £9.99 (standalone print only)');
  console.log('   artworkBundledWithDigital:  TRUE (bundle path waives fee)');
  console.log('   artworkFeePerOrder:         FALSE (default)');
  console.log('   printUpcharges:             standard in-house pricing');
  console.log('   printSizeLabels:            12×8 / 16×12 / 24×16');
  console.log('   briefingFields:             UNCHANGED (per spec)');
  console.log('   steps + description:        refreshed for new model\n');

  await client
    .patch(SERVICE_ID)
    .set({
      digitalPrice: 9.99,
      artworkFee: 9.99,
      artworkBundledWithDigital: true,
      artworkFeePerOrder: false,
      printSizeLabels: PRINT_SIZE_LABELS,
      printUpcharges: PRINT_UPCHARGES,
      steps: STEPS,
      importantNote: IMPORTANT_NOTE,
      description: DESCRIPTION,
    })
    .unset(['animationMusicPrice', 'animationVoPrice']) // clean up any stale fields
    .commit();

  console.log('✅ Past Perfect updated successfully.');
  console.log('');
  console.log('Print prices (used as standalone = base + £9.99 artwork; bundle = base only):');
  console.table(PRINT_UPCHARGES);
  console.log('');
  console.log('Sample customer totals:');
  console.log('  Digital only:                            £9.99');
  console.log('  Bundle: digital + 1 Poster Small:        £19.98  (£9.99 + £9.99)');
  console.log('  Bundle: digital + Canvas Gallery Large:  £56.98  (£9.99 + £46.99)');
  console.log('  Standalone Poster Small (no digital):    £19.98  (£9.99 base + £9.99 artwork)');
  console.log('');
  console.log('📝 Trigger a Netlify rebuild to flush the live site.');
}

run().catch((err) => {
  console.error('\n❌ Failed:', err.message);
  if (err.response) console.error('   Response:', err.response.body);
  process.exit(1);
});
