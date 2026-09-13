/**
 * Create / update the personalisationStyle documents in Sanity.
 *
 *   node tools/builder/seed-styles.mjs [--dry-run]
 *
 * One document per key in netlify/functions/_shared/styles.mjs, with the
 * public label from STYLE_META. Document _id is `personalisationStyle.<key>`
 * so re-running updates in place rather than duplicating. Only public fields
 * are written; example images and blurbs are added in the Studio afterwards.
 *
 * Needs SANITY_TOKEN in .env (same write token the functions use).
 */
import 'dotenv/config';
import { createClient } from '@sanity/client';
import { listPublicStyles } from '../../netlify/functions/_shared/styles.mjs';

const dryRun = process.argv.includes('--dry-run');

const sanity = createClient({
  projectId: 'bqb4w421',
  dataset: process.env.SANITY_DATASET || 'production',
  apiVersion: '2026-04-14',
  token: process.env.SANITY_TOKEN,
  useCdn: false,
});

const styles = listPublicStyles();
console.log(`\n  ${styles.length} styles${dryRun ? ' (dry run)' : ''}\n`);

for (const [i, s] of styles.entries()) {
  const _id = `personalisationStyle.${s.key}`;
  const doc = {
    _id,
    _type: 'personalisationStyle',
    key: s.key,
    letter: s.letter,
    label: s.label,
    sortOrder: i,
  };
  console.log(`  ${s.key}  Option ${s.letter}  ${s.label}`);
  if (dryRun) continue;
  if (!process.env.SANITY_TOKEN) { console.error('\n  SANITY_TOKEN is not set.\n'); process.exit(1); }
  // createIfNotExists + patch keeps blurbs/images an editor has added.
  await sanity.createIfNotExists({ ...doc, active: true });
  await sanity.patch(_id).set({ key: s.key, letter: s.letter, label: s.label, sortOrder: i }).commit();
}
console.log(dryRun ? '\n  Nothing written.\n' : '\n  Done.\n');
