/**
 * Star Power — pricing + briefing migration.
 *
 *   - digitalPrice: £14.99 (single poster output, no animation)
 *   - artworkFee: £5 (standalone single-print only)
 *   - artworkBundledWithDigital: TRUE (default — bundle waives the fee)
 *   - printUpcharges: standard in-house pricing
 *   - printSizeLabels: portrait imperial (8×12 / 12×18 / 18×24)
 *   - NO animation paths (poster-only service)
 *
 * Briefing fields (8 + consent = 9 total):
 *   - Always: name, email, who is this for, style, film/tv influence,
 *     role, poster title (optional), photo, anything else, consent
 *
 * Examples LEFT UNCHANGED — three existing entries are already populated.
 * Labels remain as "Example 1/2/3" — user will relabel manually in Studio.
 *
 * Run once:
 *   cd C:\Users\chris\Projects\pixel8
 *   $env:SANITY_TOKEN = (Get-Content .env | Select-String "^SANITY_TOKEN=").Line -replace "^SANITY_TOKEN=", ""
 *   node scripts/setup-star-power.mjs
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

const SERVICE_ID = 'FusyUyhE6b9oJ0qp1908v9';

// Standard in-house pricing (same as Missing Moment / Crayon / Prankz)
const PRINT_UPCHARGES = {
  poster:         { small:  9.99, medium: 12.99, large: 16.99 },
  canvasStandard: { small: 26.99, medium: 31.99, large: 44.99 },
  canvasGallery:  { small: 28.99, medium: 33.99, large: 46.99 },
};

// Portrait imperial sizes (option a)
const PRINT_SIZE_LABELS = {
  small:  'Small (8×12")',
  medium: 'Medium (12×18")',
  large:  'Large (18×24")',
};

const BRIEFING_FIELDS = [
  {
    _key: 'bf-sp-name',
    _type: 'briefingField',
    key: 'customerName',
    label: 'Your name',
    fieldType: 'text',
    required: true,
  },
  {
    _key: 'bf-sp-email',
    _type: 'briefingField',
    key: 'customerEmail',
    label: 'Email address',
    fieldType: 'email',
    helperText: "We'll send your finished file here.",
    required: true,
  },
  {
    _key: 'bf-sp-subject',
    _type: 'briefingField',
    key: 'subject',
    label: 'Who is this for?',
    fieldType: 'text',
    helperText: 'The person, pet, or family member the poster will star. Often a child or pet; works for anyone.',
    required: true,
  },
  {
    _key: 'bf-sp-style',
    _type: 'briefingField',
    key: 'posterStyle',
    label: 'What style of poster?',
    fieldType: 'select',
    helperText: 'The overall genre and visual feel.',
    options: [
      'Action / blockbuster',
      'Animation / family',
      'Fantasy / epic',
      'Adventure / exploration',
      'Sci-fi / futuristic',
      'Horror / thriller',
      'Comedy / feel-good',
      'Drama / classic',
      'Sports / inspirational',
      'Romance / period piece',
      'Leave it to you',
    ],
    required: true,
  },
  {
    _key: 'bf-sp-influence',
    _type: 'briefingField',
    key: 'filmInfluence',
    label: 'Which film or TV show to take influence from?',
    fieldType: 'text',
    helperText: 'Optional — a specific film or TV show whose poster style you want us to draw inspiration from. We work from a huge library of mainstream titles; obscure picks may not be possible and we\'ll discuss alternatives.',
    required: false,
  },
  {
    _key: 'bf-sp-role',
    _type: 'briefingField',
    key: 'role',
    label: 'What role should they play?',
    fieldType: 'select',
    options: [
      'Lead actor',
      'Villain',
      'Romantic interest',
      'Sidekick',
      'Cameo',
    ],
    required: true,
  },
  {
    _key: 'bf-sp-title',
    _type: 'briefingField',
    key: 'posterTitle',
    label: 'Poster title / tagline (optional)',
    fieldType: 'textarea',
    helperText: 'Got a title in mind? E.g. "JAKE: THE LEGEND" or "BRUNO — ROGUE AGENT". Leave blank and we\'ll invent something fitting.',
    required: false,
  },
  {
    _key: 'bf-sp-photo',
    _type: 'briefingField',
    key: 'subjectPhoto',
    label: 'Photo of the subject',
    fieldType: 'photo',
    helperText: 'Clear, well-lit, facing the camera. Multiple photos in the notes are welcome if you have favourites.',
    required: true,
  },
  {
    _key: 'bf-sp-notes',
    _type: 'briefingField',
    key: 'notes',
    label: 'Anything else we should know?',
    fieldType: 'textarea',
    helperText: 'Specific details, references, vibes, things to avoid.',
    required: false,
  },
  {
    _key: 'bf-sp-consent',
    _type: 'briefingField',
    key: 'starPowerConsent',
    label: 'I confirm this artwork is for personal entertainment and decoration only, will not be sold or presented as official film content, and that I have the rights to use the photo I\'ve uploaded.',
    fieldType: 'checkbox',
    helperText: 'We reserve the right to refuse any commission. If you\'ve picked a more obscure film or TV influence we may not have it in our library — we\'ll get in touch before processing and refund if we can\'t deliver.',
    required: true,
  },
];

const STEPS = [
  {
    _key: 'step-sp-0',
    _type: 'object',
    text: 'Upload a clear photo of your child, pet, partner — or yourself.',
  },
  {
    _key: 'step-sp-1',
    _type: 'object',
    text: 'Choose a poster style (action, animation, fantasy, etc.) and tell us about the character.',
  },
  {
    _key: 'step-sp-2',
    _type: 'object',
    text: 'We design a cinematic movie-poster-style artwork featuring them as the lead.',
  },
  {
    _key: 'step-sp-3',
    _type: 'object',
    text: 'Receive your artwork as a digital download (and poster or canvas prints if ordered).',
  },
];

const IMPORTANT_NOTE =
  'All artwork created through Star Power is original, fictional poster-style art for personal entertainment and decoration. While we draw inspiration from cinema styling, posters are not affiliated with any specific film, studio, or rights holder — they\'re original creations starring your chosen subject. Output is delivered as a portrait-orientation digital file (suitable for printing at standard poster sizes). We work from a huge library of cinematic styles; if you\'ve picked a very obscure or recent film as your visual reference we may not be able to match it exactly and will discuss alternatives before processing.';

const DESCRIPTION =
  'Turn your child, pet, partner, parent — or yourself — into the star of their very own blockbuster. With Star Power, we create cinematic movie-poster-style artwork that places the people (or pets) you love most at the heart of the action — complete with dramatic lighting, epic backdrops, and big-screen energy.';

const EXTENDED_DESCRIPTION =
  'Perfect as a gift, bedroom feature, or keepsake, each creation looks like a genuine film poster — starring your star.';

async function run() {
  if (!process.env.SANITY_TOKEN) {
    console.error('❌ SANITY_TOKEN env var not set.');
    process.exit(1);
  }

  console.log('📝 Updating Star Power with new pricing model...\n');
  console.log('   digitalPrice:                £14.99 (single poster, no animation)');
  console.log('   artworkFee:                  £5 (standalone print only)');
  console.log('   artworkBundledWithDigital:   TRUE (bundle waives the fee)');
  console.log('   printUpcharges:              standard in-house pricing');
  console.log('   printSizeLabels:             portrait imperial 8×12 / 12×18 / 18×24');
  console.log('   briefingFields:              10 fields incl. consent checkbox');
  console.log('   no animation paths:          poster-only service');
  console.log('   examples:                    LEFT UNCHANGED\n');

  await client
    .patch(SERVICE_ID)
    .set({
      digitalPrice: 14.99,
      // Explicitly clear any animation prices to be safe (this service doesn't offer animation)
      animationMusicPrice: null,
      animationVoPrice: null,
      artworkFee: 5.00,
      artworkBundledWithDigital: true,
      artworkFeePerOrder: false,
      printSizeLabels: PRINT_SIZE_LABELS,
      printUpcharges: PRINT_UPCHARGES,
      briefingFields: BRIEFING_FIELDS,
      steps: STEPS,
      importantNote: IMPORTANT_NOTE,
      description: DESCRIPTION,
      extendedDescription: EXTENDED_DESCRIPTION,
    })
    .commit();

  console.log('✅ Star Power updated successfully.');
  console.log('');
  console.log('Print prices (standalone = base + £5 artwork; bundle = base only):');
  console.table(PRINT_UPCHARGES);
  console.log('');
  console.log('Sample customer totals:');
  console.log('  Digital still only:                         £14.99');
  console.log('  Standalone Poster Small:                    £14.99  (£9.99 + £5 artwork)');
  console.log('  Standalone Canvas Gallery Large:            £51.99  (£46.99 + £5 artwork)');
  console.log('  Bundle: digital + Poster Small:             £24.98  (£14.99 + £9.99)');
  console.log('  Bundle: digital + Canvas Gallery Large:     £61.98  (£14.99 + £46.99)');
  console.log('');
  console.log('⚠️  Customer MUST tick the consent checkbox before proceeding to payment.');
  console.log('    Consent answer is stored on the commission doc as evidence.');
  console.log('');
  console.log('📝 Trigger a Netlify rebuild to flush the live site.');
}

run().catch((err) => {
  console.error('\n❌ Failed:', err.message);
  if (err.response) console.error('   Response:', err.response.body);
  process.exit(1);
});
