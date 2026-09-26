import { defineType, defineField } from 'sanity';

// One customer session in the "Your Photo" builder, from first upload through
// print. The images themselves live in Netlify Blobs under
// personalisation/<id>/ — this document holds the keys, the state, and the
// audit trail. Created by the upload function; advanced by the styling,
// checkout, proof and approval steps; swept by the retention job.
//
// Status flow:
//   uploaded → styling → ready → (paid) → proof-sent → approved → printed
//                    ↘ failed                                  ↘ expired
export default defineType({
  name: 'pendingPersonalisation',
  title: 'Personalisation',
  type: 'document',
  fields: [
    defineField({ name: 'pid', title: 'Personalisation ID', type: 'string', readOnly: true, validation: (R) => R.required() }),
    defineField({
      name: 'status',
      title: 'Status',
      type: 'string',
      options: {
        list: [
          { title: 'Uploaded', value: 'uploaded' },
          { title: 'Styling', value: 'styling' },
          { title: 'Ready (preview)', value: 'ready' },
          { title: 'Failed', value: 'failed' },
          { title: 'Paid — awaiting proof', value: 'paid' },
          { title: 'Proof sent', value: 'proof-sent' },
          { title: 'Approved — ready to print', value: 'approved' },
          { title: 'Printed', value: 'printed' },
          { title: 'Expired', value: 'expired' },
        ],
        layout: 'radio',
      },
      initialValue: 'uploaded',
    }),

    // ── Source photo ──────────────────────────────────────────────
    defineField({ name: 'photoKey', title: 'Original photo (blob key)', type: 'string', readOnly: true }),
    defineField({ name: 'photoSha256', title: 'Photo SHA-256', type: 'string', readOnly: true, description: 'Dedupe: same photo + same style is served from cache, not re-generated.' }),
    defineField({
      name: 'crop',
      title: 'Crop (square)',
      type: 'object',
      readOnly: true,
      fields: [
        { name: 'x', type: 'number', title: 'X' },
        { name: 'y', type: 'number', title: 'Y' },
        { name: 'size', type: 'number', title: 'Size' },
      ],
    }),

    // ── Styled previews (one entry per style the customer tried) ──
    defineField({
      name: 'renders',
      title: 'Styled renders',
      type: 'array',
      readOnly: true,
      of: [{
        type: 'object',
        fields: [
          { name: 'styleKey', title: 'Style', type: 'string' },
          { name: 'blobKey', title: 'Blob key (2K)', type: 'string' },
          { name: 'model', title: 'Model', type: 'string' },
          { name: 'ms', title: 'Generation ms', type: 'number' },
          { name: 'createdAt', title: 'Created', type: 'datetime' },
          { name: 'error', title: 'Error', type: 'string' },
        ],
        preview: {
          select: { styleKey: 'styleKey', ms: 'ms', error: 'error' },
          prepare({ styleKey, ms, error }) {
            return { title: styleKey, subtitle: error ? `✗ ${error}` : `${ms} ms` };
          },
        },
      }],
    }),
    defineField({ name: 'selectedStyleKey', title: 'Selected style', type: 'string' }),
    defineField({ name: 'callsUsed', title: 'Generation calls used', type: 'number', initialValue: 0, readOnly: true }),
    defineField({ name: 'switchesUsed', title: 'Style switches used', type: 'number', initialValue: 0, readOnly: true }),
    defineField({ name: 'failCode', title: 'Failure code', type: 'string', readOnly: true }),
    defineField({ name: 'failMessage', title: 'Failure message (shown to customer)', type: 'string', readOnly: true }),
    defineField({ name: 'purgedAt', title: 'Images purged', type: 'datetime', readOnly: true }),

    // ── Consent ───────────────────────────────────────────────────
    defineField({ name: 'consentAt', title: 'Consent given at', type: 'datetime', readOnly: true }),
    defineField({ name: 'consentVersion', title: 'Consent text version', type: 'string', readOnly: true }),
    defineField({ name: 'ipHash', title: 'IP hash', type: 'string', readOnly: true, description: 'Salted hash, for abuse caps only.' }),

    // ── Order ─────────────────────────────────────────────────────
    defineField({ name: 'order', title: 'Order', type: 'reference', to: [{ type: 'order' }] }),
    defineField({ name: 'customerEmail', title: 'Customer email', type: 'string' }),
    defineField({ name: 'format', title: 'Format (first line ordered)', type: 'string', readOnly: true }),
    defineField({ name: 'size', title: 'Size (first line ordered)', type: 'string', readOnly: true }),
    // Every order line for this design — the same design can be ordered in
    // several formats/sizes, or again later. Appended by the Stripe webhook.
    defineField({
      name: 'orderedLines',
      title: 'Ordered lines',
      type: 'array',
      readOnly: true,
      of: [{
        type: 'object',
        fields: [
          { name: 'orderId', title: 'Order _id', type: 'string' },
          { name: 'styleKey', title: 'Style', type: 'string' },
          { name: 'formatKey', title: 'Format', type: 'string' },
          { name: 'sizeKey', title: 'Size', type: 'string' },
          { name: 'quantity', title: 'Qty', type: 'number' },
        ],
        preview: {
          select: { f: 'formatKey', s: 'sizeKey', q: 'quantity', o: 'orderId' },
          prepare: ({ f, s, q, o }) => ({ title: `${f} · ${s} × ${q}`, subtitle: o }),
        },
      }],
    }),
    defineField({ name: 'digitalBundle', title: 'Digital bundle purchased', type: 'boolean', initialValue: false }),

    // ── Proof / approval / print ──────────────────────────────────
    defineField({ name: 'proofToken', title: 'Proof approve token', type: 'string', readOnly: true, hidden: true }),
    defineField({ name: 'proofSentAt', title: 'Proof sent', type: 'datetime', readOnly: true }),
    defineField({ name: 'approvedAt', title: 'Approved', type: 'datetime', readOnly: true }),
    defineField({ name: 'printKey', title: 'Print file (blob key, 4K)', type: 'string', readOnly: true }),
    defineField({ name: 'printPx', title: 'Print file size (px)', type: 'number', readOnly: true }),
    defineField({ name: 'printWrapColour', title: 'Canvas wrap colour', type: 'string', readOnly: true }),
    defineField({ name: 'printMethod', title: 'Upscale method', type: 'string', readOnly: true }),
    defineField({ name: 'printBuiltAt', title: 'Print file built', type: 'datetime', readOnly: true }),
    defineField({ name: 'printError', title: 'Print build error', type: 'string', readOnly: true }),
    // Set when a trigger could not start its function after retries; cleared
    // when that step later succeeds. Listed under Personalisation → Needs attention.
    defineField({ name: 'printTriggerError', title: 'Print build did not start', type: 'string', readOnly: true }),
    defineField({ name: 'proofTriggerError', title: 'Proof email did not send', type: 'string', readOnly: true }),
    defineField({ name: 'proofKey', title: 'Proof image (blob key)', type: 'string', readOnly: true }),
    defineField({ name: 'printedAt', title: 'Printed', type: 'datetime' }),

    defineField({ name: 'expiresAt', title: 'Expires', type: 'datetime', readOnly: true, description: 'Unpaid sessions and their blobs are swept after this.' }),
    defineField({ name: 'notes', title: 'Internal notes', type: 'text', rows: 3 }),
    defineField({ name: 'createdAt', title: 'Created', type: 'datetime', readOnly: true }),
  ],
  preview: {
    select: { pid: 'pid', status: 'status', style: 'selectedStyleKey', email: 'customerEmail', createdAt: 'createdAt' },
    prepare({ pid, status, style, email, createdAt }) {
      const icon: Record<string, string> = {
        uploaded: '⬆️', styling: '🎨', ready: '👀', failed: '⚠️', paid: '💳',
        'proof-sent': '✉️', approved: '✅', printed: '🖨️', expired: '🗑️',
      };
      return {
        title: `${icon[status] || ''} ${email || pid}`,
        subtitle: `${status}${style ? ` · ${style}` : ''}${createdAt ? ` · ${new Date(createdAt).toLocaleDateString('en-GB')}` : ''}`,
      };
    },
  },
  orderings: [{ title: 'Newest', name: 'newest', by: [{ field: 'createdAt', direction: 'desc' }] }],
});
