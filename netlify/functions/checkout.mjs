import Stripe from 'stripe';
import { createClient } from '@sanity/client';
import {
  FORMAT_LABELS, SIZE_LABELS, YOUR_PHOTO_PRODUCT_ID, priceCart, shippingPenceFor,
} from './_shared/pricing.mjs';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-12-18.acacia',
});

const sanity = createClient({
  projectId: 'bqb4w421',
  dataset: process.env.SANITY_DATASET || 'production',
  apiVersion: '2026-04-14',
  token: process.env.SANITY_TOKEN,
  useCdn: false,
  // With a token the default perspective also returns drafts; prices must
  // come from the published product only.
  perspective: 'published',
});

const PID_RE = /^[A-Za-z0-9_-]{20,24}$/;

/** Stripe reads an empty metadata value as "unset this key" — leave them out. */
const withoutEmpty = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== ''));

/** The Sanity products a cart refers to, by _id or (fallback) slug. */
async function loadProducts(items) {
  const stock = items.filter((i) => i && i.productId !== YOUR_PHOTO_PRODUCT_ID && !i.personalisationId);
  const ids = [...new Set(stock.map((i) => String(i.productId || '')).filter(Boolean))];
  const slugs = [...new Set(stock.map((i) => String(i.slug || '')).filter(Boolean))];
  if (!ids.length && !slugs.length) return [];
  return sanity.fetch(
    `*[_type == "product" && (_id in $ids || slug.current in $slugs)]{
      _id, "slug": slug.current, title, category, style, prices,
      "imageRef": images[0].asset._ref
    }`,
    { ids, slugs },
  );
}

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

    // Prices come from the server, never the browser: stock lines from the
    // Sanity product, Your Photo lines from _shared/pricing.mjs. The browser's
    // unitPrice is only compared, to spot a stale cart or tampering.
    const priced = priceCart(items, await loadProducts(items));
    if (!priced.ok) {
      console.warn(`checkout: rejected cart — ${priced.problems.join('; ')}`);
      return new Response(JSON.stringify({ error: priced.error, problems: priced.problems }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    for (const m of priced.mismatches) {
      console.warn(
        `checkout: client price ignored on line ${m.line} (${m.slug} ${m.formatKey}/${m.sizeKey}): ` +
        `client ${m.clientPence}p, server ${m.serverPence}p`
      );
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
    // format/size are kept for older webhook code; formatKey/sizeKey and the
    // rest are what marks a line as keyed (see _shared/order-lines.mjs).
    const lineItems = priced.lines.map((line) => {
      const personalised = line.kind === 'your-photo';
      const description = [
        `${FORMAT_LABELS[line.formatKey]} — ${SIZE_LABELS[line.sizeKey]}`,
        personalised ? 'Personalised — we email a proof to approve before printing' : null,
      ].filter(Boolean).join('. ');
      return {
        price_data: {
          currency: 'gbp',
          product_data: {
            name: line.title,
            description,
            metadata: withoutEmpty({
              productId: line.productId,
              slug: line.slug,
              title: line.title,
              collection: line.collection,
              format: line.formatKey,
              size: line.sizeKey,
              formatKey: line.formatKey,
              sizeKey: line.sizeKey,
              styleLetter: line.styleLetter,
              listingImageRef: line.listingImageRef,
              ...(personalised ? { personalisationId: line.personalisationId, styleKey: line.styleKey } : {}),
            }),
          },
          unit_amount: line.unitPence,
        },
        quantity: line.quantity,
      };
    });

    const siteUrl = process.env.URL || process.env.SITE_URL || 'https://pixel8multimedia.co.uk';

    // Conditional shipping — free over £50, otherwise £4.95 flat (GB only),
    // on the server-priced subtotal.
    const shippingPence = shippingPenceFor(priced.subtotalPence);
    const freeShipping = shippingPence === 0;
    const hasPersonalised = priced.lines.some((l) => l.kind === 'your-photo');

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
              amount: shippingPence,
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
      // A personalised design is deleted by the hourly sweep 60 minutes after
      // it expires. Stripe's default 24 h checkout window would let someone
      // pay for a design that's already gone, so carts with one get 35
      // minutes (Stripe's minimum is 30).
      ...(hasPersonalised ? { expires_at: Math.floor(Date.now() / 1000) + 35 * 60 } : {}),
      metadata: {
        source: 'shop',
        lines: String(priced.lines.length),
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
