// studio/schemas/newsletterSubscriber.ts
import { defineType, defineField } from 'sanity';

export default defineType({
  name: 'newsletterSubscriber',
  title: 'Newsletter Subscriber',
  type: 'document',
  fields: [
    defineField({
      name: 'email',
      title: 'Email Address',
      type: 'string',
      readOnly: true,
    }),
    defineField({
      name: 'source',
      title: 'Signup Source',
      type: 'string',
      readOnly: true,
      description: 'Which form on the site the signup came from.',
    }),
    defineField({
      name: 'subscribedAt',
      title: 'Subscribed At',
      type: 'datetime',
      readOnly: true,
    }),
    defineField({
      name: 'mailerLiteStatus',
      title: 'MailerLite Sync Status',
      type: 'string',
      options: {
        list: [
          { title: 'Synced (active in MailerLite)', value: 'synced' },
          { title: 'Duplicate (already on list)', value: 'duplicate' },
          { title: 'Failed (needs manual retry)', value: 'failed' },
        ],
        layout: 'radio',
      },
      description: 'Whether the email made it into MailerLite. Failed = needs manual sync.',
    }),
    defineField({
      name: 'notes',
      title: 'Notes',
      type: 'text',
      rows: 3,
      description: 'Optional notes — e.g. "manually unsubscribed", "bounced", etc.',
    }),
  ],
  preview: {
    select: {
      email: 'email',
      source: 'source',
      subscribedAt: 'subscribedAt',
      mailerLiteStatus: 'mailerLiteStatus',
    },
    prepare({ email, source, subscribedAt, mailerLiteStatus }) {
      const STATUS_ICONS: Record<string, string> = {
        synced: '✅',
        duplicate: '↺',
        failed: '⚠️',
      };
      const date = subscribedAt
        ? new Date(subscribedAt).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          })
        : '';
      return {
        title: `${STATUS_ICONS[mailerLiteStatus] || '⚪'} ${email || '(no email)'}`,
        subtitle: `${date} · from ${source || 'unknown'}`,
      };
    },
  },
  orderings: [
    {
      title: 'Newest First',
      name: 'newestFirst',
      by: [{ field: 'subscribedAt', direction: 'desc' }],
    },
    {
      title: 'By Source',
      name: 'bySource',
      by: [
        { field: 'source', direction: 'asc' },
        { field: 'subscribedAt', direction: 'desc' },
      ],
    },
  ],
});
