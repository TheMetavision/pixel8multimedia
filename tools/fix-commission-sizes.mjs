#!/usr/bin/env node
/**
 * tools/fix-commission-sizes.mjs
 *
 * Commission print sizes move to the 3:2 set in the shared print spec
 * (netlify/functions/_shared/print-spec.mjs, COMMISSION_SIZE_LABELS):
 *   landscape  12×8 / 18×12 / 24×16   (was 12×8 / 16×12 / 24×16)
 *   portrait    8×12 / 12×18 / 16×24  (was 8×12 / 12×18 / 18×24 — Star Power)
 *
 * What it changes in Sanity:
 *   - service.printSizeLabels, for services still on an old set
 *   - the two FAQs that quote those sizes (Your Song Your Story, Star Power)
 * What it does NOT change:
 *   - size KEYS or prices (service.printUpcharges is keyed small/medium/large,
 *     so prices stay where they are — review the medium price, now 18×12)
 *   - existing commission docs (they store size keys, not labels)
 *   - square services (Back in Time) or services with no labels (Cartoonify,
 *     which shows the square default): reported, left alone
 *
 * Usage (needs SANITY_TOKEN in .env):
 *   node tools/fix-commission-sizes.mjs           # dry run: show the plan
 *   node tools/fix-commission-sizes.mjs --apply   # write it
 */
import dotenv from 'dotenv';
import { createClient } from '@sanity/client';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMISSION_SIZE_LABELS, SIZE_LABELS } from '../netlify/functions/_shared/print-spec.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(ROOT, '.env'), quiet: true });
const APPLY = process.argv.includes('--apply');

const OLD = {
  landscape: { small: 'Small (12×8")', medium: 'Medium (16×12")', large: 'Large (24×16")' },
  portrait: { small: 'Small (8×12")', medium: 'Medium (12×18")', large: 'Large (18×24")' },
};
const FAQ_EDITS = [
  { id: 'faq-ysys-print-process', from: 'three sizes (12×8, 16×12, 24×16)', to: 'three sizes (12×8, 18×12, 24×16)' },
  { id: 'faq-sp-format', from: '• Large — 18×24"', to: '• Large — 16×24"' },
];

const same = (a, b) => a && b && ['small', 'medium', 'large'].every((k) => a[k] === b[k]);
const show = (l) => (l ? `${l.small} / ${l.medium} / ${l.large}` : '(none)');

async function main() {
  if (!process.env.SANITY_TOKEN) { console.error('SANITY_TOKEN is not set.'); return 1; }
  const sanity = createClient({
    projectId: 'bqb4w421', dataset: 'production', apiVersion: '2024-12-01',
    token: process.env.SANITY_TOKEN, useCdn: false, perspective: 'raw',
  });

  console.log(`\n  Commission sizes → 3:2 — ${APPLY ? 'APPLY' : 'DRY RUN (nothing written)'}\n`);
  const services = await sanity.fetch(
    `*[_type == "service" && !(_id in path("drafts.**"))] | order(sortOrder asc){ _id, _rev, title, "slug": slug.current, hasPrintOrder, printSizeLabels, printUpcharges }`,
  );
  const drafts = new Set(await sanity.fetch(`*[_type == "service" && _id in path("drafts.**")]._id`));

  const patches = [];
  console.log('  Services:');
  for (const s of services) {
    const cur = s.printSizeLabels;
    let target = null;
    let note = '';
    if (same(cur, OLD.landscape)) target = COMMISSION_SIZE_LABELS.landscape;
    else if (same(cur, OLD.portrait)) target = COMMISSION_SIZE_LABELS.portrait;
    else if (same(cur, COMMISSION_SIZE_LABELS.landscape) || same(cur, COMMISSION_SIZE_LABELS.portrait)) note = 'already 3:2 — unchanged';
    else if (same(cur, SIZE_LABELS)) note = 'square 12×12 / 16×16 / 20×20 — LEFT ALONE (square service)';
    else if (!cur) note = s.hasPrintOrder ? 'no labels → square default on the site — LEFT ALONE' : 'no prints — n/a';
    else note = 'unrecognised labels — LEFT ALONE, check by hand';
    const line = `    ${s.slug.padEnd(22)} ${show(cur)}`;
    if (target) {
      console.log(`${line}\n    ${''.padEnd(22)} → ${show(target)}`);
      patches.push({ id: s._id, rev: s._rev, set: { printSizeLabels: { ...target } }, label: `service ${s.slug}` });
      if (drafts.has(`drafts.${s._id}`)) patches.push({ id: `drafts.${s._id}`, set: { printSizeLabels: { ...target } }, label: `service ${s.slug} (draft)` });
    } else {
      console.log(`${line}   [${note}]`);
    }
  }

  const priced = services.filter((s) => s.printUpcharges);
  console.log(`\n  Prices: ${priced.length} services hold printUpcharges per format × size KEY (small/medium/large).`);
  console.log('  They are not changed. Medium is now 18×12 (was 16×12) at the same price — review if that should move.');

  console.log('\n  FAQs:');
  for (const e of FAQ_EDITS) {
    const doc = await sanity.getDocument(e.id);
    if (!doc) { console.log(`    ${e.id.padEnd(26)} not found — skipped`); continue; }
    if (doc.answer?.includes(e.to)) { console.log(`    ${e.id.padEnd(26)} already updated`); continue; }
    if (!doc.answer?.includes(e.from)) { console.log(`    ${e.id.padEnd(26)} expected text not found — LEFT ALONE, check by hand`); continue; }
    console.log(`    ${e.id.padEnd(26)} "${e.from}" → "${e.to}"`);
    patches.push({ id: doc._id, rev: doc._rev, set: { answer: doc.answer.split(e.from).join(e.to) }, label: `faq ${e.id}` });
  }

  console.log(`\n  ${patches.length} change(s) planned.`);
  if (!APPLY) { console.log('  Nothing written. Re-run with --apply to write.\n'); return 0; }

  for (const p of patches) {
    try {
      let patch = sanity.patch(p.id).set(p.set);
      if (p.rev) patch = patch.ifRevisionId(p.rev); // refuse if it changed since the plan was made
      await patch.commit({ visibility: 'sync' });
      console.log(`  written  ${p.label}`);
    } catch (err) {
      console.error(`  FAILED   ${p.label}: ${err?.message}. Stopping; earlier changes stay.`);
      return 1;
    }
  }
  console.log('\n  Done. Redeploy isn\'t needed for Sanity content, but the site rebuild picks up service labels.\n');
  return 0;
}

// process.exitCode, not process.exit(): exiting while fetch sockets close
// trips a libuv assertion on Windows (Node 24).
process.exitCode = await main();
