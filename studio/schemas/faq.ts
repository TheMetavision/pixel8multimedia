import { defineType, defineField } from 'sanity';

export default defineType({
  name: 'faq',
  title: 'FAQ',
  type: 'document',
  fields: [
    defineField({ name: 'question', title: 'Question', type: 'string', validation: (Rule) => Rule.required() }),
    defineField({ name: 'answer', title: 'Answer', type: 'text', rows: 4, validation: (Rule) => Rule.required() }),
    defineField({
      name: 'page', title: 'Show On', type: 'string',
      options: { list: [
        { title: 'Store', value: 'store' },
        { title: 'Services', value: 'services' },
        { title: 'Both', value: 'both' },
      ]},
      initialValue: 'both',
    }),
    defineField({ name: 'sortOrder', title: 'Sort Order', type: 'number', initialValue: 0 }),
  ],
  preview: { select: { title: 'question', subtitle: 'page' } },
  orderings: [{ title: 'Sort Order', name: 'sortOrder', by: [{ field: 'sortOrder', direction: 'asc' }] }],
});
