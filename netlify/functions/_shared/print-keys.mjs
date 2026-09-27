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

/** Keys the download endpoint may serve from each store — nothing else. */
export const SERVABLE = {
  [FILES_STORE]: /^print\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.jpg$/,
  personalisation: /^personalisation\/[A-Za-z0-9_-]{20,24}\/print\.(png|jpg)$/,
};
