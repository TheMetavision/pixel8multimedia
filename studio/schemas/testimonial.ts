import { defineType, defineField } from 'sanity';

export default defineType({
  name: 'testimonial',
  title: 'Testimonial',
  type: 'document',
  fields: [
    defineField({ name: 'customerName', title: 'Customer Name', type: 'string', validation: (Rule) => Rule.required() }),
    defineField({ name: 'location', title: 'Location', type: 'string' }),
    defineField({ name: 'rating', title: 'Rating (1-5)', type: 'number', validation: (Rule) => Rule.min(1).max(5) }),
    defineField({ name: 'quote', title: 'Quote', type: 'text', rows: 3, validation: (Rule) => Rule.required() }),
    defineField({ name: 'product', title: 'Product / Service', type: 'string' }),
    defineField({ name: 'featured', title: 'Featured', type: 'boolean', initialValue: false }),
  ],
  preview: {
    select: { title: 'customerName', subtitle: 'quote' },
  },
});
