/**
 * Paid Stripe session → Sanity order lines.
 *
 *   node tools/builder/order-lines-tests.mjs
 *
 * New lines (from the server-priced checkout) carry keys: productRef,
 * productSlug, formatKey, sizeKey, styleLetter, listingImageRef. Older
 * sessions — the cartItems blob, and per-line metadata without keys — must
 * still produce a valid order, just without the keys.
 */
import {
  itemsFromLineItems, itemsFromCartItemsBlob, orderLineFromItem, personalisedLinesByPid,
} from '../../netlify/functions/_shared/order-lines.mjs';

let pass = 0, fail = 0;
const ok = (c, l, e = '') => {
  if (c) { pass++; console.log(`  PASS  ${l}${e !== '' ? ' — ' + e : ''}`); }
  else { fail++; console.log(`  FAIL  ${l}${e !== '' ? ' — ' + e : ''}`); }
};
const say = console.log.bind(console);
const KEYS = ['productRef', 'productSlug', 'formatKey', 'sizeKey', 'styleLetter', 'listingImageRef'];

const li = (metadata, quantity = 1, unit_amount = 999) => ({ quantity, description: 'desc', price: { unit_amount, product: { metadata } } });

say('\n1. A NEW-STYLE STOCK LINE\n');
{
  const [item] = itemsFromLineItems([li({
    productId: 'product-hulk-style-c', slug: 'hulk-style-c', title: 'Hulk — Option C', collection: '',
    format: 'canvasGallery', size: 'large', formatKey: 'canvasGallery', sizeKey: 'large',
    styleLetter: 'C', listingImageRef: 'image-abc-1024x1024-png',
  }, 2, 4799)]);
  const line = orderLineFromItem(item, 0, 123);
  ok(KEYS.every((k) => k in line), 'has every key', KEYS.filter((k) => !(k in line)).join(',') || 'all present');
  ok(line.productRef._ref === 'product-hulk-style-c' && line.productRef._weak === true, 'productRef is a WEAK reference to the product');
  ok(line.listingImageRef._type === 'image' && line.listingImageRef.asset?._type === 'reference'
    && line.listingImageRef.asset._ref === 'image-abc-1024x1024-png' && !('_ref' in line.listingImageRef),
    'listingImageRef is an image object { _type: image, asset: { _type: reference, _ref } }', JSON.stringify(line.listingImageRef));
  ok(line.formatKey === 'canvasGallery' && line.sizeKey === 'large' && line.styleLetter === 'C' && line.productSlug === 'hulk-style-c', 'keys have the right values');
  ok(line.format === 'Canvas (Gallery Frame)' && line.size === 'Large (20×20")', 'the label fields are still written');
  ok(line.quantity === 2 && line.unitPrice === 47.99 && line.productTitle === 'Hulk — Option C', 'quantity, price, title');
  ok(line._key === 'hulk-style-c-canvasGallery-large-0-123', 'the _key shape is unchanged', line._key);
}

say('\n2. A NEW-STYLE PERSONALISED LINE\n');
{
  const [item] = itemsFromLineItems([li({
    productId: 'your-photo', slug: 'your-photo', title: 'Your Photo — Stencil', format: 'poster', size: 'small',
    formatKey: 'poster', sizeKey: 'small', styleLetter: 'A', personalisationId: 'abcdefghijklmnopqrstu', styleKey: 'style-a',
  }, 1, 1499)]);
  const line = orderLineFromItem(item, 0, 1);
  ok(line.personalisationId === 'abcdefghijklmnopqrstu' && line.styleKey === 'style-a', 'keeps personalisationId and styleKey');
  ok(line.formatKey === 'poster' && line.sizeKey === 'small', 'gets formatKey and sizeKey');
  ok(!('productRef' in line) && !('listingImageRef' in line), 'no productRef or listing image — there is no catalogue product');
}

say('\n3. LEGACY SESSIONS STILL MAKE VALID ORDERS, WITHOUT KEYS\n');
{
  // Oldest: the whole cart as a JSON blob in session metadata.
  const blob = JSON.stringify([{ productId: 'p1', slug: 'elvis-style-e', title: 'Elvis — Option E', collection: '', format: 'poster', size: 'small', quantity: 1, unitPrice: 9.99 }]);
  const items = itemsFromCartItemsBlob(blob);
  const line = orderLineFromItem(items[0], 0, 5);
  ok(items.length === 1, 'the blob parses');
  ok(KEYS.every((k) => !(k in line)), 'no keys are invented for a legacy line');
  ok(line.productTitle === 'Elvis — Option E' && line.format === 'Poster Print' && line.size === 'Small (12×12")' && line.unitPrice === 9.99, 'labels, price and title as before');
  ok(itemsFromCartItemsBlob('not json').length === 0 && itemsFromCartItemsBlob(undefined).length === 0, 'a broken or missing blob gives an empty cart, not a throw');

  // Middle era: per-line metadata with format/size but no formatKey.
  const [mid] = itemsFromLineItems([li({ productId: 'p2', slug: 'bart-simpson-style-c', title: 'Bart', format: 'poster', size: 'small' })]);
  const midLine = orderLineFromItem(mid, 0, 6);
  ok(KEYS.every((k) => !(k in midLine)) && midLine.format === 'Poster Print', 'per-line metadata without formatKey: labels only');
}

say('\n4. ONE DESIGN ORDERED ON SEVERAL LINES\n');
{
  const items = itemsFromLineItems([
    li({ productId: 'your-photo', slug: 'your-photo', format: 'poster', size: 'small', formatKey: 'poster', sizeKey: 'small', personalisationId: 'pidpidpidpidpidpidpid', styleKey: 'style-b' }, 1),
    li({ productId: 'product-x', slug: 'x-style-a', format: 'poster', size: 'small', formatKey: 'poster', sizeKey: 'small' }, 1),
    li({ productId: 'your-photo', slug: 'your-photo', format: 'canvasGallery', size: 'large', formatKey: 'canvasGallery', sizeKey: 'large', personalisationId: 'pidpidpidpidpidpidpid', styleKey: 'style-b' }, 2),
  ]);
  const lines = items.map((it, n) => orderLineFromItem(it, n, 9));
  const byPid = personalisedLinesByPid(items, lines, 'order.cs_test_1');
  const entry = byPid.get('pidpidpidpidpidpidpid');
  ok(byPid.size === 1 && entry.lines.length === 2, 'both lines are kept for the one pid', entry?.lines.length);
  ok(entry.lines[0]._key === lines[0]._key && entry.lines[1]._key === lines[2]._key, 'each recorded line points at its order line _key');
  ok(entry.lines[1].formatKey === 'canvasGallery' && entry.lines[1].sizeKey === 'large' && entry.lines[1].quantity === 2 && entry.lines[1].orderId === 'order.cs_test_1',
    'with formatKey, sizeKey, quantity and order id');
  ok(entry.lines.every((l) => l.styleKey === 'style-b'), 'and the style each line was ordered in');
}

say(`\n${pass} passed, ${fail} failed.`);
process.exitCode = fail ? 1 : 0;
