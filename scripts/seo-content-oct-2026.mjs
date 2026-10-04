/**
 * scripts/seo-content-oct-2026.mjs — meta description fixes from the
 * October 2026 audit (limit: 155 characters).
 *
 *   node scripts/seo-content-oct-2026.mjs            dry run: prints old → new, writes the plan
 *   node scripts/seo-content-oct-2026.mjs --apply    applies the plan written by the dry run
 *
 * The dry run records each document's _rev. --apply patches a document only
 * if it is unchanged since then (ifRevisionID) and has no open draft, so
 * anything edited in Studio in between is skipped and reported, not
 * overwritten. Needs SANITY_TOKEN (write) in .env.
 */
import 'dotenv/config';
import fs from 'node:fs';
import { createClient } from '@sanity/client';

const PLAN = new URL('./seo-content-oct-2026.plan.json', import.meta.url);
const MAX = 155;

/** [_type, slug, field path, new value] */
const EDITS = [
  ['blogPost', 'crayon-to-creation-process', 'seo.metaDescription',
    "How we turn a child's drawing into a 3D character in a cinematic scene: a digital still, a print or a 30-second animated short. Process, pricing, timings."],
  ['blogPost', 'the-missing-moment-explained', 'seo.metaDescription',
    'A commission that adds a missing person into an existing photo, composited to match the original. Available as a digital still, print or animated short.'],
  ['blogPost', 'canvas-vs-poster-print', 'seo.metaDescription',
    'Stretched canvas or rolled poster? A no-nonsense guide to the right format for pop culture wall art: price, durability, framing and room fit compared.'],
];

const client = createClient({
  projectId: 'bqb4w421', dataset: 'production', apiVersion: '2024-12-01',
  token: process.env.SANITY_TOKEN, useCdn: false, perspective: 'raw',
});
const get = (doc, path) => path.split('.').reduce((o, k) => o?.[k], doc);

async function dryRun() {
  const plan = [];
  for (const [type, slug, path, next] of EDITS) {
    if (next.length > MAX) throw new Error(`${slug}: new value is ${next.length} chars (> ${MAX})`);
    const doc = await client.fetch(`*[_type == $type && slug.current == $slug && !(_id in path("drafts.**"))][0]`, { type, slug });
    if (!doc) { console.log(`MISSING  ${type} ${slug}`); continue; }
    const old = get(doc, path) ?? '';
    if (old === next) { console.log(`SAME     ${slug} ${path}`); continue; }
    plan.push({ _id: doc._id, _rev: doc._rev, slug, path, old, next });
    console.log(`${slug} ${path}\n  old (${old.length}): ${old}\n  new (${next.length}): ${next}`);
  }
  fs.writeFileSync(PLAN, JSON.stringify(plan, null, 2));
  console.log(`\n${plan.length} change(s) planned. Run with --apply to write them.`);
}

async function apply() {
  const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
  let done = 0;
  for (const p of plan) {
    const draft = await client.fetch(`count(*[_id == $id])`, { id: `drafts.${p._id}` });
    if (draft) { console.log(`SKIP (open draft)       ${p.slug}`); continue; }
    try {
      await client.patch(p._id).ifRevisionId(p._rev).set({ [p.path]: p.next }).commit();
      console.log(`DONE     ${p.slug} ${p.path}`); done++;
    } catch (e) {
      console.log(`SKIP (edited since dry run) ${p.slug}: ${e.message}`);
    }
  }
  console.log(`\n${done}/${plan.length} applied.`);
}

await (process.argv.includes('--apply') ? apply() : dryRun());
