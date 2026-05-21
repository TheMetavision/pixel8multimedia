import { defineType, defineField } from 'sanity';

// Category values match those already in the database (see existing FAQs).
// 'custom-services' is the bucket for service-specific FAQs — those should
// ALSO set the `service` reference so they render under the right service
// heading on /faqs and appear on /services/[slug].
const CATEGORIES = [
  { title: 'Ordering', value: 'ordering' },
  { title: 'Product Info', value: 'product-info' },
  { title: 'Shipping', value: 'shipping' },
  { title: 'Returns', value: 'returns' },
  { title: 'Custom Services', value: 'custom-services' },
] as const;

export default defineType({
  name: 'faq',
  title: 'FAQ',
  type: 'document',
  fields: [
    defineField({
      name: 'question',
      title: 'Question',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'answer',
      title: 'Answer',
      type: 'text',
      rows: 6,
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'category',
      title: 'Category',
      type: 'string',
      options: { list: [...CATEGORIES] },
      initialValue: 'ordering',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'service',
      title: 'Service',
      description:
        'Only set this for service-specific FAQs (category = Custom Services). ' +
        'It links the FAQ to a specific service so it shows on that service page and ' +
        'groups under the service heading on the main FAQ page. Leave empty for ' +
        'general "Custom Services" FAQs that apply across all services.',
      type: 'reference',
      to: [{ type: 'service' }],
      hidden: ({ document }) => document?.category !== 'custom-services',
    }),
    defineField({
      name: 'displayOrder',
      title: 'Display Order',
      description:
        'Lower numbers display first within the same category/service group. ' +
        'Use multiples of 10 (10, 20, 30) so you can insert new items between later.',
      type: 'number',
      initialValue: 100,
    }),
  ],
  preview: {
    select: {
      title: 'question',
      category: 'category',
      serviceTitle: 'service.title',
    },
    prepare({ title, category, serviceTitle }) {
      const subtitle = serviceTitle
        ? `${category} → ${serviceTitle}`
        : category;
      return { title, subtitle };
    },
  },
  orderings: [
    {
      title: 'Category, then Display Order',
      name: 'categoryDisplayOrder',
      by: [
        { field: 'category', direction: 'asc' },
        { field: 'displayOrder', direction: 'asc' },
      ],
    },
    {
      title: 'Display Order',
      name: 'displayOrder',
      by: [{ field: 'displayOrder', direction: 'asc' }],
    },
  ],
});
