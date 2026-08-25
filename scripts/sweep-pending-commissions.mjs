// scripts/sweep-pending-commissions.mjs
//
// G7 — clean up abandoned "pending" commission docs.
//
// The checkout writes a commission doc (status: "pending") BEFORE the customer
// pays. If they abandon checkout, that doc — with their name, email, brief and
// uploaded photos — sits in the dataset forever. This sweep removes them.
//
// Needs only SANITY_TOKEN. If STRIPE_SECRET_KEY is ALSO present, it cross-checks
// every candidate against Stripe so a paid-but-stuck order (webhook failed) is
// never deleted. Without it, you verify the short list by eye in the Stripe
// dashboard before committing — fine for the current test data.
//
// DRY-RUN by default. Nothing is deleted unless you pass --commit.
//   node scripts/sweep-pending-commissions.mjs           # report only
//   node scripts/sweep-pending-commissions.mjs --commit  # delete the abandoned set
//
// Env: SANITY_TOKEN (write/delete scope) required; STRIPE_SECRET_KEY optional.

import { createClient } from '@sanity/client';

const COMMIT = process.argv.includes('--commit');
const CUTOFF_HOURS = 48;            // only touch pending docs older than this (Stripe sessions expire at 24h)
const SESSION_LOOKBACK_DAYS = 120;  // how far back we can verify against Stripe (when a key is present)

const { SANITY_TOKEN, STRIPE_SECRET_KEY } = process.env;
if (!SANITY_TOKEN) {
  console.error('Missing SANITY_TOKEN in the environment.');
  process.exit(1);
}

const sanity = createClient({
  projectId: 'bqb4w421',
  dataset: 'production',
  apiVersion: '2024-12-01',
  token: SANITY_TOKEN,
  useCdn: false,
});

const now = Date.now();
const cutoffIso = new Date(now - CUTOFF_HOURS * 3600_000).toISOString();
const lookbackMs = SESSION_LOOKBACK_DAYS * 86400_000;
const ageH = (iso) => Math.round((now - new Date(iso).getTime()) / 3600_000);

// 1. Candidate pending docs older than the cutoff, with no paid timestamp
const pending = await sanity.fetch(
  `*[_type == "commission" && status == "pending" && !defined(paidAt) && _createdAt < $cutoff]{
     _id, orderRef, customerEmail, amount, _createdAt,
     "assetRefs": uploadedFiles[].asset._ref
   } | order(_createdAt asc)`,
  { cutoff: cutoffIso }
);

if (pending.length === 0) {
  console.log(`No pending commissions older than ${CUTOFF_HOURS}h. Nothing to do.`);
  process.exit(0);
}

// 2. Optional Stripe cross-check
let sessionByCommission = null;
if (STRIPE_SECRET_KEY) {
  const Stripe = (await import('stripe')).default;
  const stripe = new Stripe(STRIPE_SECRET_KEY);
  sessionByCommission = new Map();
  const sinceTs = Math.floor((now - lookbackMs) / 1000);
  for await (const s of stripe.checkout.sessions.list({ created: { gte: sinceTs }, limit: 100 })) {
    const cid = s.metadata?.commissionId;
    if (cid) sessionByCommission.set(cid, s);
  }
  console.log(`Stripe cross-check ON (${sessionByCommission.size} sessions scanned).`);
} else {
  console.log('Stripe cross-check OFF — verify the list below in your Stripe dashboard before --commit.');
}

// 3. Classify
const toDelete = [];     // safe to remove
const stuckPaid = [];    // paid but pending -> KEEP, recover
const unverifiable = []; // too old to confirm via Stripe -> KEEP, review

for (const doc of pending) {
  if (!sessionByCommission) { toDelete.push({ doc, s: null }); continue; }
  const s = sessionByCommission.get(doc._id);
  if (s) {
    const paid = s.payment_status === 'paid' || s.status === 'complete';
    (paid ? stuckPaid : toDelete).push({ doc, s });
  } else if (now - new Date(doc._createdAt).getTime() <= lookbackMs) {
    toDelete.push({ doc, s: null }); // scanned that window, no paid session -> never paid
  } else {
    unverifiable.push({ doc, s: null });
  }
}

// 4. Report
console.log(`\nPending older than ${CUTOFF_HOURS}h: ${pending.length}`);
console.log(`  abandoned (deletable):            ${toDelete.length}`);
if (sessionByCommission) {
  console.log(`  PAID but stuck (KEEP, recover):   ${stuckPaid.length}`);
  console.log(`  too old to verify (KEEP, review): ${unverifiable.length}`);
}
console.log('');

if (stuckPaid.length) {
  console.log('!!  PAID ORDERS STUCK AT PENDING — webhook never flipped these. Recover manually, do NOT delete:');
  for (const { doc, s } of stuckPaid)
    console.log(`    ${doc.orderRef}  ${doc.customerEmail}  £${doc.amount}  session=${s.id}  (${ageH(doc._createdAt)}h)`);
  console.log('');
}
if (unverifiable.length) {
  console.log('?   Older than the Stripe lookback window — verify by hand before any deletion:');
  for (const { doc } of unverifiable)
    console.log(`    ${doc.orderRef || doc._id}  ${doc.customerEmail || '(no email)'}  (${ageH(doc._createdAt)}h)`);
  console.log('');
}
if (toDelete.length) {
  console.log(`${COMMIT ? 'Deleting' : 'Would delete'} ${toDelete.length} abandoned commission(s):`);
  for (const { doc } of toDelete)
    console.log(`    ${doc.orderRef || doc._id}  ${doc.customerEmail || '(no email)'}  £${doc.amount ?? '?'}  (${ageH(doc._createdAt)}h)`);
}

if (!COMMIT) {
  console.log('\nDRY RUN — nothing deleted. Re-run with --commit to delete the abandoned set above.');
  process.exit(0);
}

// 5. Commit: remove uploaded photos (best-effort), then the doc
let deleted = 0;
for (const { doc } of toDelete) {
  for (const ref of doc.assetRefs || []) {
    try { await sanity.delete(ref); }
    catch (e) { console.warn(`    (kept asset ${ref}: ${e.message})`); }
  }
  try { await sanity.delete(doc._id); deleted++; }
  catch (e) { console.error(`    FAILED ${doc.orderRef || doc._id}: ${e.message}`); }
}
console.log(`\nDeleted ${deleted}/${toDelete.length} abandoned commissions (and their uploaded photos).`);
