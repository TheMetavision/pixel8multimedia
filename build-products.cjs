/**
 * Pixel8 Multimedia — Automated Product Build Script
 * ====================================================
 *
 * Scans: C:\Users\chris\Documents\Pixel 8\Products\
 *
 * EXPECTED STRUCTURE:
 * ───────────────────
 * Products\
 * ├── Albert Einstein\
 * │   ├── Style A.png
 * │   ├── Style B.png
 * │   ├── ...
 * │   └── Style J.png
 * ├── Anakin Skywalker\
 * │   ├── Style A.png
 * │   └── ...
 * └── ...
 *
 * Only files named "Style A" through "Style J" (.png/.jpg/.jpeg/.webp) are used.
 * All other files are IGNORED.
 *
 * Each design × style = 1 Sanity product document.
 * Categories are auto-assigned from CATEGORY_LOOKUP below.
 * Any design NOT in the lookup defaults to 'miscellaneous'.
 *
 * USAGE:
 * ──────
 *   cd "C:\Users\chris\Downloads\Pixel8 Site"
 *   npm install @sanity/client
 *   $env:SANITY_WRITE_TOKEN="sk..."
 *   node build-products.cjs --dry-run       (scan only, no writes)
 *   node build-products.cjs                 (full build)
 *   node build-products.cjs --skip-delete   (don't wipe existing products first)
 */

const { createClient } = require('@sanity/client');
const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════
//  CONFIGURATION
// ═══════════════════════════════════════════════════════════

const SANITY_PROJECT_ID = 'bqb4w421';
const SANITY_DATASET = 'production';
const SANITY_API_VERSION = '2024-01-01';

const DEFAULT_BASE_DIR = 'C:\\Users\\chris\\Documents\\Pixel 8\\Products';

// ═══════════════════════════════════════════════════════════
//  CATEGORY LOOKUP — all 120 designs
// ═══════════════════════════════════════════════════════════
// Keys MUST match folder names exactly (case-sensitive, including ! and !!).

const CATEGORY_LOOKUP = {

  // ── Animations (28) ─────────────────────────────────
  'Bart Simpson':           'animations',
  'Bugs Bunny':             'animations',
  'Charlie Brown':          'animations',
  'Daffy Duck':             'animations',
  'Donald Duck':            'animations',
  'Eeyore':                 'animations',
  'Garfield':               'animations',
  'Goofy':                  'animations',
  'Kermit The Frog':        'animations',
  'Mickey Mouse':           'animations',
  'Optimus Prime':          'animations',
  'Paddington':             'animations',
  'Patrick Star':           'animations',
  'Pikachu':                'animations',
  'Pluto!!':                'animations',
  'Popeye':                 'animations',
  'Scooby Doo':             'animations',
  'Shaggy':                 'animations',
  'Snoopy':                 'animations',
  'Sonic The Hedgehog':     'animations',
  'Spongebob Squarepants':  'animations',
  'Squidward Tentacles':    'animations',
  'Stewie Griffin':         'animations',
  'Stitch':                 'animations',
  'Sylvester The Cat':      'animations',
  'Taz!':                   'animations',
  'The Pink Panther':       'animations',
  'The Roadrunner':         'animations',
  'Tigger':                 'animations',
  'Tom and Jerry!!':        'animations',
  'Tweety Pie':             'animations',
  'Wile E Coyote':          'animations',
  'Winnie The Pooh':        'animations',
  'Yosemite Sam':           'animations',

  // ── Music (10) ──────────────────────────────────────
  'Billie Eilish':          'music',
  'Bob Marley':             'music',
  'Elvis':                  'music',
  'Eminem!':                'music',
  'Jimi Hendrix':           'music',
  'John Lennon':            'music',
  'Kurt Cobain':            'music',
  'Madonna!':               'music',
  'Michael Jackson':        'music',
  'Prince':                 'music',
  'Snoop Dogg':             'music',

  // ── TV / Movies (54) ───────────────────────────────
  'Anakin Skywalker':       'tv-movies',
  'Bane!':                  'tv-movies',
  'Batman!!':               'tv-movies',
  'Beetlejuice':            'tv-movies',
  'Blade!':                 'tv-movies',
  'Boba Fett':              'tv-movies',
  'C3-P0':                  'tv-movies',
  'Captain America!!':      'tv-movies',
  'Chewbacca':              'tv-movies',
  'Chucky':                 'tv-movies',
  'Count Dooku!!':          'tv-movies',
  'Darth Maul':             'tv-movies',
  'Darth Vader':            'tv-movies',
  'Deadpool':               'tv-movies',
  'Doc Brown!':             'tv-movies',
  'Ellen Ripley':           'tv-movies',
  'Freddy Krueger':         'tv-movies',
  'Gandolf':                'tv-movies',
  'General Grievous':       'tv-movies',
  'Ghostface':              'tv-movies',
  'Gollum':                 'tv-movies',
  'Greedo':                 'tv-movies',
  'Grogu':                  'tv-movies',
  'Groot':                  'tv-movies',
  'Hannibal Lecter!':       'tv-movies',
  'Hans Solo':              'tv-movies',
  'Harry Potter!':          'tv-movies',
  'Homer Simpson':          'tv-movies',
  'Indiana Jones':          'tv-movies',
  'Iron Man':               'tv-movies',
  'Jabba The Hutt':         'tv-movies',
  'Jack Sparrow':           'tv-movies',
  'Jason Vorhees':          'tv-movies',
  'Jawa':                   'tv-movies',
  'John Wick':              'tv-movies',
  'Joker':                  'tv-movies',
  'Jules Winnfield':        'tv-movies',
  'Kylo Ren':               'tv-movies',
  'Leatherface':            'tv-movies',
  'Luke Skywalker':         'tv-movies',
  'Marty McFly!!':          'tv-movies',
  'Master Chief!':          'tv-movies',
  'Michael Myers':          'tv-movies',
  'Obi Wan Kenobi':         'tv-movies',
  'Pennywise':              'tv-movies',
  'Princess Leia':          'tv-movies',
  'R2D2':                   'tv-movies',
  'Randle McMurphy!':       'tv-movies',
  'Rey':                    'tv-movies',
  'Rocky!':                 'tv-movies',
  'Snake Plissken':         'tv-movies',
  'Spider-Man':             'tv-movies',
  'Stormtrooper':           'tv-movies',
  'Superman':               'tv-movies',
  'The Dude':               'tv-movies',
  'The Godfather':          'tv-movies',
  'The Incredible Hulk':    'tv-movies',
  'The Mandalorian!!':      'tv-movies',
  'The Terminator!':        'tv-movies',
  'Tony Montana!!':         'tv-movies',
  'Tony Soprano!':          'tv-movies',
  'Travis Bickle!':         'tv-movies',
  'Tusken Raider!!':        'tv-movies',
  'Tyler Durden':           'tv-movies',
  'Walter White!':          'tv-movies',
  'Wicket':                 'tv-movies',
  'Wolverine':              'tv-movies',
  'Yoda':                   'tv-movies',

  // ── Sport (4) ───────────────────────────────────────
  'Bruce Lee':              'sport',
  'Michael Jordan!!':       'sport',
  'Mike Tyson!':            'sport',
  'Muhammad Ali':           'sport',

  // ── Miscellaneous (1) ──────────────────────────────
  'Albert Einstein':        'miscellaneous',
};

// ═══════════════════════════════════════════════════════════
//  STYLE + CATEGORY METADATA
// ═══════════════════════════════════════════════════════════

const STYLE_FILE_MAP = {
  'Style A': 'style-a', 'Style B': 'style-b', 'Style C': 'style-c',
  'Style D': 'style-d', 'Style E': 'style-e', 'Style F': 'style-f',
  'Style G': 'style-g', 'Style H': 'style-h', 'Style I': 'style-i',
  'Style J': 'style-j',
};

const STYLE_LABELS = {
  'style-a': 'Neon Glow',       'style-b': 'Minimalist Cool',  'style-c': 'Retro Vibes',
  'style-d': 'Pixel Art',       'style-e': 'Abstract Burst',   'style-f': 'Pop Art',
  'style-g': 'Watercolour',     'style-h': 'Noir',             'style-i': 'Geometric',
  'style-j': 'Street Art',
};

const CATEGORY_LABELS = {
  'animations': 'Animations', 'music': 'Music', 'tv-movies': 'TV / Movies',
  'sport': 'Sport', 'miscellaneous': 'Miscellaneous', 'personalised': 'Personalised',
};

const STYLE_ACCENTS = {
  'style-a': '#FF00FF', 'style-b': '#E0E0E0', 'style-c': '#FF6B35',
  'style-d': '#00E5FF', 'style-e': '#FFD600', 'style-f': '#FF1744',
  'style-g': '#81D4FA', 'style-h': '#424242', 'style-i': '#7C4DFF',
  'style-j': '#76FF03',
};

const DEFAULT_PRICES = {
  poster:         { small: 9.99,  medium: 12.99, large: 16.99 },
  canvasStandard: { small: 27.99, medium: 32.99, large: 44.99 },
  canvasGallery:  { small: 29.99, medium: 35.99, large: 47.99 },
};

const DEFAULT_SIZES = { small: '12x8', medium: '16x12', large: '24x16' };
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

// ═══════════════════════════════════════════════════════════
//  CATEGORY DOCUMENTS
// ═══════════════════════════════════════════════════════════

const CATEGORY_DOCS = [
  { _id: 'cat-animations', _type: 'category', name: 'Animations', slug: { _type: 'slug', current: 'animations' }, description: 'Iconic animated characters reimagined across 10 art styles.', tagline: 'Toons with attitude', accentColor: '#FF6B35', sortOrder: 1, seo: { metaTitle: 'Animation Wall Art | Pixel8 Multimedia', metaDescription: 'Pop culture animation wall art in 10 unique styles. Canvas prints and posters made to order in the UK.' } },
  { _id: 'cat-music', _type: 'category', name: 'Music', slug: { _type: 'slug', current: 'music' }, description: 'Legendary musicians and bands immortalised in bold, original art.', tagline: 'Icons that hit different', accentColor: '#FF00FF', sortOrder: 2, seo: { metaTitle: 'Music Wall Art | Pixel8 Multimedia', metaDescription: 'Music legend wall art in 10 unique styles. Canvas prints and posters made to order in the UK.' } },
  { _id: 'cat-tv-movies', _type: 'category', name: 'TV / Movies', slug: { _type: 'slug', current: 'tv-movies' }, description: 'Silver screen legends and TV favourites captured in stunning original artwork.', tagline: 'From screen to scene', accentColor: '#00E5FF', sortOrder: 3, seo: { metaTitle: 'TV & Movie Wall Art | Pixel8 Multimedia', metaDescription: 'TV and movie wall art in 10 unique styles. Canvas prints and posters made to order in the UK.' } },
  { _id: 'cat-sport', _type: 'category', name: 'Sport', slug: { _type: 'slug', current: 'sport' }, description: 'Sporting heroes and legendary moments transformed into striking wall art.', tagline: 'Legends never retire', accentColor: '#FFD600', sortOrder: 4, seo: { metaTitle: 'Sport Wall Art | Pixel8 Multimedia', metaDescription: 'Sports legend wall art in 10 unique styles. Canvas prints and posters made to order in the UK.' } },
  { _id: 'cat-miscellaneous', _type: 'category', name: 'Miscellaneous', slug: { _type: 'slug', current: 'miscellaneous' }, description: "Everything else that caught our eye — animals, abstract concepts, cultural icons, and oddities.", tagline: "The ones that don't fit the box", accentColor: '#7C4DFF', sortOrder: 5, seo: { metaTitle: 'Miscellaneous Wall Art | Pixel8 Multimedia', metaDescription: 'Unique pop culture wall art in 10 styles. Canvas prints and posters made to order in the UK.' } },
  { _id: 'cat-personalised', _type: 'category', name: 'Personalised', slug: { _type: 'slug', current: 'personalised' }, description: "Your face, your pet, your moment — transformed into one of our 10 signature art styles.", tagline: 'Your story, your style', accentColor: '#76FF03', sortOrder: 6, seo: { metaTitle: 'Personalised Wall Art | Pixel8 Multimedia', metaDescription: "Custom personalised wall art in 10 unique styles. Upload your photo. Made in the UK." } },
];

// ═══════════════════════════════════════════════════════════
//  CLI
// ═══════════════════════════════════════════════════════════

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { dryRun: false, baseDir: DEFAULT_BASE_DIR, skipDelete: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') opts.dryRun = true;
    if (args[i] === '--skip-delete') opts.skipDelete = true;
    if (args[i] === '--base-dir' && args[i + 1]) opts.baseDir = args[++i];
  }
  return opts;
}

// ═══════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════

function makeSlug(text) {
  return text
    .toLowerCase()
    .replace(/[!'']/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ═══════════════════════════════════════════════════════════
//  SCANNER — reads every design folder, no skipping
// ═══════════════════════════════════════════════════════════

function scanProducts(baseDir) {
  if (!fs.existsSync(baseDir)) {
    console.error(`❌ Products folder not found: ${baseDir}`);
    console.error('   Update DEFAULT_BASE_DIR or use --base-dir flag');
    process.exit(1);
  }

  const products = [];
  const uncategorised = [];

  const designFolders = fs.readdirSync(baseDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const designFolder of designFolders) {
    const designName = designFolder.name;
    const designPath = path.join(baseDir, designName);

    // Default to miscellaneous if not in lookup
    const category = CATEGORY_LOOKUP[designName] || 'miscellaneous';
    if (!CATEGORY_LOOKUP[designName]) {
      uncategorised.push(designName);
    }

    // Scan for Style A through Style J
    const files = fs.readdirSync(designPath);

    for (const [styleName, styleValue] of Object.entries(STYLE_FILE_MAP)) {
      const matchingFile = files.find((f) => {
        const nameWithoutExt = path.parse(f).name;
        const ext = path.extname(f).toLowerCase();
        return nameWithoutExt === styleName && IMAGE_EXTENSIONS.includes(ext);
      });

      if (matchingFile) {
        products.push({
          designName,
          category,
          style: styleValue,
          imagePath: path.join(designPath, matchingFile),
          imageFilename: matchingFile,
        });
      }
    }
  }

  return { products, uncategorised };
}

// ═══════════════════════════════════════════════════════════
//  IMAGE UPLOAD
// ═══════════════════════════════════════════════════════════

async function uploadImage(client, filePath, filename) {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  };
  const buffer = fs.readFileSync(filePath);
  return client.assets.upload('image', buffer, {
    filename,
    contentType: mimeTypes[ext] || 'image/png',
  });
}

// ═══════════════════════════════════════════════════════════
//  DOCUMENT BUILDER
// ═══════════════════════════════════════════════════════════

function buildDocument(product, imageAsset) {
  const styleLabel = STYLE_LABELS[product.style];
  const slug = makeSlug(`${product.designName}-${product.style}`);

  return {
    _id: `product-${slug}`,
    _type: 'product',
    title: `${product.designName} — ${styleLabel}`,
    slug: { _type: 'slug', current: slug },
    category: product.category,
    style: product.style,
    description: [
      {
        _type: 'block', _key: 'desc-0', style: 'normal', markDefs: [],
        children: [{
          _type: 'span', _key: 'span-0', marks: [],
          text: `${product.designName} reimagined in our signature ${styleLabel} style. Bold, original pop culture wall art — available as poster print, standard canvas, or gallery canvas. Made to order in the UK by Pixel8 Multimedia.`,
        }],
      },
    ],
    images: [
      {
        _type: 'image', _key: 'img-0',
        asset: { _type: 'reference', _ref: imageAsset._id },
        alt: `${product.designName} ${styleLabel} wall art by Pixel8 Multimedia`,
      },
    ],
    prices: { ...DEFAULT_PRICES },
    sizes: { ...DEFAULT_SIZES },
    featured: false,
    sortOrder: 0,
    tags: [
      product.category,
      product.style,
      styleLabel.toLowerCase(),
      (CATEGORY_LABELS[product.category] || '').toLowerCase(),
    ].filter(Boolean),
    accentColor: STYLE_ACCENTS[product.style] || '#F07828',
    seo: {
      metaTitle: `${product.designName} ${styleLabel} Wall Art | Pixel8 Multimedia`,
      metaDescription: `${product.designName} ${styleLabel} pop culture wall art. Poster prints and canvas made to order in the UK.`,
    },
  };
}

// ═══════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════

async function main() {
  const opts = parseArgs();
  const token = process.env.SANITY_WRITE_TOKEN;

  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║    PIXEL8 MULTIMEDIA — Automated Product Build     ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  if (!token && !opts.dryRun) {
    console.error('❌ SANITY_WRITE_TOKEN is required.');
    console.error('   PowerShell:  $env:SANITY_WRITE_TOKEN="sk..."');
    console.error('   Then re-run: node build-products.cjs\n');
    process.exit(1);
  }

  const client = token ? createClient({
    projectId: SANITY_PROJECT_ID,
    dataset: SANITY_DATASET,
    apiVersion: SANITY_API_VERSION,
    token,
    useCdn: false,
  }) : null;

  // ── Step 1: Scan ──────────────────────────────────────
  console.log(`📁 Scanning: ${opts.baseDir}\n`);
  const { products, uncategorised } = scanProducts(opts.baseDir);

  if (products.length === 0) {
    console.error('❌ No products found. Check folder structure.');
    process.exit(1);
  }

  const uniqueDesigns = new Set(products.map((p) => p.designName));
  const byCat = {};
  const byStyle = {};
  for (const p of products) {
    byCat[p.category] = (byCat[p.category] || 0) + 1;
    byStyle[p.style] = (byStyle[p.style] || 0) + 1;
  }

  console.log(`📊 Found ${uniqueDesigns.size} designs × up to 10 styles = ${products.length} products\n`);

  console.log('   By Category:');
  for (const [cat, count] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${(CATEGORY_LABELS[cat] || cat).padEnd(16)} ${count}`);
  }

  console.log('\n   By Style:');
  for (const [style, count] of Object.entries(byStyle).sort()) {
    console.log(`     ${(STYLE_LABELS[style] || style).padEnd(16)} ${count}`);
  }

  if (uncategorised.length > 0) {
    console.log(`\n   ⚠ ${uncategorised.length} designs defaulting to Miscellaneous:`);
    for (const name of uncategorised) {
      console.log(`     - "${name}"`);
    }
    console.log('\n   💡 Add them to CATEGORY_LOOKUP in the script to fix.');
  }

  // ── Dry run ───────────────────────────────────────────
  if (opts.dryRun) {
    console.log('\n🏃 DRY RUN — what would be created:\n');
    let prevDesign = '';
    for (const p of products) {
      if (p.designName !== prevDesign) {
        console.log(`\n   📂 ${p.designName} [${CATEGORY_LABELS[p.category]}]`);
        prevDesign = p.designName;
      }
      const slug = makeSlug(`${p.designName}-${p.style}`);
      console.log(`      ${STYLE_LABELS[p.style].padEnd(16)} → product-${slug}`);
    }
    console.log(`\n   ✅ ${products.length} products would be created.`);
    console.log('   Run without --dry-run to execute.\n');
    return;
  }

  // ── Step 2: Delete existing ───────────────────────────
  if (!opts.skipDelete) {
    console.log('\n🗑️  Deleting existing products...');
    const existing = await client.fetch('*[_type == "product"]._id');
    if (existing.length > 0) {
      for (let i = 0; i < existing.length; i += 100) {
        const chunk = existing.slice(i, i + 100);
        let tx = client.transaction();
        for (const id of chunk) tx = tx.delete(id);
        await tx.commit();
      }
      console.log(`   Deleted ${existing.length} existing products`);
    } else {
      console.log('   No existing products to delete');
    }
  }

  // ── Step 3: Seed categories ───────────────────────────
  console.log('\n📂 Seeding 6 categories...');
  for (const cat of CATEGORY_DOCS) {
    await client.createOrReplace(cat);
    console.log(`   ✓ ${cat.name}`);
  }

  // ── Step 4: Upload products ───────────────────────────
  console.log(`\n🚀 Uploading ${products.length} products...\n`);
  let success = 0;
  let failed = 0;
  const startTime = Date.now();

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const pad = String(products.length).length;
    const progress = `[${String(i + 1).padStart(pad)}/${products.length}]`;

    try {
      process.stdout.write(`   ${progress} 📸 ${p.designName} / ${STYLE_LABELS[p.style]}...`);
      const asset = await uploadImage(client, p.imagePath, p.imageFilename);
      process.stdout.write(' ✓ → ');

      const doc = buildDocument(p, asset);
      await client.createOrReplace(doc);
      console.log(doc._id);
      success++;

      await new Promise((r) => setTimeout(r, 120));
    } catch (err) {
      console.log(` ❌ ${err.message}`);
      failed++;
    }
  }

  // ── Summary ───────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║                  BUILD COMPLETE                    ║');
  console.log('╠════════════════════════════════════════════════════╣');
  console.log(`║  ✅ Products created:  ${String(success).padStart(5)}                      ║`);
  console.log(`║  ❌ Failed:            ${String(failed).padStart(5)}                      ║`);
  console.log(`║  📂 Categories seeded:     6                      ║`);
  console.log(`║  🎨 Unique designs:    ${String(uniqueDesigns.size).padStart(5)}                      ║`);
  console.log(`║  ⏱  Time:           ${String(elapsed + 's').padStart(8)}                      ║`);
  console.log('╚════════════════════════════════════════════════════╝\n');

  if (success > 0) {
    console.log('Next steps:');
    console.log('  1. Open Sanity Studio to verify products');
    console.log('  2. Mark featured products in Studio');
    console.log('  3. Deploy Astro site to Netlify\n');
  }
}

main().catch((err) => {
  console.error('\n💥 Fatal error:', err);
  process.exit(1);
});
