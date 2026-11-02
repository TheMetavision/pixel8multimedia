// studio/schemas/marketingFields.ts
//
// Marketing consent and the referral programme, shared by an order and a
// commission. All server-written and read-only (netlify/functions/_shared/
// marketing-consent.mjs, post-delivery.mjs, referral-reward.mjs).

import { defineField } from 'sanity';

export function marketingFields(group?: string) {
  const g = group ? { group } : {};
  return [
    defineField({
      name: 'marketingConsent',
      title: 'Marketing',
      type: 'string',
      ...g,
      readOnly: true,
      options: {
        list: [
          { title: 'Not asked (soft opt-in: offers and referral emails allowed)', value: 'not_asked' },
          { title: 'Refused at checkout (no offers or referral emails)', value: 'refused' },
        ],
      },
      description: 'From the "Don’t send me offers or referral emails" box at checkout. Empty on orders placed before it existed: those buyers never get the referral email.',
    }),
    defineField({
      name: 'referralCode',
      title: 'Referral code (theirs to share)',
      type: 'string',
      ...g,
      readOnly: true,
      description: 'The buyer’s PIX- code: 10% off a friend’s first order. Created when the order reached them.',
      hidden: ({ value }) => !value,
    }),
    defineField({
      name: 'postDeliveryStartedAt',
      title: 'Post-delivery emails started',
      type: 'datetime',
      ...g,
      readOnly: true,
      description: 'Stamped when the buyer was added to MailerLite “P8 - Customers”. Its presence stops a second start.',
      hidden: ({ value }) => !value,
    }),
    defineField({
      name: 'postDeliveryError',
      title: 'Post-delivery problem',
      type: 'string',
      ...g,
      readOnly: true,
      hidden: ({ value }) => !value,
    }),
    defineField({
      name: 'referredBy',
      title: 'Referred by',
      type: 'object',
      ...g,
      readOnly: true,
      description: 'A friend’s PIX- code was used on this checkout; the friend was sent a THANKS- code.',
      hidden: ({ value }) => !value,
      fields: [
        defineField({ name: 'code', title: 'Code used', type: 'string' }),
        defineField({ name: 'referrerEmail', title: 'Referrer email', type: 'string' }),
        defineField({ name: 'referrerOrder', title: 'Referrer’s order', type: 'string' }),
        defineField({ name: 'rewardCode', title: 'Thank-you code sent', type: 'string' }),
      ],
    }),
    defineField({
      name: 'referralError',
      title: 'Referral reward problem',
      type: 'string',
      ...g,
      readOnly: true,
      hidden: ({ value }) => !value,
    }),
  ];
}
