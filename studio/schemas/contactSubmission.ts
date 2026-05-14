// studio/schemas/contactSubmission.ts
import { defineType, defineField } from 'sanity';

export default defineType({
  name: 'contactSubmission',
  title: 'Contact Submission',
  type: 'document',
  fields: [
    defineField({
      name: 'refCode',
      title: 'Reference Code',
      type: 'string',
      readOnly: true,
      description: 'Auto-generated reference code for this submission (e.g. MSG-A1B2C3D4).',
    }),
    defineField({
      name: 'name',
      title: 'Customer Name',
      type: 'string',
      readOnly: true,
    }),
    defineField({
      name: 'email',
      title: 'Customer Email',
      type: 'string',
      readOnly: true,
    }),
    defineField({
      name: 'subject',
      title: 'Subject',
      type: 'string',
      readOnly: true,
      options: {
        list: [
          { title: 'General Enquiry', value: 'general' },
          { title: 'Custom Order', value: 'custom' },
          { title: 'Issue with Order', value: 'order-issue' },
          { title: 'Other', value: 'other' },
        ],
      },
    }),
    defineField({
      name: 'message',
      title: 'Message',
      type: 'text',
      rows: 8,
      readOnly: true,
    }),
    defineField({
      name: 'status',
      title: 'Status',
      type: 'string',
      options: {
        list: [
          { title: 'New', value: 'new' },
          { title: 'In Progress', value: 'in-progress' },
          { title: 'Replied', value: 'replied' },
          { title: 'Resolved', value: 'resolved' },
          { title: 'Spam / Discard', value: 'spam' },
        ],
        layout: 'radio',
      },
      initialValue: 'new',
      description: 'Track where this enquiry stands. Editable.',
    }),
    defineField({
      name: 'submittedAt',
      title: 'Submitted At',
      type: 'datetime',
      readOnly: true,
    }),
    defineField({
      name: 'internalNotes',
      title: 'Internal Notes',
      type: 'text',
      rows: 4,
      description: 'For your own reference — what you replied with, follow-ups needed, etc. Not shown to customer.',
    }),
  ],
  preview: {
    select: {
      name: 'name',
      subject: 'subject',
      status: 'status',
      submittedAt: 'submittedAt',
      email: 'email',
    },
    prepare({ name, subject, status, submittedAt, email }) {
      const SUBJECTS: Record<string, string> = {
        general: 'General',
        custom: 'Custom Order',
        'order-issue': 'Order Issue',
        other: 'Other',
      };
      const STATUS_ICONS: Record<string, string> = {
        new: '🔴',
        'in-progress': '🟡',
        replied: '🟢',
        resolved: '✅',
        spam: '🗑️',
      };
      const date = submittedAt
        ? new Date(submittedAt).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })
        : '';
      return {
        title: `${STATUS_ICONS[status] || '⚪'} ${name || '(no name)'} — ${SUBJECTS[subject] || subject || ''}`,
        subtitle: `${date} · ${email || ''}`,
      };
    },
  },
  orderings: [
    {
      title: 'Newest First',
      name: 'newestFirst',
      by: [{ field: 'submittedAt', direction: 'desc' }],
    },
    {
      title: 'Status (New first)',
      name: 'byStatus',
      by: [
        { field: 'status', direction: 'asc' },
        { field: 'submittedAt', direction: 'desc' },
      ],
    },
  ],
});
