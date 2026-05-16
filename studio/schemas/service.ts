import { defineType, defineField } from 'sanity';

export default defineType({
  name: 'service',
  title: 'Service',
  type: 'document',
  groups: [
    { name: 'content', title: 'Page Content', default: true },
    { name: 'commission', title: 'Commission Workflow' },
    { name: 'pricing', title: 'Pricing' },
  ],
  fields: [
    // ── Page Content ────────────────────────────────────────────────
    defineField({ name: 'title', title: 'Title', type: 'string', group: 'content', validation: (Rule) => Rule.required() }),
    defineField({ name: 'slug', title: 'Slug', type: 'slug', group: 'content', options: { source: 'title', maxLength: 96 }, validation: (Rule) => Rule.required() }),
    defineField({ name: 'description', title: 'Description', type: 'text', group: 'content', rows: 4, description: 'Main intro paragraph shown below the title' }),
    defineField({ name: 'extendedDescription', title: 'Extended Description', type: 'text', group: 'content', rows: 4, description: 'Optional additional paragraphs (e.g. for The Day I Met... disclaimer)' }),

    // Hero Image
    defineField({
      name: 'heroImage',
      title: 'Hero Image',
      type: 'image',
      group: 'content',
      options: { hotspot: true },
      description: 'Main banner image shown at the top of the service page',
    }),

    // Gallery Examples (unchanged)
    defineField({
      name: 'examples',
      title: 'Gallery Examples',
      type: 'array',
      group: 'content',
      of: [{
        type: 'object',
        title: 'Example',
        fields: [
          { name: 'label', title: 'Label', type: 'string', description: 'E.g. "Example 1" or a name' },
          {
            name: 'images',
            title: 'Images (Original → Transformed)',
            type: 'array',
            of: [{
              type: 'object',
              fields: [
                { name: 'image', title: 'Image', type: 'image', options: { hotspot: true } },
                { name: 'tag', title: 'Tag', type: 'string', description: 'E.g. "Original", "Digital Still", "The Simpsons", "1950s"' },
              ],
              preview: {
                select: { title: 'tag', media: 'image' },
              },
            }],
          },
          {
            name: 'videos',
            title: 'YouTube Videos',
            type: 'array',
            of: [{
              type: 'object',
              fields: [
                { name: 'youtubeId', title: 'YouTube Video ID', type: 'string', description: 'The part after watch?v=' },
                { name: 'tag', title: 'Tag', type: 'string', description: 'E.g. "Animation with Background Music", "Animation with V/O"' },
                { name: 'title', title: 'Video Title', type: 'string' },
              ],
            }],
          },
          {
            name: 'audioTracks',
            title: 'Audio Tracks (for Your Song Your Story)',
            type: 'array',
            of: [{
              type: 'object',
              fields: [
                { name: 'title', title: 'Track Title', type: 'string' },
                { name: 'coverImage', title: 'Cover Art', type: 'image' },
                { name: 'audioFile', title: 'Audio File', type: 'file' },
                { name: 'duration', title: 'Duration', type: 'string', description: 'E.g. "4:59"' },
              ],
            }],
          },
        ],
        preview: {
          select: { title: 'label' },
        },
      }],
    }),

    // How It Works steps (unchanged)
    defineField({
      name: 'steps',
      title: 'How It Works Steps',
      type: 'array',
      group: 'content',
      of: [{
        type: 'object',
        fields: [
          { name: 'text', title: 'Step Text', type: 'string' },
        ],
        preview: {
          select: { title: 'text' },
        },
      }],
    }),

    // Important Note (unchanged)
    defineField({ name: 'importantNote', title: 'Important Note', type: 'text', group: 'content', rows: 3, description: 'Optional disclaimer shown after How It Works (e.g. fictional images note)' }),

    // ── Pricing ─────────────────────────────────────────────────────
    defineField({
      name: 'price',
      title: 'Digital Base Price (£) — LEGACY',
      type: 'number',
      group: 'pricing',
      description: 'Legacy field — use Digital Bundle Price below. Kept for backward compatibility with services not yet migrated to the new pricing model.',
      validation: (Rule) => Rule.min(0),
    }),
    defineField({
      name: 'digitalPrice',
      title: 'Digital Bundle Price (£)',
      type: 'number',
      group: 'pricing',
      description: 'Flat price for the all-styles digital download bundle. Customer receives every style as a digital file. Leave blank or set to 0 if this service does not offer a digital option (e.g. print-only restoration).',
      validation: (Rule) => Rule.min(0),
    }),
    defineField({
      name: 'styleOptions',
      title: 'Available Styles',
      type: 'array',
      group: 'pricing',
      description: 'Named styles available for this service. Customer picks per-print, or gets all styles via the digital bundle. Leave empty for services with no style choice (e.g. Past Perfect, photo restoration).',
      of: [
        {
          type: 'object',
          name: 'styleOption',
          fields: [
            {
              name: 'key',
              title: 'Internal Key',
              type: 'string',
              description: 'Short slug, lowercase, hyphenated. E.g. "simpsons", "rick-morty".',
              validation: (Rule) => Rule.required().regex(/^[a-z0-9-]+$/, { name: 'lowercase-hyphenated' }),
            },
            {
              name: 'label',
              title: 'Display Name',
              type: 'string',
              description: 'What the customer sees, e.g. "The Simpsons".',
              validation: (Rule) => Rule.required(),
            },
            {
              name: 'helperText',
              title: 'Description',
              type: 'string',
              description: 'One-line description shown beneath the style label.',
            },
          ],
          preview: {
            select: { title: 'label', subtitle: 'key' },
          },
        },
      ],
    }),
    defineField({
      name: 'printUpcharges',
      title: 'Print Prices (£)',
      type: 'object',
      group: 'pricing',
      description: 'Standalone print prices = shop product price + £5 artwork creation fee. Bundle orders (digital + print at same checkout) get the £5 waived per print, calculated automatically.',
      fields: [
        {
          name: 'poster',
          title: 'Poster Print',
          type: 'object',
          fields: [
            { name: 'small', title: 'Small', type: 'number' },
            { name: 'medium', title: 'Medium', type: 'number' },
            { name: 'large', title: 'Large', type: 'number' },
          ],
        },
        {
          name: 'canvasStandard',
          title: 'Canvas Standard',
          type: 'object',
          fields: [
            { name: 'small', title: 'Small', type: 'number' },
            { name: 'medium', title: 'Medium', type: 'number' },
            { name: 'large', title: 'Large', type: 'number' },
          ],
        },
        {
          name: 'canvasGallery',
          title: 'Canvas Gallery',
          type: 'object',
          fields: [
            { name: 'small', title: 'Small', type: 'number' },
            { name: 'medium', title: 'Medium', type: 'number' },
            { name: 'large', title: 'Large', type: 'number' },
          ],
        },
      ],
    }),

    // ── Commission Workflow ─────────────────────────────────────────
    defineField({
      name: 'commissionEnabled',
      title: 'Commission Workflow Enabled',
      type: 'boolean',
      group: 'commission',
      initialValue: true,
      description: 'When off, the service page hides the order workflow but stays viewable. Use to temporarily pause new orders without unpublishing.',
    }),
    defineField({
      name: 'briefingFields',
      title: 'Briefing Form Fields',
      type: 'array',
      group: 'commission',
      description: 'Define the per-service brief fields the customer fills in before paying. Ordering controls display order on the form.',
      of: [{
        type: 'object',
        name: 'briefingField',
        title: 'Field',
        fields: [
          defineField({
            name: 'key',
            title: 'Field Key',
            type: 'string',
            description: 'Used internally to store the answer. Lowercase, no spaces (e.g. "celebrityName", "vibe", "subjectAge").',
            validation: (Rule) => Rule.required().regex(/^[a-z][a-zA-Z0-9]*$/, { name: 'camelCase' }),
          }),
          defineField({
            name: 'label',
            title: 'Label',
            type: 'string',
            description: 'What the customer sees as the field name (e.g. "Which celebrity would you like to meet?").',
            validation: (Rule) => Rule.required(),
          }),
          defineField({
            name: 'fieldType',
            title: 'Field Type',
            type: 'string',
            options: {
              list: [
                { title: 'Text — single line', value: 'text' },
                { title: 'Textarea — multi-line', value: 'textarea' },
                { title: 'Email', value: 'email' },
                { title: 'Phone', value: 'phone' },
                { title: 'Select — dropdown', value: 'select' },
                { title: 'Style Picker — uses service.styleOptions (or A–J fallback)', value: 'styleSwatch' },
                { title: 'Photo — single upload', value: 'photo' },
                { title: 'Photos — multiple uploads', value: 'photos' },
              ],
              layout: 'dropdown',
            },
            validation: (Rule) => Rule.required(),
          }),
          defineField({
            name: 'helperText',
            title: 'Helper Text',
            type: 'string',
            description: 'Shown beneath the field in small grey text (e.g. "Clear, well-lit, facing the camera").',
          }),
          defineField({
            name: 'required',
            title: 'Required',
            type: 'boolean',
            initialValue: true,
          }),
          defineField({
            name: 'options',
            title: 'Options',
            type: 'array',
            of: [{ type: 'string' }],
            description: 'For Select fields only. Each line is a choice.',
            hidden: ({ parent }: any) => parent?.fieldType !== 'select',
          }),
          defineField({
            name: 'minPhotos',
            title: 'Minimum Photos',
            type: 'number',
            description: 'For Photos field only. How many photos the customer must upload at minimum.',
            hidden: ({ parent }: any) => parent?.fieldType !== 'photos',
          }),
          defineField({
            name: 'maxPhotos',
            title: 'Maximum Photos',
            type: 'number',
            description: 'For Photos field only. Upper limit.',
            hidden: ({ parent }: any) => parent?.fieldType !== 'photos',
          }),
        ],
        preview: {
          select: { title: 'label', subtitle: 'fieldType', required: 'required' },
          prepare({ title, subtitle, required }) {
            return {
              title: `${title}${required ? ' *' : ''}`,
              subtitle: subtitle || 'No type set',
            };
          },
        },
      }],
    }),

    // ── Legacy display toggles (kept for backwards compat) ──────────
    defineField({ name: 'hasDigitalDelivery', title: 'Show Digital Delivery Order Link', type: 'boolean', group: 'commission', initialValue: true }),
    defineField({ name: 'hasPrintOrder', title: 'Show Poster/Canvas Order Link', type: 'boolean', group: 'commission', initialValue: true }),
    defineField({ name: 'hasFileUpload', title: 'Show Upload Files Button', type: 'boolean', group: 'commission', initialValue: true }),

    // ── Ordering ────────────────────────────────────────────────────
    defineField({ name: 'sortOrder', title: 'Sort Order', type: 'number', group: 'content', initialValue: 0, description: 'Lower numbers appear first in nav and on services page' }),
  ],
  preview: {
    select: { title: 'title', subtitle: 'description', order: 'sortOrder' },
    prepare({ title, subtitle, order }) {
      return { title: `${order ?? 0}. ${title}`, subtitle: subtitle?.substring(0, 80) };
    },
  },
  orderings: [
    { title: 'Sort Order', name: 'sortOrderAsc', by: [{ field: 'sortOrder', direction: 'asc' }] },
  ],
});
