import { defineType, defineField } from 'sanity';

export default defineType({
  name: 'service',
  title: 'Service',
  type: 'document',
  fields: [
    defineField({ name: 'title', title: 'Title', type: 'string', validation: (Rule) => Rule.required() }),
    defineField({ name: 'slug', title: 'Slug', type: 'slug', options: { source: 'title', maxLength: 96 }, validation: (Rule) => Rule.required() }),
    defineField({ name: 'description', title: 'Description', type: 'text', rows: 4, description: 'Main intro paragraph shown below the title' }),
    defineField({ name: 'extendedDescription', title: 'Extended Description', type: 'text', rows: 4, description: 'Optional additional paragraphs (e.g. for The Day I Met... disclaimer)' }),

    // Gallery Examples
    defineField({
      name: 'examples',
      title: 'Gallery Examples',
      type: 'array',
      of: [{
        type: 'object',
        title: 'Example',
        fields: [
          { name: 'label', title: 'Label', type: 'string', description: 'E.g. "Example 1" or a name' },
          {
            name: 'images',
            title: 'Images (Original → Transformed)',
            type: 'array',
            of: [{
              type: 'object',
              fields: [
                { name: 'image', title: 'Image', type: 'image', options: { hotspot: true } },
                { name: 'tag', title: 'Tag', type: 'string', description: 'E.g. "Original", "Digital Still", "The Simpsons", "1950s"' },
              ],
              preview: {
                select: { title: 'tag', media: 'image' },
              },
            }],
          },
          {
            name: 'videos',
            title: 'YouTube Videos',
            type: 'array',
            of: [{
              type: 'object',
              fields: [
                { name: 'youtubeId', title: 'YouTube Video ID', type: 'string', description: 'The part after watch?v=' },
                { name: 'tag', title: 'Tag', type: 'string', description: 'E.g. "Animation with Background Music", "Animation with V/O"' },
                { name: 'title', title: 'Video Title', type: 'string' },
              ],
            }],
          },
          {
            name: 'audioTracks',
            title: 'Audio Tracks (for Your Song Your Story)',
            type: 'array',
            of: [{
              type: 'object',
              fields: [
                { name: 'title', title: 'Track Title', type: 'string' },
                { name: 'coverImage', title: 'Cover Art', type: 'image' },
                { name: 'audioFile', title: 'Audio File', type: 'file' },
                { name: 'duration', title: 'Duration', type: 'string', description: 'E.g. "4:59"' },
              ],
            }],
          },
        ],
        preview: {
          select: { title: 'label' },
        },
      }],
    }),

    // How It Works steps
    defineField({
      name: 'steps',
      title: 'How It Works Steps',
      type: 'array',
      of: [{
        type: 'object',
        fields: [
          { name: 'text', title: 'Step Text', type: 'string' },
        ],
        preview: {
          select: { title: 'text' },
        },
      }],
    }),

    // Important Note (optional disclaimer)
    defineField({ name: 'importantNote', title: 'Important Note', type: 'text', rows: 3, description: 'Optional disclaimer shown after How It Works (e.g. fictional images note)' }),

    // Order options
    defineField({ name: 'hasDigitalDelivery', title: 'Show Digital Delivery Order Link', type: 'boolean', initialValue: true }),
    defineField({ name: 'hasPrintOrder', title: 'Show Poster/Canvas Order Link', type: 'boolean', initialValue: true }),
    defineField({ name: 'hasFileUpload', title: 'Show Upload Files Button', type: 'boolean', initialValue: true }),

    // Ordering
    defineField({ name: 'sortOrder', title: 'Sort Order', type: 'number', initialValue: 0, description: 'Lower numbers appear first in nav and on services page' }),
  ],
  preview: {
    select: { title: 'title', subtitle: 'description', order: 'sortOrder' },
    prepare({ title, subtitle, order }) {
      return { title: `${order ?? 0}. ${title}`, subtitle: subtitle?.substring(0, 80) };
    },
  },
  orderings: [
    { title: 'Sort Order', name: 'sortOrderAsc', by: [{ field: 'sortOrder', direction: 'asc' }] },
  ],
});
