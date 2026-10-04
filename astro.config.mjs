// @ts-check
import { defineConfig } from 'astro/config';
import { loadEnv } from 'vite';
import { createClient } from '@sanity/client';
import tailwind from '@astrojs/tailwind';
import netlify from '@astrojs/netlify';
import sitemap from '@astrojs/sitemap';

import react from '@astrojs/react';

const SITE = 'https://pixel8multimedia.co.uk';

// Transactional pages: noindex, and never in the sitemap.
const NOT_IN_SITEMAP = ['/order-confirmation/', '/commission/success/'];

// /services/<slug>/ renders on demand, so the sitemap integration can't see it.
// List the published services here. Fails the build rather than shipping a
// sitemap without them.
async function serviceUrls() {
  const env = { ...loadEnv('production', process.cwd(), ''), ...process.env };
  const token = env.SANITY_READ_TOKEN || env.SANITY_TOKEN;
  if (!token) throw new Error('[sitemap] SANITY_READ_TOKEN / SANITY_TOKEN is not set');
  const slugs = await createClient({
    projectId: 'bqb4w421', dataset: 'production', apiVersion: '2024-12-01',
    useCdn: false, token, perspective: 'published',
  }).fetch(`*[_type == "service" && defined(slug.current)] | order(sortOrder asc).slug.current`);
  if (!Array.isArray(slugs) || slugs.length === 0) throw new Error('[sitemap] no services returned from Sanity');
  return slugs.map((s) => `${SITE}/services/${s}/`);
}

export default defineConfig({
  site: SITE,
  integrations: [
    tailwind(),
    sitemap({
      customPages: await serviceUrls(),
      filter: (page) => !NOT_IN_SITEMAP.some((p) => new URL(page).pathname === p),
    }),
    react(),
  ],
  output: 'static',
  adapter: netlify(),
});
