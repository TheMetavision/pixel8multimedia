// scripts/seed-personalised.cjs
// Creates 12 personalised service products in the shop
//
// Usage:
//   $env:SANITY_WRITE_TOKEN="sk..."
//   node scripts/seed-personalised.cjs

const { createClient } = require('@sanity/client');

const client = createClient({
  projectId: 'bqb4w421',
  dataset: 'production',
  apiVersion: '2024-01-01',
  token: process.env.SANITY_WRITE_TOKEN,
  useCdn: false,
});

const SERVICES = [
  {
    title: 'Cartoonify Me!',
    slug: 'cartoonify-me',
    description: 'Turn your photo into a hand-crafted cartoon masterpiece in your favourite style. Simpsons, Anime, Pixar, and more — the choice is yours.',
    digitalPrice: 14.99,
    hasPrint: true,
    serviceSlug: 'cartoonify-me',
    sortOrder: 1,
  },
  {
    title: 'Stills to Reels',
    slug: 'stills-to-reels',
    description: 'Watch your favourite snapshot come alive! We animate your photo into a short cinematic scene — perfect for sharing on socials or framing as a digital display.',
    digitalPrice: 24.99,
    hasPrint: false,
    serviceSlug: 'stills-to-reels',
    sortOrder: 2,
  },
  {
    title: 'The Missing Moment',
    slug: 'the-missing-moment',
    description: 'Add someone special into an existing photo — a loved one who has passed, or a friend who missed your wedding. A priceless gift of togetherness.',
    digitalPrice: 19.99,
    hasPrint: true,
    serviceSlug: 'the-missing-moment',
    sortOrder: 3,
  },
  {
    title: 'Past Perfect',
    slug: 'past-perfect',
    description: 'Restore treasured memories with professional photo repair and colourisation. Damaged, faded, or torn — we bring it back to life.',
    digitalPrice: 14.99,
    hasPrint: true,
    serviceSlug: 'past-perfect',
    sortOrder: 4,
  },
  {
    title: 'Your Song Your Story',
    slug: 'your-song-your-story',
    description: 'Turn memories, milestones, or inside jokes into an original song. A one-of-a-kind audio keepsake composed just for you.',
    digitalPrice: 29.99,
    hasPrint: false,
    serviceSlug: 'your-song-your-story',
    sortOrder: 5,
  },
  {
    title: 'Story Of Your Life',
    slug: 'story-of-your-life',
    description: 'Transform a lifetime of photographs into one beautifully crafted cinematic story. The ultimate tribute for milestone birthdays, retirements, or memorials.',
    digitalPrice: 34.99,
    hasPrint: false,
    serviceSlug: 'story-of-your-life',
    sortOrder: 6,
  },
  {
    title: 'Back in Time',
    slug: 'back-in-time',
    description: 'See yourself evolve across eras. From the 1950s through to the 2000s — we place you authentically into each decade with stunning AI-powered imagery.',
    digitalPrice: 19.99,
    hasPrint: true,
    serviceSlug: 'back-in-time',
    sortOrder: 7,
  },
  {
    title: 'The Day I Met...',
    slug: 'the-day-i-met',
    description: 'Creates a believable, cinematic image of you alongside your favourite celebrity, sports hero, or cultural icon. The ultimate conversation starter.',
    digitalPrice: 14.99,
    hasPrint: true,
    serviceSlug: 'the-day-i-met',
    sortOrder: 8,
  },
  {
    title: 'Scene Stealer',
    slug: 'scene-stealer',
    description: "Become the star of cinema's most iconic scenes. We place you into legendary movie moments with seamless, photorealistic precision.",
    digitalPrice: 14.99,
    hasPrint: true,
    serviceSlug: 'scene-stealer',
    sortOrder: 9,
  },
  {
    title: 'Crayon To Creation',
    slug: 'crayon-to-creation',
    description: "Turn your child's imagination into something truly special. We transform their drawings into polished, professional-quality artwork.",
    digitalPrice: 14.99,
    hasPrint: true,
    serviceSlug: 'crayon-to-creation',
    sortOrder: 10,
  },
  {
    title: 'Star Power',
    slug: 'star-power',
    description: 'Turn your child or pet into the star of their very own blockbuster. Superhero posters, action movie scenes, fantasy worlds — you name it.',
    digitalPrice: 14.99,
    hasPrint: true,
    serviceSlug: 'star-power',
    sortOrder: 11,
  },
  {
    title: 'Prankz!',
    slug: 'prankz',
    description: 'Prank your friends with images that look way too real to ignore. Mugshots, wanted posters, fake magazine covers, outrageous scenarios — all in good fun.',
    digitalPrice: 9.99,
    hasPrint: true,
    serviceSlug: 'prankz',
    sortOrder: 12,
  },
];

function makeBlock(text) {
  return [
    {
      _type: 'block',
      _key: 'desc-0',
      style: 'normal',
      markDefs: [],
      children: [{ _type: 'span', _key: 'span-0', text, marks: [] }],
    },
  ];
}

async function main() {
  const token = process.env.SANITY_WRITE_TOKEN;
  if (!token) {
    console.error('❌ SANITY_WRITE_TOKEN required');
    process.exit(1);
  }

  console.log('\n📦 Creating 12 personalised service products...\n');

  for (const svc of SERVICES) {
    const doc = {
      _id: `product-personalised-${svc.slug}`,
      _type: 'product',
      title: svc.title,
      slug: { _type: 'slug', current: `personalised-${svc.slug}` },
      category: 'personalised',
      style: 'style-a', // default — not style-specific for services
      description: makeBlock(svc.description),
      images: [], // placeholder — add images in Studio
      prices: svc.hasPrint
        ? {
            poster: { small: 9.99, medium: 12.99, large: 16.99 },
            canvasStandard: { small: 27.99, medium: 32.99, large: 44.99 },
            canvasGallery: { small: 29.99, medium: 35.99, large: 47.99 },
          }
        : {
            poster: { small: svc.digitalPrice, medium: svc.digitalPrice, large: svc.digitalPrice },
            canvasStandard: { small: 0, medium: 0, large: 0 },
            canvasGallery: { small: 0, medium: 0, large: 0 },
          },
      sizes: svc.hasPrint
        ? { small: '12x8', medium: '16x12', large: '24x16' }
        : { small: 'Digital', medium: 'Digital', large: 'Digital' },
      personalisationFee: svc.digitalPrice, // placeholder — update with real prices tomorrow
      featured: false,
      sortOrder: svc.sortOrder,
      tags: [
        'personalised',
        'service',
        svc.hasPrint ? 'print' : 'digital-only',
        svc.slug,
      ],
      accentColor: '#76FF03',
      seo: {
        metaTitle: `${svc.title} — Personalised Service | Pixel8 Multimedia`,
        metaDescription: `${svc.description.slice(0, 155)}`,
      },
    };

    const result = await client.createOrReplace(doc);
    const printLabel = svc.hasPrint ? '🖨️  Print + Digital' : '💾 Digital Only';
    console.log(`   ✅ ${result.title} [${printLabel}] — £${svc.digitalPrice} digital`);
  }

  console.log('\n╔════════════════════════════════════════════════╗');
  console.log('║  12 personalised products created              ║');
  console.log('║                                                ║');
  console.log('║  Next steps:                                   ║');
  console.log('║  1. Add hero images in Sanity Studio           ║');
  console.log('║  2. Update digital prices when confirmed       ║');
  console.log('║  3. Update personalisation fees per service    ║');
  console.log('╚════════════════════════════════════════════════╝\n');
}

main().catch((err) => {
  console.error('💥 Fatal:', err);
  process.exit(1);
});
