// scripts/add-crayon-drawings.mjs
//
// Uploads three child's-drawing images to Sanity and inserts each into the
// matching Crayon To Creation example, tagged "Original Drawing", positioned
// between the existing "Original" (photo) and "Digital Still" (render).
//
// Service _id: 15hxv4Rz0BxauBoW2SzsD1
//
// Image → example mapping (confirmed):
//   monster   → Monsters Ink        (_key 46e76d50e0e5)
//   superhero → Little Hero Rising  (_key 5f1bb2b88fdb)
//   robot     → Leo And The Robot   (_key d61aa1205fb5)
//
// Saves the change as a DRAFT — review in Studio, then publish.
//
// Usage:
//   1. Place the three image files in scripts/crayon-drawings/ with the
//      names referenced in DRAWINGS below (or edit the paths to match).
//   2. cd C:\Users\chris\Projects\pixel8
//      $env:SANITY_TOKEN = "your-editor-token"
//      node scripts/add-crayon-drawings.mjs

import { createClient } from '@sanity/client';
import { readFileSync } from 'fs';
import { nanoid } from 'nanoid';
import { join } from 'path';

const client = createClient({
  projectId: 'bqb4w421',
  dataset: 'production',
  apiVersion: '2024-12-01',
  token: process.env.SANITY_TOKEN,
  useCdn: false,
});

const SERVICE_ID = '15hxv4Rz0BxauBoW2SzsD1';

// Each entry: the example _key, the local image file, and a human label.
// `file` is relative to scripts/crayon-drawings/ — adjust if you put them
// elsewhere.
const DRAWINGS = [
  {
    exampleKey: '46e76d50e0e5',
    exampleLabel: 'Monsters Ink',
    file: 'monsters-ink-drawing.png',
  },
  {
    exampleKey: '5f1bb2b88fdb',
    exampleLabel: 'Little Hero Rising',
    file: 'little-hero-drawing.png',
  },
  {
    exampleKey: 'd61aa1205fb5',
    exampleLabel: 'Leo And The Robot',
    file: 'leo-robot-drawing.png',
  },
];

const DRAWINGS_DIR = join(process.cwd(), 'scripts', 'crayon-drawings');

async function main() {
  if (!process.env.SANITY_TOKEN) {
    console.error('ERROR: SANITY_TOKEN env var not set.');
    process.exit(1);
  }

  // 1. Upload each drawing as a Sanity image asset
  console.log('Uploading drawings to Sanity...');
  for (const d of DRAWINGS) {
    const path = join(DRAWINGS_DIR, d.file);
    let buffer;
    try {
      buffer = readFileSync(path);
    } catch (e) {
      console.error(`ERROR: cannot read ${path} — ${e.message}`);
      process.exit(1);
    }
    const asset = await client.assets.upload('image', buffer, {
      filename: d.file,
    });
    d.assetId = asset._id;
    console.log(`  ${d.exampleLabel}: uploaded → ${asset._id}`);
  }

  // 2. Fetch the full service document (need _type, _rev, complete examples)
  const service = await client.getDocument(SERVICE_ID);
  if (!service) {
    console.error(`ERROR: service ${SERVICE_ID} not found.`);
    process.exit(1);
  }

  // 3. For each example, splice the new "Original Drawing" image between
  //    the existing "Original" and "Digital Still" entries.
  const examples = (service.examples || []).map((example) => {
    const drawing = DRAWINGS.find((d) => d.exampleKey === example._key);
    if (!drawing) return example; // not a Crayon example we're touching

    // Guard: skip if an "Original Drawing" image already exists (re-run safe)
    const alreadyHas = (example.images || []).some(
      (img) => img.tag === 'Original Drawing'
    );
    if (alreadyHas) {
      console.log(`  ${example.label}: already has an Original Drawing — skipping`);
      return example;
    }

    const newImage = {
      _key: nanoid(12),
      _type: 'object',
      tag: 'Original Drawing',
      image: {
        _type: 'image',
        asset: { _type: 'reference', _ref: drawing.assetId },
      },
    };

    // Find the index of the "Digital Still" image; insert the drawing
    // immediately before it. If not found, append after "Original".
    const images = [...(example.images || [])];
    const digitalIdx = images.findIndex((img) => img.tag === 'Digital Still');
    if (digitalIdx >= 0) {
      images.splice(digitalIdx, 0, newImage);
    } else {
      images.push(newImage);
    }

    console.log(`  ${example.label}: inserted Original Drawing at position ${digitalIdx >= 0 ? digitalIdx : images.length - 1}`);
    return { ...example, images };
  });

  // 4. Write the change as a draft
  const draftId = `drafts.${SERVICE_ID}`;
  const existingDraft = await client.getDocument(draftId).catch(() => null);
  const base = existingDraft || service;

  const draftDoc = { ...base, _id: draftId, examples };
  await client.createOrReplace(draftDoc);

  console.log('\nDone. Draft saved.');
  console.log('Review in Studio (Crayon To Creation service), then publish.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
