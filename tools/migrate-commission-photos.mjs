#!/usr/bin/env node
/**
 * tools/migrate-commission-photos.mjs
 *
 * Moves customers' commission photos out of Sanity (image assets are public
 * by URL and anonymously listable) into the private Netlify Blobs store
 * "commission-uploads", and deletes the orphan uploads from abandoned forms.
 * The finished-artwork file is NOT touched.
 *
 * Per photo, all-or-nothing (see commission-photos/migrate-lib.mjs): copy to
 * Blobs, verify by sha256, then one Sanity transaction that moves the entry
 * to uploadedPhotos (without the stored original filename), removes it from
 * uploadedFiles, and deletes the asset. Stops at the first error. Safe to
 * re-run: keys are deterministic and an identical blob isn't re-sent.
 *
 * Usage (from the repo root; needs .env):
 *   node tools/migrate-commission-photos.mjs              # dry run: the plan (SANITY_TOKEN)
 *   node tools/migrate-commission-photos.mjs --validate   # downloads + hashes, reads Blobs, and sends
 *                                                         # each Sanity transaction with dryRun: nothing written
 *   node tools/migrate-commission-photos.mjs --apply      # do it (also NETLIFY_SITE_ID, NETLIFY_AUTH_TOKEN)
 *
 * Prints ids, keys and sizes only: never names, emails, filenames or URLs.
 */
import dotenv from 'dotenv';
import { createClient } from '@sanity/client';
import { getStore } from '@netlify/blobs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planMigration, migratePhoto } from './commission-photos/migrate-lib.mjs';
import { UPLOADS_STORE } from '../netlify/functions/_shared/commission-uploads.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(ROOT, '.env'), quiet: true });
const APPLY = process.argv.includes('--apply');
const VALIDATE = process.argv.includes('--validate');
const mode = APPLY ? 'apply' : VALIDATE ? 'validate' : 'dry';
const MB = (b) => `${(b / 1048576).toFixed(2)} MB`;

async function main() {
  if (APPLY && VALIDATE) { console.error('Use --apply or --validate, not both.'); return 1; }
  if (!process.env.SANITY_TOKEN) { console.error('SANITY_TOKEN is not set.'); return 1; }
  const haveBlobs = Boolean(process.env.NETLIFY_SITE_ID && process.env.NETLIFY_AUTH_TOKEN);
  if (mode !== 'dry' && !haveBlobs) { console.error('NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN must be set for --validate / --apply.'); return 1; }

  const sanity = createClient({
    projectId: 'bqb4w421', dataset: 'production', apiVersion: '2024-12-01',
    token: process.env.SANITY_TOKEN, useCdn: false, perspective: 'raw',
  });
  const store = haveBlobs
    ? getStore({ name: UPLOADS_STORE, siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_AUTH_TOKEN, consistency: 'strong' })
    : null;

  console.log(`\n  Commission photos → Blobs "${UPLOADS_STORE}" — ${{ dry: 'DRY RUN (nothing read from Blobs, nothing written)', validate: 'VALIDATE (nothing written)', apply: 'APPLY' }[mode]}\n`);

  const commissions = await sanity.fetch(`*[_type == "commission" && !(_id in path("drafts.**")) && count(uploadedFiles) > 0] | order(_id asc){
    _id, _rev, "hasDraft": defined(*[_id == "drafts." + ^._id][0]._id),
    "entries": uploadedFiles[]{ _key, fieldKey, "assetId": asset._ref, "bytes": asset->size, "mime": asset->mimeType,
      "w": asset->metadata.dimensions.width, "h": asset->metadata.dimensions.height, "url": asset->url }
  }`);
  const orphans = await sanity.fetch(`*[_type in ["sanity.imageAsset", "sanity.fileAsset"] && label == "commission-upload"
      && count(*[references(^._id)]) == 0] | order(_createdAt asc){ _id, size, mimeType, _createdAt }`);
  const plan = planMigration(commissions, orphans);

  console.log(`  Attached photos to move: ${plan.photos.length}`);
  for (const p of plan.photos) {
    console.log(`    ${p.commissionId.padEnd(26)} ${p.fieldKey.padEnd(15)} ${String(p.width)}×${String(p.height).padEnd(5)} ${p.mime.padEnd(10)} ${MB(p.bytes).padStart(9)}  ${p.assetId}${p.hasDraft ? '  (+draft)' : ''}`);
    console.log(`      → ${p.newKey}`);
  }
  for (const pr of plan.problems) console.log(`    PROBLEM ${pr}`);
  console.log(`\n  Orphan commission-upload assets to delete: ${plan.orphans.length} (${MB(plan.orphans.reduce((s, o) => s + o.size, 0))})`);
  for (const o of plan.orphans) console.log(`    ${o._id.padEnd(72)} ${MB(o.size).padStart(9)}  ${o._createdAt.slice(0, 10)}`);
  console.log('\n  Left alone: the finished-artwork file (see the report for its plan).');
  if (plan.problems.length) { console.error('\n  Stopping: fix the problems above first. Nothing was written.\n'); return 1; }

  if (mode === 'dry') {
    console.log('\n  Nothing written. --validate checks every step without writing; --apply migrates.\n');
    return 0;
  }

  const commitPhoto = async (photo, entry, { dryRun }) => {
    const tx = sanity.transaction();
    for (const id of [photo.commissionId, ...(photo.hasDraft ? [`drafts.${photo.commissionId}`] : [])]) {
      tx.patch(id, (p) => p
        .setIfMissing({ uploadedPhotos: [] })
        .append('uploadedPhotos', [entry])
        .unset([`uploadedFiles[_key=="${photo.entryKey}"]`]));
    }
    tx.delete(photo.assetId);
    await tx.commit({ dryRun, visibility: 'sync' });
  };
  const fetchBytes = async (photo) => {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(photo.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return Buffer.from(await res.arrayBuffer());
      } catch (err) {
        if (attempt >= 3) throw new Error(`could not download ${photo.assetId}: ${err.message}`);
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  };

  console.log('');
  let n = 0;
  for (const photo of plan.photos) {
    try {
      const r = await migratePhoto(photo, { mode, store, fetchBytes, commitPhoto });
      n++;
      console.log(`  ${mode === 'apply' ? 'moved ' : 'ok    '} ${photo.commissionId} ${photo.entryKey}  sha256 ${r.sha.slice(0, 12)}…${r.alreadyThere ? '  (blob already there)' : ''}`);
    } catch (err) {
      console.error(`  FAILED ${photo.commissionId} ${photo.entryKey}: ${err.message}`);
      console.error(`  ${n} of ${plan.photos.length} done before this; this photo is unchanged. Stopping.\n`);
      return 1;
    }
  }
  if (plan.orphans.length) {
    try {
      const tx = sanity.transaction();
      for (const o of plan.orphans) tx.delete(o._id);
      await tx.commit({ dryRun: mode !== 'apply', visibility: 'sync' });
      console.log(`  ${mode === 'apply' ? 'deleted' : 'ok     '} ${plan.orphans.length} orphan asset(s)`);
    } catch (err) {
      console.error(`  FAILED deleting orphans: ${err.message}. Photos above are done; re-run to retry.\n`);
      return 1;
    }
  }
  console.log(`\n  Done (${mode}). Now run: node tools/check-public-exposure.mjs\n`);
  return 0;
}

process.exitCode = await main();
