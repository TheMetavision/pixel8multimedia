#!/usr/bin/env node
/**
 * publish-renames.mjs
 *
 * Auto-publishes the drafts created by rename-catalogue.mjs.
 *
 * What it does:
 *   1. Loops the manifest (103 characters × 10 styles = 1,030 docs)
 *   2. For each, finds the draft (drafts.product-<slug>-style-<x>) and publishes it
 *   3. For the 2 slug-fix characters (hans-solo, c3-p0), it ALSO deletes the
 *      orphan published documents under the OLD slug — otherwise the catalogue
 *      would have duplicate products.
 *
 * EXCLUDES the 12 personalised products entirely (they were not renamed).
 *
 * Reads:   scripts/subnames.json
 * Writes:  publishes drafts → live, deletes orphan old-slug published docs
 *
 * Run from project root:
 *   $env:SANITY_API_TOKEN = "sk-..."
 *   node scripts/publish-renames.mjs
 *
 * Options:
 *   --character=batman    Only publish one character (testing)
 *   --dry-run             Show what would happen (queries only, no writes)
 *   --skip-orphans        Don't delete orphan docs from slug fixes (just publish)
 *
 * Safe to re-run. Missing drafts are silently skipped (already-published case).
 */

import { createClient } from '@sanity/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PROJECT_ID = 'bqb4w421';
const DATASET = 'production';
const API_VERSION = '2024-01-01';
const MANIFEST_PATH = resolve('scripts/subnames.json');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const skipOrphans = args.includes('--skip-orphans');
const charArg = args.find(a => a.startsWith('--character='));
const onlyCharacter = charArg ? charArg.split('=')[1] : null;

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const { _meta, characters } = manifest;
const STYLE_ORDER = _meta.styleOrder;
const SLUG_FIXES = _meta.slugFixes || {};

// IMPORTANT: even in dry-run we need a real client to READ (check what drafts exist).
// The dryRun flag only suppresses WRITES.
const token = process.env.SANITY_API_TOKEN;
if (!token) {
  console.error('❌  SANITY_API_TOKEN env var not set.');
  console.error('   (Even --dry-run needs a token to read draft status from Sanity.)');
  process.exit(1);
}

const client = createClient({
  projectId: PROJECT_ID,
  dataset: DATASET,
  apiVersion: API_VERSION,
  token,
  useCdn: false,
});

async function publishOne(draftId, publishedId) {
  const draft = await client.getDocument(draftId);
  if (!draft) {
    return { skipped: true, reason: 'no draft' };
  }
  if (dryRun) {
    return { dryRun: true, title: draft.title };
  }
  const published = { ...draft, _id: publishedId };
  delete published._rev;
  delete published._createdAt;
  delete published._updatedAt;
  await client
    .transaction()
    .createOrReplace(published)
    .delete(draftId)
    .commit({ visibility: 'async' });
  return { ok: true };
}

async function deleteOrphan(oldPublishedId, oldDraftId) {
  const oldPub = await client.getDocument(oldPublishedId);
  const oldDraft = await client.getDocument(oldDraftId);

  const toDelete = [];
  if (oldPub) toDelete.push(oldPublishedId);
  if (oldDraft) toDelete.push(oldDraftId);

  if (!toDelete.length) return { skipped: true, reason: 'no orphan to delete' };

  if (dryRun) {
    return { dryRun: true, wouldDelete: toDelete };
  }

  const tx = client.transaction();
  for (const id of toDelete) tx.delete(id);
  await tx.commit({ visibility: 'async' });
  return { ok: true, deleted: toDelete.length };
}

async function main() {
  const entries = Object.entries(characters);
  const filtered = onlyCharacter
    ? entries.filter(([slug]) => slug === onlyCharacter)
    : entries;

  if (!filtered.length) {
    console.error(`❌  No character matched: ${onlyCharacter}`);
    process.exit(1);
  }

  const total = filtered.length * 10;
  console.log(`🚀  ${dryRun ? 'DRY-RUN: ' : ''}Publishing ${filtered.length} characters × 10 styles = ${total} products`);
  if (dryRun) console.log('   (querying Sanity to check status — no writes will occur)');
  if (skipOrphans) console.log('   (skipping orphan cleanup)');
  console.log('');

  let pubOk = 0, pubSkip = 0, pubErr = 0;
  let orphanOk = 0, orphanSkip = 0, orphanErr = 0;
  const errors = [];
  const skipped = [];

  for (const [slug, charData] of filtered) {
    const slugFix = SLUG_FIXES[slug] || null;
    const finalSlug = slugFix || slug;
    const fixNote = slugFix ? ` [slug fix: ${slug} → ${slugFix}]` : '';
    console.log(`\n📤  ${charData.displayName}${fixNote}`);

    for (const slot of STYLE_ORDER) {
      const draftId = `drafts.product-${finalSlug}-style-${slot}`;
      const publishedId = `product-${finalSlug}-style-${slot}`;
      try {
        const r = await publishOne(draftId, publishedId);
        if (r.ok) {
          pubOk++;
          process.stdout.write(`  ✅ ${slot.toUpperCase()}`);
        } else if (r.dryRun) {
          pubOk++;
          process.stdout.write(`  ✓  ${slot.toUpperCase()}`);
        } else if (r.skipped) {
          pubSkip++;
          skipped.push(`${finalSlug}-style-${slot}`);
          process.stdout.write(`  ⏭️  ${slot.toUpperCase()}`);
        }
      } catch (e) {
        pubErr++;
        errors.push({ slug: finalSlug, slot, op: 'publish', msg: e.message });
        process.stdout.write(`  ❌ ${slot.toUpperCase()}`);
      }

      if (slugFix && !skipOrphans) {
        const oldPublishedId = `product-${slug}-style-${slot}`;
        const oldDraftId = `drafts.product-${slug}-style-${slot}`;
        try {
          const r = await deleteOrphan(oldPublishedId, oldDraftId);
          if (r.ok) {
            orphanOk++;
            process.stdout.write(`🗑️ `);
          } else if (r.dryRun) {
            orphanOk++;
            process.stdout.write(`(would del ${r.wouldDelete.length}) `);
          } else if (r.skipped) {
            orphanSkip++;
          }
        } catch (e) {
          orphanErr++;
          errors.push({ slug, slot, op: 'orphan', msg: e.message });
          process.stdout.write(`💥`);
        }
      }
      process.stdout.write(' ');
    }
    process.stdout.write('\n');
    if (!dryRun) await new Promise(r => setTimeout(r, 100));
  }

  console.log('\n' + '='.repeat(60));
  console.log(`${dryRun ? 'DRY-RUN ' : ''}RESULTS`);
  console.log('='.repeat(60));
  const verb = dryRun ? 'would publish' : 'published';
  const verbSkip = dryRun ? 'no draft to publish' : 'skipped (no draft)';
  console.log(`Drafts:           ${pubOk} ${verb}, ${pubSkip} ${verbSkip}, ${pubErr} errors`);
  if (!skipOrphans) {
    const oVerb = dryRun ? 'would delete' : 'deleted';
    console.log(`Orphan cleanup:   ${orphanOk} ${oVerb}, ${orphanSkip} none found, ${orphanErr} errors`);
  }

  if (skipped.length) {
    console.log(`\nDocs with no draft (${skipped.length} total — could be already-published or rename never ran):`);
    for (const s of skipped.slice(0, 20)) console.log(`  ${s}`);
    if (skipped.length > 20) console.log(`  ... and ${skipped.length - 20} more`);
  }

  if (errors.length) {
    console.log('\nErrors:');
    for (const e of errors) {
      console.log(`  ${e.slug} style-${e.slot} [${e.op}]: ${e.msg}`);
    }
  }

  if (!dryRun && pubOk > 0) {
    console.log('\n🎉  Catalogue published. Visit your storefront or Sanity Studio to verify.');
  }
  if (dryRun) {
    console.log('\n✅  Dry-run complete. If numbers look right, re-run WITHOUT --dry-run.');
  }
}

main().catch(e => {
  console.error('💥  Fatal:', e);
  process.exit(1);
});
