/**
 * Back In Time — Path X two-collection migration.
 *
 *   - digitalPrice: £14.99 (Modern Decades — 1950s-2000s, 6 styles)
 *   - digitalPriceSecondary: £14.99 (Historical Periods — Roman-Edwardian, 6 styles)
 *   - digitalPriceBoth: £24.99 (saves £4.99 vs buying separately)
 *   - artworkFee: £5 (standalone single-print only)
 *   - artworkBundledWithDigital: TRUE (bundle waives the fee)
 *   - printUpcharges: square sizes, standard in-house pricing
 *   - printSizeLabels: Cartoonify-style square (12×12 / 16×16 / 20×20)
 *
 * Briefing fields:
 *   - Always: name, email, who is this for, photo, style notes, anything else
 *   - No "Which era?" select — that choice happens via path picker + style swatch
 *
 * Examples are LEFT UNCHANGED — three existing entries cover the Modern Decades
 * collection. The user will add Historical Periods examples manually via Studio.
 *
 * Run once:
 *   cd C:\Users\chris\Projects\pixel8
 *   $env:SANITY_TOKEN = (Get-Content .env | Select-String "^SANITY_TOKEN=").Line -replace "^SANITY_TOKEN=", ""
 *   node scripts/setup-back-in-time.mjs
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

const SERVICE_ID = 'TCQSYEAsAR6vcKomk2Q7r8';

// Square print pricing matches Cartoonify Me's standard in-house numbers
const PRINT_UPCHARGES = {
  poster:         { small:  9.99, medium: 12.99, large: 16.99 },
  canvasStandard: { small: 26.99, medium: 31.99, large: 44.99 },
  canvasGallery:  { small: 28.99, medium: 33.99, large: 46.99 },
};

const PRINT_SIZE_LABELS = {
  small: 'Small (12×12")',
  medium: 'Medium (16×16")',
  large: 'Large (20×20")',
};

// ── COLLECTION 1: Modern Decades ───────────────────────────────────────────
const STYLE_OPTIONS_MODERN = [
  { _key: 'so-bit-1950s', _type: 'styleOption', key: '1950s', label: '1950s',
    helperText: 'Post-war glamour, full skirts, soft colour palette.' },
  { _key: 'so-bit-1960s', _type: 'styleOption', key: '1960s', label: '1960s',
    helperText: 'Mod fashion, bold patterns, bright pop colours.' },
  { _key: 'so-bit-1970s', _type: 'styleOption', key: '1970s', label: '1970s',
    helperText: 'Disco glam, earthy tones, wide collars and flares.' },
  { _key: 'so-bit-1980s', _type: 'styleOption', key: '1980s', label: '1980s',
    helperText: 'Neon, big hair, statement shoulders, MTV gloss.' },
  { _key: 'so-bit-1990s', _type: 'styleOption', key: '1990s', label: '1990s',
    helperText: 'Grunge meets minimalism, film-grain colour cast.' },
  { _key: 'so-bit-2000s', _type: 'styleOption', key: '2000s', label: '2000s',
    helperText: 'Low-rise denim, frosted tips, early-digital photography.' },
];

// ── COLLECTION 2: Historical Periods ───────────────────────────────────────
const STYLE_OPTIONS_HISTORICAL = [
  { _key: 'so-bit-roman', _type: 'styleOption', key: 'roman', label: 'Roman',
    helperText: 'Togas, laurel wreaths, Roman empire grandeur (~AD 100).' },
  { _key: 'so-bit-medieval', _type: 'styleOption', key: 'medieval', label: 'Medieval',
    helperText: 'Knights, courtly robes, painterly castle settings (~1300s).' },
  { _key: 'so-bit-renaissance', _type: 'styleOption', key: 'renaissance', label: 'Renaissance',
    helperText: 'Italian/Tudor styling, oil-painting portrait look (~1500s).' },
  { _key: 'so-bit-georgian', _type: 'styleOption', key: 'georgian', label: 'Georgian',
    helperText: 'Regency-era empire-waist gowns, cravats, top hats (~1810s).' },
  { _key: 'so-bit-victorian', _type: 'styleOption', key: 'victorian', label: 'Victorian',
    helperText: 'High collars, sepia photography aesthetic (1837-1901).' },
  { _key: 'so-bit-edwardian', _type: 'styleOption', key: 'edwardian', label: 'Edwardian',
    helperText: 'Titanic-era elegance, hats, suits with waistcoats (1901-1910).' },
];

const BRIEFING_FIELDS = [
  {
    _key: 'bf-bit-name',
    _type: 'briefingField',
    key: 'customerName',
    label: 'Your name',
    fieldType: 'text',
    required: true,
  },
  {
    _key: 'bf-bit-email',
    _type: 'briefingField',
    key: 'customerEmail',
    label: 'Email address',
    fieldType: 'email',
    helperText: "We'll send your finished files here.",
    required: true,
  },
  {
    _key: 'bf-bit-subject',
    _type: 'briefingField',
    key: 'subject',
    label: 'Who is this for?',
    fieldType: 'text',
    helperText: 'The person, pet, or family member the commission is about. Often this is you; for gifts, the recipient.',
    required: true,
  },
  {
    _key: 'bf-bit-photo',
    _type: 'briefingField',
    key: 'sourcePhoto',
    label: 'Photo of the subject(s)',
    fieldType: 'photo',
    helperText: 'Clear, well-lit, facing the camera. Multiple people OK.',
    required: true,
  },
  {
    _key: 'bf-bit-style-notes',
    _type: 'briefingField',
    key: 'styleNotes',
    label: 'Specific style notes',
    fieldType: 'textarea',
    helperText: 'Optional. Want a particular vibe within an era? Speakeasy 1920s / disco 1970s / sepia Victorian portrait / Sunday-best Edwardian. Specific film references all work.',
    required: false,
  },
  {
    _key: 'bf-bit-notes',
    _type: 'briefingField',
    key: 'notes',
    label: 'Anything else we should know?',
    fieldType: 'textarea',
    helperText: 'Specific details, references, vibes, things to avoid.',
    required: false,
  },
];

const STEPS = [
  {
    _key: 'step-bit-0',
    _type: 'object',
    text: 'Upload one clear, well-lit photo of yourself or your subject.',
  },
  {
    _key: 'step-bit-1',
    _type: 'object',
    text: 'Choose a collection — Modern Decades, Historical Periods, or both — or pick a single era for a print.',
  },
  {
    _key: 'step-bit-2',
    _type: 'object',
    text: 'We restyle your photo across each era, preserving your subject\'s likeness with period-accurate fashion, lighting, and colour.',
  },
  {
    _key: 'step-bit-3',
    _type: 'object',
    text: 'Receive your finished files via secure download link (plus any prints by post).',
  },
];

const IMPORTANT_NOTE =
  'About the pricing: each digital collection (Modern Decades or Historical Periods) is £14.99 and delivers all 6 era variants for that collection as separate digital files. Buy both collections together for £24.99 (saves £4.99). Add prints of any era at standard product prices — the £5 artwork fee is waived per print on bundle orders. Standalone single prints include the £5 artwork fee.';

const DESCRIPTION =
  'See yourself evolve across eras. Pick from Modern Decades (1950s through 2000s) or Historical Periods (Roman through Edwardian) — or get both. We redesign your photo to match the fashion, colour tone, and vibe of each era.';

async function run() {
  if (!process.env.SANITY_TOKEN) {
    console.error('❌ SANITY_TOKEN env var not set.');
    process.exit(1);
  }

  console.log('📝 Updating Back in Time with Path X two-collection model...\n');
  console.log('   digitalPrice (Modern Decades):       £14.99 (6 eras)');
  console.log('   digitalPriceSecondary (Historical):  £14.99 (6 eras)');
  console.log('   digitalPriceBoth (Both Collections): £24.99 (saves £4.99)');
  console.log('   artworkFee:                          £5 (standalone print only)');
  console.log('   artworkBundledWithDigital:           TRUE');
  console.log('   printUpcharges:                      square 12×12 / 16×16 / 20×20');
  console.log('   briefingFields:                      6 fields (no era select — driven by path picker)');
  console.log('   examples:                            LEFT UNCHANGED\n');

  await client
    .patch(SERVICE_ID)
    .set({
      digitalPrice: 14.99,
      digitalPriceSecondary: 14.99,
      digitalPriceBoth: 24.99,
      collectionLabel: 'Modern Decades',
      collectionLabelSecondary: 'Historical Periods',
      styleOptions: STYLE_OPTIONS_MODERN,
      styleOptionsSecondary: STYLE_OPTIONS_HISTORICAL,
      artworkFee: 5.0,
      artworkBundledWithDigital: true,
      artworkFeePerOrder: false,
      printSizeLabels: PRINT_SIZE_LABELS,
      printUpcharges: PRINT_UPCHARGES,
      briefingFields: BRIEFING_FIELDS,
      steps: STEPS,
      importantNote: IMPORTANT_NOTE,
      description: DESCRIPTION,
    })
    .commit();

  console.log('✅ Back in Time updated successfully.');
  console.log('');
  console.log('Print prices (standalone = base + £5 artwork; bundle = base only):');
  console.table(PRINT_UPCHARGES);
  console.log('');
  console.log('Sample customer totals:');
  console.log('  Modern Decades digital only:                £14.99');
  console.log('  Historical Periods digital only:            £14.99');
  console.log('  Both Collections digital:                   £24.99 (saves £4.99)');
  console.log('  Standalone Poster Small (any era):          £14.99 (£9.99 + £5 artwork)');
  console.log('  Bundle: Modern + Poster Small (any decade): £24.98 (£14.99 + £9.99)');
  console.log('  Bundle: Historical + Canvas Gallery L:      £61.98 (£14.99 + £46.99)');
  console.log('  Bundle: Both + Poster Medium:               £37.98 (£24.99 + £12.99)');
  console.log('');
  console.log('📝 NOTE: examples[] left untouched — add Historical Periods examples manually via Sanity Studio.');
  console.log('📝 Trigger a Netlify rebuild to flush the live site.');
}

run().catch((err) => {
  console.error('\n❌ Failed:', err.message);
  if (err.response) console.error('   Response:', err.response.body);
  process.exit(1);
});
