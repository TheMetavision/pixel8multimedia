// src/pages/feeds/google-shopping.xml.ts
//
// /feeds/google-shopping.xml — the Google Merchant Center product feed,
// generated at BUILD time (a static file, so every deploy — including the
// debounced rebuild after a Studio publish — refreshes it; crawlers get it
// from the CDN). One item per stock product × format × size, priced by the
// same function checkout charges with. See src/lib/shopping-feed.mjs.
//
// The build log gets a one-line summary: item count, and any product left
// out for a missing image or price.

import type { APIRoute } from 'astro';
import { sanityClient } from '../../lib/sanity';
import { CATEGORY_LABELS } from '../../data/products';
import { QUERY, buildFeed } from '../../lib/shopping-feed.mjs';

export const prerender = true;

export const GET: APIRoute = async () => {
  const products = await sanityClient.fetch(QUERY);
  const { xml, items, skipped } = buildFeed(products, { categoryLabels: CATEGORY_LABELS });
  console.log(
    `google-shopping feed: ${items.length} items from ${products.length} products` +
      `; no image: ${skipped.noImage.length ? skipped.noImage.join(', ') : 'none'}` +
      `; no price: ${skipped.noPrice.length ? skipped.noPrice.join('; ') : 'none'}` +
      (skipped.artistText.length ? `; artist text replaced: ${skipped.artistText.join(', ')}` : ''),
  );
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
