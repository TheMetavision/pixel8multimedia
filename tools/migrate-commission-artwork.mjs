#!/usr/bin/env node
/**
 * tools/migrate-commission-artwork.mjs
 *
 * Moves finished commission artwork out of Sanity (file assets are public by
 * URL, and were delivered through a function capped at 20 MB) into the
 * private Blobs store "commission-artwork", listed on the commission as
 * finishedArtwork — exactly as the upload page stores new work. Then removes
 * every reference to the Sanity asset and deletes it, in two transactions
 * (see commission-artwork/migrate-lib.mjs). Stops at the first error.
 * Safe to re-run: ids are deterministic and an intact copy isn't re-sent.
 *
 * A commission whose emailed link is still live (delivered < 30 days ago) is
 * skipped: that link reads the Sanity file. --include-live overrides.
 *
 * Usage (from the repo root; needs .env):
 *   node tools/migrate-commission-artwork.mjs              # dry run: the plan (SANITY_TOKEN)
 *   node tools/migrate-commission-artwork.mjs --validate   # downloads + hashes, reads Blobs, sends
 *                                                          # transaction 1 with dryRun: nothing written
 *   node tools/migrate-commission-artwork.mjs --apply      # do it (also NETLIFY_SITE_ID, NETLIFY_AUTH_TOKEN)
 *
 * Prints ids, order refs, keys and sizes only: never names, emails, the
 * original filename or URLs.
 */
import dotenv from 'dotenv';
import { createClient } from '@sanity/client';
import { getStore } from '@netlify/blobs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planArtwork, migrateArtwork } from './commission-artwork/migrate-lib.mjs';
import { ARTWORK_STORE, manifestKey } from '../netlify/functions/_shared/artwork-keys.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(ROOT, '.env'), quiet: true });
const APPLY = process.argv.includes('--apply');
const VALIDATE = process.argv.includes('--validate');
const INCLUDE_LIVE = process.argv.includes('--include-live');
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
    ? getStore({ name: ARTWORK_STORE, siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_AUTH_TOKEN, consistency: 'strong' })
    : null;

  const title = { dry: 'DRY RUN (nothing read from Blobs, nothing written)', validate: 'VALIDATE (nothing written)', apply: 'APPLY' }[mode];
  console.log(`\n  Finished artwork → Blobs "${ARTWORK_STORE}" — ${title}\n`);

  const commissions = await sanity.fetch(`*[_type == "commission" && !(_id in path("drafts.**")) && defined(finishedFile.asset)] | order(_id asc){
    _id, orderRef, status, deliveredAt,
    "hasDraft": defined(*[_id == "drafts." + ^._id][0]._id),
    "artworkCount": count(finishedArtwork),
    "file": { "assetId": finishedFile.asset._ref, "bytes": finishedFile.asset->size, "sha1": finishedFile.asset->sha1hash,
              "mime": finishedFile.asset->mimeType, "ext": finishedFile.asset->extension, "url": finishedFile.asset->url }
  }`);
  const draftIds = await sanity.fetch('*[_type == "commission" && _id in path("drafts.**") && defined(finishedFile.asset)]._id');
  const published = new Set(commissions.map((c) => c._id));
  const drafted = draftIds.filter((id) => !published.has(id.replace(/^drafts\./, ''))).length;
  const plan = planArtwork(commissions, { includeLive: INCLUDE_LIVE });

  console.log(`  Commissions with a Sanity finished file: ${commissions.length}`);
  for (const i of plan.items) {
    console.log(`    ${i.commissionId.padEnd(30)} ${String(i.orderRef).padEnd(12)} ${i.contentType.padEnd(16)} ${MB(i.bytes).padStart(9)}  ${i.parts} part(s)  ${i.assetId}${i.hasDraft ? '  (+draft)' : ''}`);
    console.log(`      → ${manifestKey(i.orderRef, i.uploadId)}  as "${i.filename}"${i.linkExpired === true ? '  (emailed link expired)' : i.linkExpired === null ? '  (never delivered)' : ''}`);
  }
  for (const pr of plan.problems) console.log(`    SKIPPED ${pr}`);
  if (drafted) console.log(`    NOTE ${drafted} draft(s) hold a finished file their published commission doesn't — publish or discard them, then re-run.`);

  if (mode === 'dry') {
    console.log(`\n  Nothing written. --validate checks every step without writing; --apply migrates.\n`);
    return 0;
  }

  const refsTo = (assetId) => sanity.fetch('*[references($assetId)]', { assetId });
  const commitRefs = async (patches, { dryRun }) => {
    const tx = sanity.transaction();
    for (const p of patches) {
      tx.patch(p.id, (q) => {
        let r = q.ifRevisionId(p.rev);
        if (p.append) r = r.setIfMissing({ finishedArtwork: [] }).append('finishedArtwork', [p.append]);
        return p.unset.length ? r.unset(p.unset) : r;
      });
    }
    const res = await tx.commit({ dryRun, returnDocuments: true, visibility: 'sync' });
    return Array.isArray(res) ? res : (res?.documents || res?.results?.map((x) => x.document).filter(Boolean) || []);
  };
  const deleteAsset = (assetId) => sanity.transaction().delete(assetId).commit({ visibility: 'sync' });
  // ?dlRaw= (authenticated) returns the ORIGINAL file.
  const fetchBytes = async (item) => {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(`${item.url}?dlRaw=`, { headers: { Authorization: `Bearer ${process.env.SANITY_TOKEN}` } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return Buffer.from(await res.arrayBuffer());
      } catch (err) {
        if (attempt >= 3) throw new Error(`could not download ${item.assetId}: ${err.message}`);
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  };

  console.log('');
  let n = 0;
  for (const item of plan.items) {
    try {
      const r = await migrateArtwork(item, { mode, store, fetchBytes, refsTo, commitRefs, deleteAsset, now: () => Date.now() });
      n++;
      const what = mode === 'apply'
        ? `moved; listed and references removed on ${r.patched.join(' + ')}; asset deleted`
        : `ok — bytes verified; step 1 (dryRun) lists it and leaves no reference in ${r.patched.join(' + ')}; step 2 would then delete the asset`;
      console.log(`  ${item.commissionId}  sha256 ${r.sha.slice(0, 12)}…${r.alreadyThere ? ' (already in Blobs)' : ''}  ${what}`);
    } catch (err) {
      console.error(`  FAILED ${item.commissionId}: ${err.message}`);
      console.error(`  ${n} of ${plan.items.length} done before this. Stopping.\n`);
      return 1;
    }
  }
  console.log(`\n  Done (${mode}). ${mode === 'apply' ? 'Now run: node tools/check-public-exposure.mjs' : 'Nothing was written.'}\n`);
  return 0;
}

process.exitCode = await main();
