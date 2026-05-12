#!/usr/bin/env node
/**
 * preview-rename.mjs
 *
 * DRY RUN. Outputs proposed-names.txt listing all 1,030 proposed product
 * titles by character + style, grouped by category. NO database writes.
 *
 * Run from project root:
 *   node scripts/preview-rename.mjs
 *
 * Reads:   scripts/subnames.json
 * Writes:  proposed-names.txt (in project root)
 *
 * Skim the output, flag anything weird, then run the live script:
 *   node scripts/rename-catalogue.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MANIFEST_PATH = resolve('scripts/subnames.json');
const OUTPUT_PATH = resolve('proposed-names.txt');

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const { _meta, characters } = manifest;
const styleOrder = _meta.styleOrder;
const styleNames = _meta.styleNames;
const slugFixes = _meta.slugFixes;

// Group by category
const byCategory = {};
for (const [slug, data] of Object.entries(characters)) {
  if (!byCategory[data.category]) byCategory[data.category] = [];
  byCategory[data.category].push({ slug, ...data });
}

// Build output
const lines = [];
lines.push('='.repeat(80));
lines.push('PIXEL8 MULTIMEDIA — PROPOSED RENAME PREVIEW');
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push(`Total products to rename: ${Object.keys(characters).length * 10}`);
lines.push('='.repeat(80));
lines.push('');

if (Object.keys(slugFixes).length) {
  lines.push('SLUG FIXES (typo corrections):');
  for (const [oldSlug, newSlug] of Object.entries(slugFixes)) {
    lines.push(`  ${oldSlug} → ${newSlug}`);
  }
  lines.push('');
}

const categoryOrder = ['tv-movies', 'animations', 'music', 'sport', 'miscellaneous'];
for (const cat of categoryOrder) {
  const chars = byCategory[cat];
  if (!chars) continue;
  lines.push('');
  lines.push('='.repeat(80));
  lines.push(`CATEGORY: ${cat.toUpperCase()}  (${chars.length} characters, ${chars.length * 10} products)`);
  lines.push('='.repeat(80));
  for (const char of chars.sort((a, b) => a.slug.localeCompare(b.slug))) {
    const finalSlug = slugFixes[char.slug] || char.slug;
    const slugNote = finalSlug !== char.slug ? `  [slug: ${char.slug} → ${finalSlug}]` : '';
    lines.push('');
    lines.push(`${char.displayName}${slugNote}`);
    lines.push(`  theme: ${char.theme}`);
    for (let i = 0; i < 10; i++) {
      const slot = styleOrder[i];
      const styleLabel = styleNames[slot];
      const subName = char.subNames[i];
      const fullTitle = `${char.displayName} — Style ${slot.toUpperCase()}: ${subName}`;
      lines.push(`    ${slot.toUpperCase()} (${styleLabel.padEnd(15)}) → "${fullTitle}"`);
    }
  }
}

lines.push('');
lines.push('='.repeat(80));
lines.push('END OF PREVIEW');
lines.push('='.repeat(80));

writeFileSync(OUTPUT_PATH, lines.join('\n'));

console.log(`✅  Preview generated: ${OUTPUT_PATH}`);
console.log(`📊  ${Object.keys(characters).length} characters × 10 styles = ${Object.keys(characters).length * 10} products`);
console.log(`📝  Skim the file, then edit scripts/subnames.json to override any names you don't like.`);
console.log(`🚀  When happy, run: node scripts/rename-catalogue.mjs`);
