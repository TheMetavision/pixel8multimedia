// src/lib/sanity.ts
// Shared Sanity client for Astro SSR pages + components.
//
// SERVER-ONLY. Do NOT import sanityClient into a client-side island — it carries
// a token, and once the `production` dataset is private, reads require it.
// (urlFor / image URLs are fine anywhere; asset files stay public-by-URL.)

import { createClient } from '@sanity/client';
import imageUrlBuilder from '@sanity/image-url';
import { getSecret } from 'astro:env/server';

// Read token: SANITY_READ_TOKEN (a Viewer token) if set, else SANITY_TOKEN.
// getSecret() reads the value at runtime (process.env on Netlify, .env locally)
// — unlike import.meta.env, which Astro inlines into the SSR function bundle at
// build time. Missing token = hard failure: with a private dataset an
// unauthenticated client returns empty results, which would silently build an
// empty shop.
const token = getSecret('SANITY_READ_TOKEN') || getSecret('SANITY_TOKEN');
if (!token) {
  throw new Error(
    '[sanity] SANITY_READ_TOKEN / SANITY_TOKEN is not set. The dataset is private, so ' +
      'builds and SSR pages cannot read content without one. Set it in .env locally, or ' +
      'in Netlify with Builds + Functions scopes.',
  );
}

export const sanityClient = createClient({
  projectId: 'bqb4w421',
  dataset: 'production',
  apiVersion: '2024-12-01',
  useCdn: import.meta.env.PROD, // CDN in prod, fresh data in dev
  token,
  // With a token the default ('raw') perspective also returns drafts and
  // release versions. Pin to published so the site shows exactly what the old
  // anonymous reads did.
  perspective: 'published',
});

const builder = imageUrlBuilder(sanityClient);

export function urlFor(source: any) {
  return builder.image(source);
}
