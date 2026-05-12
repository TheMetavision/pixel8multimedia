// scripts/apply-listing-collapse.mjs
// Patch #2: collapse shop listing to one card per character + rewire links to /store/<character>
//
// Three files edited:
//   1. src/lib/queries.ts                 — append allCharactersForListingQuery
//   2. src/components/ProductCard.astro   — rewrite as character-level card
//   3. src/pages/store/index.astro        — switch to character query + variant filter
//
// Idempotent: if a file already has the new content, that file is skipped.

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const filePath = (p) => path.resolve(root, p);

function patchFile(rel, doPatch) {
  const abs = filePath(rel);
  if (!fs.existsSync(abs)) {
    console.error(`✗ Not found: ${rel}`);
    process.exit(1);
  }
  const before = fs.readFileSync(abs, 'utf8');
  const result = doPatch(before);
  if (result === null) {
    console.log(`  ${rel}: already up to date`);
    return;
  }
  fs.writeFileSync(abs, result, 'utf8');
  console.log(`✓ ${rel}: ${before.length} → ${result.length} bytes`);
}

// ─────────────────────────────────────────────────────────────────────────
// 1. Append allCharactersForListingQuery to src/lib/queries.ts
// ─────────────────────────────────────────────────────────────────────────

const listingQueryBlock = `

// ─── Shop listing (one row per character) ──────────────────────────────────

// Returns one row per character with all 10 variants grouped in.
// Each row uses the Option A variant as the canonical title/price/image,
// and includes a \`variants[]\` array of thumbnail data for hover preview
// and filter swapping.
export const allCharactersForListingQuery = \`
  *[
    _type == "product"
    && defined(slug.current)
    && style == "style-a"
  ] | order(category asc, title asc) {
    _id,
    title,
    "slug": slug.current,
    "characterSlug": string::split(slug.current, "-style-")[0],
    category,
    style,
    prices,
    accentColor,
    images[0] {
      asset-> { _id, url },
      alt,
      "lqip": asset->metadata.lqip
    },
    "variants": *[
      _type == "product"
      && string::split(slug.current, "-style-")[0] == string::split(^.slug.current, "-style-")[0]
    ] | order(style asc) {
      style,
      "slug": slug.current,
      images[0] {
        asset-> { _id, url },
        alt
      }
    }
  }
\`;
`;

patchFile('src/lib/queries.ts', (content) => {
  if (content.includes('allCharactersForListingQuery')) return null;
  return content + listingQueryBlock;
});

// ─────────────────────────────────────────────────────────────────────────
// 2. Rewrite src/components/ProductCard.astro as a character-level card
// ─────────────────────────────────────────────────────────────────────────

const newProductCard = `---
import { urlFor } from '../lib/sanity';
import { PRICES, CATEGORY_LABELS } from '../data/products';

interface Variant {
  style: string;
  slug: string;
  images?: any;
}

interface Props {
  product: {
    title: string;
    slug: string;
    characterSlug?: string;
    category?: string;
    style?: string;
    accentColor?: string;
    prices?: any;
    images?: any[];
    variants?: Variant[];
    serviceHeroUrl?: string; // passed through for personalised products
  };
  // When the listing has an Option filter active, the card shows that variant
  // and links to /store/<character>?option=<letter>.
  activeLetter?: string | null;
}

const { product, activeLetter = null } = Astro.props;

// Personalised products link to the matching service page (unchanged)
const isPersonalised = product.category === 'personalised';
const serviceSlug = isPersonalised ? product.slug.replace(/^personalised-/, '') : null;

// Character slug for non-personalised products (e.g. "bart-simpson-style-a" → "bart-simpson")
const characterSlug = product.characterSlug || product.slug.replace(/-style-[a-j]$/, '');

// Pick the variant to display based on activeLetter (if set + exists), else default to Option A
const variantForLetter = activeLetter && product.variants
  ? product.variants.find((v) => v.style === \`style-\${activeLetter}\`)
  : null;
const displayVariant = variantForLetter || (product.variants?.[0]) || null;

// Build the card link
let href;
if (isPersonalised) {
  href = \`/services/\${serviceSlug}\`;
} else if (activeLetter && variantForLetter) {
  href = \`/store/\${characterSlug}?option=\${activeLetter}\`;
} else {
  href = \`/store/\${characterSlug}\`;
}

// Image: use the variant's image when filtering, else product's own image, else service hero
const variantImageUrl = displayVariant?.images?.asset
  ? urlFor(displayVariant.images).width(600).height(800).url()
  : null;
const productImageUrl = product.images?.[0]?.asset
  ? urlFor(product.images[0]).width(600).height(800).url()
  : null;
const imageUrl = variantImageUrl || productImageUrl || product.serviceHeroUrl || null;

const lowestPrice = product.prices?.poster?.small || PRICES.poster.small;
const accent = product.accentColor || '#F07828';
const categoryLabel = product.category ? (CATEGORY_LABELS[product.category] || product.category) : '';

// Trim " — Option X" suffix from title for the character-level card display
const displayTitle = (product.title || '').split(' — ')[0] || product.title;

// Variant count for the corner badge (e.g. "10 designs")
const variantCount = product.variants?.length || 1;

// CTA label differs for personalised
const ctaLabel = isPersonalised ? 'Commission' : 'View Designs';

// All-options data for the hover strip: letter + URL pairs
const variantStrip = (product.variants || [])
  .filter((v) => /^style-[a-j]$/.test(v.style || ''))
  .map((v) => ({
    letter: v.style.replace('style-', ''),
    thumbUrl: v.images?.asset ? urlFor(v.images).width(80).height(80).url() : '',
  }));
---

<a href={href} class="product-card group block" data-category={product.category} data-character={characterSlug} data-title={displayTitle?.toLowerCase()} data-variants={(product.variants || []).map((v) => v.style).join(',')}>
  <div class="aspect-[3/4] relative overflow-hidden">
    {imageUrl ? (
      <img src={imageUrl} alt={displayTitle} class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy" />
    ) : (
      <div class="img-placeholder w-full h-full">
        <span class="font-montserrat text-xs uppercase tracking-widest">{displayTitle}</span>
      </div>
    )}

    {isPersonalised && (
      <span class="absolute top-2 left-2 bg-pixel-cyan/90 backdrop-blur-sm text-xs font-montserrat font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full text-black">
        Bespoke
      </span>
    )}

    {!isPersonalised && variantCount > 1 && (
      <span class="absolute top-2 right-2 bg-black/70 backdrop-blur-sm text-xs font-montserrat font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full text-off-white">
        {variantCount} designs
      </span>
    )}

    <!-- Variant strip preview on hover -->
    {!isPersonalised && variantStrip.length > 0 && (
      <div class="absolute inset-x-0 bottom-0 px-2 pb-2 pt-6 bg-gradient-to-t from-black/90 via-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
        <div class="grid grid-cols-10 gap-1">
          {variantStrip.map((v) => (
            <div class="aspect-square rounded-sm overflow-hidden bg-bg-tertiary border border-off-white/20" title={\`Option \${v.letter.toUpperCase()}\`}>
              {v.thumbUrl ? (
                <img src={v.thumbUrl} alt="" class="w-full h-full object-cover" loading="lazy" />
              ) : (
                <div class="w-full h-full flex items-center justify-center text-[0.55rem] font-montserrat text-off-white/60">{v.letter.toUpperCase()}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    )}

    <!-- Centre CTA overlay -->
    <div class="absolute inset-0 bg-bg-primary/30 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center backdrop-blur-[1px] pointer-events-none">
      <span class="font-montserrat text-xs font-bold uppercase tracking-widest text-off-white border border-off-white/50 px-4 py-2 rounded bg-black/40">{ctaLabel}</span>
    </div>
  </div>

  <div class="p-3 flex items-start justify-between gap-2">
    <div class="min-w-0 flex-1">
      <h3 class="card-title font-dm text-sm text-off-white font-medium leading-snug">{displayTitle}</h3>
      {categoryLabel && (
        <span class="font-montserrat text-[0.65rem] text-deep-grey uppercase tracking-wider mt-1 block">{categoryLabel}</span>
      )}
    </div>
    <span class="price-tag text-sm flex-shrink-0">From £{lowestPrice.toFixed(2)}</span>
  </div>
</a>

<style define:vars={{ accent }}>
  .product-card:hover {
    border-color: var(--accent);
    box-shadow: 0 8px 30px color-mix(in srgb, var(--accent) 20%, transparent);
  }
  .card-title {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    word-break: break-word;
  }
</style>
`;

patchFile('src/components/ProductCard.astro', (content) => {
  // Sentinel: presence of "data-character" marks the new character-level card.
  if (content.includes('data-character=')) return null;
  return newProductCard;
});

// ─────────────────────────────────────────────────────────────────────────
// 3. Rewrite src/pages/store/index.astro to use the character-level query
// ─────────────────────────────────────────────────────────────────────────

const newStoreIndex = `---
import BaseLayout from '../../layouts/BaseLayout.astro';
import ProductCard from '../../components/ProductCard.astro';
import { sanityClient } from '../../lib/sanity';
import { allCharactersForListingQuery, allCategoriesQuery } from '../../lib/queries';
import { CATEGORIES, STYLES } from '../../data/products';

let characters: any[] = [];
let categories: any[] = [];
let personalisedRows: any[] = [];
let serviceHeroMap: Record<string, string> = {};

try {
  const [charactersResult, categoriesResult, personalisedResult, servicesResult] = await Promise.all([
    sanityClient.fetch(allCharactersForListingQuery),
    sanityClient.fetch(allCategoriesQuery),
    sanityClient.fetch(\`
      *[_type == "product" && category == "personalised"] | order(title asc) {
        _id,
        title,
        "slug": slug.current,
        category,
        prices,
        accentColor,
        images[] { asset-> { _id, url }, alt }
      }
    \`),
    sanityClient.fetch(\`
      *[_type == "service"]{
        "slug": slug.current,
        "heroUrl": heroImage.asset->url
      }
    \`),
  ]);

  characters = charactersResult || [];
  categories = categoriesResult || [];
  personalisedRows = personalisedResult || [];

  serviceHeroMap = (servicesResult || []).reduce((acc: any, svc: any) => {
    if (svc.slug && svc.heroUrl) acc[svc.slug] = svc.heroUrl;
    return acc;
  }, {});
} catch (e) {
  console.warn('Sanity fetch failed for store page', e);
  categories = CATEGORIES.map((c) => ({ ...c, productCount: 0 }));
}

// Decorate personalised products with their matching service hero image.
personalisedRows = personalisedRows.map((p: any) => {
  if (typeof p.slug === 'string') {
    const svcSlug = p.slug.replace(/^personalised-/, '');
    return { ...p, serviceHeroUrl: serviceHeroMap[svcSlug] || null };
  }
  return p;
});

// One unified list: ~104 characters + ~12 personalised rows.
const listingRows = [...characters, ...personalisedRows];

// Map STYLES[] to short "Option A".."Option J" labels with colour dots.
const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
const optionPills = STYLES.map((s: any, i: number) => ({
  ...s,
  letter: OPTION_LETTERS[i] || s.label,
  shortLabel: \`Option \${OPTION_LETTERS[i] || s.label}\`,
}));
---

<BaseLayout
  title="Shop Wall Art | Pixel8 Multimedia"
  description="Browse 100+ pop culture characters across 10 unique design options and 6 categories. Canvas prints and poster prints made to order in the UK."
>
  <!-- Hero -->
  <section class="bg-bg-secondary py-16 border-b border-edge-line">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center reveal">
      <span class="font-mono text-xs text-pop-orange uppercase tracking-widest">Our Way</span>
      <h1 class="section-heading mt-2 mb-4">Shop</h1>
      <p class="font-dm text-mid-grey text-lg max-w-2xl mx-auto">
        Pop culture wall art across 10 original options. Every piece made to order — poster prints, standard canvas, and gallery canvas.
      </p>
      <div class="flex justify-center gap-4 mt-6 text-sm font-dm text-mid-grey">
        <span><strong class="text-off-white">{characters.length}</strong> Characters</span>
        <span>·</span>
        <span><strong class="text-off-white">10</strong> Options each</span>
        <span>·</span>
        <span><strong class="text-off-white">{categories.length || 6}</strong> Categories</span>
        <span>·</span>
        <span><strong class="text-off-white">3</strong> Formats</span>
      </div>
    </div>
  </section>

  <!-- Filters -->
  <section class="bg-bg-primary border-b border-edge-line sticky top-40 z-30">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-3">
      <div class="flex items-center gap-3 flex-wrap">
        <div class="relative flex-1 min-w-[200px] max-w-[360px]">
          <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-deep-grey pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" id="shop-search" placeholder="Search characters..." autocomplete="off"
            class="w-full pl-9 pr-3 py-2 bg-bg-secondary border border-edge-line rounded-lg text-off-white font-dm text-sm focus:outline-none focus:border-pop-orange transition-colors" />
        </div>
        <select id="shop-sort" class="bg-bg-secondary border border-edge-line rounded-lg text-mid-grey font-dm text-sm px-3 py-2 focus:outline-none focus:border-pop-orange cursor-pointer">
          <option value="default">Sort by</option>
          <option value="title-asc">Name A–Z</option>
          <option value="price-asc">Price: Low → High</option>
          <option value="price-desc">Price: High → Low</option>
        </select>
        <span class="text-xs text-deep-grey font-dm ml-auto" id="product-count">{listingRows.length} characters</span>
      </div>

      <!-- Category pills -->
      <div class="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4" id="category-filters">
        <button class="filter-pill active font-montserrat text-xs font-semibold uppercase tracking-wider px-4 py-2 rounded-full border border-pop-orange text-off-white bg-pop-orange whitespace-nowrap transition-all" data-type="category" data-value="all">All</button>
        {(categories.length > 0 ? categories : CATEGORIES).map((cat: any) => (
          <button class="filter-pill font-montserrat text-xs font-semibold uppercase tracking-wider px-4 py-2 rounded-full border border-edge-line text-mid-grey bg-transparent hover:bg-bg-secondary hover:text-off-white hover:border-pop-orange whitespace-nowrap transition-all" data-type="category" data-value={cat.slug}>
            {cat.name}
          </button>
        ))}
      </div>

      <!-- Option pills -->
      <div class="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4" id="style-filters">
        <button class="filter-pill active font-montserrat text-xs font-semibold uppercase tracking-wider px-4 py-2 rounded-full border border-pop-orange text-off-white bg-pop-orange whitespace-nowrap transition-all" data-type="style" data-value="all">All Options</button>
        {optionPills.map((s: any) => (
          <button class="filter-pill font-montserrat text-xs font-semibold uppercase tracking-wider px-4 py-2 rounded-full border border-edge-line text-mid-grey bg-transparent hover:bg-bg-secondary hover:text-off-white hover:border-pop-orange whitespace-nowrap transition-all flex items-center gap-1.5" data-type="style" data-value={s.value} data-letter={s.letter.toLowerCase()}>
            <span class="w-2 h-2 rounded-full flex-shrink-0" style={\`background:\${s.color}\`}></span>
            {s.shortLabel}
          </button>
        ))}
      </div>
    </div>
  </section>

  <!-- Products Grid -->
  <section class="py-16 bg-bg-primary">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      {listingRows.length > 0 ? (
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6" id="products-grid">
          {listingRows.map((row: any) => (
            <div class="product-grid-item" data-category={row.category} data-variants={(row.variants || []).map((v: any) => v.style).join(',')} data-title={(row.title || '').toLowerCase()} data-price={row.prices?.poster?.small || 9.99}>
              <ProductCard product={row} />
            </div>
          ))}
        </div>
      ) : (
        <div class="text-center py-20">
          <p class="font-montserrat text-xl text-mid-grey">Products coming soon</p>
          <p class="font-dm text-sm text-deep-grey mt-2">We're adding artwork to our collections. Check back soon.</p>
        </div>
      )}
    </div>
  </section>
</BaseLayout>

<script>
  const items = document.querySelectorAll('.product-grid-item');
  const grid = document.getElementById('products-grid');
  const countEl = document.getElementById('product-count');

  let activeCategory = 'all';
  let activeStyle = 'all';

  function activateCategoryTab(value: string) {
    document.querySelectorAll('[data-type="category"]').forEach((b) => {
      b.classList.remove('active', 'bg-pop-orange', 'text-off-white', 'border-pop-orange');
      b.classList.add('bg-transparent', 'text-mid-grey', 'border-edge-line');
    });
    const target = document.querySelector(\`[data-type="category"][data-value="\${value}"]\`);
    if (target) {
      target.classList.add('active', 'bg-pop-orange', 'text-off-white', 'border-pop-orange');
      target.classList.remove('bg-transparent', 'text-mid-grey', 'border-edge-line');
    }
    activeCategory = value;
  }

  function activateStyleTab(value: string) {
    document.querySelectorAll('[data-type="style"]').forEach((b) => {
      b.classList.remove('active', 'bg-pop-orange', 'text-off-white', 'border-pop-orange');
      b.classList.add('bg-transparent', 'text-mid-grey', 'border-edge-line');
    });
    const target = document.querySelector(\`[data-type="style"][data-value="\${value}"]\`);
    if (target) {
      target.classList.add('active', 'bg-pop-orange', 'text-off-white', 'border-pop-orange');
      target.classList.remove('bg-transparent', 'text-mid-grey', 'border-edge-line');
    }
    activeStyle = value;
  }

  function applyFilters() {
    const searchTerm = (document.getElementById('shop-search') as HTMLInputElement)?.value.toLowerCase() || '';
    const sortBy = (document.getElementById('shop-sort') as HTMLSelectElement)?.value || 'default';
    const activeLetter = activeStyle === 'all'
      ? null
      : (document.querySelector(\`[data-type="style"][data-value="\${activeStyle}"]\`) as HTMLElement)?.dataset.letter || null;

    const visible: HTMLElement[] = [];

    items.forEach((item) => {
      const el = item as HTMLElement;
      const cat = el.dataset.category || '';
      const variantsCsv = el.dataset.variants || '';
      const title = el.dataset.title || '';

      const catMatch = activeCategory === 'all' || cat === activeCategory;
      const styleMatch = activeStyle === 'all' || variantsCsv.split(',').includes(activeStyle);
      const searchMatch = !searchTerm || title.includes(searchTerm);

      if (catMatch && styleMatch && searchMatch) {
        el.style.display = '';
        visible.push(el);

        // Rewrite link to /store/<character>?option=<letter> when filtering by Option.
        const anchor = el.querySelector('a.product-card') as HTMLAnchorElement | null;
        const character = anchor?.dataset.character;
        if (anchor && character) {
          if (activeLetter) {
            anchor.href = \`/store/\${character}?option=\${activeLetter}\`;
          } else {
            anchor.href = \`/store/\${character}\`;
          }
        }
      } else {
        el.style.display = 'none';
      }
    });

    if (sortBy === 'price-asc') {
      visible.sort((a, b) => parseFloat(a.dataset.price || '0') - parseFloat(b.dataset.price || '0'));
    } else if (sortBy === 'price-desc') {
      visible.sort((a, b) => parseFloat(b.dataset.price || '0') - parseFloat(a.dataset.price || '0'));
    } else if (sortBy === 'title-asc') {
      visible.sort((a, b) => (a.dataset.title || '').localeCompare(b.dataset.title || ''));
    }

    if (sortBy !== 'default' && grid) {
      visible.forEach((el) => grid.appendChild(el));
    }

    if (countEl) countEl.textContent = \`\${visible.length} character\${visible.length !== 1 ? 's' : ''}\`;
  }

  // Read filter state from URL on page load.
  const params = new URLSearchParams(window.location.search);
  const urlCategory = params.get('category');
  const urlOption = params.get('option') || params.get('style');

  if (urlCategory) activateCategoryTab(urlCategory);
  if (urlOption) activateStyleTab(urlOption);

  applyFilters();

  document.querySelectorAll('[data-type="category"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const value = (btn as HTMLElement).dataset.value || 'all';
      activateCategoryTab(value);
      applyFilters();
      const url = new URL(window.location.href);
      if (value === 'all') url.searchParams.delete('category');
      else url.searchParams.set('category', value);
      history.replaceState(null, '', url.toString());
    });
  });

  document.querySelectorAll('[data-type="style"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const value = (btn as HTMLElement).dataset.value || 'all';
      activateStyleTab(value);
      applyFilters();
      const url = new URL(window.location.href);
      url.searchParams.delete('style');
      if (value === 'all') url.searchParams.delete('option');
      else url.searchParams.set('option', value);
      history.replaceState(null, '', url.toString());
    });
  });

  document.getElementById('shop-search')?.addEventListener('input', applyFilters);
  document.getElementById('shop-sort')?.addEventListener('change', applyFilters);
</script>
`;

patchFile('src/pages/store/index.astro', (content) => {
  // Sentinel: presence of "allCharactersForListingQuery" import marks the new listing.
  if (content.includes('allCharactersForListingQuery')) return null;
  return newStoreIndex;
});

console.log('\nDone.');
