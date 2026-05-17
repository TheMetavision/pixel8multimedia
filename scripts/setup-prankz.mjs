/**
 * Prankz! — pricing + briefing migration.
 *
 *   - digitalPrice: £19.99
 *   - animationMusicPrice: £79.99
 *   - animationVoPrice: £99.99
 *   - artworkFee: £19.99 (standalone single-print only)
 *   - artworkBundledWithDigital: TRUE (default)
 *   - artworkFeePerOrder: FALSE (default)
 *   - printUpcharges: standard in-house pricing
 *   - printSizeLabels: rectangular (12×8 / 16×12 / 24×16)
 *
 * Briefing fields:
 *   - Always: name, email, who is this for, victim photo, scenario, tone,
 *     anything else, AND the new CONSENT CHECKBOX
 *   - Animation paths: scene direction (optional), camera, mood, pacing, music
 *     genre (all leave-it-to-us options)
 *   - Animation + VO: voiceover script (optional), voice character, accent,
 *     notes
 *
 * The consent checkbox uses the NEW `checkbox` fieldType. Requires the schema
 * patch in this bundle to be deployed first, otherwise the field will render
 * incorrectly in Studio.
 *
 * Examples are LEFT UNCHANGED per spec — the existing three (Mate...That's My
 * Nan!, A Bit Spursy, Carrots Have Feelings To!) are already complete.
 *
 * Run once:
 *   cd C:\Users\chris\Projects\pixel8
 *   $env:SANITY_TOKEN = (Get-Content .env | Select-String "^SANITY_TOKEN=").Line -replace "^SANITY_TOKEN=", ""
 *   node scripts/setup-prankz.mjs
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

const SERVICE_ID = '15hxv4Rz0BxauBoW2SzsOs';

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
    _key: 'bf-prz-name',
    _type: 'briefingField',
    key: 'customerName',
    label: 'Your name',
    fieldType: 'text',
    required: true,
  },
  {
    _key: 'bf-prz-email',
    _type: 'briefingField',
    key: 'customerEmail',
    label: 'Email address',
    fieldType: 'email',
    helperText: "We'll send your finished file here.",
    required: true,
  },
  {
    _key: 'bf-prz-subject',
    _type: 'briefingField',
    key: 'subject',
    label: 'Who is this for?',
    fieldType: 'text',
    helperText: 'The friend, family member, or colleague you\'re pranking.',
    required: true,
  },
  {
    _key: 'bf-prz-victim-photo',
    _type: 'briefingField',
    key: 'subjectPhoto',
    label: 'Photo of the victim',
    fieldType: 'photo',
    helperText: 'A clear, well-lit photo. Front-facing works best.',
    required: true,
  },
  {
    _key: 'bf-prz-scenario',
    _type: 'briefingField',
    key: 'scenario',
    label: 'The absurd scenario',
    fieldType: 'textarea',
    helperText: 'Be specific. "The boss riding a unicorn on Mars" beats "make it funny".',
    required: true,
  },
  {
    _key: 'bf-prz-tone',
    _type: 'briefingField',
    key: 'tone',
    label: 'How mean?',
    fieldType: 'select',
    options: [
      "Gentle (they'll laugh)",
      "Pointed (they'll laugh, eventually)",
      "Savage (consequences possible)",
    ],
    required: true,
  },

  // ── Animation paths only ───────────────────────────────────────────────────
  {
    _key: 'bf-prz-scene-action',
    _type: 'briefingField',
    key: 'sceneAction',
    label: 'Scene direction (optional)',
    fieldType: 'textarea',
    helperText: 'Want to direct the action? Describe how the prank unfolds in 30 seconds — the setup, the escalation, the reveal. Leave blank and we\'ll structure it our way.',
    required: false,
    showFor: ['animation-music', 'animation-vo'],
  },
  {
    _key: 'bf-prz-camera-movement',
    _type: 'briefingField',
    key: 'cameraMovement',
    label: 'Camera movement preference',
    fieldType: 'select',
    helperText: 'How should the camera behave during the shot?',
    options: [
      'Leave it to you',
      'Static (no movement)',
      'Slow zoom in (building tension)',
      'Quick zoom / snap',
      'Handheld / shaky-cam realism',
      'Smooth tracking',
    ],
    required: false,
    showFor: ['animation-music', 'animation-vo'],
  },
  {
    _key: 'bf-prz-mood',
    _type: 'briefingField',
    key: 'mood',
    label: 'Mood',
    fieldType: 'select',
    helperText: 'Overall vibe for the piece.',
    options: [
      'Leave it to you',
      'Suspicious / "wait what"',
      'Cinematic and serious (heightening the absurdity)',
      'Slapstick / comedy',
      'Dramatic / horror parody',
      'News-report serious',
      'Soap opera / tabloid',
    ],
    required: false,
    showFor: ['animation-music', 'animation-vo'],
  },
  {
    _key: 'bf-prz-pacing',
    _type: 'briefingField',
    key: 'pacing',
    label: 'Pacing',
    fieldType: 'select',
    helperText: 'How quickly should the prank unfold?',
    options: [
      'Leave it to you',
      'Slow burn (savour it)',
      'Natural',
      'Snappy (straight to the punchline)',
    ],
    required: false,
    showFor: ['animation-music', 'animation-vo'],
  },
  {
    _key: 'bf-prz-music-genre',
    _type: 'briefingField',
    key: 'musicGenre',
    label: 'Music style / genre',
    fieldType: 'select',
    helperText: "We'll generate a custom soundtrack matching your chosen vibe. Pick a style or leave the call to us.",
    options: [
      'Leave it to you — match the mood',
      'Dramatic / cinematic suspense',
      'Slapstick / comedy',
      'News theme / serious investigative',
      'Soap opera / tabloid drama',
      'Action / thriller',
      'Quirky / playful',
      'Tense / building dread',
    ],
    required: true,
    showFor: ['animation-music', 'animation-vo'],
  },

  // ── Voiceover only ─────────────────────────────────────────────────────────
  {
    _key: 'bf-prz-vo-script',
    _type: 'briefingField',
    key: 'voiceoverScript',
    label: 'Voiceover script (optional)',
    fieldType: 'textarea',
    helperText: 'Want to write the narration yourself? Around 80 words for 30 seconds. Or leave blank and we\'ll write a script that suits the scenario and tone.',
    required: false,
    showFor: ['animation-vo'],
  },
  {
    _key: 'bf-prz-vo-character',
    _type: 'briefingField',
    key: 'voiceCharacter',
    label: 'Voice characteristics',
    fieldType: 'select',
    helperText: 'The kind of voice that should narrate. We use AI generation.',
    options: [
      'Leave it to you',
      'News anchor (male, serious)',
      'News anchor (female, serious)',
      'Documentary narrator',
      'Soap opera narrator / dramatic',
      'Sports commentator (excitable)',
      'Reality TV narrator',
      'Old movie newsreel announcer',
      'Custom (describe in notes)',
    ],
    required: true,
    showFor: ['animation-vo'],
  },
  {
    _key: 'bf-prz-vo-accent',
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
    _key: 'bf-prz-vo-notes',
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
    _key: 'bf-prz-notes',
    _type: 'briefingField',
    key: 'notes',
    label: 'Anything else we should know?',
    fieldType: 'textarea',
    helperText: 'Specific details, references, vibes, things to avoid.',
    required: false,
  },

  // ── Consent (always, required, MUST be last so customer reads everything first) ──
  {
    _key: 'bf-prz-consent',
    _type: 'briefingField',
    key: 'prankConsent',
    label: 'I confirm this is a harmless prank, I have the subject\'s photo legitimately, and I understand the output is fictional and for entertainment only.',
    fieldType: 'checkbox',
    helperText: 'We reserve the right to refuse any commission we judge to be harmful, harassing, defamatory, sexual, or otherwise unsuitable.',
    required: true,
  },
];

const STEPS = [
  {
    _key: 'step-prz-0',
    _type: 'object',
    text: 'Upload a clear photo of the victim and describe your absurd scenario.',
  },
  {
    _key: 'step-prz-1',
    _type: 'object',
    text: 'Choose how you want it delivered — digital still, prints, or a 30-second animated short.',
  },
  {
    _key: 'step-prz-2',
    _type: 'object',
    text: 'We craft a photorealistic edit (and optional short animation) where the prank comes to life.',
  },
  {
    _key: 'step-prz-3',
    _type: 'object',
    text: 'Receive your final HD creation via secure download link. Send it — then wait for the reaction.',
  },
];

const IMPORTANT_NOTE =
  'All Prankz outputs are fictional creations for entertainment only. We do not create illegal, explicit, sexual, defamatory, or otherwise harmful content. All output is designed to be harmless, reversible, and prank-safe. For animated films: 30-second sequences with a custom soundtrack. Voiceovers (when selected) are AI-generated; you can write the script yourself or leave it to us. We can\'t lip-sync the voiceover to the victim\'s mouth, do complex multi-character interactions, or recreate copyrighted scenes. If a request crosses into harmful territory, we\'ll get in touch to discuss before processing — and we reserve the right to refuse any commission.';

const DESCRIPTION =
  'Prank your friends with images that look way too real to ignore. Prankz lets you commission realistic, fictional photos — and optional 30-second animated shorts — designed to spark confusion, laughter, and the inevitable "WHAT IS THIS?!" message.';

async function run() {
  if (!process.env.SANITY_TOKEN) {
    console.error('❌ SANITY_TOKEN env var not set.');
    process.exit(1);
  }

  console.log('📝 Updating Prankz! with new pricing model...\n');
  console.log('   digitalPrice:                £19.99');
  console.log('   animationMusicPrice:         £79.99');
  console.log('   animationVoPrice:            £99.99');
  console.log('   artworkFee:                  £19.99 (standalone print only)');
  console.log('   artworkBundledWithDigital:   TRUE (bundle waives the fee)');
  console.log('   printUpcharges:              standard in-house pricing');
  console.log('   printSizeLabels:             12×8 / 16×12 / 24×16');
  console.log('   briefingFields:              17 fields including consent checkbox');
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

  console.log('✅ Prankz! updated successfully.');
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
  console.log('    Consent answer is stored on the commission doc for record.');
  console.log('');
  console.log('📝 Trigger a Netlify rebuild to flush the live site.');
}

run().catch((err) => {
  console.error('\n❌ Failed:', err.message);
  if (err.response) console.error('   Response:', err.response.body);
  process.exit(1);
});
