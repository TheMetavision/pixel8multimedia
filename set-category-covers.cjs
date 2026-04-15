// scripts/set-category-covers.cjs
// Picks a product image from each category and sets it as the category coverImage
//
// Usage:
//   $env:SANITY_WRITE_TOKEN="sk..."
//   node scripts/set-category-covers.cjs

const { createClient } = require('@sanity/client');

const client = createClient({
  projectId: 'bqb4w421',
  dataset: 'production',
  apiVersion: '2024-01-01',
  token: process.env.SANITY_WRITE_TOKEN,
  useCdn: false,
});

const CATEGORIES = ['animations', 'music', 'tv-movies', 'sport', 'miscellaneous', 'personalised'];

async function main() {
  console.log('\n🖼️  Setting category cover images from products...\n');

  for (const cat of CATEGORIES) {
    // Get a featured product image from this category, or the first one with an image
    const product = await client.fetch(
      `*[_type == "product" && category == $cat && defined(images[0].asset)][0] {
        title,
        "imageRef": images[0].asset._ref
      }`,
      { cat }
    );

    if (!product || !product.imageRef) {
      console.log(`   ⚠ ${cat}: no products with images found — skipping`);
      continue;
    }

    // Patch the category document
    const catId = `cat-${cat}`;
    await client.patch(catId).set({
      coverImage: {
        _type: 'image',
        asset: { _type: 'reference', _ref: product.imageRef },
      },
    }).commit();

    console.log(`   ✅ ${cat}: cover set from "${product.title}"`);
  }

  console.log('\n   Done! Refresh your site to see category images.\n');
}

main().catch((err) => {
  console.error('💥', err.message);
  process.exit(1);
});
