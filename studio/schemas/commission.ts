import { defineType, defineField } from 'sanity';

export default defineType({
  name: 'commission',
  title: 'Commission',
  type: 'document',
  groups: [
    { name: 'order', title: 'Order Details', default: true },
    { name: 'brief', title: 'Customer Brief' },
    { name: 'delivery', title: 'Delivery' },
    { name: 'payment', title: 'Payment' },
    { name: 'legacy', title: 'Legacy Fields' },
  ],
  fields: [
    // ── Order Details ──────────────────────────
    defineField({
      name: 'orderRef',
      title: 'Order Reference',
      type: 'string',
      group: 'order',
      readOnly: true,
    }),
    defineField({
      name: 'service',
      title: 'Service',
      type: 'reference',
      to: [{ type: 'service' }],
      group: 'order',
      readOnly: true,
    }),
    defineField({
      name: 'status',
      title: 'Status',
      type: 'string',
      group: 'order',
      options: {
        list: [
          { title: 'Pending Payment', value: 'pending' },
          { title: 'Paid — Awaiting Start', value: 'paid' },
          { title: 'Received (Manual)', value: 'received' },
          { title: 'Quoted', value: 'quoted' },
          { title: 'In Progress', value: 'in-progress' },
          { title: 'Review', value: 'review' },
          { title: 'Complete', value: 'complete' },
          { title: 'Delivered', value: 'delivered' },
          { title: 'Refunded', value: 'refunded' },
        ],
        layout: 'radio',
      },
      initialValue: 'pending',
    }),

    // ── Customer Info ──────────────────────────
    defineField({
      name: 'customerName',
      title: 'Customer Name',
      type: 'string',
      group: 'order',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'customerEmail',
      title: 'Customer Email',
      type: 'string',
      group: 'order',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'customerPhone',
      title: 'Customer Phone',
      type: 'string',
      group: 'order',
    }),

    // ── Customer Brief ─────────────────────────
    defineField({
      name: 'brief',
      title: 'Brief / Description',
      type: 'text',
      group: 'brief',
      rows: 6,
    }),
    defineField({
      name: 'deliveryType',
      title: 'Delivery Type',
      type: 'string',
      group: 'brief',
      options: {
        list: [
          { title: 'Digital Download', value: 'digital' },
          { title: 'Print / Canvas', value: 'print' },
          { title: 'Both', value: 'both' },
        ],
      },
    }),
    defineField({
      name: 'printSize',
      title: 'Print Size',
      type: 'string',
      group: 'brief',
      hidden: ({ document }) =>
        document?.deliveryType !== 'print' && document?.deliveryType !== 'both',
    }),
    defineField({
      name: 'printFormat',
      title: 'Print Format',
      type: 'string',
      group: 'brief',
      options: {
        list: [
          { title: 'Poster', value: 'poster' },
          { title: 'Standard Canvas', value: 'canvas-standard' },
          { title: 'Gallery Canvas', value: 'canvas-gallery' },
        ],
      },
      hidden: ({ document }) =>
        document?.deliveryType !== 'print' && document?.deliveryType !== 'both',
    }),
    defineField({
      name: 'shippingAddress',
      title: 'Shipping Address',
      type: 'text',
      group: 'brief',
      rows: 4,
      hidden: ({ document }) =>
        document?.deliveryType !== 'print' && document?.deliveryType !== 'both',
    }),
    defineField({
      name: 'uploadedFiles',
      title: 'Customer Uploads',
      type: 'array',
      of: [{ type: 'image' }],
      group: 'brief',
    }),

    // ── Delivery ───────────────────────────────
    defineField({
      name: 'finishedFile',
      title: 'Finished File',
      type: 'file',
      group: 'delivery',
      description:
        'Upload the completed work here. When status is set to "complete", the customer receives a secure download link via email.',
    }),
    defineField({
      name: 'internalNotes',
      title: 'Internal Notes',
      type: 'text',
      group: 'delivery',
      rows: 4,
    }),
    defineField({
      name: 'deliveredAt',
      title: 'Delivered At',
      type: 'datetime',
      group: 'delivery',
      readOnly: true,
    }),

    // ── Payment ────────────────────────────────
    defineField({
      name: 'stripePaymentId',
      title: 'Stripe Payment ID',
      type: 'string',
      group: 'payment',
      readOnly: true,
    }),
    defineField({
      name: 'amount',
      title: 'Amount (£)',
      type: 'number',
      group: 'payment',
      readOnly: true,
    }),
    defineField({
      name: 'paidAt',
      title: 'Paid At',
      type: 'datetime',
      group: 'payment',
      readOnly: true,
    }),

    // ── Legacy Fields (kept for backwards compat) ──
    defineField({
      name: 'serviceType',
      title: 'Service Type (Legacy)',
      type: 'string',
      group: 'legacy',
      options: {
        list: [
          { title: 'Photo Restoration', value: 'photo-restoration' },
          { title: 'Stills to Reels', value: 'stills-to-reels' },
          { title: 'Bespoke Commission', value: 'bespoke' },
        ],
      },
    }),
    defineField({
      name: 'referenceImages',
      title: 'Reference Images (Legacy)',
      type: 'array',
      of: [{ type: 'image' }],
      group: 'legacy',
    }),
    defineField({
      name: 'preferredStyle',
      title: 'Preferred Art Style',
      type: 'string',
      group: 'legacy',
    }),
    defineField({
      name: 'preferredFormat',
      title: 'Preferred Format',
      type: 'string',
      group: 'legacy',
    }),
    defineField({
      name: 'turnaround',
      title: 'Turnaround',
      type: 'string',
      group: 'legacy',
    }),
    defineField({
      name: 'budgetRange',
      title: 'Budget Range',
      type: 'string',
      group: 'legacy',
    }),
    defineField({
      name: 'quotedPrice',
      title: 'Quoted Price (£)',
      type: 'number',
      group: 'legacy',
    }),
    defineField({
      name: 'notes',
      title: 'Notes (Legacy)',
      type: 'text',
      group: 'legacy',
      rows: 4,
    }),
  ],

  preview: {
    select: {
      title: 'orderRef',
      customerName: 'customerName',
      status: 'status',
      service: 'service.title',
    },
    prepare({ title, customerName, status, service }) {
      const emoji: Record<string, string> = {
        pending: '⏳',
        paid: '💷',
        received: '📥',
        quoted: '💬',
        'in-progress': '🎨',
        review: '👁️',
        complete: '✅',
        delivered: '📬',
        refunded: '↩️',
      };
      const displayTitle = title || customerName || 'Untitled';
      return {
        title: `${emoji[status || ''] || '❓'} ${displayTitle}`,
        subtitle: `${service || 'Manual commission'} — ${customerName || ''}`,
      };
    },
  },

  orderings: [
    {
      title: 'Newest First',
      name: 'createdDesc',
      by: [{ field: '_createdAt', direction: 'desc' }],
    },
    {
      title: 'Status',
      name: 'statusAsc',
      by: [{ field: 'status', direction: 'asc' }],
    },
  ],
});
