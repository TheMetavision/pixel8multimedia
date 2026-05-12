// Pixel8 Multimedia — Product types, pricing & metadata

export type ProductFormat = 'poster' | 'canvasStandard' | 'canvasGallery';
export type ProductSize = 'small' | 'medium' | 'large';

export const FORMAT_LABELS: Record<ProductFormat, string> = {
  poster: 'Poster Print',
  canvasStandard: 'Canvas (Standard Frame)',
  canvasGallery: 'Canvas (Gallery Frame)',
};

export const SIZE_LABELS: Record<ProductSize, string> = {
  small: 'Small (12×8" / 12×12")',
  medium: 'Medium (16×12" / 16×16")',
  large: 'Large (24×16" / 20×20")',
};

export const SIZES: ProductSize[] = ['small', 'medium', 'large'];
export const FORMATS: ProductFormat[] = ['poster', 'canvasStandard', 'canvasGallery'];

// Keys match Sanity product.prices field names
export const PRICES: Record<ProductFormat, Record<ProductSize, number>> = {
  poster:          { small: 9.99,  medium: 12.99, large: 16.99 },
  canvasStandard:  { small: 27.99, medium: 32.99, large: 44.99 },
  canvasGallery:   { small: 29.99, medium: 35.99, large: 47.99 },
};

// ── Categories ──────────────────────────────────────────

export const CATEGORIES = [
  { name: 'Animations',    slug: 'animations',    tagline: 'Toons with attitude',          accent: '#FF6B35' },
  { name: 'Music',         slug: 'music',         tagline: 'Icons that hit different',      accent: '#FF00FF' },
  { name: 'TV / Movies',   slug: 'tv-movies',     tagline: 'From screen to scene',          accent: '#00E5FF' },
  { name: 'Sport',         slug: 'sport',         tagline: 'Legends never retire',           accent: '#FFD600' },
  { name: 'Miscellaneous', slug: 'miscellaneous', tagline: "The ones that don't fit the box", accent: '#7C4DFF' },
  { name: 'Personalised',  slug: 'personalised',  tagline: 'Your story, your style',         accent: '#76FF03' },
];

export const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.slug, c.name])
);

// ── Styles ──────────────────────────────────────────────

export const STYLES = [
  { value: 'style-a', label: 'Option A', color: '#FF00FF' },
  { value: 'style-b', label: 'Option B', color: '#E0E0E0' },
  { value: 'style-c', label: 'Option C', color: '#FF6B35' },
  { value: 'style-d', label: 'Option D', color: '#00E5FF' },
  { value: 'style-e', label: 'Option E', color: '#FFD600' },
  { value: 'style-f', label: 'Option F', color: '#FF1744' },
  { value: 'style-g', label: 'Option G', color: '#81D4FA' },
  { value: 'style-h', label: 'Option H', color: '#424242' },
  { value: 'style-i', label: 'Option I', color: '#7C4DFF' },
  { value: 'style-j', label: 'Option J', color: '#76FF03' },
] as const;

export const STYLE_LABELS: Record<string, string> = Object.fromEntries(
  STYLES.map((s) => [s.value, s.label])
);
