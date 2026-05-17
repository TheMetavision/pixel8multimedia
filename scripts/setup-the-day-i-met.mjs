/**
 * The Day I Met... — pricing + briefing migration.
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
 * Briefing fields:
 *   - Always: name, email, who is this for (gift use case), which celebrity,
 *     vibe, photo of you, anything else, AND CONSENT CHECKBOX
 *   - Animation paths: scene direction (optional), camera, mood, pacing,
 *     music genre — all with "Leave it to you"
 *   - Animation + VO: voiceover script (optional), narrator-only voice
 *     character (no celebrity impersonation), accent, notes
 *
 * Examples are LEFT UNCHANGED per spec — three existing entries (Messi,
 * Sabrina Carpenter, Mike Tyson) are already complete.
 *
 * Run once:
 *   cd C:\Users\chris\Projects\pixel8
 *   $env:SANITY_TOKEN = (Get-Content .env | Select-String "^SANITY_TOKEN=").Line -replace "^SANITY_TOKEN=", ""
 *   node scripts/setup-the-day-i-met.mjs
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

const SERVICE_ID = '15hxv4Rz0BxauBoW2Szpt4';

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
    _key: 'bf-tdim-name',
    _type: 'briefingField',
    key: 'customerName',
    label: 'Your name',
    fieldType: 'text',
    required: true,
  },
  {
    _key: 'bf-tdim-email',
    _type: 'briefingField',
    key: 'customerEmail',
    label: 'Email address',
    fieldType: 'email',
    helperText: "We'll send your finished file here.",
    required: true,
  },
  {
    _key: 'bf-tdim-subject',
    _type: 'briefingField',
    key: 'subject',
    label: 'Who is this for?',
    fieldType: 'text',
    helperText: 'The person whose "celebrity meeting" we\'re creating. Often this is you; for gifts, the recipient (e.g. "my dad").',
    required: true,
  },
  {
    _key: 'bf-tdim-celebrity',
    _type: 'briefingField',
    key: 'celebrity',
    label: 'Which celebrity?',
    fieldType: 'text',
    helperText: 'Living or otherwise. Include surname if there are multiple famous people with the same first name.',
    required: true,
  },
  {
    _key: 'bf-tdim-vibe',
    _type: 'briefingField',
    key: 'vibe',
    label: 'What kind of meeting?',
    fieldType: 'select',
    options: [
      'Casual snapshot',
      'Red carpet',
      'Backstage',
      'Studio / set',
      'Sporting event',
      'Concert',
      'Restaurant / bar',
    ],
    required: true,
  },
  {
    _key: 'bf-tdim-photo',
    _type: 'briefingField',
    key: 'subjectPhoto',
    label: 'Photo of the subject',
    fieldType: 'photo',
    helperText: 'Clear, well-lit, facing the camera. Full or half body works best.',
    required: true,
  },

  // ── Animation paths only ───────────────────────────────────────────────────
  {
    _key: 'bf-tdim-scene-action',
    _type: 'briefingField',
    key: 'sceneAction',
    label: 'Scene direction (optional)',
    fieldType: 'textarea',
    helperText: 'Want to direct the action? Describe how the meeting unfolds in 30 seconds — the greeting, the moment, what happens next. Leave blank and we\'ll structure it our way.',
    required: false,
    showFor: ['animation-music', 'animation-vo'],
  },
  {
    _key: 'bf-tdim-camera-movement',
    _type: 'briefingField',
    key: 'cameraMovement',
    label: 'Camera movement preference',
    fieldType: 'select',
    helperText: 'How should the camera behave during the shot?',
    options: [
      'Leave it to you',
      'Static (no movement)',
      'Slow zoom in',
      'Slow pan',
      'Handheld / candid realism',
      'Dynamic cinematic moves',
    ],
    required: false,
    showFor: ['animation-music', 'animation-vo'],
  },
  {
    _key: 'bf-tdim-mood',
    _type: 'briefingField',
    key: 'mood',
    label: 'Mood',
    fieldType: 'select',
    helperText: 'Overall vibe for the piece.',
    options: [
      'Leave it to you',
      'Casual and authentic',
      'Star-struck and excited',
      'Cool and composed',
      'Cinematic and dramatic',
      'Fun and playful',
      'Awkward / candid moment',
    ],
    required: false,
    showFor: ['animation-music', 'animation-vo'],
  },
  {
    _key: 'bf-tdim-pacing',
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
    _key: 'bf-tdim-music-genre',
    _type: 'briefingField',
    key: 'musicGenre',
    label: 'Music style / genre',
    fieldType: 'select',
    helperText: "We'll generate a custom soundtrack matching your chosen vibe. Pick a style or leave the call to us.",
    options: [
      'Leave it to you — match the vibe',
      'Cinematic / epic',
      'Upbeat / pop',
      'Glamorous / Hollywood',
      'Sport / triumphant',
      'Concert / live music vibe',
      'Documentary / interview',
      'Quirky / playful',
    ],
    required: true,
    showFor: ['animation-music', 'animation-vo'],
  },

  // ── Voiceover only — NARRATOR ONLY (no celebrity impersonation) ────────────
  {
    _key: 'bf-tdim-vo-script',
    _type: 'briefingField',
    key: 'voiceoverScript',
    label: 'Voiceover script (optional)',
    fieldType: 'textarea',
    helperText: 'A narrator describes the fictional meeting in third person. Around 80 words for 30 seconds. Or leave blank and we\'ll write a script that fits the scene.',
    required: false,
    showFor: ['animation-vo'],
  },
  {
    _key: 'bf-tdim-vo-character',
    _type: 'briefingField',
    key: 'voiceCharacter',
    label: 'Narrator voice',
    fieldType: 'select',
    helperText: 'A narrator describes the meeting — we don\'t impersonate the celebrity\'s actual voice.',
    options: [
      'Leave it to you',
      'Documentary narrator',
      'News anchor (male, serious)',
      'News anchor (female, serious)',
      'Sports commentator (excitable)',
      'Movie trailer voice',
      'Storyteller / friendly',
      'Reality TV narrator',
      'Custom (describe in notes)',
    ],
    required: true,
    showFor: ['animation-vo'],
  },
  {
    _key: 'bf-tdim-vo-accent',
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
    _key: 'bf-tdim-vo-notes',
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
    _key: 'bf-tdim-notes',
    _type: 'briefingField',
    key: 'notes',
    label: 'Anything else we should know?',
    fieldType: 'textarea',
    helperText: 'Specific details, references, vibes, things to avoid.',
    required: false,
  },

  // ── Consent (always, required, last) ───────────────────────────────────────
  {
    _key: 'bf-tdim-consent',
    _type: 'briefingField',
    key: 'tdimConsent',
    label: 'I confirm this image is for personal entertainment only, will not be used to deceive anyone or imply real endorsement, and that I have not requested content involving celebrity children, deceased public figures in distressing contexts, sexual scenarios, or defamatory content.',
    fieldType: 'checkbox',
    helperText: 'We reserve the right to refuse any commission we judge to be deceptive, harmful, or unsuitable. The output is a fictional artistic recreation and must not be presented as a real encounter.',
    required: true,
  },
];

const STEPS = [
  {
    _key: 'step-tdim-0',
    _type: 'object',
    text: 'Upload a clear photo of the subject (yourself, or the recipient if it\'s a gift).',
  },
  {
    _key: 'step-tdim-1',
    _type: 'object',
    text: 'Tell us which celebrity to "meet" and choose the kind of meeting.',
  },
  {
    _key: 'step-tdim-2',
    _type: 'object',
    text: 'Choose how you want it delivered — digital still, prints, or a 30-second animated short.',
  },
  {
    _key: 'step-tdim-3',
    _type: 'object',
    text: 'We seamlessly merge the subject into the scene with cinematic realism.',
  },
  {
    _key: 'step-tdim-4',
    _type: 'object',
    text: 'Receive your finished file (and prints if ordered) via secure link or post.',
  },
];

const IMPORTANT_NOTE =
  'All images and animations created through The Day I Met... are fictional, artistic recreations made for entertainment and personal use only. They are not endorsements, real encounters, or affiliated with the celebrity depicted. For animated films: 30-second sequences with a custom soundtrack. Voiceovers (when selected) are AI-generated narrators describing the fictional meeting — we don\'t impersonate the celebrity\'s voice. We don\'t create content involving celebrity children, deceased public figures in distressing contexts, sexual or defamatory scenarios, or anything intended to deceive viewers into believing the encounter was real. We reserve the right to refuse any commission.';

const DESCRIPTION =
  "Ever wished you'd been there when it happened? The Day I Met... creates a believable, cinematic image of you alongside your favourite celebrity — and optionally a 30-second animated short — seamlessly merged as if the moment really took place.";

async function run() {
  if (!process.env.SANITY_TOKEN) {
    console.error('❌ SANITY_TOKEN env var not set.');
    process.exit(1);
  }

  console.log('📝 Updating The Day I Met... with new pricing model...\n');
  console.log('   digitalPrice:                £19.99');
  console.log('   animationMusicPrice:         £79.99');
  console.log('   animationVoPrice:            £99.99');
  console.log('   artworkFee:                  £19.99 (standalone print only)');
  console.log('   artworkBundledWithDigital:   TRUE (bundle waives the fee)');
  console.log('   printUpcharges:              standard in-house pricing');
  console.log('   printSizeLabels:             12×8 / 16×12 / 24×16');
  console.log('   briefingFields:              17 fields including consent checkbox');
  console.log('   voiceover policy:            narrator-only (no celebrity impersonation)');
  console.log('   examples:                    LEFT UNCHANGED (already complete)\n');

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

  console.log('✅ The Day I Met... updated successfully.');
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
