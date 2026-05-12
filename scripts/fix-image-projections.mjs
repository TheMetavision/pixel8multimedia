// scripts/fix-image-projections.mjs (v2)
// Fixes the broken `images[0] { ... }` projection in queries.ts.
// Operates line-by-line so it's resilient to CRLF/LF differences and exact whitespace.

import fs from 'node:fs';
import path from 'node:path';

const filePath = path.resolve('src/lib/queries.ts');
const content = fs.readFileSync(filePath, 'utf8');

// Detect line ending so we preserve it
const eol = content.includes('\r\n') ? '\r\n' : '\n';
const lines = content.split(/\r?\n/);

let patched = 0;
const newLines = lines.map((line) => {
  // Match any line that has "images[0] {" with optional leading whitespace,
  // but NOT "images[0...1] {" which is the already-fixed form.
  if (/^\s*images\[0\]\s*\{\s*$/.test(line) && !line.includes('[0...1]')) {
    patched++;
    return line.replace('images[0]', 'images[0...1]');
  }
  return line;
});

if (patched === 0) {
  // Check whether the fix is already in place
  const alreadyFixed = lines.filter((l) => /images\[0\.\.\.1\]/.test(l)).length;
  if (alreadyFixed > 0) {
    console.log(`  Already patched — ${alreadyFixed} fixed projection(s) present.`);
    process.exit(0);
  }
  console.error('  No matching `images[0] {` lines found and no fixed projection either.');
  console.error('  Showing all lines containing "images[":');
  lines.forEach((l, i) => {
    if (l.includes('images[')) console.error(`    ${i + 1}: ${JSON.stringify(l)}`);
  });
  process.exit(1);
}

const out = newLines.join(eol);
fs.writeFileSync(filePath, out, 'utf8');
console.log(`Patched ${patched} projection(s) in src/lib/queries.ts`);
console.log(`  ${content.length} -> ${out.length} bytes`);
console.log(`  Line ending: ${eol === '\r\n' ? 'CRLF' : 'LF'}`);
