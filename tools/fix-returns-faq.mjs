#!/usr/bin/env node
/**
 * tools/fix-returns-faq.mjs
 *
 * Brings Sanity copy in line with /refund-policy, /shipping-policy and the
 * T&Cs (September 2026):
 *   - FAQ "What is your returns policy?": 14 days to cancel stock items,
 *     return postage paid by the customer unless faulty or incorrect, the
 *     delivery charge refunded on whole-order returns, personalised / "Your
 *     Photo, Your Style" / commissions excluded for change of mind, and
 *     faulty-item rights
 *   - FAQ "Do you offer free shipping?" and "Do you ship internationally?":
 *     free UK P&P on orders of £50 AND OVER (checkout's rule), prints to UK addresses
 *     only
 *   - siteSettings.announcementBar: "£50 and over" (no page shows it yet)
 *
 * Each field is replaced only if it is still exactly the known previous text
 * (so a hand edit is never overwritten — it's reported instead). An open
 * draft is updated under the same rule.
 *
 * Usage (needs SANITY_TOKEN in .env):
 *   node tools/fix-returns-faq.mjs           # dry run: show old and new text
 *   node tools/fix-returns-faq.mjs --apply   # write it
 */
import dotenv from 'dotenv';
import { createClient } from '@sanity/client';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(ROOT, '.env'), quiet: true });
const APPLY = process.argv.includes('--apply');

export const TARGETS = [
  {
    id: 'FWi5rTvmaPNs150cst2pOD', // "What is your returns policy?"
    field: 'answer',
    old: [
      'We offer a 14-day returns policy on all standard products. Items must be returned in their original packaging, unused and undamaged.',
      "Personalised items — anything made from a photo you supply — can't be returned once printed, because they're made specifically for you. That's exactly why we email you a proof first: nothing goes to print until you approve it, and you can cancel free of charge at any point before you do.",
      "If anything arrives damaged, faulty, or different from the proof you approved, contact us within 30 days and we'll replace it or refund you in full. That applies to personalised items too.",
    ].join('\n\n'),
    new: [
      "Changed your mind about our ready-made (non-personalised) wall art? Tell us within 14 days of delivery, then send it back within 14 days of telling us, unused and in its original packaging. Return postage is paid by you unless the item is faulty or we sent the wrong one. We refund the item price within 14 days of receiving it back (or of proof of posting, if sooner). If you return your whole order, we also refund the standard delivery charge you paid.",
      "Personalised items, \"Your Photo, Your Style\" designs and commissions are made to your specification, so they can't be returned for a change of mind. That's why we send you a proof first: nothing goes ahead until you approve it, and you can cancel free of charge at any point before you do.",
      "If anything arrives damaged, faulty or not as ordered, contact us with photos, ideally within 48 hours, and we'll cover the return and offer a replacement or a refund. You have 30 days from delivery to reject a faulty item for a full refund, and that applies to personalised items and commissions too.",
    ].join('\n\n'),
  },
  {
    id: 'pqsf8ly4J5ZHPrl9Dk3iht', // "Do you offer free shipping?"
    field: 'answer',
    old: "Yes — free UK P&P on orders over £50. Otherwise, UK standard P&P is a flat £4.95.\n\nWe currently ship to the UK only. International shipping is coming soon — drop us a line via the contact page if you'd like us to let you know when it's live.",
    new: "Yes — free UK P&P on orders of £50 and over. Otherwise, UK standard P&P is a flat £4.95.\n\nWe currently ship prints to UK addresses only. International shipping is coming soon — drop us a line via the contact page if you'd like us to let you know when it's live.",
  },
  {
    id: 'zOkJuNZVmyYz76wu4mZsA1', // "Do you ship internationally?"
    field: 'answer',
    old: "Not yet — we currently ship to the UK only.\n\nInternational shipping is coming soon. If you're outside the UK and want to be notified when we launch international delivery, drop us a line via the contact page and we'll let you know as soon as it's live.\n\nNote: digital products (digital downloads, digital collages, animated stories without prints) are deliverable anywhere in the world — only physical prints are UK-only at the moment.",
    new: "Not yet — we currently ship prints to UK addresses only.\n\nInternational shipping is coming soon. If you're outside the UK and want to be notified when we launch international delivery, drop us a line via the contact page and we'll let you know as soon as it's live.\n\nNote: digital products (digital downloads, digital collages, animated stories without prints) are deliverable anywhere in the world — only physical prints are limited to the UK at the moment.",
  },
  {
    id: 'siteSettings',
    field: 'announcementBar',
    old: 'Free UK delivery on all orders over £50',
    new: 'Free UK delivery on orders of £50 and over',
  },
];

const indent = (s) => String(s).split('\n').map((l) => `      ${l}`).join('\n');

async function main() {
  if (!process.env.SANITY_TOKEN) { console.error('SANITY_TOKEN is not set.'); return 1; }
  const sanity = createClient({
    projectId: 'bqb4w421', dataset: 'production', apiVersion: '2024-12-01',
    token: process.env.SANITY_TOKEN, useCdn: false, perspective: 'raw',
  });
  console.log(`\n  Returns & delivery copy in Sanity — ${APPLY ? 'APPLY' : 'DRY RUN (nothing written)'}\n`);

  const patches = [];
  for (const t of TARGETS) {
    for (const id of [t.id, `drafts.${t.id}`]) {
      const doc = await sanity.getDocument(id);
      if (!doc) { if (id === t.id) console.log(`  ${id}: not found — skipped`); continue; }
      const label = doc.question ? `"${doc.question}"` : t.field;
      if (doc[t.field] === t.new) { console.log(`  ${id} ${label}: already up to date`); continue; }
      if (doc[t.field] !== t.old) { console.log(`  ${id} ${label}: edited since — LEFT ALONE, check it by hand`); continue; }
      console.log(`  ${id} — ${label}`);
      console.log(`    old:\n${indent(doc[t.field])}`);
      console.log(`    new:\n${indent(t.new)}\n`);
      patches.push({ id, rev: doc._rev, field: t.field, value: t.new });
    }
  }

  console.log(`  ${patches.length} change(s) planned.`);
  if (!APPLY) { console.log('  Nothing written. Re-run with --apply to write.\n'); return 0; }
  for (const p of patches) {
    try {
      await sanity.patch(p.id).ifRevisionId(p.rev).set({ [p.field]: p.value }).commit({ visibility: 'sync' });
      console.log(`  written  ${p.id}`);
    } catch (err) {
      console.error(`  FAILED   ${p.id}: ${err?.message}. Stopping; earlier changes stay.`);
      return 1;
    }
  }
  console.log('\n  Done. The FAQ and home pages pick this up on the next site build.\n');
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) process.exitCode = await main();
