/**
 * Populate all 12 Pixel8 services with their briefing fields + pricing.
 *
 * Run once after deploying the extended service.ts schema:
 *   cd C:\Users\chris\Projects\pixel8
 *   $env:SANITY_TOKEN = "<editor token>"
 *   node scripts/populate-services.mjs
 *
 * Safe to re-run — uses .set() so it always overwrites with the latest config.
 * To adjust prices/fields per service, edit the SERVICE_CONFIG below and re-run.
 *
 * IMPORTANT: Deploy the schema FIRST with `npx sanity schemas deploy`,
 * otherwise these patches will be rejected for fields the schema doesn't know about.
 */

import { createClient } from '@sanity/client';

const client = createClient({
  projectId: 'bqb4w421',
  dataset: 'production',
  apiVersion: '2024-01-01',
  token: process.env.SANITY_TOKEN,
  useCdn: false,
});

// ─── Shared print upcharges (identical across all services that offer print) ──
const standardPrintUpcharges = {
  poster: { small: 14.99, medium: 18.99, large: 22.99 },
  canvasStandard: { small: 32.99, medium: 38.99, large: 49.99 },
  canvasGallery: { small: 35.99, medium: 41.99, large: 52.99 },
};

// Stills to Reels has no print path — sells as digital animation only
const noPrintUpcharges = {
  poster: { small: 0, medium: 0, large: 0 },
  canvasStandard: { small: 0, medium: 0, large: 0 },
  canvasGallery: { small: 0, medium: 0, large: 0 },
};

// ─── Field templates ─────────────────────────────────────────────────────────
// Re-usable so we don't repeat name/email definitions 12 times.
const fName = {
  _type: 'briefingField',
  key: 'customerName',
  label: 'Your name',
  fieldType: 'text',
  required: true,
};
const fEmail = {
  _type: 'briefingField',
  key: 'customerEmail',
  label: 'Email address',
  fieldType: 'email',
  helperText: "We'll send your finished file here.",
  required: true,
};
const fPhone = {
  _type: 'briefingField',
  key: 'customerPhone',
  label: 'Phone number',
  fieldType: 'phone',
  helperText: 'Optional — only if you want us to call you about the brief.',
  required: false,
};
const fSubject = {
  _type: 'briefingField',
  key: 'subject',
  label: 'Who is this for?',
  fieldType: 'text',
  helperText: 'The person, pet or family member the commission is about.',
  required: true,
};
const fNotes = {
  _type: 'briefingField',
  key: 'notes',
  label: 'Anything else we should know?',
  fieldType: 'textarea',
  helperText: 'Specific details, references, vibes, things to avoid.',
  required: false,
};

// Add keys (Sanity arrays of objects need stable _key per item)
function withKeys(arr) {
  return arr.map((item, i) => ({
    ...item,
    _key: `bf-${Date.now().toString(36)}-${i}`,
  }));
}

// ─── Per-service configuration ───────────────────────────────────────────────
const SERVICE_CONFIG = {
  'cartoonify-me': {
    price: 19.99,
    printUpcharges: standardPrintUpcharges,
    briefingFields: withKeys([
      fName,
      fEmail,
      fSubject,
      {
        _type: 'briefingField',
        key: 'style',
        label: 'Which design option?',
        fieldType: 'styleSwatch',
        helperText: 'Pick the style you want your cartoon to be drawn in. Each option has its own look — see /store for full examples.',
        required: true,
      },
      {
        _type: 'briefingField',
        key: 'subjectPhoto',
        label: 'Photo of the subject',
        fieldType: 'photo',
        helperText: 'Clear, well-lit, facing the camera. JPG or PNG.',
        required: true,
      },
      fNotes,
    ]),
  },

  'stills-to-reels': {
    price: 39.99,
    printUpcharges: noPrintUpcharges,
    briefingFields: withKeys([
      fName,
      fEmail,
      {
        _type: 'briefingField',
        key: 'reelType',
        label: 'Animation style',
        fieldType: 'select',
        options: ['Background music only', 'Music + voiceover', 'Music + voiceover + subtitles'],
        required: true,
      },
      {
        _type: 'briefingField',
        key: 'sourcePhotos',
        label: 'Source photos',
        fieldType: 'photos',
        minPhotos: 1,
        maxPhotos: 6,
        helperText: '1–6 photos to animate. Higher resolution = better result.',
        required: true,
      },
      {
        _type: 'briefingField',
        key: 'voiceoverScript',
        label: 'Voiceover script (if applicable)',
        fieldType: 'textarea',
        helperText: 'Leave blank if you chose music-only.',
        required: false,
      },
      fNotes,
    ]),
  },

  'the-missing-moment': {
    price: 49.99,
    printUpcharges: standardPrintUpcharges,
    briefingFields: withKeys([
      fName,
      fEmail,
      fPhone,
      {
        _type: 'briefingField',
        key: 'sceneBrief',
        label: 'Describe the moment',
        fieldType: 'textarea',
        helperText: 'In your own words — where it would have been, who was there, what the mood should feel like.',
        required: true,
      },
      {
        _type: 'briefingField',
        key: 'people',
        label: 'Who is in the scene?',
        fieldType: 'text',
        helperText: 'Names and relationships (e.g. "My grandfather Tom, my mum Jane, me as a child").',
        required: true,
      },
      {
        _type: 'briefingField',
        key: 'subjectPhotos',
        label: 'Reference photos of the people',
        fieldType: 'photos',
        minPhotos: 1,
        maxPhotos: 10,
        helperText: 'The more photos of each person, the better the likeness. Casual photos work better than studio shots.',
        required: true,
      },
      {
        _type: 'briefingField',
        key: 'locationPhotos',
        label: 'Reference photos of the location',
        fieldType: 'photos',
        minPhotos: 0,
        maxPhotos: 5,
        helperText: 'Optional. The room, the venue, the view — anything that anchors the setting.',
        required: false,
      },
      fNotes,
    ]),
  },

  'past-perfect': {
    price: 24.99,
    printUpcharges: standardPrintUpcharges,
    briefingFields: withKeys([
      fName,
      fEmail,
      {
        _type: 'briefingField',
        key: 'restorationType',
        label: 'What do you need?',
        fieldType: 'select',
        options: ['Repair only (fix damage, keep B&W)', 'Repair + colourise', 'Colourise only (no damage to fix)'],
        required: true,
      },
      {
        _type: 'briefingField',
        key: 'sourcePhoto',
        label: 'The photo to restore',
        fieldType: 'photo',
        helperText: 'A scan or clear phone photo of the original. Daylight, no flash glare.',
        required: true,
      },
      {
        _type: 'briefingField',
        key: 'damageNotes',
        label: 'What damage should we fix?',
        fieldType: 'textarea',
        helperText: 'Optional. E.g. "Tear across grandma\'s face, fading on the right side."',
        required: false,
      },
      fNotes,
    ]),
  },

  'your-song-your-story': {
    price: 44.99,
    printUpcharges: standardPrintUpcharges,
    briefingFields: withKeys([
      fName,
      fEmail,
      fSubject,
      {
        _type: 'briefingField',
        key: 'songTitle',
        label: 'Song title',
        fieldType: 'text',
        required: true,
      },
      {
        _type: 'briefingField',
        key: 'artist',
        label: 'Artist',
        fieldType: 'text',
        required: true,
      },
      {
        _type: 'briefingField',
        key: 'meaning',
        label: 'Why this song?',
        fieldType: 'textarea',
        helperText: 'What does it mean to you / the recipient? Where were you when you first heard it? What does it remind you of?',
        required: true,
      },
      {
        _type: 'briefingField',
        key: 'date',
        label: 'Date to include',
        fieldType: 'text',
        helperText: 'Optional — anniversary, first dance, etc.',
        required: false,
      },
      fNotes,
    ]),
  },

  'story-of-your-life': {
    price: 79.99,
    printUpcharges: standardPrintUpcharges,
    briefingFields: withKeys([
      fName,
      fEmail,
      fPhone,
      fSubject,
      {
        _type: 'briefingField',
        key: 'momentCount',
        label: 'How many moments?',
        fieldType: 'select',
        options: ['6 moments', '8 moments', '10 moments', '12 moments'],
        required: true,
      },
      {
        _type: 'briefingField',
        key: 'momentBrief',
        label: 'List each moment',
        fieldType: 'textarea',
        helperText: 'For each moment include the approximate year and what it should depict. E.g. "1962 — born in Manchester / 1968 — first day at school" etc.',
        required: true,
      },
      {
        _type: 'briefingField',
        key: 'referencePhotos',
        label: 'Reference photos',
        fieldType: 'photos',
        minPhotos: 6,
        maxPhotos: 12,
        helperText: 'One photo per moment if possible. Older / lower quality photos are fine.',
        required: true,
      },
      fNotes,
    ]),
  },

  'back-in-time': {
    price: 34.99,
    printUpcharges: standardPrintUpcharges,
    briefingFields: withKeys([
      fName,
      fEmail,
      fSubject,
      {
        _type: 'briefingField',
        key: 'era',
        label: 'Which era?',
        fieldType: 'select',
        options: ['1920s', '1950s', '1960s', '1970s', '1980s', '1990s', 'Victorian', 'Edwardian', 'Renaissance', 'Other (describe below)'],
        required: true,
      },
      {
        _type: 'briefingField',
        key: 'sourcePhoto',
        label: 'Photo of the subject(s)',
        fieldType: 'photo',
        helperText: 'Clear, well-lit, facing camera. Multiple people OK.',
        required: true,
      },
      {
        _type: 'briefingField',
        key: 'styleNotes',
        label: 'Specific style notes',
        fieldType: 'textarea',
        helperText: 'Optional. Speakeasy / disco / Sunday best / specific film references all work.',
        required: false,
      },
      fNotes,
    ]),
  },

  'the-day-i-met': {
    price: 29.99,
    printUpcharges: standardPrintUpcharges,
    briefingFields: withKeys([
      fName,
      fEmail,
      fSubject,
      {
        _type: 'briefingField',
        key: 'celebrity',
        label: 'Which celebrity?',
        fieldType: 'text',
        helperText: 'Living or otherwise. Include surname if there are multiple famous people with the same first name.',
        required: true,
      },
      {
        _type: 'briefingField',
        key: 'vibe',
        label: 'What kind of meeting?',
        fieldType: 'select',
        options: ['Casual snapshot', 'Red carpet', 'Backstage', 'Studio / set', 'Sporting event', 'Concert', 'Restaurant / bar'],
        required: true,
      },
      {
        _type: 'briefingField',
        key: 'subjectPhoto',
        label: 'Photo of you',
        fieldType: 'photo',
        helperText: 'Clear, well-lit, facing the camera. Full or half body.',
        required: true,
      },
      fNotes,
    ]),
  },

  'scene-stealer': {
    price: 29.99,
    printUpcharges: standardPrintUpcharges,
    briefingFields: withKeys([
      fName,
      fEmail,
      fSubject,
      {
        _type: 'briefingField',
        key: 'scene',
        label: 'Which scene?',
        fieldType: 'text',
        helperText: 'Film + scene description. E.g. "The Goonies — treasure room", "Pulp Fiction — diner".',
        required: true,
      },
      {
        _type: 'briefingField',
        key: 'character',
        label: 'Which character do you want to be?',
        fieldType: 'text',
        helperText: 'Optional — leave blank and we\'ll add you as yourself.',
        required: false,
      },
      {
        _type: 'briefingField',
        key: 'subjectPhoto',
        label: 'Photo of you',
        fieldType: 'photo',
        helperText: 'Clear, well-lit, facing the camera. Full or half body.',
        required: true,
      },
      fNotes,
    ]),
  },

  'crayon-to-creation': {
    price: 34.99,
    printUpcharges: standardPrintUpcharges,
    briefingFields: withKeys([
      fName,
      fEmail,
      {
        _type: 'briefingField',
        key: 'childAge',
        label: "Child's age when they drew it",
        fieldType: 'text',
        helperText: 'Approximate is fine. Helps us match the energy of the restyle.',
        required: false,
      },
      {
        _type: 'briefingField',
        key: 'whatItIs',
        label: "What's the drawing of?",
        fieldType: 'textarea',
        helperText: 'Tell us anything we might not be able to tell from looking at it. E.g. "the dog on the left is Max, the yellow blob in the sky is Grandma".',
        required: true,
      },
      {
        _type: 'briefingField',
        key: 'sourceDrawing',
        label: 'The drawing',
        fieldType: 'photo',
        helperText: 'A flat photo in good daylight, or a scan. JPG or PNG.',
        required: true,
      },
      fNotes,
    ]),
  },

  'star-power': {
    price: 39.99,
    printUpcharges: standardPrintUpcharges,
    briefingFields: withKeys([
      fName,
      fEmail,
      fSubject,
      {
        _type: 'briefingField',
        key: 'filmTitle',
        label: 'Which film?',
        fieldType: 'text',
        helperText: 'The film whose poster style you want to recreate.',
        required: true,
      },
      {
        _type: 'briefingField',
        key: 'role',
        label: 'What role should they play?',
        fieldType: 'select',
        options: ['Lead actor', 'Villain', 'Romantic interest', 'Sidekick', 'Cameo'],
        required: true,
      },
      {
        _type: 'briefingField',
        key: 'subjectPhoto',
        label: 'Photo of the subject',
        fieldType: 'photo',
        helperText: 'Clear, well-lit, facing the camera.',
        required: true,
      },
      fNotes,
    ]),
  },

  'prankz': {
    price: 29.99,
    printUpcharges: standardPrintUpcharges,
    briefingFields: withKeys([
      fName,
      fEmail,
      fSubject,
      {
        _type: 'briefingField',
        key: 'scenario',
        label: 'The absurd scenario',
        fieldType: 'textarea',
        helperText: 'Be specific. "The boss riding a unicorn on Mars" beats "make it funny".',
        required: true,
      },
      {
        _type: 'briefingField',
        key: 'tone',
        label: 'How mean?',
        fieldType: 'select',
        options: ['Gentle (they\'ll laugh)', 'Pointed (they\'ll laugh, eventually)', 'Savage (consequences possible)'],
        required: true,
      },
      {
        _type: 'briefingField',
        key: 'subjectPhoto',
        label: 'Photo of the victim',
        fieldType: 'photo',
        required: true,
      },
      fNotes,
    ]),
  },
};

// ─── Main run ────────────────────────────────────────────────────────────────
async function run() {
  if (!process.env.SANITY_TOKEN) {
    console.error('❌ SANITY_TOKEN env var not set.');
    console.error('   PowerShell: $env:SANITY_TOKEN = "sk..."');
    process.exit(1);
  }

  console.log('🔍 Fetching all services from Sanity…');
  const services = await client.fetch(
    `*[_type == "service"]{ _id, "slug": slug.current, title }`
  );
  console.log(`   Found ${services.length} services\n`);

  let patched = 0;
  let skipped = 0;
  const missing = [];

  for (const svc of services) {
    const config = SERVICE_CONFIG[svc.slug];
    if (!config) {
      console.log(`   ⚠ Skipping "${svc.title}" — no config for slug "${svc.slug}"`);
      missing.push(svc.slug);
      skipped++;
      continue;
    }

    console.log(`   ✓ Patching "${svc.title}"`);
    console.log(`     • Digital base: £${config.price.toFixed(2)}`);
    console.log(`     • Briefing fields: ${config.briefingFields.length}`);

    await client
      .patch(svc._id)
      .set({
        price: config.price,
        printUpcharges: config.printUpcharges,
        briefingFields: config.briefingFields,
        commissionEnabled: true,
      })
      .commit();

    patched++;
  }

  console.log(`\n✅ Done. ${patched} patched, ${skipped} skipped.`);
  if (missing.length > 0) {
    console.log(`\n⚠ Services with no config (add them to SERVICE_CONFIG and re-run):`);
    missing.forEach((s) => console.log(`     - ${s}`));
  }
  console.log(`\n📝 Next step: trigger a Netlify rebuild so the frontend picks up the new fields.`);
  console.log(`   (Sanity webhook should fire automatically. If not, hit "Trigger Deploy" in Netlify.)`);
}

run().catch((err) => {
  console.error('\n❌ Failed:', err.message);
  if (err.responseBody) console.error('   Response:', err.responseBody);
  process.exit(1);
});
