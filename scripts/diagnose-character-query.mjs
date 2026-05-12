// scripts/diagnose-character-query.mjs
// Tests several GROQ variants to find one Sanity accepts.

import { createClient } from '@sanity/client';

const client = createClient({
  projectId: 'bqb4w421',
  dataset: 'production',
  apiVersion: '2024-12-01',
  useCdn: false,
});

const queries = [
  {
    name: 'Current broken: array::unique(*[...].slug.current)',
    groq: `array::unique(*[_type == "product" && defined(slug.current) && slug.current match "*-style-?"].slug.current)`,
  },
  {
    name: 'Alt 1: just project slugs of all variants (let JS dedupe)',
    groq: `*[_type == "product" && defined(slug.current) && slug.current match "*-style-?"]{ "slug": slug.current }`,
  },
  {
    name: 'Alt 2: only style-a variants (one per character by definition)',
    groq: `*[_type == "product" && defined(slug.current) && style == "style-a"]{ "slug": slug.current }`,
  },
  {
    name: 'Alt 3: count check — how many products total?',
    groq: `count(*[_type == "product"])`,
  },
  {
    name: 'Alt 4: count check — how many style-a products?',
    groq: `count(*[_type == "product" && style == "style-a"])`,
  },
];

for (const q of queries) {
  console.log('---');
  console.log(q.name);
  try {
    const r = await client.fetch(q.groq);
    if (Array.isArray(r)) {
      console.log(`  ✓ ${r.length} rows. Sample:`, JSON.stringify(r.slice(0, 3)));
    } else {
      console.log(`  ✓ Result:`, r);
    }
  } catch (e) {
    console.log(`  ✗ ERROR:`, e.message.slice(0, 200));
  }
}
