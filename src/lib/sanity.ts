// src/lib/sanity.ts
// Shared Sanity client for Astro SSR pages + components.
//
// SERVER-ONLY. Do NOT import sanityClient into a client-side island — it carries
// a token, and once the `production` dataset is private, reads require it.
// (urlFor / image URLs are fine anywhere; asset files stay public-by-URL.)

import { createClient } from '@sanity/client';
import imageUrlBuilder from '@sanity/image-url';

export const sanityClient = createClient({
  projectId: 'bqb4w421',
  dataset: 'production',
  apiVersion: '2024-12-01',
  useCdn: import.meta.env.PROD, // CDN in prod, fresh data in dev
  // H6: required once the dataset is private. Astro keeps non-PUBLIC_ env vars
  // server-side only, so this token is never shipped to the browser. SANITY_TOKEN
  // is already set in Netlify (your functions use it). If SSR reads come back
  // empty at runtime, switch this to process.env.SANITY_TOKEN.
  token: import.meta.env.SANITY_TOKEN,
});

const builder = imageUrlBuilder(sanityClient);

export function urlFor(source: any) {
  return builder.image(source);
}
