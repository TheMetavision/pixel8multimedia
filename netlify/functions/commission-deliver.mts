// netlify/functions/commission-deliver.mts
// The Sanity webhook "Commission Delivery" (commission complete / shipped).
//
// KEPT LIVE until /api/sanity-orders-webhook has passed its live test; then
// Alan repoints the webhook there and this is retired. Both run the same code:
//   status == "complete" → _shared/commission-delivery.mts (download email;
//                          print-only orders are just marked delivered)
//   status == "shipped"  → _shared/dispatch-email.mjs (dispatch email, sent
//                          once: an atomic claim, then dispatchedAt)
//
// Webhook GROQ filter (as configured in sanity.io/manage):
//   (delta::before(status) != "complete" && status == "complete") ||
//   (delta::before(status) != "shipped"   && status == "shipped")

import type { Context } from '@netlify/functions';
import { createClient } from '@sanity/client';
import { isValidSignature, SIGNATURE_HEADER_NAME } from '@sanity/webhook';
import { Resend } from 'resend';
import { deliverCommission } from './_shared/commission-delivery.mts';
import { sendDispatchEmail } from './_shared/dispatch-email.mjs';
import { sanityWriteToken, setting } from './_shared/site-config.mjs';

const sanity = createClient({
  projectId: setting('SANITY_PROJECT_ID'),
  dataset: setting('SANITY_DATASET'),
  apiVersion: '2024-12-01',
  token: sanityWriteToken('SANITY_TOKEN'),
  useCdn: false,
});

let resendClient: Resend | null = null;
const getResend = () => {
  if (resendClient) return resendClient;
  if (!process.env.RESEND_API_KEY) return null;
  return (resendClient = new Resend(process.env.RESEND_API_KEY));
};

// Sanity signs "t=<timestamp>,v1=<base64url-hmac>" over "<timestamp>.<body>".
async function verifySanityWebhook(body: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature) return false;
  try {
    return await isValidSignature(body, signature, secret);
  } catch (err) {
    console.error('Signature validation error:', err);
    return false;
  }
}

async function handleShipped(commissionId: string): Promise<Response> {
  const r = await sendDispatchEmail({ kind: 'commission', id: commissionId, sanity, getResend });
  return new Response(r.sent ? 'Dispatched' : r.reason, { status: r.status });
}

async function handleComplete(commissionId: string): Promise<Response> {
  const resend = getResend();
  if (!resend) return new Response('RESEND_API_KEY not set', { status: 500 });
  return deliverCommission(commissionId, { sanity, resend });
}

export default async function handler(req: Request, _context: Context) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const body = await req.text();
  const sanitySecret = process.env.SANITY_WEBHOOK_SECRET;
  // Fail closed: no secret configured → refuse rather than accept unsigned webhooks.
  if (!sanitySecret) {
    console.error('SANITY_WEBHOOK_SECRET not set — refusing to process webhook');
    return new Response('Webhook secret not configured', { status: 500 });
  }
  const sig = req.headers.get(SIGNATURE_HEADER_NAME) || req.headers.get('sanity-webhook-signature');
  if (!(await verifySanityWebhook(body, sig, sanitySecret))) {
    return new Response('Invalid signature', { status: 401 });
  }

  const payload = JSON.parse(body);
  const commissionId = payload._id;
  if (!commissionId) {
    return new Response('No commission ID', { status: 400 });
  }

  // Route on the payload's status; the handlers re-read and re-check it.
  try {
    if (payload.status === 'shipped') return await handleShipped(commissionId);
    if (payload.status === 'complete') return await handleComplete(commissionId);

    const current = await sanity.fetch(`*[_type == "commission" && _id == $id][0].status`, { id: commissionId });
    if (current === 'shipped') return await handleShipped(commissionId);
    if (current === 'complete') return await handleComplete(commissionId);
    return new Response('No actionable status — skipping', { status: 200 });
  } catch (err) {
    console.error('commission-deliver error:', err);
    return new Response('Internal error', { status: 500 });
  }
}

export const config = { path: '/.netlify/functions/commission-deliver' };
