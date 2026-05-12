#!/usr/bin/env node
/**
 * rename-style-to-option.mjs
 *
 * Replaces the word "Style" with "Option" across all 1,042 product text fields
 * in Sanity. Internal field names (e.g. style: "style-a") remain unchanged —
 * only user-facing display text is updated.
 *
 * Fields patched per product:
 *   - title:                "X — Style B: Y"     → "X — Option B: Y"
 *   - description text:     "...exclusive Style B..."  → "...exclusive Option B..."
 *   - seo.metaTitle:        "...— Style B | ..." → "...— Option B | ..."
 *   - seo.metaDescription:  "...exclusive Style B..."  → "...exclusive Option B..."
 *   - images[0].alt:        "...Style B wall art..."   → "...Option B wall art..."
 *
 * Also updates published documents directly (no draft step) since these are
 * pure text patches on already-rebranded products. Safe to re-run.
 *
 * Run from project root:
 *   $env:SANITY_API_TOKEN = "sk-..."
 *   node scripts/rename-style-to-option.mjs
 *
 * Options:
 *   --dry-run       Show what would change, no writes
 *   --character=batman    Only patch one character
 *   --limit=10      Cap total products (testing)
 */

import { createClient } from '@sanity/client';

const PROJECT_ID = 'bqb4w421';
const DATASET = 'production';
const API_VERSION = '2024-01-01';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const charArg = args.find(a => a.startsWith('--character='));
const onlyCharacter = charArg ? charArg.split('=')[1] : null;
const limitArg = args.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;

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
 * Replace "Style" with "Option" in a string, preserving the rest.
 * Whole-word match only — avoids hitting things like "stylesheet" by accident.
 * Case-sensitive intentionally: we only want to swap "Style" not "style".
 */
function swap(str) {
  if (!str || typeof str !== 'string') return str;
  return str.replace(/\bStyle\b/g, 'Option');
}

async function fetchProducts() {
  let query = `*[_type == "product" && category != "personalised"]`;
  if (onlyCharacter) {
    query += ` && string::startsWith(slug.current, "${onlyCharacter}-style-")`;
  }
  query += ` {
    _id,
    title,
    description,
    seo,
    images
  }`;
  if (limit) query += ` [0...${limit}]`;
  return client.fetch(query);
}

async function patchOne(product) {
  const updates = {};
  let changed = false;

  // Title
  const newTitle = swap(product.title);
  if (newTitle !== product.title) {
    updates.title = newTitle;
    changed = true;
  }

  // Description (portable text - block array with children spans)
  if (Array.isArray(product.description)) {
    const newDesc = product.description.map(block => ({
      ...block,
      children: (block.children || []).map(child => ({
        ...child,
        text: swap(child.text),
      })),
    }));
    // Only set if anything actually changed
    const oldFlat = product.description.flatMap(b => (b.children || []).map(c => c.text)).join('\n');
    const newFlat = newDesc.flatMap(b => (b.children || []).map(c => c.text)).join('\n');
    if (oldFlat !== newFlat) {
      updates.description = newDesc;
      changed = true;
    }
  }

  // SEO
  if (product.seo) {
    const newSeo = { ...product.seo };
    let seoChanged = false;
    if (product.seo.metaTitle && swap(product.seo.metaTitle) !== product.seo.metaTitle) {
      newSeo.metaTitle = swap(product.seo.metaTitle);
      seoChanged = true;
    }
    if (product.seo.metaDescription && swap(product.seo.metaDescription) !== product.seo.metaDescription) {
      newSeo.metaDescription = swap(product.seo.metaDescription);
      seoChanged = true;
    }
    if (seoChanged) {
      updates.seo = newSeo;
      changed = true;
    }
  }

  // Image alt text
  if (Array.isArray(product.images) && product.images.length > 0) {
    const newImages = product.images.map(img => ({
      ...img,
      alt: swap(img.alt),
    }));
    const altsChanged = product.images.some((img, i) => swap(img.alt) !== img.alt);
    if (altsChanged) {
      updates.images = newImages;
      changed = true;
    }
  }

  if (!changed) {
    return { skipped: true, reason: 'nothing to update' };
  }

  if (dryRun) {
    return { dryRun: true, updates };
  }

  await client.patch(product._id).set(updates).commit({ visibility: 'async' });
  return { ok: true };
}

async function main() {
  console.log(`🔁 Renaming "Style" → "Option" in Sanity catalogue`);
  if (dryRun) console.log('   (DRY RUN — no writes)');
  if (onlyCharacter) console.log(`   Filter: character="${onlyCharacter}"`);
  if (limit) console.log(`   Limit: ${limit} products`);
  console.log('');

  const products = await fetchProducts();
  console.log(`Found ${products.length} products to check\n`);

  let ok = 0, skip = 0, err = 0;
  const errors = [];

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    try {
      const r = await patchOne(p);
      if (r.ok) {
        ok++;
        if (ok % 50 === 0) console.log(`  ...${ok}/${products.length} done`);
      } else if (r.dryRun) {
        ok++;
        if (ok <= 5) {
          console.log(`  [DRY] ${p._id}`);
          console.log(`        title: "${p.title}" → "${r.updates.title || '(unchanged)'}"`);
        } else if (ok === 6) {
          console.log(`  [DRY] ...(omitting remaining dry-run output)`);
        }
      } else if (r.skipped) {
        skip++;
      }
    } catch (e) {
      err++;
      errors.push({ id: p._id, msg: e.message });
    }
    // Polite pause every 25 docs
    if (!dryRun && (i + 1) % 25 === 0) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`Summary: ${ok}/${products.length} updated, ${skip} unchanged, ${err} errors`);
  if (errors.length) {
    console.log('\nErrors:');
    for (const e of errors.slice(0, 20)) console.log(`  ${e.id}: ${e.msg}`);
    if (errors.length > 20) console.log(`  ...and ${errors.length - 20} more`);
  }
  if (!dryRun && ok > 0) {
    console.log('\n🎉  Catalogue rename complete — all products now show "Option X" instead of "Style X".');
    console.log('   No publish step needed — patches applied directly to published documents.');
    console.log('   Re-deploy your Astro site (Netlify build) to surface the changes.');
  }
}

main().catch(e => {
  console.error('💥  Fatal:', e);
  process.exit(1);
});
