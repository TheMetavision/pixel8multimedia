// netlify/functions/contact.mts
//
// Contact form handler.
//  1. Validates required fields
//  2. Creates a `contactSubmission` doc in Sanity (status: new)
//  3. Sends a Resend email to the team with the message
//  4. Sends a Resend auto-acknowledgement to the customer
//
// Endpoint: /api/contact (rewritten via the export below)
//
// Expected POST body: { name, email, subject, message, honeypot? }

import type { Context, Config } from '@netlify/functions';
import { createClient } from '@sanity/client';
import { Resend } from 'resend';
import { nanoid } from 'nanoid';

const sanity = createClient({
  projectId: 'bqb4w421',
  dataset: 'production',
  apiVersion: '2024-12-01',
  token: process.env.SANITY_API_TOKEN,
  useCdn: false,
});

const resend = new Resend(process.env.RESEND_API_KEY!);

const TEAM_EMAIL = process.env.TEAM_EMAIL || 'hello@pixel8multimedia.co.uk';
const FROM_EMAIL = process.env.EMAIL_FROM || 'Pixel8 Multimedia <hello@pixel8multimedia.co.uk>';
const SITE_URL = process.env.URL || 'https://pixel8multimedia.co.uk';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SUBJECT_LABELS: Record<string, string> = {
  general: 'General Enquiry',
  custom: 'Custom Order',
  'order-issue': 'Issue with Order',
  other: 'Other',
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildTeamEmail(opts: {
  name: string;
  email: string;
  subject: string;
  message: string;
  refCode: string;
}): string {
  const subjectLabel = SUBJECT_LABELS[opts.subject] || opts.subject;
  return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 640px; margin: 0 auto; background: #f4f4f7;">
  <div style="background: linear-gradient(135deg, #F07828, #FF00FF); padding: 24px; text-align: center; color: #000;">
    <h1 style="margin: 0; font-size: 22px; font-weight: 800; letter-spacing: 0.5px;">NEW CONTACT MESSAGE</h1>
    <p style="margin: 4px 0 0; font-size: 12px; opacity: 0.85;">Pixel8 Multimedia · Reference ${opts.refCode}</p>
  </div>
  <div style="background: #fff; padding: 28px;">
    <h2 style="margin: 0 0 4px; font-size: 18px;">${escapeHtml(opts.name)}</h2>
    <p style="margin: 0 0 16px; color: #666; font-size: 14px;">
      <a href="mailto:${escapeHtml(opts.email)}" style="color: #F07828; text-decoration: none;">${escapeHtml(opts.email)}</a>
    </p>
    <p style="margin: 0 0 4px;"><strong>Subject:</strong> ${escapeHtml(subjectLabel)}</p>
    <div style="margin-top: 16px; padding: 16px; background: #f5f5f5; border-radius: 6px; white-space: pre-wrap; line-height: 1.5; font-size: 14px;">
      ${escapeHtml(opts.message)}
    </div>
    <div style="margin-top: 24px; padding: 14px; background: #FFF8E1; border-left: 4px solid #F07828; border-radius: 4px; font-size: 13px; line-height: 1.5;">
      <strong>Next steps:</strong><br/>
      Reply directly to this email — it'll go to the customer.<br/>
      View / update the submission in <a href="https://pixel8multimedia.sanity.studio" style="color: #F07828;">Sanity Studio</a>.
    </div>
  </div>
</div>`;
}

function buildAckEmail(opts: { name: string; refCode: string }): string {
  return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; background: #f4f4f7;">
  <div style="background: linear-gradient(135deg, #F07828, #FF00FF); padding: 24px; text-align: center; color: #000;">
    <h1 style="margin: 0; font-size: 22px; font-weight: 800; letter-spacing: 0.5px;">PIXEL8 MULTIMEDIA</h1>
    <p style="margin: 4px 0 0; font-size: 12px; opacity: 0.85;">Pop. Art. Motion.</p>
  </div>
  <div style="background: #fff; padding: 32px;">
    <h2 style="margin: 0 0 12px; font-size: 20px;">Thanks for getting in touch, ${escapeHtml(opts.name)}.</h2>
    <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.6; color: #333;">
      Your message has reached us. We're a small UK-based team and we answer every message
      personally — we'll be in touch within 24–48 hours.
    </p>
    <p style="margin: 0 0 16px; font-size: 14px; color: #666;">
      For your reference, your message ID is <strong>${opts.refCode}</strong>.
    </p>
    <div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid #eaeaea; font-size: 13px; color: #888;">
      <p style="margin: 0 0 4px;">In the meantime, you might find what you're looking for in our FAQs:</p>
      <a href="${SITE_URL}/faqs" style="color: #F07828; text-decoration: none; font-weight: 600;">Read the FAQs →</a>
    </div>
  </div>
  <div style="background: #f9fafb; padding: 16px 32px; text-align: center; font-size: 12px; color: #888;">
    Pixel8 Multimedia · <a href="${SITE_URL}" style="color: #F07828; text-decoration: none;">pixel8multimedia.co.uk</a>
  </div>
</div>`;
}

// ── Handler ──────────────────────────────────────────────────────────────────
export default async (req: Request, _context: Context) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const name = (body?.name || '').toString().trim();
    const email = (body?.email || '').toString().trim().toLowerCase();
    const subject = (body?.subject || '').toString().trim();
    const message = (body?.message || '').toString().trim();
    const honeypot = (body?.website || '').toString().trim(); // honeypot field

    // ── Spam check ─────────────────────────────────────────────────────────
    if (honeypot) {
      // Pretend success — let the bot think it succeeded but don't act
      return new Response(
        JSON.stringify({ success: true, message: 'Thanks!' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ── Validate ───────────────────────────────────────────────────────────
    if (!name || !email || !subject || !message) {
      return new Response(
        JSON.stringify({ error: 'Please fill in all required fields.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (!EMAIL_REGEX.test(email)) {
      return new Response(
        JSON.stringify({ error: 'Please enter a valid email address.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (message.length > 5000) {
      return new Response(
        JSON.stringify({ error: 'Message is too long. Please shorten and try again.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const refCode = `MSG-${nanoid(8).toUpperCase()}`;

    // ── Sanity log ─────────────────────────────────────────────────────────
    try {
      await sanity.create({
        _type: 'contactSubmission',
        refCode,
        name,
        email,
        subject,
        message,
        status: 'new',
        submittedAt: new Date().toISOString(),
      });
    } catch (sanityErr) {
      // Log but don't abort — email is the primary deliverable
      console.error('Sanity contactSubmission write failed:', sanityErr);
    }

    // ── Send team notification ─────────────────────────────────────────────
    const subjectLabel = SUBJECT_LABELS[subject] || subject;
    try {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: [TEAM_EMAIL],
        replyTo: email,
        subject: `[${refCode}] ${subjectLabel} — ${name}`,
        html: buildTeamEmail({ name, email, subject, message, refCode }),
      });
    } catch (resendErr) {
      console.error('Resend team email failed:', resendErr);
      // If team email fails, this is a real problem — surface it
      return new Response(
        JSON.stringify({ error: 'Could not deliver your message. Please email us directly at hello@pixel8multimedia.co.uk.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ── Send customer acknowledgement (non-blocking) ───────────────────────
    try {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: [email],
        subject: `Thanks for your message — Pixel8 Multimedia`,
        html: buildAckEmail({ name, refCode }),
      });
    } catch (ackErr) {
      console.error('Customer ack email failed:', ackErr);
      // Non-fatal — team email already sent, message will still be answered
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Message sent! We'll be in touch within 24–48 hours.`,
        refCode,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Contact function error:', err);
    return new Response(
      JSON.stringify({ error: 'Something went wrong. Please try again.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const config: Config = {
  path: '/api/contact',
};
