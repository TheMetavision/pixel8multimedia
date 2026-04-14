// Pixel8 Multimedia — Product types & pricing

export type ProductFormat = 'poster' | 'canvas-standard' | 'canvas-gallery';
export type ProductSize = 'small' | 'medium' | 'large';

export const FORMAT_LABELS: Record<ProductFormat, string> = {
  poster: 'Poster Print',
  'canvas-standard': 'Canvas (Standard Frame)',
  'canvas-gallery': 'Canvas (Gallery Frame)',
};

export const SIZE_LABELS: Record<ProductSize, string> = {
  small: 'Small (12×8" / 12×12")',
  medium: 'Medium (16×12" / 16×16")',
  large: 'Large (24×16" / 20×20")',
};

export const SIZES: ProductSize[] = ['small', 'medium', 'large'];
export const FORMATS: ProductFormat[] = ['poster', 'canvas-standard', 'canvas-gallery'];

export const PRICES: Record<ProductFormat, Record<ProductSize, number>> = {
  poster: { small: 9.99, medium: 12.99, large: 16.99 },
  'canvas-standard': { small: 27.99, medium: 32.99, large: 44.99 },
  'canvas-gallery': { small: 39.99, medium: 49.99, large: 64.99 },
};

export const COLLECTIONS = [
  { name: 'Neon Glow', slug: 'neon-glow', tagline: 'Electric vibrancy meets pop culture icons', accent: '#00BCD4' },
  { name: 'Minimalist Cool', slug: 'minimalist-cool', tagline: 'Stripped back, maximum impact', accent: '#F5F5F0' },
  { name: 'Retro Vibes', slug: 'retro-vibes', tagline: 'Nostalgia-soaked, era-defining', accent: '#F07828' },
  { name: 'Pixel Art', slug: 'pixel-art', tagline: '8-bit homage to the greats', accent: '#E91E7B' },
  { name: 'Abstract Burst', slug: 'abstract-burst', tagline: 'Colour explosions, no boundaries', accent: '#00BCD4' },
  { name: 'Pop Art', slug: 'pop-art', tagline: 'Bold, brash, beautiful', accent: '#F07828' },
  { name: 'Watercolour', slug: 'watercolour', tagline: 'Soft edges, vivid souls', accent: '#E91E7B' },
  { name: 'Noir', slug: 'noir', tagline: 'Shadow and light, drama and mystery', accent: '#F5F5F0' },
  { name: 'Geometric', slug: 'geometric', tagline: 'Precision meets personality', accent: '#00BCD4' },
  { name: 'Street Art', slug: 'street-art', tagline: 'Raw, urban, unapologetic', accent: '#F07828' },
];

export const COLLECTION_LABELS: Record<string, string> = Object.fromEntries(
  COLLECTIONS.map((c) => [c.slug, c.name])
);
