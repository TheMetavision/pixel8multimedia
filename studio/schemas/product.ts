import { defineType, defineField } from 'sanity';

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
        list: [
          { title: 'Style A — Neon Glow', value: 'style-a' },
          { title: 'Style B — Minimalist Cool', value: 'style-b' },
          { title: 'Style C — Retro Vibes', value: 'style-c' },
          { title: 'Style D — Pixel Art', value: 'style-d' },
          { title: 'Style E — Abstract Burst', value: 'style-e' },
          { title: 'Style F — Pop Art', value: 'style-f' },
          { title: 'Style G — Watercolour', value: 'style-g' },
          { title: 'Style H — Noir', value: 'style-h' },
          { title: 'Style I — Geometric', value: 'style-i' },
          { title: 'Style J — Street Art', value: 'style-j' },
        ],
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
          title: 'Poster Print',
          type: 'object',
          fields: [
            { name: 'small', title: 'Small', type: 'number', initialValue: 9.99 },
            { name: 'medium', title: 'Medium', type: 'number', initialValue: 12.99 },
            { name: 'large', title: 'Large', type: 'number', initialValue: 16.99 },
          ],
        }),
        defineField({
          name: 'canvasStandard',
          title: 'Canvas — Standard Frame',
          type: 'object',
          fields: [
            { name: 'small', title: 'Small', type: 'number', initialValue: 27.99 },
            { name: 'medium', title: 'Medium', type: 'number', initialValue: 32.99 },
            { name: 'large', title: 'Large', type: 'number', initialValue: 44.99 },
          ],
        }),
        defineField({
          name: 'canvasGallery',
          title: 'Canvas — Gallery Frame',
          type: 'object',
          fields: [
            { name: 'small', title: 'Small', type: 'number', initialValue: 29.99 },
            { name: 'medium', title: 'Medium', type: 'number', initialValue: 35.99 },
            { name: 'large', title: 'Large', type: 'number', initialValue: 47.99 },
          ],
        }),
      ],
    }),
    defineField({
      name: 'sizes',
      title: 'Available Sizes',
      type: 'object',
      fields: [
        { name: 'small', title: 'Small', type: 'string', initialValue: '12x8' },
        { name: 'medium', title: 'Medium', type: 'string', initialValue: '16x12' },
        { name: 'large', title: 'Large', type: 'string', initialValue: '24x16' },
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
      const styleLabels: Record<string, string> = {
        'style-a': 'Neon Glow', 'style-b': 'Minimalist', 'style-c': 'Retro',
        'style-d': 'Pixel Art', 'style-e': 'Abstract', 'style-f': 'Pop Art',
        'style-g': 'Watercolour', 'style-h': 'Noir', 'style-i': 'Geometric', 'style-j': 'Street Art',
      };
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
