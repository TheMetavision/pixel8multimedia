import Stripe from 'stripe';
import { createClient } from '@sanity/client';
import { Resend } from 'resend';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-12-18.acacia',
});

const sanity = createClient({
  projectId: process.env.SANITY_PROJECT_ID,
  dataset: process.env.SANITY_DATASET || 'production',
  apiVersion: '2026-04-14',
  token: process.env.SANITY_WRITE_TOKEN,
  useCdn: false,
});

const resend = new Resend(process.env.RESEND_API_KEY);

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

export default async (req, context) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const body = await req.text();
  const sig = req.headers.get('stripe-signature');

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    try {
      const shipping = session.shipping_details?.address || {};
      const customerName = session.shipping_details?.name || session.customer_details?.name || 'Customer';
      const customerEmail = session.customer_details?.email || '';
      const totalAmount = (session.amount_total || 0) / 100;
      const cartItems = JSON.parse(session.metadata?.cartItems || '[]');

      const lineItems = cartItems.map((item) => ({
        _type: 'object',
        _key: `${item.slug}-${item.format}-${item.size}-${Date.now()}`,
        productTitle: item.title,
        format: FORMAT_LABELS[item.format] || item.format,
        size: SIZE_LABELS[item.size] || item.size,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      }));

      // Create order in Sanity
      await sanity.create({
        _type: 'order',
        stripeSessionId: session.id,
        stripePaymentId: session.payment_intent,
        customerName,
        customerEmail,
        shippingAddress: {
          line1: shipping.line1 || '',
          line2: shipping.line2 || '',
          city: shipping.city || '',
          county: shipping.state || '',
          postcode: shipping.postal_code || '',
          country: shipping.country || '',
        },
        lineItems,
        totalAmount,
        status: 'received',
        createdAt: new Date().toISOString(),
      });

      console.log(`Order created in Sanity for session ${session.id}`);

      // Build email content
      const itemRows = cartItems
        .map((item) =>
          `<tr>
            <td style="padding: 8px 12px; border-bottom: 1px solid #2A2A2E; color: #F5F5F0;">${item.title}</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #2A2A2E; color: #999;">${FORMAT_LABELS[item.format] || item.format}</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #2A2A2E; color: #999;">${SIZE_LABELS[item.size] || item.size}</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #2A2A2E; color: #999; text-align: center;">${item.quantity}</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #2A2A2E; text-align: right; color: #F07828; font-family: monospace;">£${(item.unitPrice * item.quantity).toFixed(2)}</td>
          </tr>`
        ).join('');

      const orderTable = `
        <table style="width: 100%; border-collapse: collapse; font-family: 'DM Sans', Arial, sans-serif; font-size: 14px;">
          <thead>
            <tr style="background: #1A1A1E;">
              <th style="padding: 10px 12px; text-align: left; color: #F07828; font-family: 'Montserrat', Arial, sans-serif; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em;">Product</th>
              <th style="padding: 10px 12px; text-align: left; color: #F07828; font-family: 'Montserrat', Arial, sans-serif; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em;">Format</th>
              <th style="padding: 10px 12px; text-align: left; color: #F07828; font-family: 'Montserrat', Arial, sans-serif; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em;">Size</th>
              <th style="padding: 10px 12px; text-align: center; color: #F07828; font-family: 'Montserrat', Arial, sans-serif; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em;">Qty</th>
              <th style="padding: 10px 12px; text-align: right; color: #F07828; font-family: 'Montserrat', Arial, sans-serif; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em;">Price</th>
            </tr>
          </thead>
          <tbody>${itemRows}</tbody>
          <tfoot>
            <tr>
              <td colspan="4" style="padding: 10px 12px; text-align: right; font-weight: bold; color: #F5F5F0;">Total:</td>
              <td style="padding: 10px 12px; text-align: right; font-weight: bold; color: #F07828; font-family: monospace; font-size: 16px;">£${totalAmount.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>`;

      const shippingBlock = `
        <div style="background: #1A1A1E; padding: 16px; border-radius: 4px; margin: 16px 0; border-left: 3px solid #F07828;">
          <strong style="color: #F5F5F0;">Ship to:</strong><br/>
          <span style="color: #999;">${customerName}<br/>
          ${shipping.line1 || ''}${shipping.line2 ? '<br/>' + shipping.line2 : ''}<br/>
          ${shipping.city || ''}${shipping.state ? ', ' + shipping.state : ''}<br/>
          ${shipping.postal_code || ''}<br/>
          ${shipping.country || ''}</span>
        </div>`;

      // Customer confirmation email
      try {
        await resend.emails.send({
          from: process.env.EMAIL_FROM || 'Pixel8 Multimedia <orders@pixel8multimedia.co.uk>',
          to: [customerEmail],
          subject: `Order Confirmed — Pixel8 Multimedia`,
          html: `
            <div style="font-family: 'DM Sans', Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #F5F5F0; background: #0D0D0D;">
              <div style="background: #0D0D0D; padding: 24px; text-align: center; border-bottom: 2px solid #F07828;">
                <h1 style="color: #F5F5F0; margin: 0; font-size: 24px; font-family: 'Montserrat', Arial, sans-serif; letter-spacing: 0.05em;">PIXEL<span style="background: linear-gradient(135deg, #E91E7B, #6C63FF, #00BCD4); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">8</span></h1>
                <p style="color: #666; margin: 4px 0 0; font-size: 11px; letter-spacing: 0.15em; text-transform: uppercase;">Pop. Art. Motion.</p>
              </div>
              <div style="padding: 32px 24px; background: #0D0D0D;">
                <h2 style="margin: 0 0 8px; font-size: 22px; color: #F5F5F0; font-family: 'Montserrat', Arial, sans-serif;">Thanks for your order, ${customerName}!</h2>
                <p style="color: #999; line-height: 1.6; margin: 0 0 24px;">
                  Your order has been received and is being prepared. All our products are made to order in our UK studio — please allow 3-6 working days for dispatch.
                </p>
                ${orderTable}
                ${shippingBlock}
                <p style="color: #999; line-height: 1.6; margin: 24px 0 0;">
                  We'll send you another email when your order has been dispatched with tracking details.
                </p>
                <p style="color: #666; margin-top: 32px; font-size: 12px; font-family: monospace;">
                  Payment ID: ${session.payment_intent}<br/>
                  Order placed: ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
              </div>
              <div style="background: #1A1A1E; padding: 16px; text-align: center; font-size: 11px; color: #666;">
                <p style="margin: 0;">&copy; 2026 Pixel8 Multimedia. All rights reserved.</p>
                <p style="margin: 4px 0 0;"><a href="https://pixel8multimedia.co.uk" style="color: #F07828;">pixel8multimedia.co.uk</a></p>
              </div>
            </div>
          `,
        });
        console.log(`Customer confirmation email sent to ${customerEmail}`);
      } catch (emailErr) {
        console.error('Failed to send customer email:', emailErr);
      }

      // Team notification email
      const teamEmail = process.env.TEAM_EMAIL || process.env.EMAIL_FROM || 'orders@pixel8multimedia.co.uk';
      try {
        await resend.emails.send({
          from: process.env.EMAIL_FROM || 'Pixel8 Multimedia <orders@pixel8multimedia.co.uk>',
          to: [teamEmail],
          subject: `NEW ORDER — £${totalAmount.toFixed(2)} — ${customerName}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #1a1a1a;">
              <div style="background: #F07828; padding: 16px; text-align: center;">
                <h1 style="color: #000; margin: 0; font-size: 22px;">NEW ORDER RECEIVED</h1>
              </div>
              <div style="padding: 24px;">
                <h2 style="margin: 0 0 4px;">${customerName}</h2>
                <p style="color: #666; margin: 0 0 20px;">${customerEmail}</p>
                ${orderTable}
                ${shippingBlock}
                <div style="margin-top: 20px; padding: 16px; background: #FFF9E6; border-left: 4px solid #F07828; border-radius: 4px;">
                  <strong>Next steps:</strong><br/>
                  1. Open <a href="https://pixel8multimedia.sanity.studio" style="color: #E91E7B;">Sanity Studio</a> to view/manage this order<br/>
                  2. Prepare artwork for printing<br/>
                  3. Update order status to "In Production" when started<br/>
                  4. Add tracking number and update to "Dispatched" when shipped
                </div>
                <p style="color: #999; margin-top: 20px; font-size: 12px;">
                  Stripe Session: ${session.id}<br/>
                  Payment Intent: ${session.payment_intent}
                </p>
              </div>
            </div>
          `,
        });
        console.log(`Team notification sent to ${teamEmail}`);
      } catch (emailErr) {
        console.error('Failed to send team notification:', emailErr);
      }
    } catch (err) {
      console.error('Error processing checkout.session.completed:', err);
      return new Response('Webhook processing error (logged)', { status: 200 });
    }
  }

  return new Response('OK', { status: 200 });
};

export const config = {
  path: '/api/webhook',
};
