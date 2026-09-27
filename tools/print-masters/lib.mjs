/**
 * tools/print-masters/lib.mjs
 *
 * Pure pieces of upload-masters.mjs, kept separate so the tests can drive
 * them with fake folders, fake products and a mock Blobs store.
 */

/** Folder names that don't slugify to their product's subject. */
export const SUBJECT_ALIASES = {
  'c3-p0': 'c-3po',     // folder "C3-P0"    → product c-3po-style-*
  'hans-solo': 'han-solo', // folder "Hans Solo" → product han-solo-style-*
};

/** The audit's rule: lower-case, & → and, anything else non-alphanumeric → '-'. */
export function slugifySubject(folderName) {
  const s = String(folderName).toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return SUBJECT_ALIASES[s] || s;
}

/** "Style A.png" / "style g.PNG" → 'a'; anything else → null. */
export function styleLetterOf(fileName) {
  const m = /^style ([a-j])\.png$/i.exec(String(fileName));
  return m ? m[1].toLowerCase() : null;
}

/**
 * Decide, for every file found, whether it's a master for a real product.
 *
 * @param {Array<{ dir: string, file: string }>} files   relative: dir = subject folder
 * @param {Set<string>|string[]} productSlugs             stock product slugs
 * @returns {{
 *   candidates: Array<{ slug, dir, file, sourcePath }>,
 *   skipped: Array<{ sourcePath, reason }>,
 *   missing: string[],          products with no master file
 * }}
 */
export function buildPlan(files, productSlugs) {
  const products = new Set(productSlugs);
  const subjects = new Set([...products].map((s) => s.replace(/-style-[a-j]$/, '')));
  const bySlug = new Map();
  const skipped = [];

  for (const { dir, file } of files) {
    const sourcePath = `${dir}/${file}`;
    const letter = styleLetterOf(file);
    if (!letter) { skipped.push({ sourcePath, reason: 'not a "Style X.png" file' }); continue; }
    const subject = slugifySubject(dir);
    if (!subjects.has(subject)) { skipped.push({ sourcePath, reason: `no stock product for subject "${subject}"` }); continue; }
    const slug = `${subject}-style-${letter}`;
    if (!products.has(slug)) { skipped.push({ sourcePath, reason: `no product ${slug}` }); continue; }
    if (!bySlug.has(slug)) bySlug.set(slug, []);
    bySlug.get(slug).push({ slug, dir, file, sourcePath });
  }

  const candidates = [];
  for (const [slug, list] of bySlug) {
    if (list.length === 1) candidates.push(list[0]);
    else for (const c of list) skipped.push({ sourcePath: c.sourcePath, reason: `duplicate: ${list.length} files map to ${slug}` });
  }
  candidates.sort((a, b) => a.slug.localeCompare(b.slug));
  const covered = new Set(candidates.map((c) => c.slug));
  const duplicated = new Set([...bySlug].filter(([, l]) => l.length > 1).map(([s]) => s));
  const missing = [...products].filter((s) => !covered.has(s) && !duplicated.has(s)).sort();
  return { candidates, skipped, missing, duplicated: [...duplicated].sort() };
}

export const MASTER_PX = 4096;

/** Refuse anything that isn't a 4096×4096 RGB PNG. `meta` is sharp().metadata(). */
export function validateMaster(meta) {
  const problems = [];
  if (!meta) return ['unreadable'];
  if (meta.format !== 'png') problems.push(`format ${meta.format}, not png`);
  if (meta.width !== MASTER_PX || meta.height !== MASTER_PX) problems.push(`${meta.width}×${meta.height}, not ${MASTER_PX}×${MASTER_PX}`);
  if (meta.channels !== 3 || meta.hasAlpha) problems.push(`${meta.channels} channel(s)${meta.hasAlpha ? ' with alpha' : ''}, not RGB`);
  if (meta.space && meta.space !== 'srgb') problems.push(`colour space ${meta.space}, not srgb`);
  return problems;
}

/**
 * Resume decision: upload unless the store already holds this exact file.
 * @param {string} localSha
 * @param {{ metadata?: { sha256?: string } } | null} stored   store.getMetadata(slug) result
 */
export function decide(localSha, stored) {
  if (!stored) return 'upload';
  if (stored.metadata?.sha256 === localSha) return 'skip-unchanged';
  return 'replace';
}

/** Run `fn` over items with at most `n` in flight. */
export async function pool(items, n, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

/** Retry with backoff: 1 s, 3 s, 9 s … between attempts. */
export async function withRetry(fn, { attempts = 4, baseDelayMs = 1000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), onRetry } = {}) {
  let last;
  for (let a = 1; a <= attempts; a++) {
    try { return await fn(a); } catch (err) {
      last = err;
      if (a === attempts) break;
      const delay = baseDelayMs * Math.pow(3, a - 1);
      onRetry?.(err, a, delay);
      await sleep(delay);
    }
  }
  throw last;
}

/**
 * The upload loop, with its I/O injected.
 *
 * deps:
 *   store        { getMetadata(key), set(key, data, { metadata }) }  — @netlify/blobs Store or a mock
 *   readFile(c)  → Promise<Uint8Array>
 *   sha256(buf)  → hex
 *   localSha(c)  → Promise<hex>   (cheap, cached; used to decide before reading the file into memory)
 *   log(line)
 *   now()        → ISO string
 *   apply        false = plan only (store is still consulted if given, nothing is written)
 */
export async function runUploads(candidates, { store, readFile, sha256, localSha, log = () => {}, now = () => new Date().toISOString(), apply = false, concurrency = 3, retry = {} }) {
  const result = { uploaded: [], replaced: [], skippedUnchanged: [], wouldUpload: [], failed: [], bytes: 0 };
  await pool(candidates, concurrency, async (c) => {
    try {
      const sha = await localSha(c);
      const stored = store ? await withRetry(() => store.getMetadata(c.slug), retry) : null;
      const action = decide(sha, stored);
      if (action === 'skip-unchanged') { result.skippedUnchanged.push(c.slug); log(`skip-unchanged ${c.slug}`); return; }
      if (!apply) { result.wouldUpload.push({ slug: c.slug, action }); return; }

      const data = await readFile(c);
      const dataSha = sha256(data);
      if (dataSha !== sha) throw new Error('file changed while uploading — re-run');
      const metadata = {
        sha256: dataSha, bytes: data.byteLength, width: 4096, height: 4096,
        sourcePath: c.sourcePath, uploadedAt: now(),
      };
      const t0 = Date.now();
      await withRetry(() => store.set(c.slug, data, { metadata }), {
        ...retry, onRetry: (err, a, d) => log(`retry ${c.slug} attempt ${a} failed (${err?.message}); waiting ${d} ms`),
      });
      // Read back: the store must now report this exact file.
      const check = await withRetry(() => store.getMetadata(c.slug), retry);
      if (check?.metadata?.sha256 !== dataSha) throw new Error('stored sha256 does not match after upload');
      (action === 'replace' ? result.replaced : result.uploaded).push(c.slug);
      result.bytes += data.byteLength;
      log(`${action === 'replace' ? 'replaced' : 'uploaded'} ${c.slug} ${data.byteLength} bytes in ${Date.now() - t0} ms`);
    } catch (err) {
      result.failed.push({ slug: c.slug, error: String(err?.message || err) });
      log(`FAILED ${c.slug}: ${err?.message || err}`);
    }
  });
  return result;
}

/**
 * --verify: what the store holds vs what it should.
 * @param {string[]} storeKeys
 * @param {Map<string, object|null>} storedMeta   key → getMetadata().metadata
 * @param {string[]} productSlugs
 * @param {Map<string, string>} localShas         slug → sha of the local master (where one exists)
 */
export function compareStore(storeKeys, storedMeta, productSlugs, localShas) {
  const keys = new Set(storeKeys);
  const products = new Set(productSlugs);
  const missing = [...products].filter((s) => !keys.has(s)).sort();
  const extra = [...keys].filter((k) => !products.has(k)).sort();
  const shaMismatch = [];
  const noMetadata = [];
  for (const k of keys) {
    if (!products.has(k)) continue;
    const m = storedMeta.get(k);
    if (!m?.sha256) { noMetadata.push(k); continue; }
    const local = localShas.get(k);
    if (local && local !== m.sha256) shaMismatch.push(k);
  }
  return { stored: keys.size, missing, extra, shaMismatch: shaMismatch.sort(), noMetadata: noMetadata.sort() };
}
