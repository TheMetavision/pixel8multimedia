import { defineType, defineField } from 'sanity';

export default defineType({
  name: 'product',
  title: 'Product',
  type: 'document',
  fields: [
    defineField({ name: 'title', title: 'Title', type: 'string', validation: (Rule) => Rule.required() }),
    defineField({ name: 'slug', title: 'Slug', type: 'slug', options: { source: 'title', maxLength: 96 }, validation: (Rule) => Rule.required() }),
    defineField({
      name: 'collection',
      title: 'Collection',
      type: 'reference',
      to: [{ type: 'collection' }],
      validation: (Rule) => Rule.required(),
    }),
    defineField({ name: 'description', title: 'Description', type: 'text', rows: 4 }),
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
      description: 'e.g. film, music, sport, iconic, legend',
    }),
    defineField({ name: 'featured', title: 'Featured Product', type: 'boolean', initialValue: false }),
    defineField({ name: 'sortOrder', title: 'Sort Order', type: 'number', initialValue: 0 }),
    defineField({
      name: 'seo',
      title: 'SEO',
      type: 'object',
      fields: [
        { name: 'metaTitle', title: 'Meta Title', type: 'string' },
        { name: 'metaDescription', title: 'Meta Description', type: 'text', rows: 3 },
        { name: 'ogImage', title: 'Open Graph Image', type: 'image' },
      ],
      options: { collapsible: true, collapsed: true },
    }),
  ],
  preview: {
    select: { title: 'title', subtitle: 'collection.name', media: 'images.0' },
  },
  orderings: [
    { title: 'Sort Order', name: 'sortOrderAsc', by: [{ field: 'sortOrder', direction: 'asc' }] },
    { title: 'Title A-Z', name: 'titleAsc', by: [{ field: 'title', direction: 'asc' }] },
  ],
});
