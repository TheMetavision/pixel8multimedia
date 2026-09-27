/**
 * "PRINT FILE MISSING" in the Stripe webhook: alert, never block.
 *
 *   node tools/builder/print-alerts-tests.mjs
 *
 * webhook.mjs calls flagMissingPrintFiles on the new order lines before it
 * creates the order, then teamSubject / missingBlockHtml for the team email.
 * These are exercised here with fake Blobs stores (present, absent, erroring,
 * hanging).
 */
import { flagMissingPrintFiles, teamSubject, missingBlockHtml, SUBJECT_PREFIX, PRINT_CHECK_TIMEOUT_MS } from '../../netlify/functions/_shared/print-alerts.mjs';
import { orderLineFromItem } from '../../netlify/functions/_shared/order-lines.mjs';
import { renderKey } from '../../netlify/functions/_shared/print-sources.mjs';

let pass = 0, fail = 0;
const ok = (c, l, e = '') => {
  if (c) { pass++; console.log(`  PASS  ${l}${e !== '' ? ' — ' + e : ''}`); }
  else { fail++; console.log(`  FAIL  ${l}${e !== '' ? ' — ' + e : ''}`); }
};
const say = console.log.bind(console);

const store = (keys) => ({ getMetadata: async (k) => (keys.includes(k) ? { etag: '"e"', metadata: { sha256: 'f'.repeat(64) } } : null) });
const storesWith = ({ masters = [], renders = [] }) => (name) => (name === 'print-masters' ? store(masters) : store(renders));

const stock = (slug, n) => orderLineFromItem({ productId: `product-${slug}`, slug, title: slug, format: 'poster', size: 'small', formatKey: 'poster', sizeKey: 'small', styleLetter: 'C', quantity: 1, unitPrice: 9.99 }, n, 1);
const personalised = (n) => orderLineFromItem({ productId: 'your-photo', slug: 'your-photo', title: 'Your Photo', format: 'canvasGallery', size: 'large', formatKey: 'canvasGallery', sizeKey: 'large', personalisationId: 'abcdefghijklmnopqrstuv', styleKey: 'style-b', quantity: 1, unitPrice: 52.99 }, n, 1);
const historic = (n) => orderLineFromItem({ productId: 'p', slug: 'elvis-style-e', title: 'Elvis', format: 'poster', size: 'small', quantity: 1, unitPrice: 9.99 }, n, 1);

say('\n1. MISSING MASTER → FLAG AND SUBJECT PREFIX\n');
{
  const lines = [stock('hulk-style-c', 0), stock('eminem-style-j', 1)];
  const r = await flagMissingPrintFiles(lines, storesWith({ masters: ['hulk-style-c'] }));
  ok(r.missing.length === 1 && lines[1].printFileMissing === true && !('printFileMissing' in lines[0]), 'only the line without a master is flagged');
  const subject = teamSubject({ total: 14.94, customerName: 'A Customer', missingCount: r.missing.length });
  ok(subject.startsWith(SUBJECT_PREFIX) && subject === 'PRINT FILE MISSING — NEW ORDER — £14.94 — A Customer', 'team subject starts with "PRINT FILE MISSING — "', subject);
  const html = missingBlockHtml(r.missing);
  ok(/PRINT FILE MISSING/.test(html) && /eminem-style-j/.test(html) && !/hulk-style-c/.test(html), 'team-only block names the missing line');
}

say('\n2. MASTER PRESENT → NO FLAG\n');
{
  const lines = [stock('hulk-style-c', 0)];
  const r = await flagMissingPrintFiles(lines, storesWith({ masters: ['hulk-style-c'] }));
  ok(r.missing.length === 0 && !('printFileMissing' in lines[0]), 'no flag');
  ok(teamSubject({ total: 9.99, customerName: 'B', missingCount: 0 }) === 'NEW ORDER — £9.99 — B', 'normal subject');
  ok(missingBlockHtml([]) === '', 'no block in the team email');
}

say('\n3. PERSONALISED LINES\n');
{
  const a = [personalised(0)];
  await flagMissingPrintFiles(a, storesWith({ renders: [renderKey('abcdefghijklmnopqrstuv', 'style-b')] }));
  ok(!('printFileMissing' in a[0]), 'render present → no flag');
  const b = [personalised(0)];
  const r = await flagMissingPrintFiles(b, storesWith({}));
  ok(b[0].printFileMissing === true && /personalised render style-b/.test(missingBlockHtml(r.missing)), 'render missing → flagged, and named in the team block');
}

say('\n4. HISTORIC LINE → NEVER FLAGGED\n');
{
  let asked = 0;
  const lines = [historic(0)];
  const r = await flagMissingPrintFiles(lines, () => ({ getMetadata: async () => { asked++; return null; } }));
  ok(r.missing.length === 0 && !('printFileMissing' in lines[0]) && asked === 0, 'a line without keys is not even looked up');
}

say('\n5. BLOBS DOWN → NO FLAG, NO DELAY, ORDER GOES AHEAD\n');
{
  const lines = [stock('eminem-style-j', 0)];
  const t0 = Date.now();
  const r = await flagMissingPrintFiles(lines, () => ({ getMetadata: async () => { throw new Error('ECONNREFUSED blobs'); } }));
  ok(r.missing.length === 0 && !('printFileMissing' in lines[0]) && /ECONNREFUSED/.test(r.skipped), 'store errors → skipped (reason returned for the log), nothing flagged', r.skipped);
  ok(Date.now() - t0 < 200, 'and it returns straight away');

  const hung = [stock('eminem-style-j', 0)];
  const t1 = Date.now();
  const h = await flagMissingPrintFiles(hung, () => ({ getMetadata: () => new Promise(() => {}) }));
  const took = Date.now() - t1;
  ok(h.missing.length === 0 && /timed out/.test(h.skipped) && took < PRINT_CHECK_TIMEOUT_MS + 300, `store hangs → gives up at the ${PRINT_CHECK_TIMEOUT_MS} ms deadline, nothing flagged`, `${took} ms`);

  const sync = [stock('eminem-style-j', 0)];
  const s = await flagMissingPrintFiles(sync, () => { throw new Error('MissingBlobsEnvironmentError'); });
  ok(s.missing.length === 0 && s.skipped, 'getStore itself throwing (no Blobs context) → skipped, not thrown');
  // "Order still created": flagMissingPrintFiles never throws, so webhook.mjs
  // carries on to sanity.create with the lines unflagged.
}

say('\n6. THE CUSTOMER EMAIL IS UNTOUCHED\n');
{
  // The customer email is built from the cart items, not the flagged lines, and
  // never includes missingBlockHtml or the subject prefix (see webhook.mjs).
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../netlify/functions/webhook.mjs', import.meta.url), 'utf8');
  const customer = src.slice(src.indexOf('// Customer confirmation email'), src.indexOf('// Team notification email'));
  ok(customer.length > 100 && !/missingBlockHtml|teamSubject|printFileMissing|PRINT FILE/.test(customer), 'nothing print-file related in the customer email block');
  const team = src.slice(src.indexOf('// Team notification email'));
  ok(/teamSubject\(/.test(team) && /missingBlockHtml\(printCheck\.missing\)/.test(team), 'the team email uses the subject prefix and the block');
}

say(`\n${pass} passed, ${fail} failed.`);
process.exitCode = fail ? 1 : 0;
