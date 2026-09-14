import Stripe from 'stripe';
import { createClient } from '@sanity/client';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-12-18.acacia',
});

const sanity = createClient({
  projectId: 'bqb4w421',
  dataset: process.env.SANITY_DATASET || 'production',
  apiVersion: '2026-04-14',
  token: process.env.SANITY_TOKEN,
  useCdn: false,
});

// Keys match src/data/products.ts (the cart sends camelCase formats and
// square sizes) — the previous maps used 'canvas-standard' and 12×8", so
// Stripe descriptions showed the raw key and the wrong dimensions.
const FORMAT_LABELS = {
  poster: 'Poster Print',
  canvasStandard: 'Canvas (Standard Frame)',
  canvasGallery: 'Canvas (Gallery Frame)',
};

const SIZE_LABELS = {
  small: 'Small (12×12")',
  medium: 'Medium (16×16")',
  large: 'Large (20×20")',
};

// Free-shipping threshold (GBP) and standard rate (pence)
const FREE_SHIPPING_THRESHOLD_GBP = 50;
const STANDARD_SHIPPING_PENCE = 495;

const PID_RE = /^[A-Za-z0-9_-]{20,24}$/;

/**
 * Personalised lines must point at a session that is actually ready, in the
 * style the customer picked. This is the server-side check that what they're
 * paying for exists — the browser can't be trusted to say so.
 */
async function validatePersonalised(items) {
  const personalised = items.filter((i) => i.personalisationId);
  if (!personalised.length) return null;
  for (const i of personalised) {
    if (!PID_RE.test(i.personalisationId) || !/^style-[a-j]$/.test(i.styleKey || '')) {
      return 'A personalised item in your cart is invalid. Please remove it and add it again.';
    }
  }
  const ids = personalised.map((i) => `pendingPersonalisation.${i.personalisationId}`);
  const docs = await sanity.fetch(
    `*[_type == "pendingPersonalisation" && _id in $ids]{ _id, pid, status, selectedStyleKey, expiresAt, "tried": renders[!defined(error)].styleKey }`,
    { ids },
  );
  const byPid = new Map(docs.map((d) => [d.pid, d]));
  const now = new Date().toISOString();
  for (const i of personalised) {
    const d = byPid.get(i.personalisationId);
    if (!d) return "One of your personalised designs has expired — please create it again.";
    if (d.expiresAt && d.expiresAt < now) return "One of your personalised designs has expired — please create it again.";
    if (!['ready', 'paid', 'proof-sent'].includes(d.status)) return "One of your personalised designs isn't finished yet — please go back to it.";
    if (!(d.tried || []).includes(i.styleKey)) return "One of your personalised designs doesn't match the style in your cart — please re-add it.";
  }
  return null;
}

export default async (req, context) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { items } = await req.json();

    if (!items || !Array.isArray(items) || items.length === 0) {
      return new Response(JSON.stringify({ error: 'Cart is empty' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const problem = await validatePersonalised(items);
    if (problem) {
      return new Response(JSON.stringify({ error: problem }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Everything the webhook needs to rebuild the order rides on each line's
    // own product metadata (each value ≤ 500 chars, unlimited lines) rather
    // than one JSON blob in session metadata, which overflowed at ~4 lines.
    const lineItems = items.map((item) => {
      const personalised = Boolean(item.personalisationId);
      const description = [
        `${FORMAT_LABELS[item.format] || item.format} — ${SIZE_LABELS[item.size] || item.size}`,
        personalised ? 'Personalised — we email a proof to approve before printing' : null,
      ].filter(Boolean).join('. ');
      return {
        price_data: {
          currency: 'gbp',
          product_data: {
            name: item.title,
            description,
            metadata: {
              productId: item.productId,
              slug: item.slug,
              title: item.title,
              collection: item.collection || '',
              format: item.format,
              size: item.size,
              ...(personalised ? { personalisationId: item.personalisationId, styleKey: item.styleKey } : {}),
            },
          },
          unit_amount: Math.round(item.unitPrice * 100),
        },
        quantity: item.quantity,
      };
    });

    const siteUrl = process.env.URL || process.env.SITE_URL || 'https://pixel8multimedia.co.uk';

    // Conditional shipping — free over £50, otherwise £4.95 flat (GB only).
    const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    const freeShipping = subtotal >= FREE_SHIPPING_THRESHOLD_GBP;
    const hasPersonalised = items.some((i) => i.personalisationId);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: lineItems,
      shipping_address_collection: {
        allowed_countries: ['GB'],
      },
      shipping_options: [
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            fixed_amount: {
              amount: freeShipping ? 0 : STANDARD_SHIPPING_PENCE,
              currency: 'gbp',
            },
            display_name: freeShipping ? 'FREE UK P&P' : 'UK Standard P&P (£4.95)',
            delivery_estimate: {
              minimum: { unit: 'business_day', value: 3 },
              maximum: { unit: 'business_day', value: 6 },
            },
          },
        },
      ],
      metadata: {
        source: 'shop',
        lines: String(items.length),
        personalised: hasPersonalised ? 'yes' : 'no',
      },
      success_url: `${siteUrl}/order-confirmation?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/store`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Stripe checkout error:', error);
    return new Response(JSON.stringify({ error: 'Failed to create checkout session' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const config = {
  path: '/api/checkout',
};
