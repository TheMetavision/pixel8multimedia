import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-12-18.acacia',
});

const FORMAT_LABELS = {
  poster: 'Poster Print',
  'canvas-standard': 'Canvas (Standard Frame)',
  'canvas-gallery': 'Canvas (Gallery Frame)',
};

const SIZE_LABELS = {
  small: 'Small (12×8")',
  medium: 'Medium (16×12")',
  large: 'Large (24×16")',
};

// Free-shipping threshold (GBP) and standard rate (pence)
const FREE_SHIPPING_THRESHOLD_GBP = 50;
const STANDARD_SHIPPING_PENCE = 495;

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

    const lineItems = items.map((item) => ({
      price_data: {
        currency: 'gbp',
        product_data: {
          name: item.title,
          description: `${FORMAT_LABELS[item.format] || item.format} — ${SIZE_LABELS[item.size] || item.size}`,
          metadata: {
            productId: item.productId,
            slug: item.slug,
            format: item.format,
            size: item.size,
          },
        },
        unit_amount: Math.round(item.unitPrice * 100),
      },
      quantity: item.quantity,
    }));

    const cartMeta = items.map((item) => ({
      productId: item.productId,
      slug: item.slug,
      title: item.title,
      collection: item.collection,
      format: item.format,
      size: item.size,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
    }));

    const siteUrl = process.env.URL || process.env.SITE_URL || 'https://pixel8multimedia.co.uk';

    // Conditional shipping — free over £50, otherwise £4.95 flat (GB only).
    const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    const freeShipping = subtotal >= FREE_SHIPPING_THRESHOLD_GBP;

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
        cartItems: JSON.stringify(cartMeta),
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
