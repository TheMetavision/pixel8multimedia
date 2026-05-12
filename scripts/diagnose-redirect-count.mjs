// scripts/diagnose-redirect-count.mjs
// Confirms the slug counts before generating _redirects entries.

import { createClient } from '@sanity/client';

const client = createClient({
  projectId: 'bqb4w421',
  dataset: 'production',
  apiVersion: '2024-12-01',
  useCdn: false,
});

const all = await client.fetch(
  '*[_type == "product" && defined(slug.current) && slug.current match "*-style-*"].slug.current'
);

const personalised = all.filter((s) => s.startsWith('personalised-'));
const characterVariants = all.filter((s) => !s.startsWith('personalised-') && /-style-[a-j]$/.test(s));
const otherWeirdSlugs = all.filter(
  (s) => !s.startsWith('personalised-') && !/-style-[a-j]$/.test(s)
);

console.log('Total slugs containing "-style-":', all.length);
console.log('  Character variants (will be redirected):', characterVariants.length);
console.log('  Personalised (will NOT be redirected, link to /services/...):', personalised.length);
console.log('  Other / unexpected (skipped):', otherWeirdSlugs.length);
if (otherWeirdSlugs.length > 0) {
  console.log('    Sample of unexpected:', otherWeirdSlugs.slice(0, 5));
}

// Character sample
const characters = new Set(characterVariants.map((s) => s.replace(/-style-[a-j]$/, '')));
console.log('Unique characters:', characters.size);
console.log('  Sample:', [...characters].slice(0, 5));

// Sample of what the redirects will look like
console.log('\nSample redirects that will be generated:');
characterVariants.slice(0, 5).forEach((s) => {
  const character = s.replace(/-style-[a-j]$/, '');
  const letter = s.match(/-style-([a-j])$/)?.[1];
  console.log(`  /store/${s}  /store/${character}?option=${letter}  301`);
});
