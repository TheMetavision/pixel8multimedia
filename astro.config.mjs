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
const NOT_IN_SITEMAP = [
  '/order-confirmation/', '/commission/success/',
  // The newsletter's confirm pages, reached only from its email.
  '/newsletter/confirm/', '/newsletter/confirmed/', '/newsletter/link-expired/',
];

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

/* Blog posts get a sitemap <lastmod> from their Sanity _updatedAt.
   A failed fetch only drops the lastmod values; it never fails the build. */
async function blogLastmods() {
  try {
    const query = encodeURIComponent(`*[_type == "blogPost" && defined(slug.current)]{"slug": slug.current, "updatedAt": _updatedAt}`);
    const token = process.env.SANITY_READ_TOKEN || process.env.SANITY_API_TOKEN || process.env.SANITY_TOKEN;
    const res = await fetch(`https://bqb4w421.api.sanity.io/v2024-01-01/data/query/production?query=${query}&perspective=published`,
      token ? { headers: { Authorization: `Bearer ${token}` } } : {});
    const { result } = await res.json();
    return new Map((result || []).map((p) => [`/blog/${p.slug}`, p.updatedAt]));
  } catch (err) {
    console.warn('[sitemap] blog lastmod fetch failed:', err);
    return new Map();
  }
}
const BLOG_LASTMOD = await blogLastmods();
const withBlogLastmod = (item) => {
  const lastmod = BLOG_LASTMOD.get(new URL(item.url).pathname.replace(/\/$/, ''));
  return lastmod ? { ...item, lastmod } : item;
};

export default defineConfig({
  site: SITE,
  integrations: [
    tailwind(),
    sitemap({ serialize: withBlogLastmod,
      customPages: await serviceUrls(),
      filter: (page) => !NOT_IN_SITEMAP.some((p) => new URL(page).pathname === p),
    }),
    react(),
  ],
  output: 'static',
  adapter: netlify(),
});
