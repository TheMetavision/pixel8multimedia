/**
 * Populates Your Song Your Story with the new pricing model:
 *   - digitalPrice: £19.99 — Suno-generated song in MP3 + WAV
 *   - artworkFee: £10.00 — for the lyrics print (photo background + lyrics overlay)
 *   - artworkBundledWithDigital: FALSE — song and print are SEPARATE products,
 *     artwork fee always applies on print orders even when bought with the song
 *   - artworkFeePerOrder: TRUE — artwork fee charged once per checkout regardless
 *     of how many prints are ordered (one lyrics layout, multiple sizes)
 *   - Print prices: aligned with standard in-house pricing (matches Missing Moment)
 *   - Briefing fields rebuilt per spec:
 *       * REMOVED: artist, date (folded into "what to include"), why-this-song
 *       * ADDED: musicGenre, songTitlePreference (let us name it OR provide)
 *       * ADDED: fileFormatPreference (MP3/WAV/Both)
 *       * ADDED: backgroundPhoto (only for print paths)
 *       * ADDED: titleProvidedByCustomer (only if they want to name it themselves)
 *
 * Run once:
 *   cd C:\Users\chris\Projects\pixel8
 *   $env:SANITY_TOKEN = (Get-Content .env | Select-String "^SANITY_TOKEN=").Line -replace "^SANITY_TOKEN=", ""
 *   node scripts/setup-your-song-your-story.mjs
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

const SERVICE_ID = 'FusyUyhE6b9oJ0qp19068J';

// Print product prices — standard in-house pricing (matches Missing Moment)
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

const BRIEFING_FIELDS = [
  {
    _key: 'bf-ysys-name',
    _type: 'briefingField',
    key: 'customerName',
    label: 'Your name',
    fieldType: 'text',
    required: true,
  },
  {
    _key: 'bf-ysys-email',
    _type: 'briefingField',
    key: 'customerEmail',
    label: 'Email address',
    fieldType: 'email',
    helperText: "We'll send your finished file here.",
    required: true,
  },
  {
    _key: 'bf-ysys-subject',
    _type: 'briefingField',
    key: 'subject',
    label: 'Who is this for?',
    fieldType: 'text',
    helperText: 'The person, pet or family member the song is about.',
    required: true,
  },

  // ── Music brief ──
  {
    _key: 'bf-ysys-genre',
    _type: 'briefingField',
    key: 'musicGenre',
    label: 'Music style / genre',
    fieldType: 'select',
    helperText: "Pick the vibe — we'll generate a custom track in that style.",
    options: [
      'Pop / contemporary',
      'Acoustic / folk',
      'Rock',
      'Country',
      'Rap / hip-hop',
      'R&B / soul',
      'Cinematic / orchestral',
      'Sentimental piano',
      'Indie / alternative',
      'Reggae',
      'Jazz / lounge',
      'Disco / funk',
      'Electronic / dance',
      'Up to you — match the brief',
    ],
    required: true,
  },
  {
    _key: 'bf-ysys-details',
    _type: 'briefingField',
    key: 'songDetails',
    label: 'What should the song include?',
    fieldType: 'textarea',
    helperText: 'Tell us what to reference: names, dates, milestones, places, inside jokes, the emotional arc. The more specific the detail, the more personal the song.',
    required: true,
  },
  {
    _key: 'bf-ysys-title-pref',
    _type: 'briefingField',
    key: 'songTitlePreference',
    label: 'Song title',
    fieldType: 'select',
    helperText: 'Want to name it yourself, or leave it to us?',
    options: [
      "I'll provide a title",
      'Leave it to you',
    ],
    required: true,
  },
  {
    _key: 'bf-ysys-title-input',
    _type: 'briefingField',
    key: 'songTitle',
    label: 'Your song title',
    fieldType: 'text',
    helperText: 'Only fill this in if you chose "I\'ll provide a title" above.',
    required: false,
  },
  {
    _key: 'bf-ysys-format',
    _type: 'briefingField',
    key: 'fileFormatPreference',
    label: 'Preferred file format',
    fieldType: 'select',
    helperText: "We'll deliver your song as a secure download link.",
    options: [
      'Both MP3 and WAV (recommended)',
      'MP3 only',
      'WAV only',
    ],
    required: true,
  },

  // ── Print-specific (conditional on print paths only) ──
  {
    _key: 'bf-ysys-bg-photo',
    _type: 'briefingField',
    key: 'backgroundPhoto',
    label: 'Background photo for the print',
    fieldType: 'photo',
    helperText: 'The photo you want the song title and lyrics laid over. Higher resolution = better print quality. Portrait or landscape both work — we\'ll fit the layout to your chosen print size.',
    required: true,
    showFor: ['singlePrint', 'bundle'],
  },

  // ── Catch-all (always) ──
  {
    _key: 'bf-ysys-notes',
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
    _key: 'step-ysys-0',
    _type: 'object',
    text: 'Tell us who the song is for and what it should say — names, milestones, the emotional arc.',
  },
  {
    _key: 'step-ysys-1',
    _type: 'object',
    text: 'Pick your music style and decide if you also want a printed lyrics piece.',
  },
  {
    _key: 'step-ysys-2',
    _type: 'object',
    text: 'We write the lyrics, generate the track, and (if ordered) lay out the lyrics over your chosen photo.',
  },
  {
    _key: 'step-ysys-3',
    _type: 'object',
    text: 'Receive your finished song via secure download link. Prints arrive at your door if ordered.',
  },
];

const IMPORTANT_NOTE =
  'About the song and the print: these are separate products. The £19.99 digital song is the audio track only. The lyrics print is a physical poster or canvas with your chosen photo as the background and the song title plus lyrics laid over the top — that\'s a different production process, so the £10 artwork fee applies to print orders even when bought alongside the song. The artwork fee is a one-time charge per order, so multiple prints at different sizes from the same lyrics layout only pay the £10 fee once.';

const DESCRIPTION =
  'Turn memories, milestones, or inside jokes into an original song. Choose your genre (pop, rock, acoustic, rap, country — anything goes) and share the details that matter — names, dates, stories, emotions — and we\'ll write a custom song just for you. Want it on the wall too? Add a lyrics print with your own photo as the background.';

async function run() {
  if (!process.env.SANITY_TOKEN) {
    console.error('❌ SANITY_TOKEN env var not set.');
    process.exit(1);
  }

  console.log('📝 Updating Your Song Your Story with new pricing model...\n');
  console.log('   digitalPrice:                £19.99 (song only — MP3/WAV)');
  console.log('   artworkFee:                  £10.00 (lyrics print artwork)');
  console.log('   artworkBundledWithDigital:   FALSE (separate products)');
  console.log('   artworkFeePerOrder:          TRUE (charged once per checkout)');
  console.log('   printUpcharges:              standard in-house pricing');
  console.log('   briefingFields:              rebuilt — 10 fields, 1 conditional');
  console.log('   steps:                       rewritten');
  console.log('   importantNote:               new — explains separate-products model\n');

  await client
    .patch(SERVICE_ID)
    .set({
      digitalPrice: 19.99,
      artworkFee: 10.00,
      artworkBundledWithDigital: false,
      artworkFeePerOrder: true,
      printSizeLabels: PRINT_SIZE_LABELS,
      printUpcharges: PRINT_UPCHARGES,
      briefingFields: BRIEFING_FIELDS,
      steps: STEPS,
      importantNote: IMPORTANT_NOTE,
      description: DESCRIPTION,
    })
    .unset(['animationMusicPrice', 'animationVoPrice']) // clean up any stale fields
    .commit();

  console.log('✅ Your Song Your Story updated successfully.');
  console.log('');
  console.log('Print prices (before £10 artwork fee):');
  console.table(PRINT_UPCHARGES);
  console.log('');
  console.log('Sample customer totals:');
  console.log('  Digital song only:                          £19.99');
  console.log('  1 print only (Poster Small):                £19.99 (£9.99 + £10 artwork)');
  console.log('  Song + 1 print (Poster Small):              £39.98 (£19.99 + £9.99 + £10 artwork)');
  console.log('  Song + 3 prints (Poster Small):             £59.96 (£19.99 + 3×£9.99 + £10 ONE-TIME artwork)');
  console.log('  Song + Canvas Gallery Large:                £76.98 (£19.99 + £46.99 + £10)');
  console.log('');
  console.log('📝 Trigger a Netlify rebuild to flush the live site.');
}

run().catch((err) => {
  console.error('\n❌ Failed:', err.message);
  if (err.response) console.error('   Response:', err.response.body);
  process.exit(1);
});
