#!/usr/bin/env node
/**
 * tools/fix-faq-copy.mjs
 *
 * Makes the canvas-wrap and finishes FAQs say what the site and T&Cs say:
 * a solid colour wrap sampled from the edges of the design, with the full
 * design on the front; posters are satin. The wording is FAQ_COPY in the
 * shared print spec (netlify/functions/_shared/print-spec.mjs), the same
 * source as the PDP, Your Photo page and T&Cs (WRAP_COPY).
 *
 * Replaces an answer only if it is one of the known old versions, i.e. still
 * says "dominant colour", "complementary" or "matte". Anything else is left
 * alone and reported, in case it was edited by hand.
 *
 * Usage (needs SANITY_TOKEN in .env):
 *   node tools/fix-faq-copy.mjs           # dry run: show old and new text
 *   node tools/fix-faq-copy.mjs --apply   # write it
 */
import dotenv from 'dotenv';
import { createClient } from '@sanity/client';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAQ_COPY } from '../netlify/functions/_shared/print-spec.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(ROOT, '.env'), quiet: true });
const APPLY = process.argv.includes('--apply');

const TARGETS = [
  { id: 'faq-canvas-wrap-design-preserved', answer: FAQ_COPY.canvasWrap },
  { id: 'pqsf8ly4J5ZHPrl9Dk3jpJ', answer: FAQ_COPY.finishes }, // "What finishes are available?"
];
const STALE = /dominant colou?r|complementary|\bmatte\b/i;
const indent = (s) => s.split('\n').map((l) => `      ${l}`).join('\n');

async function main() {
  if (!process.env.SANITY_TOKEN) { console.error('SANITY_TOKEN is not set.'); return 1; }
  const sanity = createClient({
    projectId: 'bqb4w421', dataset: 'production', apiVersion: '2024-12-01',
    token: process.env.SANITY_TOKEN, useCdn: false, perspective: 'raw',
  });
  console.log(`\n  FAQ wrap/finish wording — ${APPLY ? 'APPLY' : 'DRY RUN (nothing written)'}\n`);

  const patches = [];
  for (const t of TARGETS) {
    for (const id of [t.id, `drafts.${t.id}`]) {
      const doc = await sanity.getDocument(id);
      if (!doc) { if (id === t.id) console.log(`  ${id}: not found — skipped`); continue; }
      if (doc.answer === t.answer) { console.log(`  ${id}: already up to date`); continue; }
      if (!STALE.test(doc.answer || '')) { console.log(`  ${id}: doesn't contain the old wording — LEFT ALONE, check by hand`); continue; }
      console.log(`  ${id} — "${doc.question}"`);
      console.log(`    old:\n${indent(doc.answer)}`);
      console.log(`    new:\n${indent(t.answer)}\n`);
      patches.push({ id, rev: doc._rev, answer: t.answer });
    }
  }

  console.log(`  ${patches.length} change(s) planned.`);
  if (!APPLY) { console.log('  Nothing written. Re-run with --apply to write.\n'); return 0; }
  for (const p of patches) {
    try {
      await sanity.patch(p.id).ifRevisionId(p.rev).set({ answer: p.answer }).commit({ visibility: 'sync' });
      console.log(`  written  ${p.id}`);
    } catch (err) {
      console.error(`  FAILED   ${p.id}: ${err?.message}. Stopping; earlier changes stay.`);
      return 1;
    }
  }
  console.log('\n  Done. The FAQ page picks this up on the next site build.\n');
  return 0;
}

process.exitCode = await main();
