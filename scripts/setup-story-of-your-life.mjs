/**
 * Story Of Your Life — pricing + briefing + examples migration.
 *
 *   - digitalPrice: £14.99 (collage of moments — digital still)
 *   - animationMusicPrice: £109.99 (up to 60-sec animated story with soundtrack)
 *   - animationVoPrice: £139.99 (animation + soundtrack + AI voiceover)
 *   - artworkFee: £14.99 (standalone single-print only)
 *   - artworkBundledWithDigital: TRUE (default — bundle path waives the fee)
 *   - artworkFeePerOrder: FALSE (default — per-print)
 *   - printUpcharges: standard in-house pricing
 *   - printSizeLabels: rectangular (12×8 / 16×12 / 24×16)
 *
 * Briefing fields rebuilt:
 *   - Always: name, email, who is this for, how many moments, list each moment,
 *     reference photos (6-12), anything else
 *   - Animation paths: scene direction (optional), camera, mood, pacing, music genre
 *     (all "leave it to you" option included)
 *   - Animation + VO: voiceover script (optional), voice character, accent, notes
 *
 * Examples data hygiene:
 *   - The Love Story example is currently split across two orphaned entries
 *     (one with only a label, one with only videos). This script merges them
 *     into a single example with the proper label + videos. Once the migration
 *     runs, you can upload Original + Digital Still images for each example
 *     via Sanity Studio.
 *
 * Run once:
 *   cd C:\Users\chris\Projects\pixel8
 *   $env:SANITY_TOKEN = (Get-Content .env | Select-String "^SANITY_TOKEN=").Line -replace "^SANITY_TOKEN=", ""
 *   node scripts/setup-story-of-your-life.mjs
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

const SERVICE_ID = 'TCQSYEAsAR6vcKomk2Q7cu';

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
    _key: 'bf-soyl-name',
    _type: 'briefingField',
    key: 'customerName',
    label: 'Your name',
    fieldType: 'text',
    required: true,
  },
  {
    _key: 'bf-soyl-email',
    _type: 'briefingField',
    key: 'customerEmail',
    label: 'Email address',
    fieldType: 'email',
    helperText: "We'll send your finished file here.",
    required: true,
  },
  {
    _key: 'bf-soyl-subject',
    _type: 'briefingField',
    key: 'subject',
    label: 'Who is this for?',
    fieldType: 'text',
    helperText: 'The person, pet or family member the commission is about.',
    required: true,
  },
  {
    _key: 'bf-soyl-moment-count',
    _type: 'briefingField',
    key: 'momentCount',
    label: 'How many moments?',
    fieldType: 'select',
    helperText: 'Drives both the collage layout and the animation length.',
    options: ['6 moments', '8 moments', '10 moments', '12 moments'],
    required: true,
  },
  {
    _key: 'bf-soyl-moment-brief',
    _type: 'briefingField',
    key: 'momentBrief',
    label: 'List each moment',
    fieldType: 'textarea',
    helperText: 'For each moment include the approximate year and what it should depict. E.g. "1962 — born in Manchester / 1968 — first day at school".',
    required: true,
  },
  {
    _key: 'bf-soyl-ref-photos',
    _type: 'briefingField',
    key: 'referencePhotos',
    label: 'Reference photos',
    fieldType: 'photos',
    helperText: 'One photo per moment if possible. Older or lower-quality photos are fine — we work with what you have.',
    minPhotos: 6,
    maxPhotos: 12,
    required: true,
  },

  // ── Animation paths only ───────────────────────────────────────────────────
  {
    _key: 'bf-soyl-scene-action',
    _type: 'briefingField',
    key: 'sceneAction',
    label: 'Scene direction (optional)',
    fieldType: 'textarea',
    helperText: 'Want to direct any specific moments? Tell us how transitions should flow, key beats to dwell on, or visual ideas. Leave blank and we\'ll structure the narrative our way.',
    required: false,
    showFor: ['animation-music', 'animation-vo'],
  },
  {
    _key: 'bf-soyl-camera-movement',
    _type: 'briefingField',
    key: 'cameraMovement',
    label: 'Camera movement preference',
    fieldType: 'select',
    helperText: 'How should the camera behave across the story?',
    options: [
      'Leave it to you',
      'Mostly static (subtle parallax only)',
      'Slow Ken Burns (gentle zoom + pan)',
      'Dynamic cinematic moves',
      'Mix of static and motion',
    ],
    required: false,
    showFor: ['animation-music', 'animation-vo'],
  },
  {
    _key: 'bf-soyl-mood',
    _type: 'briefingField',
    key: 'mood',
    label: 'Mood',
    fieldType: 'select',
    helperText: 'Overall emotional tone for the piece.',
    options: [
      'Leave it to you',
      'Warm and nostalgic',
      'Joyful and uplifting',
      'Quiet and emotional',
      'Cinematic and grand',
      'Tender and bittersweet',
      'Celebratory',
    ],
    required: false,
    showFor: ['animation-music', 'animation-vo'],
  },
  {
    _key: 'bf-soyl-pacing',
    _type: 'briefingField',
    key: 'pacing',
    label: 'Pacing',
    fieldType: 'select',
    helperText: 'How long to dwell on each moment.',
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
    _key: 'bf-soyl-music-genre',
    _type: 'briefingField',
    key: 'musicGenre',
    label: 'Music style / genre',
    fieldType: 'select',
    helperText: "We'll generate a custom soundtrack matching your chosen vibe. Pick a style or leave the call to us.",
    options: [
      'Leave it to you — match the mood',
      'Cinematic / orchestral',
      'Sentimental piano',
      'Acoustic / folk',
      'Uplifting / bright',
      'Quiet / ambient',
      'Pop / contemporary',
      'Country',
      'Jazz / lounge',
    ],
    required: true,
    showFor: ['animation-music', 'animation-vo'],
  },

  // ── Voiceover only ─────────────────────────────────────────────────────────
  {
    _key: 'bf-soyl-vo-script',
    _type: 'briefingField',
    key: 'voiceoverScript',
    label: 'Voiceover script (optional)',
    fieldType: 'textarea',
    helperText: 'Want to write the narration yourself? Around 150 words is right for 60 seconds. Or leave blank and we\'ll write a script drawn from your moment brief.',
    required: false,
    showFor: ['animation-vo'],
  },
  {
    _key: 'bf-soyl-vo-character',
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
      'Storyteller / narrator',
      'Custom (describe in notes)',
    ],
    required: true,
    showFor: ['animation-vo'],
  },
  {
    _key: 'bf-soyl-vo-accent',
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
    _key: 'bf-soyl-vo-notes',
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
    _key: 'bf-soyl-notes',
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
    _key: 'step-soyl-0',
    _type: 'object',
    text: 'Upload 6–12 photos covering the meaningful moments of the story.',
  },
  {
    _key: 'step-soyl-1',
    _type: 'object',
    text: 'List each moment with an approximate year and what it should depict.',
  },
  {
    _key: 'step-soyl-2',
    _type: 'object',
    text: 'Choose how you want it delivered — digital collage still, prints, or a cinematic animated story (up to 60 seconds).',
  },
  {
    _key: 'step-soyl-3',
    _type: 'object',
    text: 'We weave the photos into a flowing narrative — enhanced, expanded, and structured for emotional impact.',
  },
  {
    _key: 'step-soyl-4',
    _type: 'object',
    text: 'Receive your finished file (and prints if ordered) via secure link or post.',
  },
];

const IMPORTANT_NOTE =
  'About Story Of Your Life: The digital collage still arranges your chosen moments into one beautifully composed image — enhanced and harmonised so older or lower-quality photos sit naturally alongside newer ones. The animated story takes the same moments and turns them into a flowing cinematic piece of up to 60 seconds, with custom soundtrack and (optionally) AI-generated voiceover. What we can do beautifully: a memorable narrative arc that captures the essence of a life. What we can\'t do: lip-sync the voiceover to faces, recreate moments we have no reference for, or extend beyond 60 seconds. Soundtracks are custom-generated for each piece based on your chosen mood. Voiceovers (when selected) are AI-generated; you can write the script yourself or we\'ll write one drawn from your brief.';

const DESCRIPTION =
  "Transform a lifetime of photographs into one beautifully crafted story. We can deliver it as a digital collage of your chosen moments, as prints for the wall, or as a cinematic animated story of up to 60 seconds — carefully enhanced, expanded, and woven together into a powerful tribute to the journey that made you who you are.";

/**
 * Examples — fixes the orphan "Love Story" entries. Keeps the two complete
 * examples as-is; merges entries 3 and 4 into a single Love Story example
 * with both label and videos. Images are left empty for each — you can upload
 * "Original" and "Digital Still" images via Sanity Studio later.
 */
const EXAMPLES = [
  {
    _key: 'ex-soyl-1',
    label: 'In Memory — A Life That Still Moves',
    videos: [
      { _key: 'vid-soyl-1-music', tag: 'Animation with Background Music', title: 'In Memory — A Life That Still Moves', youtubeId: 'HkNnxnL-FOY' },
      { _key: 'vid-soyl-1-vo',    tag: 'Animation with Background Music and Voiceover', title: 'In Memory — A Life That Still Moves', youtubeId: 'AQdgjJc44qM' },
    ],
  },
  {
    _key: 'ex-soyl-2',
    label: 'From Training Wheels To Triumph',
    videos: [
      { _key: 'vid-soyl-2-music', tag: 'Animation with Background Music', title: 'From Training Wheels To Triumph', youtubeId: 'Bf3fXWIDhE4' },
      { _key: 'vid-soyl-2-vo',    tag: 'Animation with Background Music and Voiceover', title: 'From Training Wheels To Triumph', youtubeId: '2-29y3d-CXg' },
    ],
  },
  {
    _key: 'ex-soyl-3',
    label: 'The Love Story',
    videos: [
      { _key: 'vid-soyl-3-music', tag: 'Animation with Background Music', title: 'The Love Story', youtubeId: 'SqjroPJildY' },
      { _key: 'vid-soyl-3-vo',    tag: 'Animation with Background Music and Voiceover', title: 'The Love Story', youtubeId: 'hAjo8qFY7_0' },
    ],
  },
];

async function run() {
  if (!process.env.SANITY_TOKEN) {
    console.error('❌ SANITY_TOKEN env var not set.');
    process.exit(1);
  }

  console.log('📝 Updating Story Of Your Life with new pricing model...\n');
  console.log('   digitalPrice:                £14.99 (collage still)');
  console.log('   animationMusicPrice:         £109.99 (up to 60-sec animation)');
  console.log('   animationVoPrice:            £139.99 (animation + AI voiceover)');
  console.log('   artworkFee:                  £14.99 (standalone print only)');
  console.log('   artworkBundledWithDigital:   TRUE (bundle path waives the fee)');
  console.log('   printUpcharges:              standard in-house pricing');
  console.log('   printSizeLabels:             12×8 / 16×12 / 24×16');
  console.log('   briefingFields:              rebuilt — 16 fields with conditional + leave-to-us');
  console.log('   examples:                    Love Story orphans merged (now 3 clean entries)');
  console.log('   steps + description:         refreshed for new model\n');

  await client
    .patch(SERVICE_ID)
    .set({
      digitalPrice: 14.99,
      animationMusicPrice: 109.99,
      animationVoPrice: 139.99,
      artworkFee: 14.99,
      artworkBundledWithDigital: true,
      artworkFeePerOrder: false,
      printSizeLabels: PRINT_SIZE_LABELS,
      printUpcharges: PRINT_UPCHARGES,
      briefingFields: BRIEFING_FIELDS,
      steps: STEPS,
      importantNote: IMPORTANT_NOTE,
      description: DESCRIPTION,
      examples: EXAMPLES,
    })
    .commit();

  console.log('✅ Story Of Your Life updated successfully.');
  console.log('');
  console.log('Print prices (standalone = base + £14.99 artwork; bundle = base only):');
  console.table(PRINT_UPCHARGES);
  console.log('');
  console.log('Sample customer totals:');
  console.log('  Digital collage only:                       £14.99');
  console.log('  Animation (music) — up to 60s:              £109.99');
  console.log('  Animation (music + VO) — up to 60s:         £139.99');
  console.log('  Bundle: collage + Poster Small:             £24.98  (£14.99 + £9.99)');
  console.log('  Animation + Canvas Gallery Large:           £156.98 (£109.99 + £46.99)');
  console.log('  Animation VO + 2 prints (Poster S + CG L):  £196.97 (£139.99 + £9.99 + £46.99)');
  console.log('  Standalone Poster Small (no other base):    £24.98  (£9.99 + £14.99 artwork)');
  console.log('');
  console.log('📌 Next step: upload Original + Digital Still images for each');
  console.log('   example in Sanity Studio. The three clean entries are now:');
  console.log('   - In Memory — A Life That Still Moves');
  console.log('   - From Training Wheels To Triumph');
  console.log('   - The Love Story');
  console.log('');
  console.log('📝 Trigger a Netlify rebuild to flush the live site.');
}

run().catch((err) => {
  console.error('\n❌ Failed:', err.message);
  if (err.response) console.error('   Response:', err.response.body);
  process.exit(1);
});
