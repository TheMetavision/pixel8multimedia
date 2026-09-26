/**
 * netlify/functions/_shared/order-lines.mjs
 *
 * Turning a paid Stripe session into Sanity order lines. Pure — webhook.mjs
 * does the Stripe and Sanity calls; the tests call these directly.
 *
 * Three shapes of session exist in the wild:
 *   1. cartItems blob in session metadata (oldest)       → labels only
 *   2. per-line product metadata: format/size keys        → labels only
 *   3. per-line metadata with formatKey/sizeKey/...       → labels + keys
 * Only shape 3 gets the keyed fields. Lines from 1 and 2 are stored exactly as
 * before; nothing may treat a missing key on those as an error.
 */
import { FORMAT_LABELS, SIZE_LABELS, YOUR_PHOTO_PRODUCT_ID } from './pricing.mjs';

/** Cart items from Stripe line items (expand: ['data.price.product']). */
export function itemsFromLineItems(data) {
  return (data || []).map((li) => {
    const m = li.price?.product?.metadata || {};
    const item = {
      productId: m.productId || '',
      slug: m.slug || '',
      title: m.title || li.description || 'Item',
      collection: m.collection || '',
      format: m.format || '',
      size: m.size || '',
      quantity: li.quantity || 1,
      unitPrice: (li.price?.unit_amount || 0) / 100,
    };
    if (m.personalisationId) {
      item.personalisationId = m.personalisationId;
      item.styleKey = m.styleKey || '';
    }
    // Shape 3: keys written by the server-priced checkout.
    if (m.formatKey && m.sizeKey) {
      item.formatKey = m.formatKey;
      item.sizeKey = m.sizeKey;
      if (m.styleLetter) item.styleLetter = m.styleLetter;
      if (m.listingImageRef) item.listingImageRef = m.listingImageRef;
    }
    return item;
  });
}

/** Cart items from the oldest sessions' metadata.cartItems JSON blob. */
export function itemsFromCartItemsBlob(json) {
  try {
    const items = JSON.parse(json || '[]');
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

/** One Sanity order line. `stamp` keeps _keys unique across orders (Date.now()). */
export function orderLineFromItem(item, n, stamp = Date.now()) {
  const line = {
    _type: 'object',
    _key: `${item.personalisationId || item.slug || 'line'}-${item.format}-${item.size}-${n}-${stamp}`,
    productTitle: item.title,
    format: FORMAT_LABELS[item.format] || item.format,
    size: SIZE_LABELS[item.size] || item.size,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
  };
  if (item.personalisationId) {
    line.personalisationId = item.personalisationId;
    line.styleKey = item.styleKey;
  }
  if (item.formatKey && item.sizeKey) {
    line.formatKey = item.formatKey;
    line.sizeKey = item.sizeKey;
    const stock = item.productId && item.productId !== YOUR_PHOTO_PRODUCT_ID && !item.personalisationId;
    if (stock) {
      // Weak: deleting or renaming a product must never be blocked by old orders.
      line.productRef = { _type: 'reference', _ref: item.productId, _weak: true };
      line.productSlug = item.slug;
      if (item.styleLetter) line.styleLetter = item.styleLetter;
      if (item.listingImageRef) {
        line.listingImageRef = { _type: 'reference', _ref: item.listingImageRef, _weak: true };
      }
    }
  }
  return line;
}

/**
 * Personalised lines grouped by pid, for recording on pendingPersonalisation.
 * One pid can appear on several lines (different formats or sizes); each is
 * kept, so nothing ordered is lost.
 *
 * @returns {Map<string, { styleKey: string, lines: Array }>}
 */
export function personalisedLinesByPid(items, orderLines, orderId) {
  const byPid = new Map();
  items.forEach((item, n) => {
    if (!item.personalisationId) return;
    const entry = byPid.get(item.personalisationId) || { styleKey: item.styleKey, lines: [] };
    entry.lines.push({
      _key: orderLines[n]._key,
      orderId,
      styleKey: item.styleKey,
      formatKey: item.formatKey || item.format,
      sizeKey: item.sizeKey || item.size,
      quantity: item.quantity,
    });
    byPid.set(item.personalisationId, entry);
  });
  return byPid;
}
