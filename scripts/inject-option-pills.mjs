// scripts/inject-option-pills.mjs
// One-shot script: inserts the Option Pills HTML into src/pages/store/[character].astro
// between the price-tag div and the Format Selector. Idempotent: safe to re-run.

import fs from 'node:fs';
import path from 'node:path';

const filePath = path.resolve('src/pages/store/[character].astro');
const content = fs.readFileSync(filePath, 'utf8');

const sentinel = '<!-- Option Pills -->';
if (content.includes(sentinel)) {
  console.log('✓ Option Pills HTML already present — no changes made');
  process.exit(0);
}

const anchor = '          <!-- Format Selector -->';
if (!content.includes(anchor)) {
  console.error('✗ Anchor not found: "<!-- Format Selector -->"');
  console.error('   The file may have been modified since this script was written.');
  process.exit(1);
}

const pillsBlock = `          <!-- Option Pills -->
          <div class="mb-6">
            <label class="font-montserrat text-xs font-semibold text-mid-grey uppercase tracking-wider block mb-3">Option</label>
            <div class="grid grid-cols-5 sm:grid-cols-10 gap-2" id="option-pills">
              {variantPayloads.map((v) => (
                <button
                  class={\`option-pill font-montserrat text-sm font-semibold py-3 px-2 rounded border transition-all text-center \${v.letter === requestedOption ? 'border-pop-orange bg-pop-orange/10 text-pop-orange' : 'border-edge-line text-mid-grey hover:border-pop-orange hover:text-pop-orange'}\`}
                  data-letter={v.letter}
                  aria-label={\`Option \${v.letter.toUpperCase()}\`}
                >
                  {v.letter.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <!-- Format Selector -->`;

const patched = content.replace(anchor, pillsBlock);

if (patched === content) {
  console.error('✗ Replacement did not change the file — anchor mismatch?');
  process.exit(1);
}

fs.writeFileSync(filePath, patched, 'utf8');
console.log('✓ Option Pills HTML inserted');
console.log(`  File size: ${content.length} → ${patched.length} bytes`);
