#!/usr/bin/env node
/**
 * tools/print-masters/upload-masters.mjs
 *
 * Uploads stock print masters (4096×4096 RGB PNG) to the PRIVATE Netlify
 * Blobs store "print-masters", key = product slug. Never to Sanity: Sanity
 * assets are public by URL.
 *
 * Source layout:  <src>/<Subject Display Name>/Style <A-J>.png
 * Mapping:        folder → subject slug (lib.slugifySubject: slugify + the
 *                 C3-P0 / Hans Solo aliases), "Style X" case-insensitive.
 *                 Only slugs that exist as stock products in Sanity are
 *                 uploaded; everything else is listed as skipped.
 * Metadata:       sha256, bytes, width, height, sourcePath, uploadedAt.
 *                 sha256 is the master's identity (print-file cache key).
 *
 * Modes
 *   (default)       dry run: validate every file and print the plan. Reads the
 *                   store too if credentials are set, to show what's unchanged.
 *   --apply         upload (resumable: a slug whose stored sha256 matches the
 *                   local file is skipped; safe to stop and re-run)
 *   --only <slug>   just that product (combine with --apply for a test upload)
 *   --verify        compare the store with the product list: missing, extra,
 *                   sha mismatches
 *   --src <dir>     source folder (default C:\Users\chris\Projects\pixel8-upscaled)
 *
 * Needs in .env: SANITY_TOKEN (product list); for --apply / --verify also
 * NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN (a personal access token).
 * Log: %TEMP%\pixel8-masters-upload.log   Hash cache: %TEMP%\pixel8-masters-sha-cache.json
 */
import dotenv from 'dotenv';
import { createClient } from '@sanity/client';
import { getStore } from '@netlify/blobs';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, statSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlan, validateMaster, runUploads, compareStore, pool, withRetry } from './lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
dotenv.config({ path: join(ROOT, '.env') });

const STORE_NAME = 'print-masters';
const LOG_FILE = join(tmpdir(), 'pixel8-masters-upload.log');
const SHA_CACHE_FILE = join(tmpdir(), 'pixel8-masters-sha-cache.json');

// ── Args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const APPLY = flag('--apply');
const VERIFY = flag('--verify');
const ONLY = opt('--only');
const SRC = resolve(opt('--src') || 'C:\\Users\\chris\\Projects\\pixel8-upscaled');

const log = (line) => {
  try { appendFileSync(LOG_FILE, `${new Date().toISOString()} ${line}\n`); } catch { /* logging must never stop an upload */ }
};
const say = console.log.bind(console);

async function main() {
  if (APPLY && VERIFY) { console.error('Use --apply or --verify, not both.'); return 1; }
  if (!process.env.SANITY_TOKEN) { console.error('SANITY_TOKEN is not set.'); return 1; }
  if (!existsSync(SRC)) { console.error(`Source folder not found: ${SRC}`); return 1; }
  const haveBlobs = Boolean(process.env.NETLIFY_SITE_ID && process.env.NETLIFY_AUTH_TOKEN);
  if ((APPLY || VERIFY) && !haveBlobs) {
    console.error('NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN must be set in .env for --apply / --verify.');
    return 1;
  }

  const mode = VERIFY ? 'VERIFY' : APPLY ? 'APPLY' : 'DRY RUN';
  say(`\n  Print masters → Blobs "${STORE_NAME}" — ${mode}${ONLY ? ` (only ${ONLY})` : ''}`);
  say(`  Source: ${SRC}`);
  log(`---- ${mode}${ONLY ? ` only=${ONLY}` : ''} src=${SRC}`);

  // ── Products (the source of truth for what may be uploaded) ──────────────
  const sanity = createClient({
    projectId: 'bqb4w421', dataset: 'production', apiVersion: '2024-12-01',
    token: process.env.SANITY_TOKEN, useCdn: false, perspective: 'published',
  });
  const productSlugs = await sanity.fetch(
    `*[_type == "product" && category != "personalised" && defined(slug.current)].slug.current`,
  );
  say(`  Stock products in Sanity: ${productSlugs.length}`);
  if (ONLY && !productSlugs.includes(ONLY)) { console.error(`\n  --only ${ONLY}: not a stock product slug.`); return 1; }

  // ── Files ─────────────────────────────────────────────────────────────────
  const files = [];
  for (const dir of readdirSync(SRC)) {
    const full = join(SRC, dir);
    if (!statSync(full).isDirectory()) continue;
    for (const file of readdirSync(full)) if (statSync(join(full, file)).isFile()) files.push({ dir, file });
  }
  const plan = buildPlan(files, productSlugs);
  let candidates = plan.candidates;
  if (ONLY) candidates = candidates.filter((c) => c.slug === ONLY);

  // ── Validate every candidate (reads headers only) ─────────────────────────
  const refused = [];
  const valid = [];
  await pool(candidates, 8, async (c) => {
    let meta = null;
    try { meta = await sharp(join(SRC, c.dir, c.file)).metadata(); } catch { /* unreadable */ }
    const problems = validateMaster(meta);
    if (problems.length) refused.push({ ...c, problems }); else valid.push(c);
  });
  valid.sort((a, b) => a.slug.localeCompare(b.slug));
  refused.sort((a, b) => a.slug.localeCompare(b.slug));

  // ── Local sha256, cached by path + size + mtime (22 GB is slow to re-hash) ─
  let shaCache = {};
  try { shaCache = JSON.parse(readFileSync(SHA_CACHE_FILE, 'utf8')); } catch { /* none yet */ }
  const hashFile = (p) => new Promise((res, rej) => {
    const h = createHash('sha256');
    createReadStream(p).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej);
  });
  const localSha = async (c) => {
    const p = join(SRC, c.dir, c.file);
    const st = statSync(p);
    const k = `${c.sourcePath}|${st.size}|${st.mtimeMs}`;
    if (shaCache[k]) return shaCache[k];
    const sha = await hashFile(p);
    shaCache[k] = sha;
    return sha;
  };
  const saveShaCache = () => { try { writeFileSync(SHA_CACHE_FILE, JSON.stringify(shaCache)); } catch { /* cache is optional */ } };

  const store = haveBlobs
    ? getStore({ name: STORE_NAME, siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_AUTH_TOKEN, consistency: 'strong' })
    : null;

  // ── Verify ────────────────────────────────────────────────────────────────
  if (VERIFY) {
    const { blobs } = await withRetry(() => store.list());
    const keys = blobs.map((b) => b.key);
    const storedMeta = new Map();
    await pool(keys, 8, async (k) => {
      const m = await withRetry(() => store.getMetadata(k));
      storedMeta.set(k, m?.metadata || null);
    });
    say(`  Hashing ${valid.length} local masters (cached after the first run)…`);
    const localShas = new Map();
    await pool(valid, 4, async (c) => { localShas.set(c.slug, await localSha(c)); });
    saveShaCache();
    const r = compareStore(keys, storedMeta, ONLY ? [ONLY] : productSlugs, localShas);
    const noLocal = r.missing.filter((s) => !localShas.has(s));
    const missingWithLocal = r.missing.filter((s) => localShas.has(s));
    say(`\n  Store holds ${r.stored} object(s).`);
    say(`  Missing from store, local master exists (run --apply): ${missingWithLocal.length}`);
    missingWithLocal.forEach((s) => say(`    ${s}`));
    say(`  Missing from store, no local master yet:                ${noLocal.length}`);
    say(`  Extra keys in store (not a stock product):               ${r.extra.length}`);
    r.extra.forEach((s) => say(`    ${s}`));
    say(`  sha256 mismatch with local file:                         ${r.shaMismatch.length}`);
    r.shaMismatch.forEach((s) => say(`    ${s}`));
    say(`  Stored without sha256 metadata:                          ${r.noMetadata.length}`);
    r.noMetadata.forEach((s) => say(`    ${s}`));
    log(`verify stored=${r.stored} missingWithLocal=${missingWithLocal.length} noLocal=${noLocal.length} extra=${r.extra.length} mismatch=${r.shaMismatch.length}`);
    return missingWithLocal.length || r.extra.length || r.shaMismatch.length || r.noMetadata.length ? 1 : 0;
  }

  // ── Plan / upload ─────────────────────────────────────────────────────────
  if (!APPLY && !store) say('  (No NETLIFY_SITE_ID / NETLIFY_AUTH_TOKEN: the store is not consulted, so nothing shows as unchanged yet.)');
  const needSha = APPLY || store; // the dry run without a store needs no hashing
  const result = await runUploads(valid, {
    store, apply: APPLY, concurrency: 3, log,
    localSha: needSha ? localSha : async () => '',
    readFile: (c) => readFile(join(SRC, c.dir, c.file)),
    sha256: (buf) => createHash('sha256').update(buf).digest('hex'),
  });
  saveShaCache();

  // ── Summary ───────────────────────────────────────────────────────────────
  const bytesOf = (list) => list.reduce((s, c) => s + statSync(join(SRC, c.dir, c.file)).size, 0);
  const gb = (b) => `${(b / 1024 ** 3).toFixed(2)} GB`;
  if (!ONLY) {
    say(`\n  Skipped files (${plan.skipped.length}):`);
    for (const s of plan.skipped) say(`    ${s.sourcePath.padEnd(48)} ${s.reason}`);
  }
  if (refused.length) {
    say(`\n  Refused (${refused.length}):`);
    for (const r of refused) say(`    ${r.sourcePath.padEnd(48)} ${r.problems.join('; ')}`);
  }
  if (result.failed.length) {
    say(`\n  FAILED (${result.failed.length}) — re-run to retry:`);
    for (const f of result.failed) say(`    ${f.slug}: ${f.error}`);
  }
  say('\n  Summary');
  if (APPLY) {
    say(`    uploaded               ${result.uploaded.length}`);
    say(`    replaced (changed)     ${result.replaced.length}`);
    say(`    failed                 ${result.failed.length}`);
  } else {
    say(`    would upload           ${result.wouldUpload.filter((w) => w.action === 'upload').length}`);
    say(`    would replace          ${result.wouldUpload.filter((w) => w.action === 'replace').length}`);
  }
  say(`    skipped-unchanged      ${result.skippedUnchanged.length}${store ? '' : '  (store not consulted)'}`);
  say(`    refused                ${refused.length}`);
  if (!ONLY) {
    say(`    skipped files          ${plan.skipped.length}`);
    say(`    missing-master products ${plan.missing.length}${plan.duplicated.length ? ` (+ ${plan.duplicated.length} with duplicate files)` : ''}`);
  }
  say(`    ${APPLY ? 'bytes uploaded        ' : 'bytes to upload       '}  ${APPLY ? gb(result.bytes) : gb(bytesOf(valid.filter((c) => result.wouldUpload.some((w) => w.slug === c.slug))))}`);
  say(`    all valid masters      ${valid.length} files, ${gb(bytesOf(valid))}`);
  if (!ONLY && plan.missing.length) {
    const file = join(tmpdir(), 'pixel8-masters-missing.txt');
    writeFileSync(file, plan.missing.join('\r\n') + '\r\n');
    say(`\n  Missing-master product slugs written to ${file}`);
  }
  say(`  Log: ${LOG_FILE}\n`);
  log(`summary mode=${mode} valid=${valid.length} refused=${refused.length} uploaded=${result.uploaded.length} replaced=${result.replaced.length} unchanged=${result.skippedUnchanged.length} failed=${result.failed.length} bytes=${result.bytes}`);
  return result.failed.length ? 1 : 0;
}

// process.exitCode rather than process.exit(): exiting while fetch sockets
// close trips a libuv assertion on Windows (Node 24).
process.exitCode = await main();
