/**
 * The Google Shopping feed and the product page's variant links / JSON-LD.
 *
 *   node tools/builder/shopping-feed-tests.mjs
 *
 * 1. buildFeed() on sample products: one item per product × format × size,
 *    priced by priceCart (what checkout charges), with the required
 *    attributes; personalised items and Your Photo left out; a product
 *    missing an image or a price is reported, never guessed.
 * 2. The JSON-LD offers use the same sku, link and price as the feed.
 * 3. If the site has been built (dist/), the real feed and a real product
 *    page are checked against each other, and the page reads option/format/
 *    size from the URL.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { priceCart } from '../../netlify/functions/_shared/pricing.mjs';
import { buildFeed, offersFor, itemId, variantUrl, letterOf } from '../../src/lib/shopping-feed.mjs';

let pass = 0, fail = 0;
const ok = (c, l, e = '') => {
  if (c) { pass++; console.log(`  PASS  ${l}${e !== '' ? ' — ' + e : ''}`); }
  else { fail++; console.log(`  FAIL  ${l}${e !== '' ? ' — ' + e : ''}`); }
};
const say = console.log.bind(console);

const PRICES = {
  poster: { small: 9.99, medium: 12.99, large: 16.99 },
  canvasStandard: { small: 27.99, medium: 32.99, large: 44.99 },
  canvasGallery: { small: 29.99, medium: 35.99, large: 47.99 },
};
const prod = (slug, over = {}) => ({
  _id: `p-${slug}`, slug, title: `${slug.split('-style-')[0].replace(/^./, (c) => c.toUpperCase())} — Option ${slug.slice(-1).toUpperCase()}`,
  category: 'music', style: `style-${slug.slice(-1)}`, prices: structuredClone(PRICES),
  sizes: { small: '12x12', medium: '16x16', large: '20x20' },
  image: `https://cdn.sanity.io/images/x/production/${slug}.png`,
  description: `${slug} in our exclusive Option A "Velvet Glow" design. Fish & chips <tested>.`, ...over,
});
const CATS = { music: 'Music', 'tv-movies': 'TV / Movies' };

say('\n1. THE FEED\n');
const sample = [
  prod('adele-style-a'),
  prod('adele-style-c', { category: 'tv-movies' }),
  prod('noimage-style-a', { image: null }),
  prod('gap-style-b', { prices: { ...structuredClone(PRICES), canvasGallery: { small: 29.99, medium: 0, large: 47.99 } } }),
  prod('personal-style-a', { category: 'personalised' }),
  prod('artist-style-a', { description: 'Painted in the style of Roy Lichtenstein.' }),
];
const { xml, items, skipped } = buildFeed(sample, { categoryLabels: CATS, now: new Date('2026-09-29T12:00:00Z') });
{
  ok(items.length === 9 + 9 + 8 + 9, '9 items per stock product (3 formats × 3 sizes); a missing price drops just that variant', items.length);
  ok(skipped.personalised.join() === 'personal-style-a' && !items.some((i) => i.groupId === 'personal-style-a'), 'personalised category excluded');
  ok(skipped.noImage.join() === 'noimage-style-a' && skipped.noPrice.join() === 'gap-style-b (canvasGallery/medium)', 'missing image and missing price reported, not guessed', JSON.stringify(skipped));
  const ids = items.map((i) => i.id);
  ok(new Set(ids).size === ids.length && ids.every((id) => id.length <= 50), 'ids unique and ≤ 50 characters');
  ok(items.every((i) => i.pence === priceCart([{ productId: `p-${i.groupId}`, slug: i.groupId, format: /-(p|cs|cg)-/.exec(i.id) && ({ p: 'poster', cs: 'canvasStandard', cg: 'canvasGallery' })[/-(p|cs|cg)-[sml]$/.exec(i.id)[1]], size: ({ s: 'small', m: 'medium', l: 'large' })[i.id.slice(-1)], quantity: 1 }], sample).lines[0].unitPence),
    'every price is exactly what checkout would charge (priceCart)');
  const a = items.find((i) => i.id === 'adele-style-c-cs-m');
  ok(a && a.link === 'https://pixel8multimedia.co.uk/store/adele/?option=c&format=canvasStandard&size=medium' && a.groupId === 'adele-style-c' && a.size === '16x16in' && a.pence === 3299,
    'variant link names option, format and size; item_group_id is the product; g:size is dimensions only', a?.link);
  ok(a.title === 'Adele — Option C — Canvas (Standard Frame) (16x16in)' && a.productType === 'Wall Art > TV / Movies', 'title uses the style label; product_type by category', a.title);
  ok(!xml.includes('Lichtenstein') && skipped.artistText.join() === 'artist-style-a', 'a description naming an artist is replaced (and reported)');
  const first = xml.slice(xml.indexOf('<item>'), xml.indexOf('</item>'));
  for (const [tag, re] of [
    ['availability', /<g:availability>in_stock<\/g:availability>/], ['brand', /<g:brand>Pixel8 Multimedia<\/g:brand>/],
    ['condition', /<g:condition>new<\/g:condition>/], ['identifier_exists', /<g:identifier_exists>no<\/g:identifier_exists>/],
    ['google_product_category', /<g:google_product_category>500044<\/g:google_product_category>/],
    ['shipping', /<g:shipping>\s*<g:country>GB<\/g:country>\s*<g:service>Standard<\/g:service>\s*<g:price>4\.95 GBP<\/g:price>/],
    ['free_shipping_threshold', /<g:free_shipping_threshold>\s*<g:country>GB<\/g:country>\s*<g:price_threshold>50\.00 GBP<\/g:price_threshold>/],
    ['price', /<g:price>9\.99 GBP<\/g:price>/], ['image', /<g:image_link>https:\/\/cdn\.sanity\.io\/[^<]+fm=jpg[^<]*<\/g:image_link>/],
  ]) ok(re.test(first), `item has ${tag}`);
  ok(/Fish &amp; chips &lt;tested&gt;/.test(xml) && /option=a&amp;format=poster&amp;size=small/.test(xml) && !/&(?!amp;|lt;|gt;|quot;|apos;)/.test(xml), 'XML-escaped (&, <, > and the link\'s &)');
  ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>') && (xml.match(/<item>/g) || []).length === items.length, 'RSS 2.0 with the g: namespace, one <item> per item');
  ok(!/lichtenstein/i.test(items.map((i) => i.title).join(' ')) && items.every((i) => /Option [A-J]/.test(i.title)), 'titles carry "Option A–J" style labels only');
}

say('\n2. JSON-LD OFFERS\n');
{
  const offers = offersFor(sample.filter((p) => p.slug.startsWith('adele')));
  const feedAdele = items.filter((i) => i.groupId.startsWith('adele'));
  ok(offers.length === 18 && offers.every((o) => { const f = feedAdele.find((i) => i.id === o.sku); return f && f.link === o.url && (f.pence / 100).toFixed(2) === o.price; }),
    'one Offer per variant; sku, url and price identical to the feed item');
  ok(offers.every((o) => o['@type'] === 'Offer' && o.priceCurrency === 'GBP' && /InStock$/.test(o.availability) && /NewCondition$/.test(o.itemCondition)), 'Offers are GBP, InStock, New');
  ok(itemId('adele-style-a', 'poster', 'small') === 'adele-style-a-p-s' && letterOf('adele-style-j') === 'j' && variantUrl('adele-style-a', 'canvasGallery', 'large').endsWith('/store/adele/?option=a&format=canvasGallery&size=large'), 'id / link helpers');
}

say('\n3. THE BUILT SITE (if dist/ exists)\n');
const DIST = new URL('../../dist/', import.meta.url);
if (!existsSync(new URL('feeds/google-shopping.xml', DIST))) {
  say('  (skipped: run npm run build first)');
} else {
  const feed = readFileSync(new URL('feeds/google-shopping.xml', DIST), 'utf8');
  const n = (feed.match(/<item>/g) || []).length;
  ok(n > 0 && !/your-photo/.test(feed) && !/<g:link>[^<]*personal/i.test(feed), 'built feed: items present, no Your Photo, no personalised links', `${n} items`);
  const character = /\/store\/([^/]+)\/\?option=/.exec(feed)?.[1];
  const page = readFileSync(new URL(`store/${character}/index.html`, DIST), 'utf8');
  const ld = [...page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1])).find((j) => j['@type'] === 'Product');
  const feedItems = [...feed.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => ({
    id: /<g:id>([^<]+)</.exec(m[1])[1], link: /<g:link>([^<]+)</.exec(m[1])[1].replace(/&amp;/g, '&'), price: /<g:price>([\d.]+) GBP</.exec(m[1])[1],
  })).filter((i) => i.link.includes(`/store/${character}/?`));
  ok(ld && Array.isArray(ld.offers) && ld.offers.length === feedItems.length && ld.offers.every((o) => feedItems.some((f) => f.id === o.sku && f.link === o.url && f.price === o.price)),
    `built /store/${character}/: JSON-LD has one Offer per feed item, matching sku, url and price`, `${ld?.offers?.length} offers`);
  ok(/pixel8multimedia\.co\.uk\/store\//.test(ld.url) && !/netlify\.app/.test(page.match(/application\/ld\+json[\s\S]*?<\/script>/)?.[0] || ''), 'JSON-LD uses the real domain');
  const js = readdirSync(new URL('_astro/', DIST)).filter((f) => f.endsWith('.js')).map((f) => readFileSync(new URL(`_astro/${f}`, DIST), 'utf8')).join('\n') + page;
  ok(/canvas-standard/.test(js) && /searchParams|URLSearchParams/.test(js) && /"option"|'option'/.test(js), 'the page script reads option / format / size from the URL');
}

say(`\n${pass} passed, ${fail} failed.`);
process.exitCode = fail ? 1 : 0;
