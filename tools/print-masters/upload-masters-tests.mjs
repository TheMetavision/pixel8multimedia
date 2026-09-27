/**
 * Print-master upload: mapping, exclusion, validation and resume.
 *
 *   node tools/print-masters/upload-masters-tests.mjs
 */
import {
  slugifySubject, styleLetterOf, buildPlan, validateMaster, decide, runUploads, compareStore, withRetry,
} from './lib.mjs';
import { createHash } from 'node:crypto';

let pass = 0, fail = 0;
const ok = (c, l, e = '') => {
  if (c) { pass++; console.log(`  PASS  ${l}${e !== '' ? ' — ' + e : ''}`); }
  else { fail++; console.log(`  FAIL  ${l}${e !== '' ? ' — ' + e : ''}`); }
};
const say = console.log.bind(console);
const sha = (s) => createHash('sha256').update(s).digest('hex');

say('\n1. FOLDER → SLUG\n');
{
  ok(slugifySubject('Charlie Chaplin The Tramp') === 'charlie-chaplin-the-tramp', 'spaces → hyphens, lower case');
  ok(slugifySubject('E.T') === 'e-t', 'punctuation → hyphen', slugifySubject('E.T'));
  ok(slugifySubject('Tom and Jerry') === 'tom-and-jerry' && slugifySubject('Tom & Jerry') === 'tom-and-jerry', '& → and');
  ok(slugifySubject('C3-P0') === 'c-3po', 'alias: C3-P0 → c-3po');
  ok(slugifySubject('Hans Solo') === 'han-solo', 'alias: Hans Solo → han-solo');
  ok(styleLetterOf('Style A.png') === 'a' && styleLetterOf('style G.png') === 'g' && styleLetterOf('STYLE J.PNG') === 'j', '"Style X" is case-insensitive (incl. the lowercase "style G")');
  ok(styleLetterOf('Style K.png') === null && styleLetterOf('Style A.jpg') === null && styleLetterOf('Style A copy.png') === null, 'other names are not masters');
}

say('\n2. ORPHANS, EXCLUSIONS, MISSING\n');
{
  const products = [
    ...'abcdefghij'.split('').map((l) => `jabba-the-hutt-style-${l}`),
    ...'abcdefghij'.split('').map((l) => `c-3po-style-${l}`),
    'han-solo-style-a', 'gandalf-style-a', 'eminem-style-a', 'eminem-style-b',
  ];
  const files = [
    ...'ABCDEFHIJ'.split('').map((l) => ({ dir: 'Jabba The Hutt', file: `Style ${l}.png` })),
    { dir: 'Jabba The Hutt', file: 'style G.png' },
    { dir: 'C3-P0', file: 'Style A.png' },
    { dir: 'Hans Solo', file: 'Style A.png' },
    { dir: 'Gandalf', file: 'Style A.png' },
    { dir: 'Gandolf', file: 'Style A.png' },          // misspelt duplicate folder
    { dir: 'Baby Yoda', file: 'Style A.png' },        // subject not in the catalogue
    { dir: 'Eminem', file: 'Style A.png' },
    { dir: 'Eminem', file: 'notes.txt' },
    { dir: 'Han Solo', file: 'Style A.png' },         // a second folder for the same subject
  ];
  const p = buildPlan(files, products);
  const slugs = p.candidates.map((c) => c.slug);
  ok(slugs.includes('jabba-the-hutt-style-g') && p.candidates.find((c) => c.slug === 'jabba-the-hutt-style-g').file === 'style G.png', 'the lowercase "style G.png" maps to jabba-the-hutt-style-g');
  ok(slugs.includes('c-3po-style-a'), 'C3-P0 folder → c-3po-style-a');
  ok(p.skipped.some((s) => s.sourcePath === 'Gandolf/Style A.png' && /no stock product/.test(s.reason)), 'Gandolf (misspelt duplicate) is skipped: no such subject');
  ok(p.skipped.some((s) => s.sourcePath === 'Baby Yoda/Style A.png'), 'an orphan subject is skipped');
  ok(p.skipped.some((s) => s.sourcePath === 'Eminem/notes.txt'), 'a non-master file is skipped');
  ok(!slugs.includes('han-solo-style-a') && p.skipped.filter((s) => /duplicate/.test(s.reason)).length === 2 && p.duplicated.includes('han-solo-style-a'),
    'two folders mapping to one slug: both refused as duplicates, never guessed');
  ok(p.missing.includes('eminem-style-b') && p.missing.includes('c-3po-style-j') && !p.missing.includes('eminem-style-a'), 'products without a file are reported as missing');
  ok(!p.missing.includes('han-solo-style-a'), 'a duplicated slug is reported as duplicated, not missing');
}

say('\n3. VALIDATION\n');
{
  const good = { format: 'png', width: 4096, height: 4096, channels: 3, hasAlpha: false, space: 'srgb' };
  ok(validateMaster(good).length === 0, 'a 4096×4096 RGB sRGB PNG passes');
  ok(validateMaster({ ...good, format: 'jpeg' }).some((p) => /png/.test(p)), 'JPEG refused');
  ok(validateMaster({ ...good, width: 2048, height: 2048 }).some((p) => /4096/.test(p)), '2048² refused');
  ok(validateMaster({ ...good, width: 4096, height: 4095 }).length === 1, 'non-square refused');
  ok(validateMaster({ ...good, channels: 4, hasAlpha: true }).some((p) => /RGB/.test(p)), 'RGBA refused');
  ok(validateMaster({ ...good, channels: 1, space: 'b-w' }).length === 2, 'greyscale refused');
  ok(validateMaster({ ...good, space: 'cmyk', channels: 4 }).length >= 1, 'CMYK refused');
  ok(validateMaster(null)[0] === 'unreadable', 'an unreadable file is refused');
}

say('\n4. RESUME\n');
{
  ok(decide('abc', null) === 'upload', 'not in store → upload');
  ok(decide('abc', { metadata: { sha256: 'abc' } }) === 'skip-unchanged', 'same sha256 → skip');
  ok(decide('abc', { metadata: { sha256: 'old' } }) === 'replace', 'different sha256 → replace');
  ok(decide('abc', { metadata: {} }) === 'replace', 'stored without sha256 → replace');

  /** A mock Blobs store that can fail on demand. */
  const mockStore = (initial = {}, failSets = 0) => {
    const data = new Map(Object.entries(initial));
    let failuresLeft = failSets;
    return {
      data, sets: 0,
      async getMetadata(k) { return data.has(k) ? { etag: 'e', metadata: data.get(k).metadata } : null; },
      async set(k, v, { metadata }) {
        this.sets++;
        if (failuresLeft > 0) { failuresLeft--; throw new Error('HTTP 503'); }
        data.set(k, { v, metadata });
      },
    };
  };
  const content = { a: 'AAAA', b: 'BBBB', c: 'CCCC' };
  const cands = Object.keys(content).map((k) => ({ slug: `x-style-${k}`, dir: 'X', file: `Style ${k}.png`, sourcePath: `X/Style ${k}.png` }));
  const deps = (store, extra = {}) => ({
    store, apply: true, concurrency: 3,
    retry: { attempts: 3, sleep: async () => {} },
    localSha: async (c) => sha(content[c.slug.slice(-1)]),
    readFile: async (c) => Buffer.from(content[c.slug.slice(-1)]),
    sha256: (b) => sha(b),
    now: () => '2026-09-27T00:00:00.000Z',
    ...extra,
  });

  const s1 = mockStore({ 'x-style-a': { metadata: { sha256: sha('AAAA') } } });
  const r1 = await runUploads(cands, deps(s1));
  ok(r1.skippedUnchanged.join() === 'x-style-a' && r1.uploaded.sort().join() === 'x-style-b,x-style-c', 'already-uploaded a is skipped; b and c uploaded');
  const m = s1.data.get('x-style-b').metadata;
  ok(m.sha256 === sha('BBBB') && m.bytes === 4 && m.width === 4096 && m.height === 4096 && m.sourcePath === 'X/Style b.png' && m.uploadedAt,
    'metadata: sha256, bytes, width, height, sourcePath, uploadedAt');

  const r2 = await runUploads(cands, deps(s1));
  ok(r2.skippedUnchanged.length === 3 && r2.uploaded.length === 0 && s1.sets === 2, 're-run after completion: everything skipped, nothing re-sent');

  content.c = 'CHANGED';
  const r3 = await runUploads(cands, deps(s1));
  ok(r3.replaced.join() === 'x-style-c' && r3.skippedUnchanged.length === 2, 'an edited master is replaced');

  const s4 = mockStore({}, 2);
  const r4 = await runUploads([cands[0]], deps(s4));
  ok(r4.uploaded.length === 1 && s4.sets === 3, 'two 503s then success: retried, uploaded', `${s4.sets} set calls`);

  const s5 = mockStore({}, 99);
  const r5 = await runUploads(cands, deps(s5));
  ok(r5.failed.length === 3 && r5.uploaded.length === 0, 'always failing: every slug reported failed, none marked uploaded (so a re-run retries them)');

  const s6 = mockStore();
  const r6 = await runUploads(cands, deps(s6, { apply: false }));
  ok(s6.sets === 0 && r6.wouldUpload.length === 3, 'dry run: consults the store, writes nothing');

  const s7 = mockStore();
  const r7 = await runUploads([cands[0]], deps(s7, { readFile: async () => Buffer.from('DIFFERENT') }));
  ok(r7.failed.length === 1 && s7.sets === 0, 'file changed between hashing and reading: refused, not uploaded');

  let n = 0;
  const flaky = await withRetry(async () => { if (++n < 3) throw new Error('x'); return 'ok'; }, { sleep: async () => {} });
  ok(flaky === 'ok' && n === 3, 'withRetry: succeeds on the third attempt');
}

say('\n5. VERIFY\n');
{
  const r = compareStore(
    ['a-style-a', 'a-style-b', 'stray-key'],
    new Map([['a-style-a', { sha256: 'S1' }], ['a-style-b', { sha256: 'OLD' }], ['stray-key', { sha256: 'Z' }]]),
    ['a-style-a', 'a-style-b', 'a-style-c'],
    new Map([['a-style-a', 'S1'], ['a-style-b', 'NEW']]),
  );
  ok(r.missing.join() === 'a-style-c', 'missing: a product not in the store');
  ok(r.extra.join() === 'stray-key', 'extra: a key that is not a product');
  ok(r.shaMismatch.join() === 'a-style-b', 'sha mismatch: stored file differs from the local master');
}

say(`\n${pass} passed, ${fail} failed.`);
process.exitCode = fail ? 1 : 0;
