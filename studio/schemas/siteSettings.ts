import { defineType, defineField, type ValidationContext } from 'sanity';

const enabledIn = (ctx: ValidationContext) => (ctx.parent as { enabled?: boolean } | undefined)?.enabled === true;

export default defineType({
  name: 'siteSettings',
  title: 'Site Settings',
  type: 'document',
  fields: [
    defineField({ name: 'siteName', title: 'Site Name', type: 'string', initialValue: 'Pixel8 Multimedia' }),
    defineField({ name: 'tagline', title: 'Tagline', type: 'string', initialValue: 'Pop. Art. Motion.' }),
    defineField({ name: 'contactEmail', title: 'Contact Email', type: 'string' }),
    defineField({
      name: 'socialLinks', title: 'Social Links', type: 'object',
      fields: [
        { name: 'facebook', title: 'Facebook', type: 'url' },
        { name: 'instagram', title: 'Instagram', type: 'url' },
        { name: 'x', title: 'X (Twitter)', type: 'url' },
        { name: 'tiktok', title: 'TikTok', type: 'url' },
      ],
    }),
    defineField({ name: 'announcementBar', title: 'Announcement Bar', type: 'string' }),
    defineField({ name: 'newsletterHeading', title: 'Newsletter Heading', type: 'string', initialValue: 'Stay in the Loop' }),
    // Homepage hero for a season (Christmas etc.). Publishing rebuilds the site; the visitor's
    // clock then switches it on at startDate and off at endDate, with no rebuild needed.
    // Anything missing or invalid = the normal hero. Rules: src/lib/seasonal-campaign.mjs.
    defineField({
      name: 'seasonalCampaign', title: 'Seasonal Campaign', type: 'object',
      description: 'Swaps the homepage hero between the start and end dates. Test with ?season=on or ?season=off on the homepage.',
      options: { collapsible: true, collapsed: true },
      fields: [
        defineField({ name: 'enabled', title: 'Enabled', type: 'boolean', initialValue: false }),
        defineField({ name: 'label', title: 'Label', type: 'string', description: 'For you only, e.g. "Christmas 2026". Not shown on the site.' }),
        defineField({
          name: 'startDate', title: 'Start', type: 'datetime',
          validation: (Rule) => Rule.custom((v, ctx) => (enabledIn(ctx) && !v ? 'Required when the campaign is enabled' : true)),
        }),
        defineField({
          name: 'endDate', title: 'End', type: 'datetime', description: 'The hero goes back to normal at this moment.',
          validation: (Rule) => Rule.custom((v, ctx) => {
            if (enabledIn(ctx) && !v) return 'Required when the campaign is enabled';
            const start = (ctx.parent as { startDate?: string } | undefined)?.startDate;
            if (v && start && Date.parse(v as string) <= Date.parse(start)) return 'Must be after the start';
            return true;
          }),
        }),
        defineField({
          name: 'heroImage', title: 'Hero Image', type: 'image',
          description: 'Square, at least 2048 × 2048px. Shown whole (never cropped), on phones too.',
          validation: (Rule) => Rule.custom((v, ctx) => {
            const ref = (v as { asset?: { _ref?: string } } | undefined)?.asset?._ref;
            if (!ref) return enabledIn(ctx) ? 'Required when the campaign is enabled' : true;
            // Asset ids carry the size: image-<hash>-<w>x<h>-<ext>
            const m = ref.match(/-(\d+)x(\d+)-\w+$/);
            if (!m) return true;
            const w = Number(m[1]), h = Number(m[2]);
            if (w !== h) return `Must be square (this one is ${w} × ${h}px)`;
            if (w < 2048) return `Must be at least 2048px (this one is ${w}px)`;
            return true;
          }),
        }),
        defineField({
          name: 'heroImageAlt', title: 'Hero Image Alt Text', type: 'string',
          validation: (Rule) => Rule.custom((v, ctx) => (enabledIn(ctx) && !(v as string | undefined)?.trim() ? 'Required when the campaign is enabled' : true)),
        }),
        defineField({ name: 'eyebrow', title: 'Eyebrow', type: 'string', description: 'Empty = "UK Made · UK Delivery"' }),
        defineField({ name: 'headlineLine1', title: 'Headline Line 1', type: 'string', description: 'Empty = "Where Pop Culture Meets"' }),
        defineField({ name: 'headlineLine2', title: 'Headline Line 2 (gradient)', type: 'string', description: 'Empty = "Pixel-Perfect Art"' }),
        defineField({ name: 'body', title: 'Body', type: 'text', rows: 3, description: 'Empty = the normal hero paragraph' }),
        defineField({ name: 'ctaLabel', title: 'Button Label', type: 'string', description: 'Empty = "Shop Wall Art"' }),
        defineField({
          name: 'ctaHref', title: 'Button Link', type: 'string', description: 'A site path like /store/christmas/ or a full https:// link. Empty = /store/',
          validation: (Rule) => Rule.custom((v) => (!v || /^(\/(?!\/)|https:\/\/)/.test(v as string) ? true : 'Start with / or https://')),
        }),
        defineField({ name: 'snow', title: 'Snow', type: 'boolean', initialValue: true }),
      ],
    }),
  ],
  preview: { prepare() { return { title: 'Site Settings' }; } },
});
