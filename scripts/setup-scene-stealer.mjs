/**
 * Scene Stealer — pricing + briefing migration.
 *
 *   - digitalPrice: £19.99
 *   - animationMusicPrice: £79.99
 *   - animationVoPrice: £99.99
 *   - artworkFee: £19.99 (standalone single-print only)
 *   - artworkBundledWithDigital: TRUE (default — bundle waives the fee)
 *   - artworkFeePerOrder: FALSE (default)
 *   - printUpcharges: standard in-house pricing
 *   - printSizeLabels: rectangular (12×8 / 16×12 / 24×16)
 *
 * Briefing fields (16 + consent = 17 total):
 *   - Always: name, email, who is this for, FILM (not scene), CHARACTER (required),
 *     photo, anything else
 *   - Animation paths: scene direction (optional), camera, mood, pacing, music genre
 *   - Animation + VO: voiceover script (optional), narrator voice (no actor
 *     impersonation), accent, notes
 *   - Always last: consent checkbox
 *
 * Examples LEFT UNCHANGED — three existing entries (Back To The Future, Star
 * Wars, Grease) are already complete.
 *
 * Run once:
 *   cd C:\Users\chris\Projects\pixel8
 *   $env:SANITY_TOKEN = (Get-Content .env | Select-String "^SANITY_TOKEN=").Line -replace "^SANITY_TOKEN=", ""
 *   node scripts/setup-scene-stealer.mjs
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

const SERVICE_ID = '15hxv4Rz0BxauBoW2SzqBh';

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
    _key: 'bf-ss-name',
    _type: 'briefingField',
    key: 'customerName',
    label: 'Your name',
    fieldType: 'text',
    required: true,
  },
  {
    _key: 'bf-ss-email',
    _type: 'briefingField',
    key: 'customerEmail',
    label: 'Email address',
    fieldType: 'email',
    helperText: "We'll send your finished file here.",
    required: true,
  },
  {
    _key: 'bf-ss-subject',
    _type: 'briefingField',
    key: 'subject',
    label: 'Who is this for?',
    fieldType: 'text',
    helperText: 'The person whose face we\'re inserting into the scene. Often this is you; for gifts, the recipient.',
    required: true,
  },
  {
    _key: 'bf-ss-film',
    _type: 'briefingField',
    key: 'film',
    label: 'Which film?',
    fieldType: 'text',
    helperText: 'The film you want to appear in. We pull from a huge library, so mainstream choices work brilliantly. Include the year if there\'s any ambiguity (e.g. "Ocean\'s Eleven (2001)" vs "Ocean\'s Eleven (1960)").',
    required: true,
  },
  {
    _key: 'bf-ss-character',
    _type: 'briefingField',
    key: 'character',
    label: 'Which character do you want to replace?',
    fieldType: 'text',
    helperText: 'The specific character whose role you\'ll take on. We\'ll feature you across a range of scenes from the chosen film as that character.',
    required: true,
  },
  {
    _key: 'bf-ss-photo',
    _type: 'briefingField',
    key: 'subjectPhoto',
    label: 'Photo of the subject',
    fieldType: 'photo',
    helperText: 'Clear, well-lit, facing the camera. Full or half body works best.',
    required: true,
  },

  // ── Animation paths only ───────────────────────────────────────────────────
  {
    _key: 'bf-ss-scene-action',
    _type: 'briefingField',
    key: 'sceneAction',
    label: 'Scene direction (optional)',
    fieldType: 'textarea',
    helperText: 'Want to direct the action? Describe how your 30-second sequence should unfold — which moments to include, where the emphasis sits. Leave blank and we\'ll choose the most iconic beats.',
    required: false,
    showFor: ['animation-music', 'animation-vo'],
  },
  {
    _key: 'bf-ss-camera-movement',
    _type: 'briefingField',
    key: 'cameraMovement',
    label: 'Camera movement preference',
    fieldType: 'select',
    helperText: 'How should the camera behave?',
    options: [
      'Leave it to you',
      'Faithful to the original film',
      'Static / locked off',
      'Slow zoom in',
      'Dynamic tracking',
      'Handheld realism',
      'Dramatic crane / sweeping',
    ],
    required: false,
    showFor: ['animation-music', 'animation-vo'],
  },
  {
    _key: 'bf-ss-mood',
    _type: 'briefingField',
    key: 'mood',
    label: 'Mood',
    fieldType: 'select',
    helperText: 'Overall vibe.',
    options: [
      'Leave it to you',
      'Faithful to the original scene',
      'Cinematic and dramatic',
      'Tense / thriller',
      'Romantic / emotional',
      'Comedic / light-hearted',
      'Action / high-energy',
      'Atmospheric / moody',
    ],
    required: false,
    showFor: ['animation-music', 'animation-vo'],
  },
  {
    _key: 'bf-ss-pacing',
    _type: 'briefingField',
    key: 'pacing',
    label: 'Pacing',
    fieldType: 'select',
    helperText: 'How quickly should the scene unfold?',
    options: [
      'Leave it to you',
      'Slow burn',
      'Natural',
      'Snappy / quick cuts',
    ],
    required: false,
    showFor: ['animation-music', 'animation-vo'],
  },
  {
    _key: 'bf-ss-music-genre',
    _type: 'briefingField',
    key: 'musicGenre',
    label: 'Music style / genre',
    fieldType: 'select',
    helperText: "We'll generate a custom soundtrack — we can't use the original film score for copyright reasons, but we'll match the vibe.",
    options: [
      'Leave it to you — match the scene',
      'Orchestral / epic score',
      'Synth / 80s soundtrack',
      'Action / thriller',
      'Romantic / sweeping strings',
      'Comedic / playful',
      'Tense / horror',
      'Period-appropriate (jazz / rock / classical)',
      'Quirky / indie',
    ],
    required: true,
    showFor: ['animation-music', 'animation-vo'],
  },

  // ── Voiceover only — NARRATOR ONLY (no actor impersonation) ────────────────
  {
    _key: 'bf-ss-vo-script',
    _type: 'briefingField',
    key: 'voiceoverScript',
    label: 'Voiceover script (optional)',
    fieldType: 'textarea',
    helperText: 'A narrator describes the scene in third person — like a movie trailer or behind-the-scenes feature. Around 80 words for 30 seconds. Or leave blank and we\'ll write one that fits.',
    required: false,
    showFor: ['animation-vo'],
  },
  {
    _key: 'bf-ss-vo-character',
    _type: 'briefingField',
    key: 'voiceCharacter',
    label: 'Narrator voice',
    fieldType: 'select',
    helperText: 'A narrator describes the scene — we don\'t impersonate the original actors\' voices for legal reasons.',
    options: [
      'Leave it to you',
      'Movie trailer voice',
      'Documentary narrator',
      'Behind-the-scenes presenter',
      'News anchor (male, serious)',
      'News anchor (female, serious)',
      'Storyteller / friendly',
      'Sports commentator (excitable)',
      'Custom (describe in notes)',
    ],
    required: true,
    showFor: ['animation-vo'],
  },
  {
    _key: 'bf-ss-vo-accent',
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
    _key: 'bf-ss-vo-notes',
    _type: 'briefingField',
    key: 'voiceNotes',
    label: 'Voiceover notes',
    fieldType: 'textarea',
    helperText: 'Optional. Specific tone, pauses, emphasis, custom narrator description, or anything to avoid.',
    required: false,
    showFor: ['animation-vo'],
  },

  // ── Catch-all (always) ─────────────────────────────────────────────────────
  {
    _key: 'bf-ss-notes',
    _type: 'briefingField',
    key: 'notes',
    label: 'Anything else we should know?',
    fieldType: 'textarea',
    helperText: 'Specific scenes to focus on, things to avoid, vibe notes.',
    required: false,
  },

  // ── Consent (always, required, last) ───────────────────────────────────────
  {
    _key: 'bf-ss-consent',
    _type: 'briefingField',
    key: 'sceneStealerConsent',
    label: 'I confirm this image is for personal entertainment only, will not be redistributed, sold, or presented as official film content, and that I understand the output is a fictional artistic recreation. I confirm I have not requested content involving minors in adult roles, sexual or violent scene recreations, or anything intended to deceive viewers.',
    fieldType: 'checkbox',
    helperText: 'We reserve the right to refuse any commission we judge to be infringing, deceptive, or unsuitable. If you\'ve picked a more obscure film we may not have it in our library — we\'ll get in touch before processing and refund if we can\'t deliver.',
    required: true,
  },
];

const STEPS = [
  {
    _key: 'step-ss-0',
    _type: 'object',
    text: 'Upload a clear photo of the subject (yourself, or the recipient if it\'s a gift).',
  },
  {
    _key: 'step-ss-1',
    _type: 'object',
    text: 'Tell us which film you want to appear in and which character you want to replace.',
  },
  {
    _key: 'step-ss-2',
    _type: 'object',
    text: 'Choose how you want it delivered — digital still, prints, or a 30-second animated short.',
  },
  {
    _key: 'step-ss-3',
    _type: 'object',
    text: 'We craft a photorealistic edit (and optional short animation) showing you across a range of scenes from the chosen film.',
  },
  {
    _key: 'step-ss-4',
    _type: 'object',
    text: 'Receive your finished file (and prints if ordered) via secure link or post.',
  },
];

const IMPORTANT_NOTE =
  'All images and animations created through Scene Stealer are fictional, artistic recreations made for personal entertainment only. They are not endorsements, official film content, or affiliated with the original studios, actors, or rights holders. For animated films: 30-second sequences with a custom soundtrack (we can\'t use the original film score for copyright reasons but we\'ll match the vibe). Voiceovers (when selected) are AI-generated narrators describing the scene — we don\'t impersonate the original actors\' voices. We work from a huge library of mainstream films; if you choose a more obscure title we may not be able to recreate it and will contact you before processing. We don\'t recreate scenes involving graphic violence, sexual content, content involving minors, or scenes from films where the IP holder is actively litigious. We reserve the right to refuse any commission that crosses into infringement territory.';

const DESCRIPTION =
  "Become the star of cinema's most iconic films. From action epics to romantic classics, we replace the character of your choice with YOU — flawlessly integrated into the set, lighting, and mood across a range of scenes from your chosen film.";

async function run() {
  if (!process.env.SANITY_TOKEN) {
    console.error('❌ SANITY_TOKEN env var not set.');
    process.exit(1);
  }

  console.log('📝 Updating Scene Stealer with new pricing model...\n');
  console.log('   digitalPrice:                £19.99');
  console.log('   animationMusicPrice:         £79.99');
  console.log('   animationVoPrice:            £99.99');
  console.log('   artworkFee:                  £19.99 (standalone print only)');
  console.log('   artworkBundledWithDigital:   TRUE (bundle waives the fee)');
  console.log('   printUpcharges:              standard in-house pricing');
  console.log('   printSizeLabels:             12×8 / 16×12 / 24×16');
  console.log('   briefingFields:              17 fields incl. consent checkbox');
  console.log('   field model:                 FILM-based (not scene-based)');
  console.log('   character field:             REQUIRED (was optional)');
  console.log('   voiceover policy:            narrator-only (no actor impersonation)');
  console.log('   examples:                    LEFT UNCHANGED\n');

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
    })
    .commit();

  console.log('✅ Scene Stealer updated successfully.');
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
  console.log('  Standalone Poster Small:                    £29.98  (£9.99 + £19.99 artwork)');
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
