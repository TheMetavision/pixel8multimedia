import { defineType, defineField } from 'sanity';

/**
 * grouponVoucher — one document per Groupon voucher sold.
 *
 * Lifecycle:
 *   imported  → the voucher exists on Groupon and has been imported here.
 *   claimed   → a customer entered the code on /groupon and holds a short-lived
 *               claim token. Reverts to `imported` if the claim window lapses.
 *   checkout  → a Stripe Checkout Session has been created against it.
 *               Reverts to `imported` if the session expires unused.
 *   redeemed  → payment (or £0 completion) confirmed. Terminal.
 *   expired   → past the Groupon expiry date without redemption. Terminal.
 *   refunded  → Groupon refunded the customer after redemption. Terminal.
 *   void      → cancelled by us (fraud, duplicate import, test data). Terminal.
 */
export default defineType({
  name: 'grouponVoucher',
  title: 'Groupon Voucher',
  type: 'document',
  groups: [
    { name: 'voucher', title: 'Voucher', default: true },
    { name: 'entitlement', title: 'Entitlement' },
    { name: 'redemption', title: 'Redemption' },
    { name: 'stripe', title: 'Stripe' },
    { name: 'admin', title: 'Admin' },
  ],
  fields: [
    // ── Voucher ────────────────────────────────────────────────────────────
    defineField({
      name: 'code',
      title: 'Groupon Code',
      type: 'string',
      group: 'voucher',
      description:
        'The customer-facing Groupon security / voucher code, normalised to uppercase with spaces and hyphens stripped. Must be unique.',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'status',
      title: 'Status',
      type: 'string',
      group: 'voucher',
      options: {
        list: [
          { title: 'Imported — available', value: 'imported' },
          { title: 'Claimed — customer in the wizard', value: 'claimed' },
          { title: 'Checkout — session created', value: 'checkout' },
          { title: 'Redeemed — order placed', value: 'redeemed' },
          { title: 'Expired', value: 'expired' },
          { title: 'Refunded by Groupon', value: 'refunded' },
          { title: 'Void', value: 'void' },
        ],
        layout: 'dropdown',
      },
      initialValue: 'imported',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'dealId',
      title: 'Groupon Deal ID',
      type: 'string',
      group: 'voucher',
      description: 'The campaign this voucher was sold against.',
    }),
    defineField({
      name: 'campaignName',
      title: 'Campaign Name',
      type: 'string',
      group: 'voucher',
    }),
    defineField({
      name: 'optionLabel',
      title: 'Groupon Option',
      type: 'string',
      group: 'voucher',
      description: 'The option title exactly as it appears on the Groupon deal.',
    }),
    defineField({
      name: 'purchasedAt',
      title: 'Purchased At',
      type: 'datetime',
      group: 'voucher',
    }),
    defineField({
      name: 'expiresAt',
      title: 'Voucher Expiry',
      type: 'datetime',
      group: 'voucher',
      description:
        'After this date the code is refused at redemption. Leave blank for no expiry.',
    }),

    // ── Entitlement ────────────────────────────────────────────────────────
    defineField({
      name: 'service',
      title: 'Service',
      type: 'reference',
      to: [{ type: 'service' }],
      group: 'entitlement',
      description: 'The Pixel8 service this voucher entitles the holder to.',
    }),
    defineField({
      name: 'serviceSlug',
      title: 'Service Slug',
      type: 'string',
      group: 'entitlement',
      description:
        'Denormalised slug — the redemption endpoint matches on this so it never has to resolve a reference on the hot path.',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'entitlementOrderType',
      title: 'Entitled Order Type',
      type: 'string',
      group: 'entitlement',
      description:
        'The order type the Groupon option corresponds to (digital, animation-music, animation-vo, bundle...). Recorded for reporting; the customer may upgrade and pay the difference.',
    }),
    defineField({
      name: 'valuePence',
      title: 'Entitlement Value (pence)',
      type: 'number',
      group: 'entitlement',
      description:
        'The discount this voucher is worth, in pence. Normally the Groupon "original value" for the option (e.g. 1499 = £14.99). This is the maximum discount applied at checkout — upgrades above it are paid by the customer.',
      validation: (Rule) => Rule.required().integer().positive(),
    }),
    defineField({
      name: 'paidPence',
      title: 'Customer Paid Groupon (pence)',
      type: 'number',
      group: 'entitlement',
      description: 'The deal price the customer actually paid Groupon. Reporting only.',
    }),
    defineField({
      name: 'netPence',
      title: 'Net Due From Groupon (pence)',
      type: 'number',
      group: 'entitlement',
      description: 'Our share after Groupon commission. Reporting only.',
    }),

    // ── Redemption ─────────────────────────────────────────────────────────
    defineField({
      name: 'claimTokenHash',
      title: 'Claim Token Hash',
      type: 'string',
      group: 'redemption',
      readOnly: true,
      description:
        'SHA-256 of the single-use claim token handed to the browser. The raw token is never stored.',
    }),
    defineField({
      name: 'claimedAt',
      title: 'Claimed At',
      type: 'datetime',
      group: 'redemption',
      readOnly: true,
    }),
    defineField({
      name: 'claimExpiresAt',
      title: 'Claim Expires At',
      type: 'datetime',
      group: 'redemption',
      readOnly: true,
      description: 'After this the claim lapses and the code becomes available again.',
    }),
    defineField({
      name: 'claimCount',
      title: 'Claim Count',
      type: 'number',
      group: 'redemption',
      readOnly: true,
      description: 'How many times this code has been claimed. Repeated claims on one code are worth a look.',
      initialValue: 0,
    }),
    defineField({
      name: 'commission',
      title: 'Commission',
      type: 'reference',
      to: [{ type: 'commission' }],
      group: 'redemption',
      readOnly: true,
    }),
    defineField({
      name: 'orderRef',
      title: 'Order Reference',
      type: 'string',
      group: 'redemption',
      readOnly: true,
    }),
    defineField({
      name: 'customerEmail',
      title: 'Customer Email',
      type: 'string',
      group: 'redemption',
      readOnly: true,
    }),
    defineField({
      name: 'redeemedAt',
      title: 'Redeemed At',
      type: 'datetime',
      group: 'redemption',
      readOnly: true,
    }),
    defineField({
      name: 'discountAppliedPence',
      title: 'Discount Actually Applied (pence)',
      type: 'number',
      group: 'redemption',
      readOnly: true,
      description:
        'What Stripe actually took off. Lower than the entitlement value if the customer ordered something cheaper than they bought.',
    }),
    defineField({
      name: 'upgradePaidPence',
      title: 'Upgrade Paid (pence)',
      type: 'number',
      group: 'redemption',
      readOnly: true,
      description: 'What the customer paid us on top of the voucher. The number that matters for the Groupon business case.',
    }),

    // ── Stripe ─────────────────────────────────────────────────────────────
    defineField({
      name: 'stripeCouponId',
      title: 'Stripe Coupon ID',
      type: 'string',
      group: 'stripe',
      readOnly: true,
    }),
    defineField({
      name: 'stripePromotionCodeId',
      title: 'Stripe Promotion Code ID',
      type: 'string',
      group: 'stripe',
      readOnly: true,
      description: 'Single-use (max_redemptions = 1) — Stripe is the second lock against double redemption.',
    }),
    defineField({
      name: 'stripePromotionCode',
      title: 'Stripe Promotion Code',
      type: 'string',
      group: 'stripe',
      readOnly: true,
    }),
    defineField({
      name: 'stripeSessionId',
      title: 'Stripe Checkout Session ID',
      type: 'string',
      group: 'stripe',
      readOnly: true,
    }),

    // ── Admin ──────────────────────────────────────────────────────────────
    defineField({
      name: 'importBatch',
      title: 'Import Batch',
      type: 'string',
      group: 'admin',
      readOnly: true,
      description: 'Identifies the import run this voucher arrived in — used to undo a bad import.',
    }),
    defineField({
      name: 'verified',
      title: 'Verified Against Groupon',
      type: 'boolean',
      group: 'admin',
      initialValue: true,
      description:
        'False when the code was accepted without appearing in an import (unverified mode). These MUST be reconciled against a Groupon report before the work is delivered.',
    }),
    defineField({
      name: 'reconciledAt',
      title: 'Reconciled At',
      type: 'datetime',
      group: 'admin',
      readOnly: true,
      description: 'Last time this voucher was matched against a Groupon redemption report.',
    }),
    defineField({
      name: 'flags',
      title: 'Flags',
      type: 'array',
      of: [{ type: 'string' }],
      group: 'admin',
      options: {
        list: [
          { title: 'Unverified code', value: 'unverified' },
          { title: 'Repeat claim attempts', value: 'repeat-claims' },
          { title: 'Missing from Groupon report', value: 'missing-in-report' },
          { title: 'Redeemed here but not on Groupon', value: 'not-marked-on-groupon' },
          { title: 'Value mismatch', value: 'value-mismatch' },
          { title: 'Suspected abuse', value: 'suspected-abuse' },
        ],
      },
    }),
    defineField({
      name: 'notes',
      title: 'Notes',
      type: 'text',
      group: 'admin',
      rows: 3,
    }),
  ],

  preview: {
    select: {
      code: 'code',
      status: 'status',
      campaignName: 'campaignName',
      optionLabel: 'optionLabel',
      orderRef: 'orderRef',
    },
    prepare({ code, status, campaignName, optionLabel, orderRef }) {
      const emoji: Record<string, string> = {
        imported: '🎟️',
        claimed: '✋',
        checkout: '🛒',
        redeemed: '✅',
        expired: '⌛',
        refunded: '↩️',
        void: '🚫',
      };
      return {
        title: `${emoji[status || ''] || '❓'} ${code || '(no code)'}`,
        subtitle: [campaignName, optionLabel, orderRef].filter(Boolean).join(' — '),
      };
    },
  },

  orderings: [
    { title: 'Newest First', name: 'createdDesc', by: [{ field: '_createdAt', direction: 'desc' }] },
    { title: 'Status', name: 'statusAsc', by: [{ field: 'status', direction: 'asc' }] },
    { title: 'Campaign', name: 'campaignAsc', by: [{ field: 'campaignName', direction: 'asc' }] },
  ],
});
