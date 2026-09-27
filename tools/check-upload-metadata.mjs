#!/usr/bin/env node
/**
 * tools/check-upload-metadata.mjs — READ-ONLY
 *
 * Lists the customer photos in the Blobs store "commission-uploads" and
 * reports, for each, whether it still carries EXIF, GPS or XMP metadata.
 * Photos uploaded before chore/forms-hardening (including the 6 migrated from
 * Sanity) were stored as sent; newer uploads are stripped on the way in.
 * Changes nothing. Prints keys (truncated) and flags only.
 *
 *   node tools/check-upload-metadata.mjs      (needs NETLIFY_SITE_ID, NETLIFY_AUTH_TOKEN in .env)
 */
import dotenv from 'dotenv';
import { getStore } from '@netlify/blobs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readExif } from '../netlify/functions/_shared/strip-metadata.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(ROOT, '.env'), quiet: true });
const sharp = createRequire(join(ROOT, 'package.json'))('sharp');

async function main() {
  if (!process.env.NETLIFY_SITE_ID || !process.env.NETLIFY_AUTH_TOKEN) {
    console.error('NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN must be set in .env.');
    return 1;
  }
  const store = getStore({ name: 'commission-uploads', siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_AUTH_TOKEN, consistency: 'strong' });
  let blobs;
  try {
    ({ blobs } = await store.list({ prefix: 'commission-upload/' }));
  } catch (err) {
    console.error(`Could not read the store: ${err.message}. A 401 means NETLIFY_AUTH_TOKEN (or NETLIFY_SITE_ID) in .env isn't valid for this site any more.`);
    return 1;
  }
  console.log(`\n  commission-uploads: ${blobs.length} photo(s)\n`);
  let withExif = 0, withGps = 0, withXmp = 0;
  for (const b of blobs) {
    const buf = Buffer.from(await store.get(b.key, { type: 'arrayBuffer' }));
    const m = await sharp(buf).metadata().catch(() => ({}));
    let gps = false;
    if (m.exif) {
      withExif++;
      const i = m.exif.indexOf('Exif');
      gps = readExif(m.exif.subarray(i >= 0 ? i + 6 : 0)).hasGps;
    }
    if (gps) withGps++;
    if (m.xmp) withXmp++;
    console.log(`  ${b.key.slice('commission-upload/'.length, 'commission-upload/'.length + 13)}…  ${String(m.format).padEnd(5)} exif:${m.exif ? 'yes' : 'no '} gps:${gps ? 'YES' : 'no '} xmp:${m.xmp ? 'yes' : 'no'}`);
  }
  console.log(`\n  with EXIF: ${withExif}   with GPS: ${withGps}   with XMP: ${withXmp}\n`);
  return 0;
}

process.exitCode = await main();
