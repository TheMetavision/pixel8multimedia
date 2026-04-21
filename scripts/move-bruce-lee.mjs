// scripts/move-bruce-lee.mjs
// Run once with: node scripts/move-bruce-lee.mjs
// Requires: SANITY_TOKEN env var (from .env or pass inline)

import { createClient } from '@sanity/client';

const client = createClient({
  projectId: 'bqb4w421',
  dataset: 'production',
  apiVersion: '2024-12-01',
  token: process.env.SANITY_TOKEN,
  useCdn: false,
});

const bruceLeeIds = [
  'product-bruce-lee-style-a',
  'product-bruce-lee-style-b',
  'product-bruce-lee-style-c',
  'product-bruce-lee-style-d',
  'product-bruce-lee-style-e',
  'product-bruce-lee-style-f',
  'product-bruce-lee-style-g',
  'product-bruce-lee-style-h',
  'product-bruce-lee-style-i',
  'product-bruce-lee-style-j',
];

async function run() {
  console.log(`Moving ${bruceLeeIds.length} Bruce Lee products from Sport to TV/Movies...`);
  let tx = client.transaction();
  for (const id of bruceLeeIds) {
    tx = tx.patch(id, (p) => p.set({ category: 'tv-movies' }));
  }
  const result = await tx.commit();
  console.log(`Done. Updated ${result.results.length} documents.`);
}

run().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
