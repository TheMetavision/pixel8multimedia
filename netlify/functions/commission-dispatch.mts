// netlify/functions/commission-dispatch.mts
// Triggered by Sanity GROQ webhook (separate from commission-deliver):
//   filter = delta::before(status) != "shipped" && status == "shipped"
// Mirrors the commission-deliver pattern exactly:
//   - same @sanity/webhook isValidSignature verification
//   - same Resend account / FROM address
// On a physical order being marked "shipped":
//   1. Builds a carrier tracking URL from carrier + trackingNumber
//   2. Sends a branded "Your order is on the way" email (TRACK YOUR PARCEL button)
//   3. Patches commission: dispatchedAt timestamp (status STAYS "shipped" — final state)
//
// Idempotency: skips if dispatchedAt is already set, so re-saving a shipped doc
// (or a webhook retry) will not double-send. Status is NOT changed, because
// "shipped" is the chosen terminal value; we guard on the timestamp instead.

import type { Context } from '@netlify/functions';
import { createClient } from '@sanity/client';
import { isValidSignature, SIGNATURE_HEADER_NAME } from '@sanity/webhook';
import { Resend } from 'resend';

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
const LOGO_URL = 'https://pixel8multimedia.co.uk/Pixel8_Logo.png';

// ── Verify Sanity webhook signature ──────
// Identical to commission-deliver: Sanity signs "t=<ts>,v1=<base64url-hmac>"
// over "<ts>.<body>". isValidSignature parses + verifies correctly. A
// hand-rolled HMAC compare throws ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH.
async function verifySanityWebhook(body: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature) return false;
  try {
    return await isValidSignature(body, signature, secret);
  } catch (err) {
    console.error('Signature validation error:', err);
    return false;
  }
}

// ── Carrier tracking URL builder ─────────
// Returns null for unknown carriers / missing number → email falls back to
// showing the number as plain text with no button.
function buildTrackingUrl(carrier: string | undefined, trackingNumber: string | undefined): string | null {
  if (!carrier || !trackingNumber || !trackingNumber.trim()) return null;
  const num = encodeURIComponent(trackingNumber.trim());
  switch (carrier.toLowerCase().replace(/\s+/g, '')) {
    case 'royalmail':
      // Royal Mail currently recommends the query form while their standard
      // hash-route links have known technical issues.
      return `https://www.royalmail.com/track-your-item?trackNumber=${num}`;
    case 'evri':
      return `https://www.evri.com/track/parcel/${num}`;
    case 'dpd':
      return `https://track.dpd.co.uk/parcels/${num}`;
    case 'ups':
      return `https://www.ups.com/track?tracknum=${num}`;
    default:
      return null;
  }
}

// Pretty carrier label for display (the stored value is the dropdown value).
function carrierLabel(carrier: string | undefined): string {
  switch ((carrier || '').toLowerCase().replace(/\s+/g, '')) {
    case 'royalmail': return 'Royal Mail';
    case 'evri': return 'Evri';
    case 'dpd': return 'DPD';
    case 'ups': return 'UPS';
    default: return carrier || 'Courier';
  }
}

// ── Branded email HTML (shared Pixel8 shell: dark header + logo + tagline) ──
function buildDispatchEmailHtml(args: {
  customerName: string;
  serviceTitle: string;
  orderRef: string;
  carrier: string | undefined;
  trackingNumber: string | undefined;
  trackingUrl: string | null;
}): string {
  const { customerName, serviceTitle, orderRef, carrier, trackingNumber, trackingUrl } = args;
  const carrierName = carrierLabel(carrier);
  const cleanTracking = trackingNumber?.trim();

  const trackingBlock = cleanTracking
    ? `
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;margin:0 0 24px;">
              <tr><td style="padding:16px 20px;">
                <p style="margin:0 0 6px;color:#6b7280;font-size:13px;">Carrier</p>
                <p style="margin:0 0 14px;color:#1a1a2e;font-size:16px;font-weight:700;">${carrierName}</p>
                <p style="margin:0 0 6px;color:#6b7280;font-size:13px;">Tracking number</p>
                <p style="margin:0;color:#1a1a2e;font-size:16px;font-weight:700;letter-spacing:0.5px;">${cleanTracking}</p>
              </td></tr>
            </table>`
    : '';

  const trackButton = trackingUrl
    ? `
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td align="center" style="padding:8px 0 28px;">
                <a href="${trackingUrl}" style="display:inline-block;padding:14px 36px;background:#7c3aed;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;border-radius:8px;letter-spacing:0.3px;">
                  TRACK YOUR PARCEL
                </a>
              </td></tr>
            </table>`
    : '';

  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
        <!-- Header (dark block + logo + tagline) -->
        <tr>
          <td style="background:#0e0e14;padding:32px 40px 24px;text-align:center;">
            <img src="${LOGO_URL}" width="180" alt="Pixel8 Multimedia" style="display:block;margin:0 auto;max-width:180px;height:auto;border:0;outline:none;text-decoration:none;">
            <p style="margin:18px 0 0;color:rgba(255,255,255,0.55);font-size:12px;letter-spacing:2px;text-transform:uppercase;">POP. ART. MOTION.</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:40px;">
            <h2 style="margin:0 0 8px;font-size:20px;color:#1a1a2e;">Your order is on the way! \u{1F4E6}</h2>
            <p style="margin:0 0 24px;color:#6b7280;font-size:15px;line-height:1.6;">
              Hi ${customerName},<br><br>
              Good news \u2014 your <strong>${serviceTitle}</strong> print (ref: <strong>${orderRef}</strong>) has been dispatched and is on its way to you${carrier ? ` with <strong>${carrierName}</strong>` : ''}.
            </p>

            ${trackingBlock}
            ${trackButton}

            <p style="margin:0;color:#9ca3af;font-size:13px;">
              Tracking can take a few hours to update after dispatch. Any questions, just reply to this email \u2014 we\u2019re happy to help.
            </p>
          </td>
        </tr>

        <!-- Footer -->
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

export default async function handler(req: Request, _context: Context) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // ── Verify webhook ─────────────────────
  const body = await req.text();
  const sanitySecret = process.env.SANITY_WEBHOOK_SECRET;
  if (sanitySecret) {
    const sig = req.headers.get(SIGNATURE_HEADER_NAME) || req.headers.get('sanity-webhook-signature');
    if (!(await verifySanityWebhook(body, sig, sanitySecret))) {
      return new Response('Invalid signature', { status: 401 });
    }
  }

  const payload = JSON.parse(body);
  const commissionId = payload._id;

  if (!commissionId) {
    return new Response('No commission ID', { status: 400 });
  }

  try {
    const commission = await sanity.fetch(
      `*[_type == "commission" && _id == $id][0]{
        _id, orderRef, customerName, customerEmail,
        deliveryType, status, carrier, trackingNumber, dispatchedAt,
        "serviceTitle": service->title
      }`,
      { id: commissionId }
    );

    if (!commission) {
      return new Response('Commission not found', { status: 404 });
    }

    if (commission.status !== 'shipped') {
      return new Response('Not in shipped status \u2014 skipping', { status: 200 });
    }

    // Digital-only orders cannot be "shipped" — guard against bad data.
    if (commission.deliveryType === 'digital') {
      console.warn(`Commission ${commissionId} is digital-only but marked shipped — skipping dispatch email`);
      return new Response('Digital-only order \u2014 nothing to dispatch', { status: 200 });
    }

    // Idempotency: already dispatched → don't re-send (status stays "shipped").
    if (commission.dispatchedAt) {
      console.log(`Commission ${commissionId} already dispatched at ${commission.dispatchedAt} \u2014 skipping`);
      return new Response('Already dispatched', { status: 200 });
    }

    const trackingUrl = buildTrackingUrl(commission.carrier, commission.trackingNumber);

    // ── Send email ───────────────────────
    const { error: emailError } = await resend.emails.send({
      from: FROM_EMAIL,
      to: commission.customerEmail,
      subject: `Your order is on the way! \u2014 ${commission.orderRef}`,
      html: buildDispatchEmailHtml({
        customerName: commission.customerName,
        serviceTitle: commission.serviceTitle || 'your commission',
        orderRef: commission.orderRef,
        carrier: commission.carrier,
        trackingNumber: commission.trackingNumber,
        trackingUrl,
      }),
    });

    if (emailError) {
      console.error('Resend error:', emailError);
      return new Response('Email send failed', { status: 500 });
    }

    // ── Stamp dispatchedAt (status stays "shipped") ──
    await sanity
      .patch(commissionId)
      .set({ dispatchedAt: new Date().toISOString() })
      .commit();

    console.log(`Commission ${commissionId} dispatch email sent to ${commission.customerEmail}`);
    return new Response('Dispatched', { status: 200 });
  } catch (err) {
    console.error('commission-dispatch error:', err);
    return new Response('Internal error', { status: 500 });
  }
}

export const config = { path: '/.netlify/functions/commission-dispatch' };
