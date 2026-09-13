import { defineType, defineField } from 'sanity';

// Customer-facing record of one "Your Photo" style. This is the PUBLIC half —
// the dataset is readable without a token, so nothing here may identify the
// underlying art style or contain generation prompts. Those live server-side
// in netlify/functions/_shared/styles.mjs, keyed by the same `key`.
export default defineType({
  name: 'personalisationStyle',
  title: 'Personalisation Style',
  type: 'document',
  fields: [
    defineField({
      name: 'key',
      title: 'Style key',
      type: 'string',
      description: 'Must match a key in the server-side styles module (e.g. style-f). One document per key.',
      options: {
        list: [
          { title: 'Style A — Neon Glow', value: 'style-a' },
          { title: 'Style B — Minimalist Cool', value: 'style-b' },
          { title: 'Style C — Retro Vibes', value: 'style-c' },
          { title: 'Style D — Pixel Art', value: 'style-d' },
          { title: 'Style E — Abstract Burst', value: 'style-e' },
          { title: 'Style F — Pop Art', value: 'style-f' },
          { title: 'Style G — Watercolour', value: 'style-g' },
          { title: 'Style H — Noir', value: 'style-h' },
          { title: 'Style I — Geometric', value: 'style-i' },
          { title: 'Style J — Street Art', value: 'style-j' },
        ],
      },
      validation: (Rule) => Rule.required(),
    }),
    defineField({ name: 'letter', title: 'Option letter', type: 'string', readOnly: true }),
    defineField({ name: 'label', title: 'Customer label', type: 'string', validation: (Rule) => Rule.required() }),
    defineField({
      name: 'blurb',
      title: 'One-line blurb',
      type: 'string',
      description: 'Shown under the style pill in the builder. Describe the look, never the artist.',
    }),
    defineField({
      name: 'exampleBefore',
      title: 'Example — original photo',
      type: 'image',
      options: { hotspot: true },
      description: 'Use a photo you own the rights to (the harness test set is fine).',
    }),
    defineField({
      name: 'exampleAfter',
      title: 'Example — styled result',
      type: 'image',
      options: { hotspot: true },
    }),
    defineField({ name: 'active', title: 'Available in the builder', type: 'boolean', initialValue: true }),
    defineField({ name: 'sortOrder', title: 'Sort order', type: 'number', initialValue: 0 }),
  ],
  preview: {
    select: { title: 'label', key: 'key', active: 'active', media: 'exampleAfter' },
    prepare({ title, key, active, media }) {
      return { title: `${active === false ? '⏸ ' : ''}${title || key}`, subtitle: key, media };
    },
  },
  orderings: [{ title: 'Sort order', name: 'sortOrder', by: [{ field: 'sortOrder', direction: 'asc' }] }],
});
