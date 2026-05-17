/**
 * Crayon To Creation — pricing + briefing migration.
 *
 *   - digitalPrice: £19.99 (cinematic 3D still in scene)
 *   - animationMusicPrice: £79.99 (30-sec animation + Suno soundtrack + digital still)
 *   - animationVoPrice: £99.99 (animation + soundtrack + AI voiceover + digital still)
 *   - artworkFee: £19.99 (standalone single-print only)
 *   - artworkBundledWithDigital: TRUE (default — bundle path waives the fee)
 *   - artworkFeePerOrder: FALSE (default — per-print)
 *   - printUpcharges: standard in-house pricing (matches Missing Moment)
 *   - printSizeLabels: rectangular (12×8 / 16×12 / 24×16)
 *
 * Briefing fields rebuilt:
 *   - Always: name, email, what's the drawing of, the drawing
 *   - REMOVED: child's age
 *   - Animation paths: scene action (optional), camera, mood, pacing, music genre
 *     (all "leave it to you" option included)
 *   - Animation + VO: voiceover script (optional), voice character ("leave it to you"
 *     option included), accent, notes
 *
 * Run once:
 *   cd C:\Users\chris\Projects\pixel8
 *   $env:SANITY_TOKEN = (Get-Content .env | Select-String "^SANITY_TOKEN=").Line -replace "^SANITY_TOKEN=", ""
 *   node scripts/setup-crayon-to-creation.mjs
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

const SERVICE_ID = '15hxv4Rz0BxauBoW2SzsD1';

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
    _key: 'bf-c2c-name',
    _type: 'briefingField',
    key: 'customerName',
    label: 'Your name',
    fieldType: 'text',
    required: true,
  },
  {
    _key: 'bf-c2c-email',
    _type: 'briefingField',
    key: 'customerEmail',
    label: 'Email address',
    fieldType: 'email',
    helperText: "We'll send your finished file here.",
    required: true,
  },

  // ── Core (always shown) ────────────────────────────────────────────────────
  {
    _key: 'bf-c2c-drawing',
    _type: 'briefingField',
    key: 'sourceDrawing',
    label: 'The drawing',
    fieldType: 'photo',
    helperText: 'A flat photo in good daylight, or a scan. JPG or PNG.',
    required: true,
  },
  {
    _key: 'bf-c2c-what-it-is',
    _type: 'briefingField',
    key: 'whatItIs',
    label: "What's the drawing of?",
    fieldType: 'textarea',
    helperText: 'Tell us anything we might not be able to tell from looking at it. E.g. "the dog on the left is Max, the yellow blob in the sky is Grandma".',
    required: true,
  },

  // ── Animation paths only ───────────────────────────────────────────────────
  {
    _key: 'bf-c2c-scene-action',
    _type: 'briefingField',
    key: 'sceneAction',
    label: 'Scene direction (optional)',
    fieldType: 'textarea',
    helperText: 'Want to direct the action? Tell us what should happen in the 30-second piece. E.g. "the character flies over a forest, lands on a cloud, waves to the camera". Leave blank and we\'ll bring the drawing to life our way.',
    required: false,
    showFor: ['animation-music', 'animation-vo'],
  },
  {
    _key: 'bf-c2c-camera-movement',
    _type: 'briefingField',
    key: 'cameraMovement',
    label: 'Camera movement preference',
    fieldType: 'select',
    helperText: 'How should the camera behave during the shot?',
    options: [
      'Leave it to you',
      'Static (no movement)',
      'Slow zoom in',
      'Slow zoom out',
      'Slow pan',
      'Subtle parallax',
      'Dynamic / cinematic',
    ],
    required: false,
    showFor: ['animation-music', 'animation-vo'],
  },
  {
    _key: 'bf-c2c-mood',
    _type: 'briefingField',
    key: 'mood',
    label: 'Mood',
    fieldType: 'select',
    helperText: 'Overall emotional tone for the piece.',
    options: [
      'Leave it to you',
      'Magical and whimsical',
      'Adventurous and bold',
      'Joyful and playful',
      'Gentle and dreamy',
      'Cinematic and grand',
      'Funny and quirky',
    ],
    required: false,
    showFor: ['animation-music', 'animation-vo'],
  },
  {
    _key: 'bf-c2c-pacing',
    _type: 'briefingField',
    key: 'pacing',
    label: 'Pacing',
    fieldType: 'select',
    helperText: 'How quickly should the scene unfold?',
    options: [
      'Leave it to you',
      'Slow and lingering',
      'Natural',
      'Snappier',
    ],
    required: false,
    showFor: ['animation-music', 'animation-vo'],
  },
  {
    _key: 'bf-c2c-music-genre',
    _type: 'briefingField',
    key: 'musicGenre',
    label: 'Music style / genre',
    fieldType: 'select',
    helperText: "We'll generate a custom soundtrack matching your chosen vibe. Pick a style or leave the call to us.",
    options: [
      'Leave it to you — match the mood',
      'Magical / fantasy orchestral',
      'Playful / quirky',
      'Adventure / heroic',
      'Gentle / lullaby',
      'Bouncy / upbeat',
      'Cinematic / orchestral',
      'Quiet / dreamy',
      'Pop / contemporary',
    ],
    required: true,
    showFor: ['animation-music', 'animation-vo'],
  },

  // ── Voiceover only ─────────────────────────────────────────────────────────
  {
    _key: 'bf-c2c-vo-script',
    _type: 'briefingField',
    key: 'voiceoverScript',
    label: 'Voiceover script (optional)',
    fieldType: 'textarea',
    helperText: 'Want to write the voiceover yourself? Around 80 words is right for 30 seconds. Or leave blank and we\'ll write a script that fits the drawing and the scene.',
    required: false,
    showFor: ['animation-vo'],
  },
  {
    _key: 'bf-c2c-vo-character',
    _type: 'briefingField',
    key: 'voiceCharacter',
    label: 'Voice characteristics',
    fieldType: 'select',
    helperText: 'The general type of voice. We use AI generation — for anything specific, add it in the notes below.',
    options: [
      'Leave it to you',
      'Warm female (adult)',
      'Warm male (adult)',
      'Older female',
      'Older male',
      'Young woman',
      'Young man',
      'Child (around 7-10)',
      'Child (around 4-6)',
      'Storyteller / narrator',
      'Custom (describe in notes)',
    ],
    required: true,
    showFor: ['animation-vo'],
  },
  {
    _key: 'bf-c2c-vo-accent',
    _type: 'briefingField',
    key: 'voiceAccent',
    label: 'Accent',
    fieldType: 'select',
    options: [
      'Leave it to you',
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
    _key: 'bf-c2c-vo-notes',
    _type: 'briefingField',
    key: 'voiceNotes',
    label: 'Voiceover notes',
    fieldType: 'textarea',
    helperText: 'Optional. Specific tone, pauses, emphasis, custom voice description, or anything to avoid.',
    required: false,
    showFor: ['animation-vo'],
  },

  // ── Catch-all (always) ─────────────────────────────────────────────────────
  {
    _key: 'bf-c2c-notes',
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
    _key: 'step-c2c-0',
    _type: 'object',
    text: "Upload your child's drawing.",
  },
  {
    _key: 'step-c2c-1',
    _type: 'object',
    text: 'Choose how you want it delivered — digital still, prints, or a 30-second animated short.',
  },
  {
    _key: 'step-c2c-2',
    _type: 'object',
    text: 'We transform the drawing into a cinematic 3D character and place them in their own scene.',
  },
  {
    _key: 'step-c2c-3',
    _type: 'object',
    text: 'Receive your finished file (and prints if ordered) via secure link or post.',
  },
];

const IMPORTANT_NOTE =
  'About Crayon To Creation: We transform your child\'s drawing into a fully realised 3D character in a cinematic scene — keeping the personality and charm of the original while rendering it with professional production quality. For animated films, we add subtle motion — character animation, camera moves, environmental effects — over 30 seconds. What we can do beautifully: bring the character to life in their own world. What we can\'t do: lip-sync to a voiceover, complex multi-character interactions, full feature-film animation. Soundtracks are custom-generated based on your chosen mood — pick a style or leave it to us. Voiceovers (when selected) are AI-generated; you can write the script yourself or we\'ll write one that fits the drawing and the scene.';

const DESCRIPTION =
  "Turn your child's imagination into something truly special. We transform hand-drawn pictures into vibrant 3D characters and cinematic scenes while preserving the charm, personality, and creativity of the original drawing. Choose a digital still, add a print for the wall, or commission a 30-second animated short.";

const EXTENDED_DESCRIPTION =
  'From fridge-door masterpieces to fantasy heroes, this is a keepsake that celebrates creativity and turns imagination into art.';

async function run() {
  if (!process.env.SANITY_TOKEN) {
    console.error('❌ SANITY_TOKEN env var not set.');
    process.exit(1);
  }

  console.log('📝 Updating Crayon To Creation with new pricing model...\n');
  console.log('   digitalPrice:                £19.99 (cinematic 3D still)');
  console.log('   animationMusicPrice:         £79.99');
  console.log('   animationVoPrice:            £99.99');
  console.log('   artworkFee:                  £19.99 (standalone print only)');
  console.log('   artworkBundledWithDigital:   TRUE (bundle path waives the fee)');
  console.log('   printUpcharges:              standard in-house pricing');
  console.log('   printSizeLabels:             12×8 / 16×12 / 24×16');
  console.log('   briefingFields:              rebuilt — 14 fields with leave-it-to-us options');
  console.log('   steps + description:         refreshed for new model\n');

  await client
    .patch(SERVICE_ID)
    .set({
      digitalPrice: 19.99,
      animationMusicPrice: 79.99,
      animationVoPrice: 99.99,
      artworkFee: 19.99,
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

  console.log('✅ Crayon To Creation updated successfully.');
  console.log('');
  console.log('Print prices (standalone = base + £19.99 artwork; bundle = base only):');
  console.table(PRINT_UPCHARGES);
  console.log('');
  console.log('Sample customer totals:');
  console.log('  Digital still only:                         £19.99');
  console.log('  Animation (music):                          £79.99');
  console.log('  Animation (music + VO):                     £99.99');
  console.log('  Bundle: digital + Poster Small:             £29.98  (£19.99 + £9.99)');
  console.log('  Animation VO + Canvas Gallery Large:        £146.98 (£99.99 + £46.99)');
  console.log('  Standalone Poster Small (no other base):    £29.98  (£9.99 + £19.99 artwork)');
  console.log('');
  console.log('📝 Trigger a Netlify rebuild to flush the live site.');
}

run().catch((err) => {
  console.error('\n❌ Failed:', err.message);
  if (err.response) console.error('   Response:', err.response.body);
  process.exit(1);
});
