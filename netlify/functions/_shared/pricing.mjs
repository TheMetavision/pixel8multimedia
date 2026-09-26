/**
 * netlify/functions/_shared/pricing.mjs
 *
 * The server's price list for the shop cart. checkout.mjs charges what this
 * returns and ignores the unitPrice the browser sends.
 *
 * Stock products: price is Sanity product.prices.<formatKey>.<sizeKey>.
 * "Your Photo" lines (productId 'your-photo'): no Sanity product; price is
 * YOUR_PHOTO_PRICES[format][size] + PERSONALISATION_FEE, per unit.
 *
 * src/pages/store/your-photo.astro imports YOUR_PHOTO_PRICES and
 * PERSONALISATION_FEE from here, so the price shown is the price charged.
 *
 * Pure: no Sanity or Stripe calls. The caller loads products and passes them in.
 */

export const FORMAT_KEYS = ['poster', 'canvasStandard', 'canvasGallery'];
export const SIZE_KEYS = ['small', 'medium', 'large'];

export const FORMAT_LABELS = {
  poster: 'Poster Print',
  canvasStandard: 'Canvas (Standard Frame)',
  canvasGallery: 'Canvas (Gallery Frame)',
};
export const SIZE_LABELS = {
  small: 'Small (12×12")',
  medium: 'Medium (16×16")',
  large: 'Large (20×20")',
};

/** Per-unit fee on every "Your Photo" print, in GBP. */
export const PERSONALISATION_FEE = 5;

/** Base print prices for "Your Photo" lines, in GBP (the fee is added on top). */
export const YOUR_PHOTO_PRICES = {
  poster: { small: 9.99, medium: 12.99, large: 16.99 },
  canvasStandard: { small: 27.99, medium: 32.99, large: 44.99 },
  canvasGallery: { small: 29.99, medium: 35.99, large: 47.99 },
};

export const YOUR_PHOTO_PRODUCT_ID = 'your-photo';
export const MIN_QTY = 1;
export const MAX_QTY = 20;

export const FREE_SHIPPING_THRESHOLD_PENCE = 5000;
export const STANDARD_SHIPPING_PENCE = 495;

const toPence = (gbp) => Math.round(Number(gbp) * 100);

/** 'hulk-style-c' → 'C'; also accepts a style field value 'style-c'. */
export function styleLetterOf(slugOrStyle) {
  const m = /(?:^|-)style-([a-j])$/.exec(String(slugOrStyle || ''));
  return m ? m[1].toUpperCase() : '';
}

/**
 * Price a cart.
 *
 * @param {Array} items    cart lines as posted by the browser
 * @param {Array} products Sanity products: { _id, slug, title, category, style, prices, imageRef }
 * @returns {{ ok: true, lines: Array, subtotalPence: number, mismatches: Array }
 *         | { ok: false, error: string, problems: Array<string> }}
 */
export function priceCart(items, products) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: 'Your cart is empty.', problems: ['empty cart'] };
  }
  const byId = new Map(products.map((p) => [p._id, p]));
  const bySlug = new Map(products.map((p) => [p.slug, p]));

  const problems = [];
  const lines = [];
  const mismatches = [];

  items.forEach((item, n) => {
    const where = `line ${n + 1}`;
    const formatKey = item?.format;
    const sizeKey = item?.size;
    const quantity = item?.quantity;

    if (!FORMAT_KEYS.includes(formatKey)) { problems.push(`${where}: unknown format`); return; }
    if (!SIZE_KEYS.includes(sizeKey)) { problems.push(`${where}: unknown size`); return; }
    if (!Number.isInteger(quantity) || quantity < MIN_QTY || quantity > MAX_QTY) {
      problems.push(`${where}: quantity must be ${MIN_QTY}–${MAX_QTY}`); return;
    }

    const personalised = Boolean(item.personalisationId);
    let line;

    if (item.productId === YOUR_PHOTO_PRODUCT_ID || personalised) {
      // Both or neither: a pid on a stock product, or a Your Photo line without one, is malformed.
      if (item.productId !== YOUR_PHOTO_PRODUCT_ID || !personalised) {
        problems.push(`${where}: personalised line is malformed`); return;
      }
      const base = YOUR_PHOTO_PRICES[formatKey]?.[sizeKey];
      if (!base) { problems.push(`${where}: no price for this format and size`); return; }
      line = {
        kind: 'your-photo',
        productId: YOUR_PHOTO_PRODUCT_ID,
        slug: YOUR_PHOTO_PRODUCT_ID,
        title: String(item.title || 'Your Photo').slice(0, 200),
        unitPence: toPence(base) + toPence(PERSONALISATION_FEE),
        feePence: toPence(PERSONALISATION_FEE),
        personalisationId: item.personalisationId,
        styleKey: item.styleKey,
        styleLetter: styleLetterOf(item.styleKey),
        listingImageRef: '',
      };
    } else {
      const product = byId.get(item.productId) || bySlug.get(item.slug);
      if (!product) { problems.push(`${where}: unknown product`); return; }
      // Personalised catalogue products are ordered through their service page
      // (commission flow), never the cart: no page adds them, so refuse.
      if (product.category === 'personalised') {
        problems.push(`${where}: this product is ordered through its service page`); return;
      }
      const gbp = product.prices?.[formatKey]?.[sizeKey];
      if (!(Number(gbp) > 0)) { problems.push(`${where}: not available in this format and size`); return; }
      line = {
        kind: 'stock',
        productId: product._id,
        slug: product.slug,
        title: String(product.title || item.title || 'Print').slice(0, 200),
        unitPence: toPence(gbp),
        feePence: 0,
        styleLetter: styleLetterOf(product.style) || styleLetterOf(product.slug),
        listingImageRef: product.imageRef || '',
      };
    }

    const clientPence = toPence(item.unitPrice);
    if (Number.isFinite(clientPence) && clientPence !== line.unitPence) {
      mismatches.push({ line: n + 1, slug: line.slug, formatKey, sizeKey, clientPence, serverPence: line.unitPence });
    }

    lines.push({
      ...line,
      formatKey, sizeKey, quantity,
      collection: String(item.collection || '').slice(0, 100),
      lineTotalPence: line.unitPence * quantity,
    });
  });

  if (problems.length) {
    return {
      ok: false,
      error: 'Something in your cart is no longer available as selected. Please check your cart and try again.',
      problems,
    };
  }
  const subtotalPence = lines.reduce((s, l) => s + l.lineTotalPence, 0);
  return { ok: true, lines, subtotalPence, mismatches };
}

export const shippingPenceFor = (subtotalPence) =>
  subtotalPence >= FREE_SHIPPING_THRESHOLD_PENCE ? 0 : STANDARD_SHIPPING_PENCE;
