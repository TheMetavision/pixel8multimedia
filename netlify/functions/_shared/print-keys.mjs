/**
 * netlify/functions/_shared/print-keys.mjs
 *
 * Print-file Blobs keys and id checks. Dependency-free on purpose: the edge
 * function that streams downloads imports this, and must not pull sharp or
 * the Sanity client into the edge bundle.
 */

export const FILES_STORE = 'print-files';

const ID_RE = /^[A-Za-z0-9._-]{1,200}$/;
/** Order ids (order.cs_live_…) and line keys: letters, digits, . _ - only, no "..". */
export const isSafeId = (s) => typeof s === 'string' && ID_RE.test(s) && !s.includes('..');

const HEX_RE = /^#?([0-9a-f]{6})$/i;
export const isHexColour = (s) => typeof s === 'string' && HEX_RE.test(s.trim());

export const stateKey = (orderId, lineKey) => `print/${orderId}/${lineKey}.state`;

export function wrapToken(wrapColour) {
  return wrapColour && isHexColour(wrapColour) ? wrapColour.trim().replace('#', '').toLowerCase() : 'auto';
}

export function cacheKey({ orderId, lineKey, sizeKey, formatKey, style, identity, wrapColour }) {
  return `print/${orderId}/${lineKey}/${sizeKey}-${formatKey}-${style}-${identity}-${wrapToken(wrapColour)}.jpg`;
}

// ── Ad-hoc print files (/admin/print-any: a stock product, no site order) ──
// print/adhoc/<slug>/<size>-<format>-<masterIdentity>-<wrap>.jpg, and its note
// beside it as .state. No order or line in the key, so asking again for the
// same product, size, finish and wrap (with the master unchanged) is a hit.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const isSlug = (s) => typeof s === 'string' && s.length <= 120 && SLUG_RE.test(s);

export function adhocKey({ slug, sizeKey, formatKey, identity, wrapColour }) {
  return `print/adhoc/${slug}/${sizeKey}-${formatKey}-${identity}-${wrapToken(wrapColour)}.jpg`;
}
const ADHOC_KEY_RE = /^print\/adhoc\/[a-z0-9-]{1,120}\/[A-Za-z]+-[A-Za-z]+-[A-Za-z0-9]{1,40}-(?:auto|[0-9a-f]{6})\.jpg$/;
export const isAdhocKey = (k) => typeof k === 'string' && ADHOC_KEY_RE.test(k) && !k.includes('..');
export const adhocStateKey = (key) => key.replace(/\.jpg$/, '.state');

/** Keys the download endpoint may serve from each store — nothing else. */
export const SERVABLE = {
  [FILES_STORE]: /^print\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.jpg$/,
  personalisation: /^personalisation\/[A-Za-z0-9_-]{20,24}\/print\.(png|jpg)$/,
};
