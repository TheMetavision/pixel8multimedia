// netlify/functions/stripe-webhook-commission.mts
// Handles Stripe checkout.session.completed for commission orders.
// Updates Sanity commission doc: status → paid, records paymentId + timestamp.

import type { Context } from '@netlify/functions';
import Stripe from 'stripe';
import { createClient } from '@sanity/client';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-12-18.acacia' });
const endpointSecret = process.env.STRIPE_COMMISSION_WEBHOOK_SECRET!;

const sanity = createClient({
  projectId: 'bqb4w421',
  dataset: 'production',
  apiVersion: '2024-12-01',
  token: process.env.SANITY_TOKEN!,
  useCdn: false,
});

export default async function handler(req: Request, _context: Context) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const body = await req.text();
  const sig = req.headers.get('stripe-signature');

  if (!sig) {
    return new Response('Missing signature', { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, endpointSecret);
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const commissionId = session.metadata?.commissionId;

    if (!commissionId) {
      // Not a commission checkout — ignore (standard shop handles separately)
      return new Response('OK — not a commission', { status: 200 });
    }

    try {
      await sanity
        .patch(commissionId)
        .set({
          status: 'paid',
          stripePaymentId: session.payment_intent as string,
          paidAt: new Date().toISOString(),
        })
        .commit();

      console.log(`Commission ${commissionId} marked as paid`);
    } catch (err) {
      console.error(`Failed to update commission ${commissionId}:`, err);
      return new Response('Failed to update commission', { status: 500 });
    }
  }

  return new Response('OK', { status: 200 });
}

export const config = { path: '/.netlify/functions/stripe-webhook-commission' };
