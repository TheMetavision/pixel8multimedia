import { defineType, defineField } from 'sanity';

export default defineType({
  name: 'blogPost',
  title: 'Blog Post',
  type: 'document',
  fields: [
    defineField({ name: 'title', title: 'Title', type: 'string', validation: (Rule) => Rule.required() }),
    defineField({ name: 'slug', title: 'Slug', type: 'slug', options: { source: 'title', maxLength: 96 }, validation: (Rule) => Rule.required() }),
    defineField({ name: 'author', title: 'Author', type: 'string', initialValue: 'Pixel8 Team' }),
    defineField({ name: 'publishedAt', title: 'Published At', type: 'datetime', validation: (Rule) => Rule.required() }),
    defineField({
      name: 'category', title: 'Category', type: 'string',
      options: { list: [
        { title: 'New Drops', value: 'new-drops' },
        { title: 'Behind the Scenes', value: 'behind-the-scenes' },
        { title: 'Style Guides', value: 'style-guides' },
        { title: 'Announcements', value: 'announcements' },
      ]},
    }),
    defineField({ name: 'excerpt', title: 'Excerpt', type: 'text', rows: 3 }),
    defineField({ name: 'mainImage', title: 'Featured Image', type: 'image', options: { hotspot: true }, fields: [{ name: 'alt', title: 'Alt Text', type: 'string' }] }),
    defineField({
      name: 'body', title: 'Body', type: 'array',
      of: [
        { type: 'block', styles: [{ title: 'Normal', value: 'normal' }, { title: 'H2', value: 'h2' }, { title: 'H3', value: 'h3' }, { title: 'Quote', value: 'blockquote' }] },
        { type: 'image', options: { hotspot: true }, fields: [{ name: 'alt', type: 'string', title: 'Alt' }, { name: 'caption', type: 'string', title: 'Caption' }] },
      ],
    }),
    defineField({
      name: 'seo', title: 'SEO', type: 'object',
      fields: [
        { name: 'metaTitle', title: 'Meta Title', type: 'string' },
        { name: 'metaDescription', title: 'Meta Description', type: 'text', rows: 3 },
      ],
      options: { collapsible: true, collapsed: true },
    }),
  ],
  preview: {
    select: { title: 'title', subtitle: 'category', media: 'mainImage' },
  },
  orderings: [
    { title: 'Publish Date', name: 'publishedAtDesc', by: [{ field: 'publishedAt', direction: 'desc' }] },
  ],
});
