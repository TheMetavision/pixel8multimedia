import { defineType, defineField } from 'sanity';

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
  ],
  preview: { prepare() { return { title: 'Site Settings' }; } },
});
