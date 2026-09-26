import { defineType, defineField } from 'sanity';

export default defineType({
  name: 'order',
  title: 'Order',
  type: 'document',
  fields: [
    defineField({ name: 'stripeSessionId', title: 'Stripe Session ID', type: 'string', readOnly: true }),
    defineField({ name: 'stripePaymentId', title: 'Stripe Payment ID', type: 'string', readOnly: true }),
    defineField({ name: 'customerName', title: 'Customer Name', type: 'string' }),
    defineField({ name: 'customerEmail', title: 'Customer Email', type: 'string' }),
    defineField({
      name: 'shippingAddress',
      title: 'Shipping Address',
      type: 'object',
      fields: [
        { name: 'line1', title: 'Line 1', type: 'string' },
        { name: 'line2', title: 'Line 2', type: 'string' },
        { name: 'city', title: 'City', type: 'string' },
        { name: 'county', title: 'County/State', type: 'string' },
        { name: 'postcode', title: 'Postcode', type: 'string' },
        { name: 'country', title: 'Country', type: 'string' },
      ],
    }),
    defineField({
      name: 'lineItems',
      title: 'Order Items',
      type: 'array',
      of: [{
        type: 'object',
        fields: [
          { name: 'productTitle', title: 'Product', type: 'string' },
          { name: 'format', title: 'Format', type: 'string' },
          { name: 'size', title: 'Size', type: 'string' },
          { name: 'quantity', title: 'Qty', type: 'number' },
          { name: 'unitPrice', title: 'Unit Price (£)', type: 'number' },
          { name: 'personalisationId', title: 'Personalisation ID', type: 'string', readOnly: true },
          { name: 'styleKey', title: 'Style', type: 'string', readOnly: true },
          // Keys, stamped by the webhook on lines from the server-priced
          // checkout. Older lines don't have them — that's expected.
          { name: 'productRef', title: 'Product', type: 'reference', to: [{ type: 'product' }], weak: true, readOnly: true },
          { name: 'productSlug', title: 'Product slug', type: 'string', readOnly: true },
          { name: 'formatKey', title: 'Format key', type: 'string', readOnly: true },
          { name: 'sizeKey', title: 'Size key', type: 'string', readOnly: true },
          { name: 'styleLetter', title: 'Style letter', type: 'string', readOnly: true },
          // An image field, not a reference: sanity.imageAsset isn't a schema
          // type a reference can target ("Unknown type"), and this way Studio
          // shows the listing image as a thumbnail on the line.
          { name: 'listingImageRef', title: 'Listing image (at time of order)', type: 'image', readOnly: true },
        ],
        preview: {
          select: { title: 'productTitle', quantity: 'quantity', unitPrice: 'unitPrice' },
          prepare({ title, quantity, unitPrice }) {
            return { title: `${title} × ${quantity}`, subtitle: `£${((unitPrice || 0) * (quantity || 0)).toFixed(2)}` };
          },
        },
      }],
    }),
    defineField({ name: 'totalAmount', title: 'Total (£)', type: 'number', readOnly: true }),
    defineField({
      name: 'status',
      title: 'Status',
      type: 'string',
      options: {
        list: [
          { title: 'Received', value: 'received' },
          { title: 'In Production', value: 'in-production' },
          { title: 'Dispatched', value: 'dispatched' },
          { title: 'Delivered', value: 'delivered' },
          { title: 'Refunded', value: 'refunded' },
        ],
        layout: 'radio',
      },
      initialValue: 'received',
    }),
    defineField({ name: 'trackingNumber', title: 'Tracking Number', type: 'string' }),
    defineField({ name: 'notes', title: 'Internal Notes', type: 'text', rows: 3 }),
    defineField({ name: 'createdAt', title: 'Created At', type: 'datetime', readOnly: true }),
    // Pre-migration _id, set by tools/migrate-private-ids.mjs.
    defineField({ name: 'legacyId', title: 'Legacy ID', type: 'string', readOnly: true, hidden: true }),
  ],
  preview: {
    select: { title: 'customerName', status: 'status', total: 'totalAmount', createdAt: 'createdAt' },
    prepare({ title, status, total, createdAt }) {
      const emoji = { received: '📥', 'in-production': '🖨️', dispatched: '📦', delivered: '✅', refunded: '↩️' };
      return {
        title: `${emoji[status] || ''} ${title || 'Unknown'}`,
        subtitle: `£${(total || 0).toFixed(2)} — ${status} — ${createdAt ? new Date(createdAt).toLocaleDateString('en-GB') : ''}`,
      };
    },
  },
  orderings: [
    { title: 'Newest', name: 'newest', by: [{ field: 'createdAt', direction: 'desc' }] },
  ],
});
