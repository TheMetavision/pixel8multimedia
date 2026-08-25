#!/usr/bin/env node
// scripts/groupon-daily.mjs
//
// The daily Groupon round. Everything the routine does lives here rather than
// in a scheduled prompt, so it is versioned, testable, and can be run by hand
// in exactly the same way the task runs it:
//
//   node --env-file=.env scripts/groupon-daily.mjs
//
// It does three things, in order:
//   1. Acts on any CSV dropped in groupon-exports/ — imported AND verified,
//      because either kind of Groupon export can release held orders.
//   2. Sweeps: releases lapsed claims, expires old vouchers, repairs any
//      voucher whose payment webhook didn't finish.
//   3. Reports what is still waiting on a human.
//
// It prints a short report and exits 0 when nothing needs attention, or 10
// when something does — so the caller can stay quiet on a normal day.
//
// --dry-run  shows what would happen and writes nothing.

import { readdirSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, basename, extname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const CLI = join(__dirname, 'groupon-vouchers.mjs');
const DROP = join(REPO, 'groupon-exports');
const DONE = join(DROP, 'processed');

const DRY = process.argv.includes('--dry-run');
const NEEDS_ATTENTION = 10;

function run(args) {
  const res = spawnSync(process.execPath, [CLI, ...args, '--json'], {
    cwd: REPO,
    encoding: 'utf8',
    env: process.env,
  });
  if (res.error) return { ok: false, error: res.error.message };
  const text = (res.stdout || '').trim();
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    // Non-JSON output (sweep, or an early failure) — hand back the text so the
    // report can still say something useful rather than swallowing it.
    return { ok: res.status === 0, text, error: (res.stderr || '').trim() || undefined };
  }
}

function stamp() {
  // No Date.now() games — this runs on a real machine with a real clock.
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

const lines = [];
const say = (s = '') => lines.push(s);

// ── 1. anything dropped in the folder ──────────────────────────────────────
let filesHandled = 0;
let released = 0;
const mismatches = [];
const importErrors = [];

if (!existsSync(DROP)) mkdirSync(DROP, { recursive: true });
if (!existsSync(DONE)) mkdirSync(DONE, { recursive: true });

const drops = readdirSync(DROP)
  .filter((f) => ['.csv', '.tsv'].includes(extname(f).toLowerCase()))
  .map((f) => join(DROP, f));

for (const file of drops) {
  const name = basename(file);
  say(`Export: ${name}`);

  // Import first — new codes become known and authoritative, and any order
  // already held against them is released as a side effect.
  const imp = run(['import', file, ...(DRY ? ['--dry-run'] : [])]);
  if (imp.data) {
    const d = imp.data;
    const newly = (d.created || []).length;
    const auto = (d.autoVerified || []).length;
    released += auto;
    for (const m of d.autoMismatched || []) mismatches.push(m);
    for (const e of d.errors || []) importErrors.push(e);
    say(`  imported ${newly}, released ${auto}, mismatches ${(d.autoMismatched || []).length}, errors ${(d.errors || []).length}`);
  } else {
    say(`  import: ${imp.error || imp.text || 'no result'}`);
  }

  // Then verify — catches held orders whose codes this export explains but
  // which the import skipped because the code was already on file.
  const ver = run(['verify', file, ...(DRY ? ['--dry-run'] : [])]);
  if (ver.data) {
    const d = ver.data;
    released += (d.verified || []).length;
    for (const m of d.mismatched || []) mismatches.push(m);
    say(`  verified ${(d.verified || []).length}, mismatches ${(d.mismatched || []).length}, unexplained ${(d.stillUnchecked || []).length}`);
  } else {
    say(`  verify: ${ver.error || ver.text || 'no result'}`);
  }

  if (!DRY) {
    try {
      renameSync(file, join(DONE, `${stamp()}--${name}`));
      say(`  moved to processed/`);
    } catch (e) {
      say(`  could not move to processed/: ${e.message}`);
    }
  }
  filesHandled++;
  say();
}

if (filesHandled === 0) say('No new exports in groupon-exports/.\n');

// ── 2. housekeeping ────────────────────────────────────────────────────────
const sweep = run(['sweep', ...(DRY ? ['--dry-run'] : [])]);
if (sweep.text) {
  const interesting = sweep.text
    .split('\n')
    .filter((l) => /released|expiry|finalised|repaired|Paid but/.test(l))
    .map((l) => l.trim())
    .filter(Boolean);
  if (interesting.length) {
    say('Sweep:');
    for (const l of interesting) say(`  ${l}`);
    say();
  }
}

// ── 3. what still needs a person ───────────────────────────────────────────
const pending = run(['pending']);
const waiting = Array.isArray(pending.data) ? pending.data : [];

say('─'.repeat(64));
if (waiting.length === 0 && mismatches.length === 0 && importErrors.length === 0) {
  say('Nothing needs you. Every paid Groupon order has a confirmed voucher.');
  console.log(lines.join('\n'));
  process.exit(0);
}

if (waiting.length) {
  say(`${waiting.length} order(s) waiting on a Merchant Center lookup:`);
  say();
  for (const v of waiting) {
    say(`  ${v.code}   ${v.campaignName || v.serviceSlug || ''} — ${v.optionLabel || ''}`);
    say(`  ${' '.repeat(v.code.length)}   order ${v.orderRef || '—'} · ${v.customerName || ''} <${v.customerEmail || ''}>`);
  }
  say();
  say('  Codes to paste into Merchant Center:');
  say(`  ${waiting.map((v) => v.code).join('  ')}`);
  say();
  say('  Then release them:');
  for (const v of waiting.slice(0, 3)) {
    say(`    node --env-file=.env scripts/groupon-vouchers.mjs confirm ${v.code}`);
  }
  if (waiting.length > 3) say(`    …and ${waiting.length - 3} more`);
  say();
}

if (mismatches.length) {
  say(`${mismatches.length} MISMATCH(ES) — ordered something other than what Groupon sold them.`);
  say('These need a customer conversation before any work starts:');
  for (const m of mismatches) say(`  ${m.code}: ${m.detail || ''}`);
  say();
}

if (importErrors.length) {
  say(`${importErrors.length} row(s) could not be imported:`);
  for (const e of importErrors.slice(0, 10)) say(`  ${e.code}: ${e.reason}`);
  say();
}

console.log(lines.join('\n'));
process.exit(NEEDS_ATTENTION);
