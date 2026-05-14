// netlify/functions/newsletter.mts
//
// Newsletter signup handler.
// Pattern: MailerLite for the actual subscription, plus a Sanity log doc
// for our own records (so we have a backup if we ever migrate provider).
//
// Endpoint: /api/newsletter (rewritten via the export below)
//
// Expected POST body: { email: string, source?: string }
// `source` should be set by the frontend caller, e.g. "footer" or
// "join-the-gallery" — purely for our own analytics in Sanity.

import type { Context, Config } from '@netlify/functions';
import { createClient } from '@sanity/client';

const sanity = createClient({
  projectId: 'bqb4w421',
  dataset: 'production',
  apiVersion: '2024-12-01',
  token: process.env.SANITY_TOKEN,
  useCdn: false,
});

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async (req: Request, _context: Context) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const email = (body?.email || '').toString().trim().toLowerCase();
    const source = (body?.source || 'unknown').toString();

    if (!email) {
      return new Response(
        JSON.stringify({ error: 'Email is required.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (!EMAIL_REGEX.test(email)) {
      return new Response(
        JSON.stringify({ error: 'Please enter a valid email address.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const MAILERLITE_API_KEY = process.env.MAILERLITE_API_KEY;
    const MAILERLITE_GROUP_ID = process.env.MAILERLITE_GROUP_ID;

    if (!MAILERLITE_API_KEY || !MAILERLITE_GROUP_ID) {
      console.error('Missing MAILERLITE_API_KEY or MAILERLITE_GROUP_ID env vars');
      return new Response(
        JSON.stringify({ error: 'Server configuration error. Please try again later.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ── MailerLite subscribe ────────────────────────────────────────────────
    let mlStatus: 'synced' | 'duplicate' | 'failed' = 'synced';
    let mlMessage = 'Subscribed successfully.';

    const mlResponse = await fetch('https://connect.mailerlite.com/api/subscribers', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MAILERLITE_API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        email,
        groups: [MAILERLITE_GROUP_ID],
        status: 'active',
      }),
    });

    if (!mlResponse.ok) {
      const errorData = await mlResponse.json().catch(() => ({}));
      console.error('MailerLite API error:', mlResponse.status, errorData);

      if (mlResponse.status === 422) {
        // 422 = already subscribed. Treat as success from the user's perspective,
        // but log it as a duplicate in Sanity.
        mlStatus = 'duplicate';
        mlMessage = 'You\'re already on the list!';
      } else {
        mlStatus = 'failed';
        // Still write to Sanity so we can retry manually if needed
      }
    }

    // ── Sanity log ─────────────────────────────────────────────────────────
    // Use the email as the doc ID stem so duplicate submissions don't pile up.
    // Sanity doc IDs can't contain "@" or "." so we sanitise the email.
    const sanitisedEmail = email.replace(/[^a-z0-9-]+/g, '-');
    const docId = `newsletter.${sanitisedEmail}`;

    try {
      await sanity.createOrReplace({
        _id: docId,
        _type: 'newsletterSubscriber',
        email,
        source,
        subscribedAt: new Date().toISOString(),
        mailerLiteStatus: mlStatus,
      });
    } catch (sanityErr) {
      // Sanity write failure shouldn't block the user — they're already subscribed
      // in MailerLite which is the source of truth for sending.
      console.error('Sanity log failed for newsletter signup:', sanityErr);
    }

    if (mlStatus === 'failed') {
      return new Response(
        JSON.stringify({ error: 'Could not complete signup. Please try again.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: mlMessage }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Newsletter function error:', err);
    return new Response(
      JSON.stringify({ error: 'Something went wrong. Please try again.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const config: Config = {
  path: '/api/newsletter',
};
