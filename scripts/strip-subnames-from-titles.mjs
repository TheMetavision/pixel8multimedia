#!/usr/bin/env node
/**
 * strip-subnames-from-titles.mjs
 *
 * Strips the ": Sub-Name" portion from product titles only.
 * Description, SEO meta title, SEO meta description, and image alt text
 * are LEFT UNTOUCHED (sub-names continue to provide SEO and screen-reader
 * value behind the scenes).
 *
 * Transform:
 *   "Albert Einstein — Option B: Theory Minimal"
 *      → "Albert Einstein — Option B"
 *
 *   "Bob Marley — Option C: Trenchtown 76"
 *      → "Bob Marley — Option C"
 *
 * The pattern matches:
 *   " — Option <Letter>: <anything to end of string>"
 * and replaces the ": <anything>" portion with empty string,
 * preserving everything before.
 *
 * Excludes personalised products (their titles never had this format).
 *
 * Run from project root:
 *   $env:SANITY_API_TOKEN = "sk-..."
 *   node scripts/strip-subnames-from-titles.mjs
 *
 * Options:
 *   --dry-run    Show before/after for first 10, no writes
 *   --character=batman   Test on one character first
 */

import { createClient } from '@sanity/client';

const PROJECT_ID = 'bqb4w421';
const DATASET = 'production';
const API_VERSION = '2024-01-01';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const charArg = args.find(a => a.startsWith('--character='));
const onlyCharacter = charArg ? charArg.split('=')[1] : null;

const token = process.env.SANITY_API_TOKEN;
if (!token) {
  console.error('❌  SANITY_API_TOKEN env var not set.');
  process.exit(1);
}

const client = createClient({
  projectId: PROJECT_ID,
  dataset: DATASET,
  apiVersion: API_VERSION,
  token,
  useCdn: false,
});

/**
 * Strip the ": Sub-Name" portion from a title.
 * Matches " — Option X: ..." and removes everything from the colon onwards.
 *
 * Examples:
 *   "Albert Einstein — Option B: Theory Minimal" → "Albert Einstein — Option B"
 *   "Bob Marley — Option C: Trenchtown 76"      → "Bob Marley — Option C"
 *   "Batman — Option I: Caped Geometry"          → "Batman — Option I"
 *
 * If the title doesn't match the expected pattern, returns it unchanged.
 */
function stripSubName(title) {
  if (!title || typeof title !== 'string') return title;
  // ` — Option X: ` followed by any text → keep just ` — Option X`
  return title.replace(/(\s—\s+Option\s+[A-J]):\s+.+$/, '$1');
}

async function fetchProducts() {
  let query = `*[_type == "product" && category != "personalised"`;
  if (onlyCharacter) {
    query += ` && string::startsWith(slug.current, "${onlyCharacter}-style-")`;
  }
  query += `]{ _id, title }`;
  return client.fetch(query);
}

async function patchOne(product) {
  const newTitle = stripSubName(product.title);
  if (newTitle === product.title) {
    return { skipped: true };
  }
  if (dryRun) {
    return { dryRun: true, oldTitle: product.title, newTitle };
  }
  await client.patch(product._id).set({ title: newTitle }).commit({ visibility: 'async' });
  return { ok: true, oldTitle: product.title, newTitle };
}

async function main() {
  console.log(`✂️  Stripping ": Sub-Name" from product titles`);
  if (dryRun) console.log('   (DRY RUN — no writes)');
  if (onlyCharacter) console.log(`   Filter: character="${onlyCharacter}"`);
  console.log('');

  const products = await fetchProducts();
  console.log(`Found ${products.length} products to check\n`);

  let ok = 0, skip = 0, err = 0;
  const errors = [];
  let previewShown = 0;

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    try {
      const r = await patchOne(p);
      if (r.ok) {
        ok++;
        if (ok <= 5) console.log(`  ✅ "${r.oldTitle}" → "${r.newTitle}"`);
        else if (ok === 6) console.log(`  ✅ ...(more updates, suppressing output)`);
        if (ok % 100 === 0) console.log(`  ...${ok}/${products.length} done`);
      } else if (r.dryRun) {
        ok++;
        if (previewShown < 10) {
          console.log(`  [DRY] "${r.oldTitle}"\n        → "${r.newTitle}"`);
          previewShown++;
        } else if (previewShown === 10) {
          console.log(`  [DRY] ...(showing first 10 only, ${products.length - 10}+ more would update)`);
          previewShown++;
        }
      } else if (r.skipped) {
        skip++;
      }
    } catch (e) {
      err++;
      errors.push({ id: p._id, msg: e.message });
    }
    if (!dryRun && (i + 1) % 25 === 0) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`Summary: ${ok}/${products.length} updated, ${skip} unchanged, ${err} errors`);
  if (errors.length) {
    console.log('\nErrors:');
    for (const e of errors.slice(0, 20)) console.log(`  ${e.id}: ${e.msg}`);
  }
  if (!dryRun && ok > 0) {
    console.log('\n🎉  Titles stripped — products now display as e.g. "Batman — Option B"');
    console.log('   Sub-names preserved in description, SEO metadata, and image alt text.');
    console.log('   Re-deploy your Astro site (Netlify build) to surface the changes.');
  }
}

main().catch(e => {
  console.error('💥  Fatal:', e);
  process.exit(1);
});
