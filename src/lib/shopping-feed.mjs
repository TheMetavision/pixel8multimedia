/**
 * src/lib/shopping-feed.mjs
 *
 * Google Shopping (Merchant Center) items for the stock catalogue, shared by
 * the feed (/feeds/google-shopping.xml, built at deploy) and the product
 * page's JSON-LD, so both say the same ids, links and prices. Modelled on
 * Comic Strip Canvas's generator.
 *
 * One item per product (character × Option A–J) × format × size:
 *   id              <slug>-<p|cs|cg>-<s|m|l>            (≤ 50 chars)
 *   item_group_id   the product slug
 *   link            /store/<character>/?option=<a–j>&format=<key>&size=<key>
 *                   (the page selects exactly that variant from the URL)
 *   price           priceCart() — the function checkout charges with, so the
 *                   feed can't disagree with the basket
 * Stock only: "Your Photo" and the personalised category are left out (phase 2).
 * Titles and descriptions use customer-facing labels ("Option A", the
 * design's name); a description that names an artist is replaced.
 *
 * Pure: the caller loads the products (the Astro route, at build time).
 */
import { priceCart, STANDARD_SHIPPING_PENCE, FREE_SHIPPING_THRESHOLD_PENCE, YOUR_PHOTO_PRODUCT_ID } from '../../netlify/functions/_shared/pricing.mjs';
import { FORMAT_KEYS, SIZE_KEYS, FORMAT_LABELS, SIZE_DIMENSIONS } from '../../netlify/functions/_shared/print-spec.mjs';

export const SITE_URL = 'https://pixel8multimedia.co.uk';
export const BRAND = 'Pixel8 Multimedia';
export const GOOGLE_CATEGORY = '500044'; // Home & Garden > Decor > Artwork > Posters, Prints, & Visual Artwork

const FORMAT_CODE = { poster: 'p', canvasStandard: 'cs', canvasGallery: 'cg' };
const SIZE_CODE = { small: 's', medium: 'm', large: 'l' };
/** URL values: the site's own keys; the page also accepts canvas-standard / canvas-gallery. */
export const FORMAT_PARAM = { poster: 'poster', canvasStandard: 'canvasStandard', canvasGallery: 'canvasGallery' };

/** Never in a feed title or description (style labels only). */
const ARTIST_NAMES = /lichtenstein|warhol|banksy|seuss|frank miller|jeff soto|josh agle|\bshag\b|tim burton|mucha|hokusai|van gogh|kusama|haring|basquiat|edward hopper|rockwell|jack kirby|ditko|moebius|miyazaki|koons|damien hirst|\bdal[ií]\b|picasso|matisse|klimt|in the style of/i;

export const QUERY = `*[_type == "product" && category != "personalised" && defined(slug.current) && slug.current match "*-style-?"]
  | order(slug.current asc){
  _id, title, "slug": slug.current, category, style, prices, sizes,
  "image": images[0].asset->url,
  "description": coalesce(pt::text(description), description)
}`;

export const characterOf = (slug) => String(slug || '').replace(/-style-[a-j]$/, '');
export const letterOf = (slug) => (/-style-([a-j])$/.exec(String(slug || '')) || [])[1] || '';

export function itemId(slug, format, size) {
  const tail = `-${FORMAT_CODE[format]}-${SIZE_CODE[size]}`;
  return `${String(slug).slice(0, 50 - tail.length)}${tail}`;
}

export function variantUrl(slug, format, size, site = SITE_URL) {
  const q = new URLSearchParams({ option: letterOf(slug), format: FORMAT_PARAM[format], size });
  return `${site}/store/${characterOf(slug)}/?${q.toString()}`;
}

/** Google's size text: dimensions only, e.g. "12x12in". */
export const sizeAttr = (product, size) => `${(product.sizes?.[size] || SIZE_DIMENSIONS[size]).replace(/\s+/g, '')}in`;

/** The price checkout would charge for one of this variant, in pence; null if it can't be bought. */
export function unitPence(product, format, size) {
  const r = priceCart([{ productId: product._id, slug: product.slug, format, size, quantity: 1 }], [product]);
  return r.ok ? r.lines[0].unitPence : null;
}

const xml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const gbp = (pence) => `${(pence / 100).toFixed(2)} GBP`;

/**
 * @param products  from QUERY (published)
 * @param opts      { categoryLabels: { slug: label }, now?: Date, site? }
 * @returns {{ xml, items: Array, skipped: { noImage: string[], noPrice: string[], personalised: string[], artistText: string[] } }}
 */
export function buildFeed(products, { categoryLabels = {}, now = new Date(), site = SITE_URL } = {}) {
  const items = [];
  const skipped = { noImage: [], noPrice: [], personalised: [], artistText: [] };

  for (const p of products || []) {
    if (p.category === 'personalised' || p.slug === YOUR_PHOTO_PRODUCT_ID) { skipped.personalised.push(p.slug); continue; }
    if (!p.image) { skipped.noImage.push(p.slug); continue; }
    const category = categoryLabels[p.category] || p.category || 'Wall Art';
    const optionLabel = `Option ${letterOf(p.slug).toUpperCase()}`;
    let description = String(p.description || '').replace(/\s+/g, ' ').trim();
    if (!description || ARTIST_NAMES.test(description) || ARTIST_NAMES.test(p.title || '')) {
      if (description) skipped.artistText.push(p.slug);
      description = `${characterTitle(p)} in our exclusive ${optionLabel} design. Bold, original pop culture wall art — poster print, standard canvas or gallery canvas. Made to order in the UK by Pixel8 Multimedia.`;
    }
    const image = `${p.image}?w=1200&h=1200&fit=max&fm=jpg&q=90`;

    const missing = [];
    for (const format of FORMAT_KEYS) {
      for (const size of SIZE_KEYS) {
        const pence = unitPence(p, format, size);
        if (pence === null) { missing.push(`${format}/${size}`); continue; }
        const formatLabel = FORMAT_LABELS[format];
        items.push({
          id: itemId(p.slug, format, size),
          groupId: p.slug,
          title: cut(`${characterTitle(p)} — ${optionLabel} — ${formatLabel} (${sizeAttr(p, size)})`, 150),
          description: cut(description, 4900),
          link: variantUrl(p.slug, format, size, site),
          image,
          pence,
          size: sizeAttr(p, size),
          productType: `Wall Art > ${category}`,
          category, formatLabel, optionLabel,
        });
      }
    }
    if (missing.length) skipped.noPrice.push(`${p.slug} (${missing.join(', ')})`);
  }

  const body = items.map((i) => `
    <item>
      <g:id>${xml(i.id)}</g:id>
      <g:item_group_id>${xml(i.groupId)}</g:item_group_id>
      <g:title>${xml(i.title)}</g:title>
      <g:description>${xml(i.description)}</g:description>
      <g:link>${xml(i.link)}</g:link>
      <g:image_link>${xml(i.image)}</g:image_link>
      <g:availability>in_stock</g:availability>
      <g:price>${gbp(i.pence)}</g:price>
      <g:brand>${xml(BRAND)}</g:brand>
      <g:condition>new</g:condition>
      <g:identifier_exists>no</g:identifier_exists>
      <g:google_product_category>${GOOGLE_CATEGORY}</g:google_product_category>
      <g:product_type>${xml(i.productType)}</g:product_type>
      <g:size>${xml(i.size)}</g:size>
      <g:custom_label_0>${xml(i.category)}</g:custom_label_0>
      <g:custom_label_1>${xml(i.formatLabel)}</g:custom_label_1>
      <g:custom_label_2>${xml(i.optionLabel)}</g:custom_label_2>
      <g:shipping>
        <g:country>GB</g:country>
        <g:service>Standard</g:service>
        <g:price>${gbp(STANDARD_SHIPPING_PENCE)}</g:price>
      </g:shipping>
      <g:free_shipping_threshold>
        <g:country>GB</g:country>
        <g:price_threshold>${gbp(FREE_SHIPPING_THRESHOLD_PENCE)}</g:price_threshold>
      </g:free_shipping_threshold>
    </item>`).join('');

  const out = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>Pixel8 Multimedia — Google Shopping feed</title>
    <link>${site}</link>
    <description>Bold, original pop culture wall art: poster prints and canvas, made to order in the UK.</description>
    <lastBuildDate>${now.toUTCString()}</lastBuildDate>${body}
  </channel>
</rss>
`;
  return { xml: out, items, skipped };
}

/** "Adele — Option A" → "Adele". */
export const characterTitle = (p) => String(p.title || '').split(' — ')[0] || characterOf(p.slug);

/**
 * schema.org Offers for a product page: one per purchasable variant, with the
 * same sku (feed id), url and price as the feed.
 */
export function offersFor(products, site = SITE_URL) {
  const offers = [];
  for (const p of products || []) {
    if (p.category === 'personalised') continue;
    for (const format of FORMAT_KEYS) {
      for (const size of SIZE_KEYS) {
        const pence = unitPence(p, format, size);
        if (pence === null) continue;
        offers.push({
          '@type': 'Offer',
          sku: itemId(p.slug, format, size),
          url: variantUrl(p.slug, format, size, site),
          price: (pence / 100).toFixed(2),
          priceCurrency: 'GBP',
          availability: 'https://schema.org/InStock',
          itemCondition: 'https://schema.org/NewCondition',
          name: `${p.title} — ${FORMAT_LABELS[format]} (${sizeAttr(p, size)})`,
        });
      }
    }
  }
  return offers;
}
