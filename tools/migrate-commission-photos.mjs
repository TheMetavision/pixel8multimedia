#!/usr/bin/env node
/**
 * tools/migrate-commission-photos.mjs
 *
 * Moves customers' commission photos out of Sanity (image assets are public
 * by URL and anonymously listable) into the private Netlify Blobs store
 * "commission-uploads", and deletes the orphan uploads from abandoned forms.
 * The finished-artwork file is NOT touched.
 *
 * Per photo (see commission-photos/migrate-lib.mjs): copy to Blobs, verify by
 * sha256; transaction 1 adds the uploadedPhotos entry and removes EVERY
 * reference to the asset from the commission and any draft (the uploadedFiles
 * entry with its stored filename, and any leftover image field); then, once a
 * fresh query shows nothing references the asset, transaction 2 deletes it.
 * Sanity refuses a delete in the same transaction that removes the last
 * reference, which is why these are two steps. Stops at the first error.
 * Safe to re-run: keys are deterministic, an identical blob isn't re-sent,
 * and an asset left between the two transactions is deleted by the orphan
 * phase (which re-checks for references first).
 *
 * Usage (from the repo root; needs .env):
 *   node tools/migrate-commission-photos.mjs              # dry run: the plan (SANITY_TOKEN)
 *   node tools/migrate-commission-photos.mjs --validate   # downloads + hashes, reads Blobs, and sends
 *                                                         # transaction 1 and the orphan delete with
 *                                                         # dryRun: nothing written
 *   node tools/migrate-commission-photos.mjs --apply      # do it (also NETLIFY_SITE_ID, NETLIFY_AUTH_TOKEN)
 *
 * Prints ids, keys and sizes only: never names, emails, filenames or URLs.
 */
import dotenv from 'dotenv';
import { createClient } from '@sanity/client';
import { getStore } from '@netlify/blobs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planMigration, migratePhoto, deleteOrphans } from './commission-photos/migrate-lib.mjs';
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
    token: process.env.SANITY_TOKEN, useCdn: false, perspective: 'raw', // raw: drafts count as references too
  });
  const store = haveBlobs
    ? getStore({ name: UPLOADS_STORE, siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_AUTH_TOKEN, consistency: 'strong' })
    : null;

  const title = { dry: 'DRY RUN (nothing read from Blobs, nothing written)', validate: 'VALIDATE (nothing written)', apply: 'APPLY' }[mode];
  console.log(`\n  Commission photos → Blobs "${UPLOADS_STORE}" — ${title}\n`);

  const commissions = await sanity.fetch(`*[_type == "commission" && !(_id in path("drafts.**")) && count(uploadedFiles) > 0] | order(_id asc){
    _id, "hasDraft": defined(*[_id == "drafts." + ^._id][0]._id),
    "entries": uploadedFiles[]{ _key, fieldKey, "assetId": asset._ref, "bytes": asset->size, "sha1": asset->sha1hash, "mime": asset->mimeType,
      "w": asset->metadata.dimensions.width, "h": asset->metadata.dimensions.height, "url": asset->url }
  }`);
  const attachedIds = new Set(commissions.flatMap((c) => (c.entries || []).map((e) => e.assetId)));
  // Every commission-upload asset not in the photo plan is an orphan candidate;
  // each is re-checked for references (published or draft) before deletion.
  const labelled = await sanity.fetch(`*[_type in ["sanity.imageAsset", "sanity.fileAsset"] && label == "commission-upload"]
      | order(_createdAt asc){ _id, size, mimeType, _createdAt }`);
  const plan = planMigration(commissions, labelled.filter((a) => !attachedIds.has(a._id)));

  console.log(`  Attached photos to move: ${plan.photos.length}`);
  for (const p of plan.photos) {
    console.log(`    ${p.commissionId.padEnd(26)} ${p.fieldKey.padEnd(15)} ${String(p.width)}×${String(p.height).padEnd(5)} ${p.mime.padEnd(10)} ${MB(p.bytes).padStart(9)}  ${p.assetId}${p.hasDraft ? '  (+draft)' : ''}`);
    console.log(`      → ${p.newKey}`);
  }
  for (const pr of plan.problems) console.log(`    PROBLEM ${pr}`);
  console.log(`\n  Orphan commission-upload assets (deleted only if nothing references them): ${plan.orphans.length} (${MB(plan.orphans.reduce((s, o) => s + o.size, 0))})`);
  for (const o of plan.orphans) console.log(`    ${o._id.padEnd(72)} ${MB(o.size).padStart(9)}  ${o._createdAt.slice(0, 10)}`);
  console.log('\n  Left alone: the finished-artwork file (see the report for its plan).');
  if (plan.problems.length) { console.error('\n  Stopping: fix the problems above first. Nothing was written.\n'); return 1; }

  if (mode === 'dry') {
    console.log('\n  Nothing written. --validate checks every step without writing; --apply migrates.\n');
    return 0;
  }

  // Every document referencing an asset, published AND drafts (raw perspective).
  const refsTo = (assetId) => sanity.fetch('*[references($assetId)]', { assetId });
  // Transaction 1. Returns the resulting documents so the lib can check that no
  // reference survives. ifRevisionId: refuse if a doc changed since it was read.
  const commitRefs = async (patches, { dryRun }) => {
    const tx = sanity.transaction();
    for (const p of patches) {
      tx.patch(p.id, (q) => {
        let r = q.ifRevisionId(p.rev);
        if (p.append) r = r.setIfMissing({ uploadedPhotos: [] }).append('uploadedPhotos', [p.append]);
        return p.unset.length ? r.unset(p.unset) : r;
      });
    }
    const res = await tx.commit({ dryRun, returnDocuments: true, visibility: 'sync' });
    return Array.isArray(res) ? res : (res?.documents || res?.results?.map((x) => x.document).filter(Boolean) || []);
  };
  // Transaction 2.
  const deleteAsset = (assetId) => sanity.transaction().delete(assetId).commit({ visibility: 'sync' });
  const deleteAssets = (ids, { dryRun }) => {
    const tx = sanity.transaction();
    for (const id of ids) tx.delete(id);
    return tx.commit({ dryRun, visibility: 'sync' });
  };
  // ?dlRaw= (authenticated) returns the ORIGINAL file. The plain CDN URL, and
  // ?dl=, re-encode JPEGs, so their bytes differ from the asset (size and sha1).
  const fetchBytes = async (photo) => {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(`${photo.url}?dlRaw=`, { headers: { Authorization: `Bearer ${process.env.SANITY_TOKEN}` } });
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
      const r = await migratePhoto(photo, { mode, store, fetchBytes, refsTo, commitRefs, deleteAsset });
      n++;
      const what = mode === 'apply'
        ? `moved; references removed from ${r.patched.join(' + ')}; asset deleted`
        : `ok — bytes verified; step 1 (dryRun) leaves no reference in ${r.patched.join(' + ')}; step 2 would then delete the asset`;
      console.log(`  ${photo.commissionId} ${photo.entryKey}  sha256 ${r.sha.slice(0, 12)}…${r.alreadyThere ? ' (blob already there)' : ''}  ${what}`);
    } catch (err) {
      console.error(`  FAILED ${photo.commissionId} ${photo.entryKey}: ${err.message}`);
      console.error(`  ${n} of ${plan.photos.length} done before this. Stopping.\n`);
      return 1;
    }
  }
  if (plan.orphans.length) {
    try {
      const o = await deleteOrphans(plan.orphans, { mode, refsTo, deleteAssets });
      for (const s of o.skipped) console.log(`  SKIPPED orphan ${s.id}: referenced by ${s.by.join(', ')}`);
      console.log(`  ${mode === 'apply' ? 'deleted' : 'ok — dryRun delete accepted for'} ${o.deleted.length} orphan asset(s)${o.skipped.length ? `; skipped ${o.skipped.length}` : ''}`);
    } catch (err) {
      console.error(`  FAILED deleting orphans: ${err.message}. Photos above are done; re-run to retry.\n`);
      return 1;
    }
  }
  console.log(`\n  Done (${mode}). ${mode === 'apply' ? 'Now run: node tools/check-public-exposure.mjs' : 'Nothing was written.'}\n`);
  return 0;
}

process.exitCode = await main();
