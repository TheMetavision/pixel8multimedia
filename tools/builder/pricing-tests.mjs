/**
 * The shop cart is priced by the server, not the browser.
 *
 *   node tools/builder/pricing-tests.mjs
 *
 * checkout.mjs used to charge `unit_amount = item.unitPrice * 100` — whatever
 * the browser posted. It now charges what priceCart() returns: Sanity
 * product.prices for stock lines, YOUR_PHOTO_PRICES + PERSONALISATION_FEE for
 * Your Photo lines.
 */
import {
  priceCart, shippingPenceFor, PERSONALISATION_FEE, YOUR_PHOTO_PRICES, MAX_QTY, styleLetterOf,
} from '../../netlify/functions/_shared/pricing.mjs';

let pass = 0, fail = 0;
const ok = (c, l, e = '') => {
  if (c) { pass++; console.log(`  PASS  ${l}${e !== '' ? ' — ' + e : ''}`); }
  else { fail++; console.log(`  FAIL  ${l}${e !== '' ? ' — ' + e : ''}`); }
};
const say = console.log.bind(console);

const STD = {
  poster: { small: 9.99, medium: 12.99, large: 16.99 },
  canvasStandard: { small: 27.99, medium: 32.99, large: 44.99 },
  canvasGallery: { small: 29.99, medium: 35.99, large: 47.99 },
};
const PRODUCTS = [
  { _id: 'product-hulk-style-c', slug: 'hulk-style-c', title: 'Hulk — Option C', category: 'tv-movies', style: 'style-c', prices: STD, imageRef: 'image-abc-1024x1024-png' },
  { _id: 'product-prankz', slug: 'personalised-prankz', title: 'Prankz', category: 'personalised', style: 'style-a',
    prices: { poster: { small: 24.99, medium: 24.99, large: 24.99 }, canvasStandard: { small: 0, medium: 0, large: 0 }, canvasGallery: { small: 0, medium: 0, large: 0 } } },
  { _id: 'product-odd', slug: 'odd-style-b', title: 'Odd', category: 'music', style: 'style-b',
    prices: { poster: { small: 9.99, medium: 0, large: null } } },
];
const stock = (over = {}) => ({ productId: 'product-hulk-style-c', slug: 'hulk-style-c', title: 'x', format: 'poster', size: 'small', quantity: 1, unitPrice: 9.99, ...over });
const photo = (over = {}) => ({ productId: 'your-photo', slug: 'your-photo', title: 'Your Photo — Stencil', format: 'poster', size: 'small', quantity: 1, unitPrice: 14.99, personalisationId: 'abcdefghijklmnopqrstu', styleKey: 'style-a', ...over });

say('\n1. THE BROWSER\'S PRICE IS IGNORED\n');
{
  const r = priceCart([stock({ unitPrice: 0.01 })], PRODUCTS);
  ok(r.ok && r.lines[0].unitPence === 999, 'a tampered unitPrice of £0.01 is charged at £9.99', r.lines?.[0]?.unitPence);
  ok(r.mismatches.length === 1 && r.mismatches[0].clientPence === 1 && r.mismatches[0].serverPence === 999, 'and the difference is reported for the warning log');
  const honest = priceCart([stock()], PRODUCTS);
  ok(honest.ok && honest.mismatches.length === 0, 'a correct unitPrice produces no warning');
  const missing = priceCart([stock({ unitPrice: undefined })], PRODUCTS);
  ok(missing.ok && missing.lines[0].unitPence === 999 && missing.mismatches.length === 0, 'no unitPrice at all is fine — the server price is used');
  const big = priceCart([stock({ format: 'canvasGallery', size: 'large', quantity: 2, unitPrice: 1 })], PRODUCTS);
  ok(big.ok && big.subtotalPence === 9598, 'canvas gallery large × 2 = £95.98', big.subtotalPence);
  const byslug = priceCart([stock({ productId: 'nope' })], PRODUCTS);
  ok(byslug.ok && byslug.lines[0].productId === 'product-hulk-style-c', 'an unknown productId falls back to the slug');
  ok(big.lines[0].title === 'Hulk — Option C', 'the line title comes from Sanity, not the browser');
}

say('\n2. UNKNOWN PRODUCT, FORMAT OR SIZE IS REJECTED\n');
{
  const r1 = priceCart([stock({ productId: 'nope', slug: 'nope' })], PRODUCTS);
  ok(!r1.ok && /unknown product/.test(r1.problems[0]), 'unknown product', r1.problems?.[0]);
  const r2 = priceCart([stock({ format: 'framed' })], PRODUCTS);
  ok(!r2.ok && /unknown format/.test(r2.problems[0]), 'unknown format', r2.problems?.[0]);
  const r3 = priceCart([stock({ size: 'xl' })], PRODUCTS);
  ok(!r3.ok && /unknown size/.test(r3.problems[0]), 'unknown size', r3.problems?.[0]);
  const r4 = priceCart([stock({ format: '__proto__' })], PRODUCTS);
  ok(!r4.ok, 'a prototype key as a format is rejected');
  const r5 = priceCart([stock(), stock({ size: 'xl' })], PRODUCTS);
  ok(!r5.ok, 'one bad line rejects the whole checkout');
  const r6 = priceCart([], PRODUCTS);
  ok(!r6.ok, 'an empty cart is rejected');
  const r7 = priceCart([stock({ productId: 'product-odd', slug: 'odd-style-b', size: 'medium' })], PRODUCTS);
  ok(!r7.ok && /not available/.test(r7.problems[0]), 'a price of 0 is rejected', r7.problems?.[0]);
  const r8 = priceCart([stock({ productId: 'product-odd', slug: 'odd-style-b', size: 'large' })], PRODUCTS);
  ok(!r8.ok, 'a missing price is rejected');
  ok(r1.error && !/product-|hulk/.test(r1.error), 'the customer-facing message is generic', r1.error);
}

say('\n3. POSTER-ONLY PERSONALISED PRODUCTS\n');
{
  const canvas = priceCart([stock({ productId: 'product-prankz', slug: 'personalised-prankz', format: 'canvasStandard' })], PRODUCTS);
  ok(!canvas.ok, 'canvas on a poster-only personalised product is rejected', canvas.problems?.[0]);
  const poster = priceCart([stock({ productId: 'product-prankz', slug: 'personalised-prankz' })], PRODUCTS);
  ok(!poster.ok && /service page/.test(poster.problems[0]),
    'and so is the poster: personalised catalogue products are ordered via their service page, not the cart', poster.problems?.[0]);
}

say('\n4. THE PERSONALISATION FEE\n');
{
  const one = priceCart([photo()], PRODUCTS);
  const expect = Math.round(YOUR_PHOTO_PRICES.poster.small * 100) + PERSONALISATION_FEE * 100;
  ok(one.ok && one.lines[0].unitPence === expect, `poster small = base + £${PERSONALISATION_FEE} fee`, one.lines?.[0]?.unitPence);
  const three = priceCart([photo({ quantity: 3 })], PRODUCTS);
  ok(three.ok && three.subtotalPence === expect * 3, 'fee applied once per unit (× 3 units)', three.subtotalPence);
  const cheap = priceCart([photo({ unitPrice: 0.5 })], PRODUCTS);
  ok(cheap.ok && cheap.lines[0].unitPence === expect && cheap.mismatches.length === 1, 'a tampered Your Photo price is ignored too');
  const noPid = priceCart([photo({ personalisationId: undefined })], PRODUCTS);
  ok(!noPid.ok, 'a Your Photo line without a personalisation id is rejected');
  const pidOnStock = priceCart([stock({ personalisationId: 'abcdefghijklmnopqrstu' })], PRODUCTS);
  ok(!pidOnStock.ok, 'a personalisation id on a stock product is rejected');
  ok(one.lines[0].styleLetter === 'A' && one.lines[0].feePence === PERSONALISATION_FEE * 100, 'style letter and fee recorded on the line');
}

say('\n5. QUANTITY BOUNDS\n');
{
  for (const q of [0, -1, MAX_QTY + 1, 1.5, '2', null]) {
    const r = priceCart([stock({ quantity: q })], PRODUCTS);
    ok(!r.ok, `quantity ${JSON.stringify(q)} is rejected`);
  }
  for (const q of [1, MAX_QTY]) {
    const r = priceCart([stock({ quantity: q })], PRODUCTS);
    ok(r.ok, `quantity ${q} is accepted`);
  }
}

say('\n6. SHIPPING AND KEYS\n');
{
  ok(shippingPenceFor(4999) === 495 && shippingPenceFor(5000) === 0, '£4.95 under £50, free from £50');
  const r = priceCart([stock({ unitPrice: 999 })], PRODUCTS);
  ok(shippingPenceFor(r.subtotalPence) === 495, 'shipping follows the SERVER subtotal, not an inflated client one');
  const l = r.lines[0];
  ok(l.formatKey === 'poster' && l.sizeKey === 'small' && l.styleLetter === 'C' && l.listingImageRef === 'image-abc-1024x1024-png' && l.slug === 'hulk-style-c',
    'a stock line carries formatKey, sizeKey, styleLetter, listingImageRef, slug');
  ok(styleLetterOf('hulk-style-j') === 'J' && styleLetterOf('style-b') === 'B' && styleLetterOf('nope') === '', 'styleLetterOf');
}

say(`\n${pass} passed, ${fail} failed.`);
process.exitCode = fail ? 1 : 0;
