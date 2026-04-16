// netlify/functions/commission-checkout.mts
// Receives commission form (multipart), uploads customer files to Sanity,
// creates a commission document, creates a Stripe Checkout Session, returns URL.

import type { Context } from '@netlify/functions';
import Stripe from 'stripe';
import { createClient } from '@sanity/client';
import { nanoid } from 'nanoid';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-12-18.acacia' });

const sanity = createClient({
  projectId: 'bqb4w421',
  dataset: 'production',
  apiVersion: '2024-12-01',
  token: process.env.SANITY_TOKEN!,
  useCdn: false,
});

const SITE_URL = process.env.URL || 'https://pixel8multimedia.co.uk';

// ── Commission pricing (pence) ──────────────────
// Base price per service — override in Sanity `service.price` if set
const BASE_PRICE_DIGITAL = 2999; // £29.99
const PRINT_SURCHARGES: Record<string, Record<string, number>> = {
  poster:            { '12x8': 999, '16x12': 1299, '24x16': 1699 },
  'canvas-standard': { '12x8': 2799, '16x12': 3299, '24x16': 4499 },
  'canvas-gallery':  { '12x8': 2999, '16x12': 3599, '24x16': 4799 },
};

function calculatePrice(
  deliveryType: string,
  printFormat?: string,
  printSize?: string,
  servicePrice?: number | null
): number {
  const base = servicePrice ? Math.round(servicePrice * 100) : BASE_PRICE_DIGITAL;

  if (deliveryType === 'digital') return base;

  const surcharge =
    printFormat && printSize
      ? (PRINT_SURCHARGES[printFormat]?.[printSize] ?? 0)
      : 0;

  if (deliveryType === 'print') return surcharge || base;
  // 'both'
  return base + (surcharge || 0);
}

export default async function handler(req: Request, _context: Context) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const formData = await req.formData();

    // ── Extract fields ────────────────────────
    const serviceSlug = formData.get('serviceSlug') as string;
    const serviceTitle = formData.get('serviceTitle') as string;
    const name = formData.get('name') as string;
    const email = formData.get('email') as string;
    const brief = formData.get('brief') as string;
    const deliveryType = formData.get('deliveryType') as string;
    const printSize = (formData.get('printSize') as string) || undefined;
    const printFormat = (formData.get('printFormat') as string) || undefined;
    const shippingAddress = (formData.get('shippingAddress') as string) || undefined;

    if (!serviceSlug || !name || !email || !brief || !deliveryType) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ── Look up service doc for price + _id ───
    const service = await sanity.fetch(
      `*[_type == "service" && slug.current == $slug][0]{ _id, price }`,
      { slug: serviceSlug }
    );

    if (!service) {
      return new Response(
        JSON.stringify({ error: 'Service not found.' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ── Upload files to Sanity ────────────────
    const files = formData.getAll('files') as File[];
    const uploadedAssets: Array<{ _type: 'image'; asset: { _type: 'reference'; _ref: string } }> = [];

    for (const file of files) {
      if (!file.size) continue;
      const buffer = Buffer.from(await file.arrayBuffer());
      const asset = await sanity.assets.upload('image', buffer, {
        filename: file.name,
        contentType: file.type,
      });
      uploadedAssets.push({
        _type: 'image',
        asset: { _type: 'reference', _ref: asset._id },
      });
    }

    // ── Generate order ref ────────────────────
    const orderRef = `PX-${nanoid(8).toUpperCase()}`;

    // ── Calculate amount ──────────────────────
    const amountPence = calculatePrice(deliveryType, printFormat, printSize, service.price);

    // ── Create commission doc (pending) ───────
    const commission = await sanity.create({
      _type: 'commission',
      orderRef,
      service: { _type: 'reference', _ref: service._id },
      status: 'pending',
      customerName: name,
      customerEmail: email,
      brief,
      deliveryType,
      printSize,
      printFormat,
      shippingAddress,
      uploadedFiles: uploadedAssets,
      amount: amountPence / 100,
    });

    // ── Create Stripe Checkout Session ────────
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: email,
      metadata: {
        commissionId: commission._id,
        orderRef,
        serviceSlug,
      },
      line_items: [
        {
          price_data: {
            currency: 'gbp',
            unit_amount: amountPence,
            product_data: {
              name: `${serviceTitle} — Commission`,
              description: `Order ${orderRef} · ${deliveryType === 'digital' ? 'Digital download' : deliveryType === 'print' ? `${printFormat} ${printSize}` : `Digital + ${printFormat} ${printSize}`}`,
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${SITE_URL}/commission/success?ref=${orderRef}`,
      cancel_url: `${SITE_URL}/services/${serviceSlug}#commission`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('commission-checkout error:', err);
    return new Response(
      JSON.stringify({ error: 'Failed to create checkout session. Please try again.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

export const config = { path: '/.netlify/functions/commission-checkout' };
