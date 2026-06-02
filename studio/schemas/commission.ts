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
          { title: 'Shipped', value: 'shipped' },
          { title: 'Delivered', value: 'delivered' },
          { title: 'Refunded', value: 'refunded' },
        ],
        layout: 'radio',
      },
      initialValue: 'pending',
      validation: (Rule) =>
        Rule.custom((status, context) => {
          const doc = context.document as any;
          // H2: completing a digital/both order emails the customer their
          // download link, which needs the file. Block Complete until it's
          // uploaded. Print-only orders have no download, so they're exempt.
          if (
            status === 'complete' &&
            doc?.deliveryType !== 'print' &&
            !doc?.finishedFile?.asset?._ref
          ) {
            return 'Upload a Finished File before setting status to Complete — completing emails the customer their download link.';
          }
          return true;
        }),
    }),
    defineField({
      name: 'notifyError',
      title: 'Notification Error',
      type: 'string',
      group: 'order',
      readOnly: true,
      description:
        'Set automatically if a confirmation or team-notification email failed to send for this order. If populated, the customer may not have received confirmation - follow up manually.',
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
    // Free-text brief (legacy / fallback for services without structured fields)
    defineField({
      name: 'brief',
      title: 'Brief / Description',
      type: 'text',
      group: 'brief',
      rows: 6,
      description: 'Free-text brief — used as a catch-all summary. Structured per-service answers live in "Brief Data" below.',
    }),

    // Structured per-service brief data (Option B — key/value pairs matching the service's briefingFields)
    defineField({
      name: 'briefData',
      title: 'Brief Data (Structured)',
      type: 'array',
      group: 'brief',
      description: 'Per-service brief field answers, populated from the commission workflow on the service page.',
      of: [{
        type: 'object',
        name: 'briefAnswer',
        fields: [
          { name: 'key', title: 'Field Key', type: 'string', readOnly: true },
          { name: 'label', title: 'Label', type: 'string', readOnly: true },
          { name: 'value', title: 'Answer', type: 'text', rows: 2 },
        ],
        preview: {
          select: { title: 'label', subtitle: 'value' },
          prepare({ title, subtitle }) {
            return {
              title: title || 'Unlabelled field',
              subtitle: subtitle ? subtitle.substring(0, 120) : '(empty)',
            };
          },
        },
      }],
    }),

    // Format choice — what the customer ordered (e.g. "digital", "digital+canvasGallery-medium")
    defineField({
      name: 'formatChoice',
      title: 'Format Choice',
      type: 'string',
      group: 'brief',
      readOnly: true,
      description: 'Set by the checkout flow. E.g. "digital", "digital+poster-large", "digital+canvasGallery-medium".',
    }),

    // Legacy compat fields — still populated for backwards compat with old commission docs
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
      name: 'carrier',
      title: 'Carrier',
      type: 'string',
      group: 'delivery',
      options: {
        list: [
          { title: 'Royal Mail', value: 'royalmail' },
          { title: 'Evri', value: 'evri' },
          { title: 'DPD', value: 'dpd' },
          { title: 'UPS', value: 'ups' },
        ],
        layout: 'dropdown',
      },
      description: 'Courier for the physical print. Set this and the tracking number, then change status to "Shipped" to email the customer.',
      hidden: ({ document }) => document?.deliveryType === 'digital',
    }),
    defineField({
      name: 'trackingNumber',
      title: 'Tracking Number',
      type: 'string',
      group: 'delivery',
      hidden: ({ document }) => document?.deliveryType === 'digital',
    }),
    defineField({
      name: 'dispatchedAt',
      title: 'Dispatched At',
      type: 'datetime',
      group: 'delivery',
      readOnly: true,
      description: 'Stamped automatically when the dispatch email is sent. Its presence prevents duplicate dispatch emails.',
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
      name: 'stripeSessionId',
      title: 'Stripe Checkout Session ID',
      type: 'string',
      group: 'payment',
      readOnly: true,
      description: 'Used to look up the order if a webhook fires before payment confirmation arrives.',
    }),
    defineField({
      name: 'amount',
      title: 'Amount Paid (£)',
      type: 'number',
      group: 'payment',
      readOnly: true,
    }),
    defineField({
      name: 'priceBreakdown',
      title: 'Price Breakdown',
      type: 'object',
      group: 'payment',
      readOnly: true,
      description: 'Snapshot of how the total was calculated at checkout time.',
      fields: [
        { name: 'digitalBase', title: 'Digital Base (£)', type: 'number' },
        { name: 'printUpcharge', title: 'Print Upcharge (£)', type: 'number' },
        { name: 'printFormatLabel', title: 'Print Format Label', type: 'string', description: 'E.g. "Canvas Gallery — Medium"' },
        { name: 'total', title: 'Total (£)', type: 'number' },
      ],
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
      notifyError: 'notifyError',
    },
    prepare({ title, customerName, status, service, notifyError }) {
      const emoji: Record<string, string> = {
        pending: '⏳',
        paid: '💷',
        received: '📥',
        quoted: '💬',
        'in-progress': '🎨',
        review: '👁️',
        complete: '✅',
        shipped: '🚚',
        delivered: '📬',
        refunded: '↩️',
      };
      const displayTitle = (notifyError ? '[!] ' : '') + (title || customerName || 'Untitled');
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
