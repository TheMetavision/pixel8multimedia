import { defineType, defineField } from 'sanity';
// Size and format labels come from the shared print spec, like the site.
import { FORMAT_LABELS, SIZE_DIMENSIONS, SIZE_LABELS } from '../../netlify/functions/_shared/print-spec.mjs';

// Shown on the site as "Option A" … "Option J" (PDP pills, badges, product
// titles, order lines). The stored values stay style-a … style-j.
const OPTION_LETTERS = 'ABCDEFGHIJ'.split('');

export default defineType({
  name: 'product',
  title: 'Product',
  type: 'document',
  fields: [
    defineField({ name: 'title', title: 'Title', type: 'string', validation: (Rule) => Rule.required() }),
    defineField({ name: 'slug', title: 'Slug', type: 'slug', options: { source: 'title', maxLength: 96 }, validation: (Rule) => Rule.required() }),
    defineField({
      name: 'category',
      title: 'Category',
      type: 'string',
      options: {
        list: [
          { title: 'Animations', value: 'animations' },
          { title: 'Music', value: 'music' },
          { title: 'TV / Movies', value: 'tv-movies' },
          { title: 'Sport', value: 'sport' },
          { title: 'Miscellaneous', value: 'miscellaneous' },
          { title: 'Personalised', value: 'personalised' },
        ],
        layout: 'dropdown',
      },
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'style',
      title: 'Style',
      type: 'string',
      options: {
        list: OPTION_LETTERS.map((l) => ({ title: `Option ${l}`, value: `style-${l.toLowerCase()}` })),
        layout: 'dropdown',
      },
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'description',
      title: 'Description',
      type: 'array',
      of: [{ type: 'block' }],
    }),
    defineField({
      name: 'images',
      title: 'Product Images',
      type: 'array',
      of: [{ type: 'image', options: { hotspot: true }, fields: [{ name: 'alt', title: 'Alt Text', type: 'string' }] }],
      validation: (Rule) => Rule.min(1).error('At least one image is required'),
    }),
    defineField({
      name: 'printFile',
      title: 'High-Res Print File',
      type: 'file',
      description: 'Production-quality file for printing. Not shown on frontend.',
    }),
    defineField({
      name: 'prices',
      title: 'Pricing',
      type: 'object',
      fields: [
        defineField({
          name: 'poster',
          title: FORMAT_LABELS.poster,
          type: 'object',
          fields: [
            { name: 'small', title: SIZE_LABELS.small, type: 'number', initialValue: 9.99 },
            { name: 'medium', title: SIZE_LABELS.medium, type: 'number', initialValue: 12.99 },
            { name: 'large', title: SIZE_LABELS.large, type: 'number', initialValue: 16.99 },
          ],
        }),
        defineField({
          name: 'canvasStandard',
          title: FORMAT_LABELS.canvasStandard,
          type: 'object',
          fields: [
            { name: 'small', title: SIZE_LABELS.small, type: 'number', initialValue: 27.99 },
            { name: 'medium', title: SIZE_LABELS.medium, type: 'number', initialValue: 32.99 },
            { name: 'large', title: SIZE_LABELS.large, type: 'number', initialValue: 44.99 },
          ],
        }),
        defineField({
          name: 'canvasGallery',
          title: FORMAT_LABELS.canvasGallery,
          type: 'object',
          fields: [
            { name: 'small', title: SIZE_LABELS.small, type: 'number', initialValue: 29.99 },
            { name: 'medium', title: SIZE_LABELS.medium, type: 'number', initialValue: 35.99 },
            { name: 'large', title: SIZE_LABELS.large, type: 'number', initialValue: 47.99 },
          ],
        }),
      ],
    }),
    defineField({
      name: 'sizes',
      title: 'Available Sizes',
      type: 'object',
      fields: [
        { name: 'small', title: SIZE_LABELS.small, type: 'string', initialValue: SIZE_DIMENSIONS.small },
        { name: 'medium', title: SIZE_LABELS.medium, type: 'string', initialValue: SIZE_DIMENSIONS.medium },
        { name: 'large', title: SIZE_LABELS.large, type: 'string', initialValue: SIZE_DIMENSIONS.large },
      ],
    }),
    defineField({
      name: 'personalisationFee',
      title: 'Personalisation Fee',
      type: 'number',
      description: 'Extra charge for personalised products (£)',
      hidden: ({ document }) => document?.category !== 'personalised',
    }),
    defineField({
      name: 'stripePriceIds',
      title: 'Stripe Price IDs',
      type: 'object',
      description: 'Map each format+size to a Stripe Price ID',
      options: { collapsible: true, collapsed: true },
      fields: [
        { name: 'posterSmall', title: 'Poster Small', type: 'string' },
        { name: 'posterMedium', title: 'Poster Medium', type: 'string' },
        { name: 'posterLarge', title: 'Poster Large', type: 'string' },
        { name: 'canvasStdSmall', title: 'Canvas Std Small', type: 'string' },
        { name: 'canvasStdMedium', title: 'Canvas Std Medium', type: 'string' },
        { name: 'canvasStdLarge', title: 'Canvas Std Large', type: 'string' },
        { name: 'canvasGalSmall', title: 'Canvas Gal Small', type: 'string' },
        { name: 'canvasGalMedium', title: 'Canvas Gal Medium', type: 'string' },
        { name: 'canvasGalLarge', title: 'Canvas Gal Large', type: 'string' },
      ],
    }),
    defineField({
      name: 'orientation',
      title: 'Orientation',
      type: 'string',
      options: {
        list: [
          { title: 'Portrait (3:4)', value: 'portrait' },
          { title: 'Landscape (4:3)', value: 'landscape' },
          { title: 'Square (1:1)', value: 'square' },
        ],
        layout: 'radio',
      },
      initialValue: 'portrait',
    }),
    defineField({
      name: 'tags',
      title: 'Tags',
      type: 'array',
      of: [{ type: 'string' }],
      options: { layout: 'tags' },
    }),
    defineField({ name: 'featured', title: 'Featured Product', type: 'boolean', initialValue: false }),
    defineField({ name: 'sortOrder', title: 'Sort Order', type: 'number', initialValue: 0 }),
    defineField({ name: 'accentColor', title: 'Accent Colour', type: 'string', description: 'Hex colour for hover effects' }),
    defineField({
      name: 'seo',
      title: 'SEO',
      type: 'object',
      fields: [
        { name: 'metaTitle', title: 'Meta Title', type: 'string' },
        { name: 'metaDescription', title: 'Meta Description', type: 'text', rows: 3 },
      ],
      options: { collapsible: true, collapsed: true },
    }),
  ],
  preview: {
    select: { title: 'title', category: 'category', style: 'style', media: 'images.0' },
    prepare({ title, category, style, media }) {
      const catLabels: Record<string, string> = {
        animations: 'Animations', music: 'Music', 'tv-movies': 'TV/Movies',
        sport: 'Sport', miscellaneous: 'Misc', personalised: 'Personalised',
      };
      const styleLabels: Record<string, string> = Object.fromEntries(
        OPTION_LETTERS.map((l) => [`style-${l.toLowerCase()}`, `Option ${l}`]),
      );
      return {
        title,
        subtitle: `${catLabels[category] || category || '?'} · ${styleLabels[style] || style || '?'}`,
        media,
      };
    },
  },
  orderings: [
    { title: 'Sort Order', name: 'sortOrderAsc', by: [{ field: 'sortOrder', direction: 'asc' }] },
    { title: 'Title A–Z', name: 'titleAsc', by: [{ field: 'title', direction: 'asc' }] },
    { title: 'Category', name: 'category', by: [{ field: 'category', direction: 'asc' }] },
    { title: 'Style', name: 'style', by: [{ field: 'style', direction: 'asc' }] },
  ],
});
