// src/lib/sanity.ts
// Shared Sanity client for Astro SSR pages + components

import { createClient } from '@sanity/client';
import imageUrlBuilder from '@sanity/image-url';

export const sanityClient = createClient({
  projectId: 'bqb4w421',
  dataset: 'production',
  apiVersion: '2024-12-01',
  useCdn: import.meta.env.PROD, // CDN in prod, fresh data in dev
  // No token needed for read-only public queries
});

const builder = imageUrlBuilder(sanityClient);

export function urlFor(source: any) {
  return builder.image(source);
}
