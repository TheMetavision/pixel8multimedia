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

    // Build the patch payload — always includes payment status + timestamps.
    // For orders that included prints, Stripe collected the shipping address
    // via shipping_address_collection; pull it onto the commission doc here
    // so fulfilment + customer emails have the address available.
    const patch: Record<string, unknown> = {
      status: 'paid',
      stripePaymentId: session.payment_intent as string,
      paidAt: new Date().toISOString(),
    };

    const shipping = session.shipping_details;
    if (shipping && shipping.address) {
      patch.shippingAddress = {
        recipientName: shipping.name || undefined,
        line1: shipping.address.line1 || '',
        line2: shipping.address.line2 || undefined,
        city: shipping.address.city || '',
        // Stripe rarely populates state for GB but capture if present
        state: shipping.address.state || undefined,
        postalCode: shipping.address.postal_code || '',
        country: shipping.address.country || 'GB',
      };
    }

    // Phone (collected via phone_number_collection on print orders)
    const phone = session.customer_details?.phone;
    if (phone) {
      patch.customerPhone = phone;
    }

    try {
      await sanity.patch(commissionId).set(patch).commit();
      console.log(
        `Commission ${commissionId} marked as paid${
          patch.shippingAddress ? ' (with shipping address)' : ''
        }`
      );
    } catch (err) {
      console.error(`Failed to update commission ${commissionId}:`, err);
      return new Response('Failed to update commission', { status: 500 });
    }
  }

  return new Response('OK', { status: 200 });
}

export const config = { path: '/.netlify/functions/stripe-webhook-commission' };
