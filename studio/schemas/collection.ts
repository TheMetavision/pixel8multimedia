import { defineType, defineField } from 'sanity';

export default defineType({
  name: 'collection',
  title: 'Collection',
  type: 'document',
  fields: [
    defineField({ name: 'name', title: 'Name', type: 'string', validation: (Rule) => Rule.required() }),
    defineField({ name: 'slug', title: 'Slug', type: 'slug', options: { source: 'name', maxLength: 96 }, validation: (Rule) => Rule.required() }),
    defineField({ name: 'description', title: 'Description', type: 'text', rows: 3 }),
    defineField({ name: 'tagline', title: 'Tagline', type: 'string' }),
    defineField({ name: 'coverImage', title: 'Cover Image', type: 'image', options: { hotspot: true }, fields: [{ name: 'alt', title: 'Alt Text', type: 'string' }] }),
    defineField({ name: 'accentColor', title: 'Accent Colour', type: 'string', description: 'Hex colour (e.g. #00BCD4)' }),
    defineField({ name: 'displayOrder', title: 'Display Order', type: 'number', initialValue: 0 }),
  ],
  preview: {
    select: { title: 'name', subtitle: 'tagline', media: 'coverImage' },
  },
  orderings: [
    { title: 'Display Order', name: 'displayOrder', by: [{ field: 'displayOrder', direction: 'asc' }] },
  ],
});
