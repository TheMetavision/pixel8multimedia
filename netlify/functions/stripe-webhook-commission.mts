// netlify/functions/stripe-webhook-commission.mts
// Handles Stripe checkout.session.completed for commission orders.
// On payment:
//   1. Marks the Sanity commission doc paid (idempotent — skips if already paid)
//   2. Records paymentId + paidAt + shipping address (as text) + phone
//   3. Emails the customer a branded order confirmation
//   4. Emails the Pixel8 team a "new commission" notification

import type { Context } from '@netlify/functions';
import Stripe from 'stripe';
import { createClient } from '@sanity/client';
import { Resend } from 'resend';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-12-18.acacia' });
const endpointSecret = process.env.STRIPE_COMMISSION_WEBHOOK_SECRET!;

const sanity = createClient({
  projectId: 'bqb4w421',
  dataset: 'production',
  apiVersion: '2024-12-01',
  token: process.env.SANITY_TOKEN!,
  useCdn: false,
});

const resend = new Resend(process.env.RESEND_API_KEY!);

const SITE_URL = process.env.URL || 'https://pixel8multimedia.co.uk';
const FROM_EMAIL = 'Pixel8 Multimedia <hello@pixel8multimedia.co.uk>';
const TEAM_EMAIL = process.env.TEAM_EMAIL || 'hello@pixel8multimedia.co.uk';

// ── Format a Stripe address object into a single readable block ──────────────
function formatShippingAddress(
  name: string | null | undefined,
  addr: Stripe.Address | null | undefined
): string | undefined {
  if (!addr) return undefined;
  const lines = [
    name || undefined,
    addr.line1 || undefined,
    addr.line2 || undefined,
    addr.city || undefined,
    addr.state || undefined,
    addr.postal_code || undefined,
    addr.country || undefined,
  ].filter(Boolean);
  return lines.length ? lines.join('\n') : undefined;
}

// ── Customer confirmation email ──────────────────────────────────────────────
function customerEmailHtml(args: {
  customerName: string;
  serviceTitle: string;
  orderRef: string;
  total: number;
  deliveryType: string;
  hasShipping: boolean;
}): string {
  const { customerName, serviceTitle, orderRef, total, deliveryType, hasShipping } = args;
  const nextSteps =
    deliveryType === 'print'
      ? 'Our team will create your artwork and prepare your print for dispatch. We\u2019ll email you a tracking update once it\u2019s on its way.'
      : deliveryType === 'both'
      ? 'Our team will create your artwork. You\u2019ll receive your digital file by email when it\u2019s ready, and your print will be dispatched separately with a tracking update.'
      : 'Our team will get to work on your artwork. You\u2019ll receive a secure download link by email as soon as it\u2019s ready.';

  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
        <tr>
          <td style="background:linear-gradient(135deg,#7c3aed 0%,#a855f7 100%);padding:32px 40px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:800;letter-spacing:-0.5px;">Pixel8 Multimedia</h1>
            <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:13px;letter-spacing:0.5px;">POP. ART. MOTION.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <h2 style="margin:0 0 8px;font-size:20px;color:#1a1a2e;">Order confirmed \u2014 thank you! \u{1F389}</h2>
            <p style="margin:0 0 24px;color:#6b7280;font-size:15px;line-height:1.6;">
              Hi ${customerName},<br><br>
              Thanks for your order. We\u2019ve received your <strong>${serviceTitle}</strong> commission and payment in full.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;margin:0 0 24px;">
              <tr><td style="padding:16px 20px;">
                <p style="margin:0 0 6px;color:#6b7280;font-size:13px;">Order reference</p>
                <p style="margin:0 0 14px;color:#1a1a2e;font-size:16px;font-weight:700;">${orderRef}</p>
                <p style="margin:0 0 6px;color:#6b7280;font-size:13px;">Total paid</p>
                <p style="margin:0;color:#1a1a2e;font-size:16px;font-weight:700;">\u00A3${total.toFixed(2)}</p>
              </td></tr>
            </table>
            <h3 style="margin:0 0 8px;font-size:15px;color:#1a1a2e;">What happens next</h3>
            <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.6;">${nextSteps}</p>
            ${
              hasShipping
                ? `<p style="margin:0 0 24px;color:#6b7280;font-size:13px;line-height:1.6;">We\u2019ll ship to the address you provided at checkout. If anything looks wrong, reply to this email straight away.</p>`
                : ''
            }
            <p style="margin:0;color:#9ca3af;font-size:13px;">
              Questions? Just reply to this email \u2014 we\u2019re happy to help.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;padding:24px 40px;border-top:1px solid #e5e7eb;">
            <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
              Pixel8 Multimedia \u00B7 hello@pixel8multimedia.co.uk<br>
              <a href="${SITE_URL}" style="color:#7c3aed;text-decoration:none;">pixel8multimedia.co.uk</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Team notification email ──────────────────────────────────────────────────
function teamEmailHtml(args: {
  serviceTitle: string;
  orderRef: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  total: number;
  deliveryType: string;
  shippingAddress?: string;
  commissionId: string;
}): string {
  const {
    serviceTitle, orderRef, customerName, customerEmail, customerPhone,
    total, deliveryType, shippingAddress, commissionId,
  } = args;
  const studioUrl = `https://pixel8multimedia.sanity.studio/structure/commission;${commissionId}`;
  return `
<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;">
  <div style="background:#7c3aed;padding:16px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:22px;">NEW PAID COMMISSION</h1>
  </div>
  <div style="padding:24px;">
    <p style="margin:0 0 4px;font-size:18px;"><strong>${serviceTitle}</strong></p>
    <p style="margin:0 0 16px;color:#666;">Ref: <strong>${orderRef}</strong> \u00B7 \u00A3${total.toFixed(2)} \u00B7 ${deliveryType.toUpperCase()}</p>
    <p style="margin:0 0 4px;"><strong>Customer:</strong> ${customerName}</p>
    <p style="margin:0 0 4px;"><strong>Email:</strong> ${customerEmail}</p>
    ${customerPhone ? `<p style="margin:0 0 4px;"><strong>Phone:</strong> ${customerPhone}</p>` : ''}
    ${
      shippingAddress
        ? `<div style="margin:16px 0;padding:14px 16px;background:#f5f5f5;border-radius:6px;">
             <strong>Ship to:</strong><br/>${shippingAddress.replace(/\n/g, '<br/>')}
           </div>`
        : `<p style="margin:16px 0;color:#999;">No shipping address (digital-only order).</p>`
    }
    <div style="margin-top:20px;padding:16px;background:#f3e8ff;border-left:4px solid #7c3aed;border-radius:4px;">
      <strong>Next steps:</strong><br/>
      1. Open in <a href="${studioUrl}" style="color:#7c3aed;">Sanity Studio</a><br/>
      2. Create the artwork<br/>
      3. Upload to "Finished File" and set status to <strong>Complete</strong> to trigger customer delivery
    </div>
  </div>
</div>`;
}

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

  if (event.type !== 'checkout.session.completed') {
    return new Response('OK', { status: 200 });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const commissionId = session.metadata?.commissionId;

  if (!commissionId) {
    // Not a commission checkout — standard shop handles its own webhook.
    return new Response('OK \u2014 not a commission', { status: 200 });
  }

  try {
    // ── Idempotency: if already processed, do nothing (Stripe retries safely) ──
    const existing = await sanity.fetch(
      `*[_type == "commission" && _id == $id][0]{
        _id, status, orderRef, customerName, customerEmail, amount, deliveryType,
        "serviceTitle": service->title
      }`,
      { id: commissionId }
    );

    if (!existing) {
      console.error(`Commission ${commissionId} not found`);
      return new Response('Commission not found', { status: 404 });
    }

    if (existing.status === 'paid' || existing.status === 'complete' || existing.status === 'delivered') {
      console.log(`Commission ${commissionId} already processed (${existing.status}) — skipping`);
      return new Response('Already processed', { status: 200 });
    }

    // ── Build patch ──────────────────────────────────────────────────────
    // Newer Stripe API versions nest shipping under collected_information.
    // Fall back to the legacy top-level field for older API versions.
    const shippingDetails =
      (session as any).collected_information?.shipping_details ||
      (session as any).shipping_details;

    const shippingAddressText = formatShippingAddress(
      shippingDetails?.name,
      shippingDetails?.address
    );

    const patch: Record<string, unknown> = {
      status: 'paid',
      stripePaymentId: session.payment_intent as string,
      paidAt: new Date().toISOString(),
    };
    // shippingAddress on the commission schema is a TEXT field — write a string.
    if (shippingAddressText) {
      patch.shippingAddress = shippingAddressText;
    }
    const phone = session.customer_details?.phone;
    if (phone) {
      patch.customerPhone = phone;
    }

    await sanity.patch(commissionId).set(patch).commit();
    console.log(`Commission ${commissionId} marked paid${shippingAddressText ? ' (with address)' : ''}`);

    // ── Emails (best-effort — a failure here shouldn't 500 the webhook,
    //    or Stripe will retry the whole event and we'd double-send) ─────────
    const serviceTitle = existing.serviceTitle || 'your commission';
    const total = existing.amount ?? 0;
    const deliveryType = existing.deliveryType || 'digital';

    try {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: existing.customerEmail,
        subject: `Order confirmed \u2014 ${existing.orderRef}`,
        html: customerEmailHtml({
          customerName: existing.customerName,
          serviceTitle,
          orderRef: existing.orderRef,
          total,
          deliveryType,
          hasShipping: !!shippingAddressText,
        }),
      });
    } catch (e) {
      console.error('Customer confirmation email failed:', e);
    }

    try {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: TEAM_EMAIL,
        replyTo: existing.customerEmail,
        subject: `NEW PAID COMMISSION \u2014 ${serviceTitle} \u2014 ${existing.orderRef}`,
        html: teamEmailHtml({
          serviceTitle,
          orderRef: existing.orderRef,
          customerName: existing.customerName,
          customerEmail: existing.customerEmail,
          customerPhone: phone || undefined,
          total,
          deliveryType,
          shippingAddress: shippingAddressText,
          commissionId,
        }),
      });
    } catch (e) {
      console.error('Team notification email failed:', e);
    }

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error(`Failed to process commission ${commissionId}:`, err);
    return new Response('Failed to update commission', { status: 500 });
  }
}

export const config = { path: '/.netlify/functions/stripe-webhook-commission' };
