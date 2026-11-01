// netlify/functions/_shared/shipping-deps.mts
//
// The real clients the shipping functions are wired to. Tests never import
// this: they hand the _shared/*.mjs logic fakes instead.

import { createClient } from '@sanity/client';
import { Resend } from 'resend';
import Stripe from 'stripe';
import { sanityWriteToken, setting } from './site-config.mjs';
import { shippingCreate, shippingRequest } from './shipping-client.mjs';

export const sanity = createClient({
  projectId: setting('SANITY_PROJECT_ID'),
  dataset: setting('SANITY_DATASET'),
  apiVersion: '2026-04-14',
  token: sanityWriteToken('SANITY_WRITE_TOKEN'),
  useCdn: false,
});

// Built on first use, not at import: `new Resend()` throws without a key.
let resendClient: Resend | null = null;
export const getResend = () => {
  if (resendClient) return resendClient;
  if (!process.env.RESEND_API_KEY) return null;
  return (resendClient = new Resend(process.env.RESEND_API_KEY));
};

let stripeClient: Stripe | null = null;
/** A commission's Checkout session, for its structured delivery address. */
export const retrieveSession = async (id: string) => {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not set');
  stripeClient ||= new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-12-18.acacia' as any });
  return stripeClient.checkout.sessions.retrieve(id);
};

export const shipping = (path: string, body: object) => shippingCreate(path, body);
export const fetchLabel = (labelId: string) =>
  shippingRequest(`label?labelId=${encodeURIComponent(labelId)}`, { method: 'GET' });
