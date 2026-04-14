import { defineType, defineField } from 'sanity';

export default defineType({
  name: 'commission',
  title: 'Commission',
  type: 'document',
  fields: [
    defineField({ name: 'customerName', title: 'Customer Name', type: 'string', validation: (Rule) => Rule.required() }),
    defineField({ name: 'customerEmail', title: 'Customer Email', type: 'string', validation: (Rule) => Rule.required() }),
    defineField({ name: 'customerPhone', title: 'Customer Phone', type: 'string' }),
    defineField({
      name: 'serviceType', title: 'Service Type', type: 'string',
      options: { list: [
        { title: 'Photo Restoration', value: 'photo-restoration' },
        { title: 'Stills to Reels', value: 'stills-to-reels' },
        { title: 'Bespoke Commission', value: 'bespoke' },
      ]},
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'status', title: 'Status', type: 'string',
      options: { list: [
        { title: 'Received', value: 'received' },
        { title: 'Quoted', value: 'quoted' },
        { title: 'In Progress', value: 'in-progress' },
        { title: 'Review', value: 'review' },
        { title: 'Complete', value: 'complete' },
        { title: 'Delivered', value: 'delivered' },
      ], layout: 'radio' },
      initialValue: 'received',
    }),
    defineField({ name: 'brief', title: 'Brief / Description', type: 'text', rows: 6 }),
    defineField({ name: 'referenceImages', title: 'Reference Images', type: 'array', of: [{ type: 'image' }] }),
    defineField({ name: 'preferredStyle', title: 'Preferred Art Style', type: 'string' }),
    defineField({ name: 'preferredFormat', title: 'Preferred Format', type: 'string' }),
    defineField({ name: 'turnaround', title: 'Turnaround', type: 'string' }),
    defineField({ name: 'budgetRange', title: 'Budget Range', type: 'string' }),
    defineField({ name: 'quotedPrice', title: 'Quoted Price (£)', type: 'number' }),
    defineField({ name: 'notes', title: 'Internal Notes', type: 'text', rows: 4 }),
  ],
  preview: {
    select: { title: 'customerName', subtitle: 'serviceType', status: 'status' },
    prepare({ title, subtitle, status }) {
      const emoji = { received: '📥', quoted: '💬', 'in-progress': '🎨', review: '👁️', complete: '✅', delivered: '📦' };
      return { title: `${emoji[status] || ''} ${title}`, subtitle: `${subtitle} — ${status}` };
    },
  },
});
