/**
 * Populates The Missing Moment with the new pricing model:
 *   - digitalPrice: £19.99 (digital still only)
 *   - animationMusicPrice: £79.99 (30-sec animation + music + digital still)
 *   - animationVoPrice: £99.99 (30-sec animation + music + AI voiceover + digital still)
 *   - artworkFee: £19.99 (per standalone print without other base order)
 *   - printSizeLabels: rectangular sizes (12×8, 16×12, 24×16)
 *   - printUpcharges: in-house print prices from the live shop pricing page
 *
 * Also rebuilds briefingFields with the conditional showFor mappings for
 * animation-specific fields (script, voiceover characteristics, etc.)
 *
 * Also patches the importantNote with the realistic-expectations copy and
 * rewrites the steps to match the new model.
 *
 * Run once:
 *   cd C:\Users\chris\Projects\pixel8
 *   $env:SANITY_TOKEN = (Get-Content .env | Select-String "^SANITY_TOKEN=").Line -replace "^SANITY_TOKEN=", ""
 *   node scripts/setup-missing-moment.mjs
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

const MISSING_MOMENT_ID = '15hxv4Rz0BxauBoW2SznOx';

// ── In-house print pricing (BEFORE artwork fee) ─────────────────────────────
// These match the pricing page screenshot the customer provided.
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

// ── Briefing fields with conditional showFor ────────────────────────────────
const BRIEFING_FIELDS = [
  {
    _key: 'bf-mm-customer-name',
    _type: 'briefingField',
    key: 'customerName',
    label: 'Your name',
    fieldType: 'text',
    required: true,
  },
  {
    _key: 'bf-mm-customer-email',
    _type: 'briefingField',
    key: 'customerEmail',
    label: 'Email address',
    fieldType: 'email',
    helperText: "We'll send your finished file here.",
    required: true,
  },
  {
    _key: 'bf-mm-customer-phone',
    _type: 'briefingField',
    key: 'customerPhone',
    label: 'Phone number',
    fieldType: 'phone',
    helperText: 'Optional — only if you want us to call you about the brief.',
    required: false,
  },

  // ── Core composition brief (always shown) ─────────────────────────────────
  {
    _key: 'bf-mm-original-photo',
    _type: 'briefingField',
    key: 'originalPhoto',
    label: 'Original photo',
    fieldType: 'photo',
    helperText: 'The photo you want us to ADD someone to. Highest resolution available works best.',
    required: true,
  },
  {
    _key: 'bf-mm-subject-photos',
    _type: 'briefingField',
    key: 'subjectPhotos',
    label: 'Reference photos of the person/people to add',
    fieldType: 'photos',
    helperText: 'The more photos of each person, the better the likeness. Casual photos work better than studio shots.',
    minPhotos: 1,
    maxPhotos: 10,
    required: true,
  },
  {
    _key: 'bf-mm-people',
    _type: 'briefingField',
    key: 'people',
    label: 'Who is in the scene?',
    fieldType: 'text',
    helperText: 'Names and relationships (e.g. "My grandfather Tom, my mum Jane, me as a child").',
    required: true,
  },
  {
    _key: 'bf-mm-scene-brief',
    _type: 'briefingField',
    key: 'sceneBrief',
    label: 'Describe the moment',
    fieldType: 'textarea',
    helperText: 'In your own words — where it would have been, who was there, what the mood should feel like.',
    required: true,
  },
  {
    _key: 'bf-mm-location-photos',
    _type: 'briefingField',
    key: 'locationPhotos',
    label: 'Reference photos of the location',
    fieldType: 'photos',
    helperText: 'Optional. The room, the venue, the view — anything that anchors the setting.',
    minPhotos: 0,
    maxPhotos: 5,
    required: false,
  },

  // ── Animation-specific (shown only for animation-music and animation-vo) ──
  {
    _key: 'bf-mm-scene-action',
    _type: 'briefingField',
    key: 'sceneAction',
    label: 'What should happen in the scene?',
    fieldType: 'textarea',
    helperText: 'Describe the action you want in the 30-second sequence. E.g. "Grandpa walks into frame, hugs my mum, they all turn and smile at the camera."',
    required: true,
    showFor: ['animation-music', 'animation-vo'],
  },
  {
    _key: 'bf-mm-camera-movement',
    _type: 'briefingField',
    key: 'cameraMovement',
    label: 'Camera movement preference',
    fieldType: 'select',
    helperText: 'How should the camera behave during the shot?',
    options: ['Static (no movement)', 'Slow zoom in', 'Slow zoom out', 'Slow pan', 'Subtle parallax', 'Up to you'],
    required: false,
    showFor: ['animation-music', 'animation-vo'],
  },
  {
    _key: 'bf-mm-mood',
    _type: 'briefingField',
    key: 'mood',
    label: 'Mood',
    fieldType: 'select',
    helperText: 'Overall emotional tone for the piece.',
    options: ['Warm and nostalgic', 'Joyful', 'Quiet and emotional', 'Light and playful', 'Cinematic and grand', 'Up to you'],
    required: false,
    showFor: ['animation-music', 'animation-vo'],
  },
  {
    _key: 'bf-mm-pacing',
    _type: 'briefingField',
    key: 'pacing',
    label: 'Pacing',
    fieldType: 'select',
    helperText: 'How quickly should the scene unfold?',
    options: ['Slow and lingering', 'Natural', 'Snappier', 'Up to you'],
    required: false,
    showFor: ['animation-music', 'animation-vo'],
  },
  {
    _key: 'bf-mm-music-genre',
    _type: 'briefingField',
    key: 'musicGenre',
    label: 'Music style / genre',
    fieldType: 'select',
    helperText: "We'll generate a custom soundtrack matching your chosen vibe.",
    options: [
      'Cinematic / orchestral',
      'Sentimental piano',
      'Acoustic / folk',
      'Uplifting / bright',
      'Quiet / ambient',
      'Pop / contemporary',
      'Country',
      'Jazz / lounge',
      'Up to you — match the mood',
    ],
    required: true,
    showFor: ['animation-music', 'animation-vo'],
  },

  // ── Voiceover-specific (shown only for animation-vo) ──────────────────────
  {
    _key: 'bf-mm-vo-script',
    _type: 'briefingField',
    key: 'voiceoverScript',
    label: 'Voiceover script',
    fieldType: 'textarea',
    helperText: "What should the voiceover say? Aim for around 80 words for a 30-second piece. Don't worry about timing — we'll match the pacing.",
    required: true,
    showFor: ['animation-vo'],
  },
  {
    _key: 'bf-mm-vo-character',
    _type: 'briefingField',
    key: 'voiceCharacter',
    label: 'Voice characteristics',
    fieldType: 'select',
    helperText: "The general type of voice. We use AI generation — if you want something specific, tell us in the notes below.",
    options: [
      'Warm female',
      'Warm male',
      'Older female',
      'Older male',
      'Young female',
      'Young male',
      'Custom (describe in notes)',
    ],
    required: true,
    showFor: ['animation-vo'],
  },
  {
    _key: 'bf-mm-vo-accent',
    _type: 'briefingField',
    key: 'voiceAccent',
    label: 'Accent',
    fieldType: 'select',
    options: [
      'British (RP)',
      'British (Northern)',
      'British (Scottish)',
      'British (Welsh)',
      'British (Irish)',
      'American (Neutral)',
      'American (Southern)',
      'Australian',
      'Other (describe in notes)',
    ],
    required: true,
    showFor: ['animation-vo'],
  },
  {
    _key: 'bf-mm-vo-notes',
    _type: 'briefingField',
    key: 'voiceNotes',
    label: 'Voiceover notes',
    fieldType: 'textarea',
    helperText: 'Optional. Specific tone, pauses, emphasis, or anything to avoid.',
    required: false,
    showFor: ['animation-vo'],
  },

  // ── Catch-all (always shown) ──────────────────────────────────────────────
  {
    _key: 'bf-mm-notes',
    _type: 'briefingField',
    key: 'notes',
    label: 'Anything else we should know?',
    fieldType: 'textarea',
    helperText: 'Specific details, references, vibes, things to avoid.',
    required: false,
  },
];

// ── New "How It Works" steps ────────────────────────────────────────────────
const STEPS = [
  {
    _key: 'step-mm-0',
    _type: 'object',
    text: 'Upload the original photo and reference photos of the person to add.',
  },
  {
    _key: 'step-mm-1',
    _type: 'object',
    text: 'Choose how you want it delivered — digital still, prints, or a 30-second animated short.',
  },
  {
    _key: 'step-mm-2',
    _type: 'object',
    text: 'We carefully map lighting, scale and positioning so the composite feels natural.',
  },
  {
    _key: 'step-mm-3',
    _type: 'object',
    text: 'Receive your finished file (and prints if ordered) via secure link or post.',
  },
];

const IMPORTANT_NOTE =
  'About animated films: Your 30-second animated short combines your composited "missing moment" image with subtle cinematic motion — gentle character animation, slow camera moves, soft environmental effects (snow, light shifts, ambient movement). What we can do beautifully: emotionally resonant, slow-paced moments. What we can\'t do: lip-syncing the voiceover to character mouths, realistic full-body action, complex multi-person interactions beyond a brief moment. Soundtracks are custom-generated for each piece based on your chosen genre. Voiceovers (when selected) are AI-generated from a script you provide.';

async function run() {
  if (!process.env.SANITY_TOKEN) {
    console.error('❌ SANITY_TOKEN env var not set.');
    process.exit(1);
  }

  console.log('📝 Updating The Missing Moment with new pricing model...\n');
  console.log('   digitalPrice:        £19.99');
  console.log('   animationMusicPrice: £79.99');
  console.log('   animationVoPrice:    £99.99');
  console.log('   artworkFee:          £19.99');
  console.log('   printSizeLabels:     12×8 / 16×12 / 24×16 (rectangular)');
  console.log('   briefingFields:      18 fields with conditional showFor');
  console.log('   steps:               rewritten for new model');
  console.log('   importantNote:       animation expectations copy\n');

  await client
    .patch(MISSING_MOMENT_ID)
    .set({
      digitalPrice: 19.99,
      animationMusicPrice: 79.99,
      animationVoPrice: 99.99,
      artworkFee: 19.99,
      printSizeLabels: PRINT_SIZE_LABELS,
      printUpcharges: PRINT_UPCHARGES,
      briefingFields: BRIEFING_FIELDS,
      steps: STEPS,
      importantNote: IMPORTANT_NOTE,
    })
    .commit();

  console.log('✅ The Missing Moment updated successfully.');
  console.log('');
  console.log('Print product prices (before £19.99 artwork fee):');
  console.table(PRINT_UPCHARGES);
  console.log('');
  console.log('📝 Trigger a Netlify rebuild (or wait for the Sanity webhook) to flush the live site.');
}

run().catch((err) => {
  console.error('\n❌ Failed:', err.message);
  if (err.response) console.error('   Response:', err.response.body);
  process.exit(1);
});
