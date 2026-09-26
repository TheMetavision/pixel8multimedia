#!/usr/bin/env node
/**
 * tools/migrate-private-ids.mjs
 *
 * Moves customer documents to dotted _ids so anonymous API reads can't see
 * them. On the Free plan the dataset can't be made private, but any document
 * whose _id contains a "." is only readable with a token.
 *
 *   order              → order.<stripeSessionId>      (matches webhook.mjs)
 *   commission         → commission.<orderRef>        (matches commission-checkout)
 *   contactSubmission  → contactSubmission.<old _id>
 *   grouponVoucher     → grouponVoucher.<old _id>
 *
 * For each document, in ONE transaction:
 *   1. create the new doc: every field copied, plus legacyId: <old _id>
 *      (and drafts.<new> if a drafts.<old> exists)
 *   2. re-point every reference to the old _id at the new one
 *   3. delete the old doc (and its draft)
 * Stops at the first error. A transaction is all-or-nothing, so a failure
 * leaves that document untouched.
 *
 * What customers already hold keeps working through legacyId:
 *   - commission download links are signed over the old _id; the signature
 *     still verifies and commission-download.mts falls back to legacyId.
 *   - Stripe sessions still open carry metadata.commissionId / grouponVoucherId
 *     with the old _id; stripe-webhook-commission.mts falls back to legacyId.
 *
 * Usage (needs SANITY_TOKEN in .env):
 *   node tools/migrate-private-ids.mjs              # dry run: print the plan
 *   node tools/migrate-private-ids.mjs --validate   # send each transaction with
 *                                                   # Sanity's dryRun flag: the API
 *                                                   # checks it, nothing is written
 *   node tools/migrate-private-ids.mjs --apply      # do it
 *
 * Writes the old → new mapping (ids only) to %TEMP%\pixel8-migrate-ids.json.
 * Prints ids only — never names, emails or addresses.
 */
import 'dotenv/config';
import { createClient } from '@sanity/client';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APPLY = process.argv.includes('--apply');
const VALIDATE = process.argv.includes('--validate');
const MODE = APPLY ? 'APPLY' : VALIDATE ? 'VALIDATE (server dryRun, nothing written)' : 'DRY RUN (nothing sent)';
const MAP_FILE = join(tmpdir(), 'pixel8-migrate-ids.json');

if (APPLY && VALIDATE) {
  console.error('Use either --apply or --validate, not both.');
  process.exit(1);
}
if (!process.env.SANITY_TOKEN) {
  console.error('SANITY_TOKEN is not set.');
  process.exit(1);
}

const sanity = createClient({
  projectId: 'bqb4w421',
  dataset: process.env.SANITY_DATASET || 'production',
  apiVersion: '2024-12-01',
  token: process.env.SANITY_TOKEN,
  useCdn: false,
  perspective: 'raw', // see drafts too, so they move with their document
});

const TYPES = ['order', 'commission', 'contactSubmission', 'grouponVoucher'];
const ID_OK = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

function newIdFor(doc) {
  const pick = (type, key) => (key && ID_OK.test(key) && !key.includes('.') ? `${type}.${key}` : `${type}.${doc._id}`);
  switch (doc._type) {
    case 'order': return pick('order', doc.stripeSessionId);
    case 'commission': return pick('commission', doc.orderRef);
    default: return `${doc._type}.${doc._id}`;
  }
}

/** Every JSONMatch path inside `value` whose _ref equals `id`. */
function refPaths(value, id, path = '') {
  const out = [];
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      const seg = item && typeof item === 'object' && item._key ? `[_key=="${item._key}"]` : `[${i}]`;
      out.push(...refPaths(item, id, `${path}${seg}`));
    });
  } else if (value && typeof value === 'object') {
    if (value._ref === id) out.push(`${path}._ref`.replace(/^\./, ''));
    for (const [k, v] of Object.entries(value)) {
      if (k === '_ref') continue;
      out.push(...refPaths(v, id, path ? `${path}.${k}` : k));
    }
  }
  return out;
}

/** Links and ids outside Sanity that carry the old _id. */
function derivedLinks(doc) {
  const notes = [];
  if (doc._type === 'commission') {
    if (doc.deliveredAt || doc.finishedFile) {
      notes.push('signed download link(s) emailed with id=<old _id> — still work via legacyId (commission-download)');
    }
    if (doc.stripeSessionId) {
      notes.push('Stripe session metadata.commissionId = <old _id> — resolved via legacyId (stripe-webhook-commission)');
    }
    if (doc.paidAt) {
      notes.push('team email "Open in Studio" link points at <old _id> — will no longer open; find it by orderRef');
    }
  }
  if (doc._type === 'grouponVoucher') {
    notes.push('Stripe session metadata.grouponVoucherId may hold <old _id> — resolved via legacyId');
  }
  if (doc._type === 'order') {
    notes.push('no ids in customer emails or links; Stripe finds it by stripeSessionId (unchanged)');
  }
  return notes;
}

const strip = ({ _rev, _updatedAt, ...rest }) => rest;

// process.exitCode rather than process.exit() once requests have been made:
// exiting while fetch sockets close trips a libuv assertion on Windows (Node 24).
async function main() {
  // ── Plan ────────────────────────────────────────────────────────────────────
  const docs = await sanity.fetch(
    `*[_type in $types && !(_id in path("drafts.**"))] | order(_type asc, _createdAt asc)`,
    { types: TYPES }
  );
  const toMove = docs.filter((d) => !d._id.includes('.'));
  const orphanDrafts = await sanity.fetch(
    `*[_type in $types && _id in path("drafts.**") && !(_id in path("drafts.*.**"))]._id`,
    { types: TYPES }
  );
  const draftOnly = orphanDrafts.filter((d) => !toMove.some((m) => `drafts.${m._id}` === d));

  console.log(`\n  Private-id migration — ${MODE}\n`);
  console.log(`  ${toMove.length} document(s) to move.`);
  if (draftOnly.length) {
    console.log(`  ${draftOnly.length} draft-only document(s) with no published version — not handled, publish or delete them first:`);
    for (const d of draftOnly) console.log(`    ${d}`);
  }

  // Built from fresh reads. Execution calls it again per document, because an
  // earlier transaction can change this one's references (a commission and its
  // voucher point at each other).
  async function planFor(oldId) {
    const doc = await sanity.getDocument(oldId);
    if (!doc) throw new Error(`${oldId} no longer exists`);
    const newId = newIdFor(doc);
    const draft = await sanity.getDocument(`drafts.${doc._id}`);
    const referrers = await sanity.fetch(`*[references($id)]{ _id, _type }`, { id: doc._id });
    const referrerPatches = [];
    for (const r of referrers) {
      const full = await sanity.getDocument(r._id);
      referrerPatches.push({ _id: r._id, _type: r._type, paths: refPaths(full, doc._id) });
    }
    const clash = await sanity.getDocument(newId);
    return { doc, newId, draft, referrerPatches, clash: !!clash, links: derivedLinks(doc) };
  }

  const plan = [];
  for (const doc of toMove) plan.push(await planFor(doc._id));

  for (const p of plan) {
    console.log(`\n  ${p.doc._type}  ${p.doc._id}  →  ${p.newId}${p.clash ? '   !! TARGET ID ALREADY EXISTS' : ''}`);
    if (p.draft) console.log(`    draft:      drafts.${p.doc._id}  →  drafts.${p.newId}`);
    if (!p.referrerPatches.length) console.log('    references: none');
    for (const r of p.referrerPatches) {
      console.log(`    reference:  ${r._type} ${r._id}  (${r.paths.join(', ') || 'path not found'})`);
    }
    for (const n of p.links) console.log(`    link:       ${n}`);
  }

  const mapping = plan.map((p) => ({
    type: p.doc._type, oldId: p.doc._id, newId: p.newId,
    draft: !!p.draft, referrers: p.referrerPatches.map((r) => r._id), applied: false,
  }));
  const saveMap = () => writeFileSync(MAP_FILE, JSON.stringify({ mode: MODE, at: new Date().toISOString(), mapping }, null, 2));
  saveMap();
  console.log(`\n  Mapping written to ${MAP_FILE}`);

  if (plan.some((p) => p.clash)) {
    console.error('\n  Stopping: at least one target id already exists. Nothing was sent.\n');
    return 1;
  }
  if (plan.some((p) => p.referrerPatches.some((r) => !r.paths.length))) {
    console.error('\n  Stopping: a reference path could not be located. Nothing was sent.\n');
    return 1;
  }
  if (!APPLY && !VALIDATE) {
    console.log('\n  Nothing sent. Re-run with --validate to have Sanity check each transaction, or --apply to migrate.\n');
    return 0;
  }

  // ── Execute ─────────────────────────────────────────────────────────────────
  for (const [i, planned] of plan.entries()) {
    // --validate writes nothing, so earlier documents haven't moved and the
    // up-front plan is still exact. --apply re-reads.
    const p = APPLY ? await planFor(planned.doc._id) : planned;
    if (p.clash || p.referrerPatches.some((r) => !r.paths.length)) {
      console.error(`\n  Stopping at ${p.doc._id}: target exists or a reference path is missing. ${i} done before this.\n`);
      return 1;
    }
    const tx = sanity.transaction();
    tx.create({ ...strip(p.doc), _id: p.newId, legacyId: p.doc._id });
    if (p.draft) tx.create({ ...strip(p.draft), _id: `drafts.${p.newId}`, legacyId: p.doc._id });
    for (const r of p.referrerPatches) {
      tx.patch(r._id, (patch) => patch.set(Object.fromEntries(r.paths.map((path) => [path, p.newId]))));
    }
    if (p.draft) tx.delete(`drafts.${p.doc._id}`);
    tx.delete(p.doc._id);
    try {
      await tx.commit({ visibility: 'sync', dryRun: VALIDATE });
    } catch (err) {
      console.error(`\n  FAILED on ${p.doc._id} → ${p.newId}: ${err?.message || err}`);
      console.error(`  ${i} of ${plan.length} document(s) ${VALIDATE ? 'validated' : 'migrated'} before this; this one is unchanged. Stopping.\n`);
      return 1;
    }
    if (APPLY) { mapping[i].applied = true; saveMap(); }
    console.log(`  ${VALIDATE ? 'ok (not written)' : 'moved'}  ${p.doc._id} → ${p.newId}`);
  }
  console.log(`\n  Done: ${plan.length} document(s) ${VALIDATE ? 'validated — nothing written' : 'migrated'}.\n`);
  return 0;
}

process.exitCode = await main();
