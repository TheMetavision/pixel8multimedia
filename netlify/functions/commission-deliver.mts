// netlify/functions/commission-deliver.mts
// SINGLE Sanity webhook endpoint for BOTH commission delivery and dispatch.
// (Merged because the Sanity plan webhook limit was reached — one webhook,
//  two behaviours, routed on the status that fired.)
//
// Webhook GROQ filter (catches either transition):
//   (delta::before(status) != "complete" && status == "complete") ||
//   (delta::before(status) != "shipped"   && status == "shipped")
//
// Routing:
//   status == "complete" → digital delivery (signed download link email);
//                          print-only orders are just marked delivered.
//   status == "shipped"  → dispatch email (carrier + tracking + TRACK button),
//                          stamps dispatchedAt (status stays "shipped").
//
// Shared: @sanity/webhook isValidSignature, same Resend account / FROM address.

import type { Context } from '@netlify/functions';
import { createClient } from '@sanity/client';
import { isValidSignature, SIGNATURE_HEADER_NAME } from '@sanity/webhook';
import { Resend } from 'resend';
import crypto from 'crypto';

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
const DOWNLOAD_SECRET = process.env.DOWNLOAD_LINK_SECRET!;
const DOWNLOAD_EXPIRY_DAYS = 30;

// ── Verify Sanity webhook signature ──────
// Sanity signs "t=<timestamp>,v1=<base64url-hmac>" over "<timestamp>.<body>".
// isValidSignature parses + verifies correctly (a hand-rolled HMAC compare
// throws ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH on length mismatch).
async function verifySanityWebhook(body: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature) return false;
  try {
    return await isValidSignature(body, signature, secret);
  } catch (err) {
    console.error('Signature validation error:', err);
    return false;
  }
}

// ── Generate signed download URL (delivery) ──
function generateSignedUrl(commissionId: string, fileRef: string): string {
  const expiry = Date.now() + DOWNLOAD_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
  const payload = `${commissionId}:${fileRef}:${expiry}`;
  const hmac = crypto.createHmac('sha256', DOWNLOAD_SECRET);
  hmac.update(payload);
  const sig = hmac.digest('hex');

  const params = new URLSearchParams({
    id: commissionId,
    file: fileRef,
    exp: expiry.toString(),
    sig,
  });

  return `${SITE_URL}/.netlify/functions/commission-download?${params.toString()}`;
}

// ── Carrier tracking URL builder (dispatch) ──
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

function carrierLabel(carrier: string | undefined): string {
  switch ((carrier || '').toLowerCase().replace(/\s+/g, '')) {
    case 'royalmail': return 'Royal Mail';
    case 'evri': return 'Evri';
    case 'dpd': return 'DPD';
    case 'ups': return 'UPS';
    default: return carrier || 'Courier';
  }
}

// ── Branded delivery email (digital download) ──
function buildDeliveryEmailHtml(
  customerName: string,
  serviceTitle: string,
  orderRef: string,
  downloadUrl: string
): string {
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
            <h2 style="margin:0 0 8px;font-size:20px;color:#1a1a2e;">Your creation is ready! ✨</h2>
            <p style="margin:0 0 24px;color:#6b7280;font-size:15px;line-height:1.6;">
              Hi ${customerName},<br><br>
              Great news — your <strong>${serviceTitle}</strong> commission (ref: <strong>${orderRef}</strong>) has been completed.
            </p>

            <!-- Download Button -->
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td align="center" style="padding:8px 0 28px;">
                <a href="${downloadUrl}" style="display:inline-block;padding:14px 36px;background:#7c3aed;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;border-radius:8px;letter-spacing:0.3px;">
                  Download Your File
                </a>
              </td></tr>
            </table>

            <p style="margin:0 0 4px;color:#9ca3af;font-size:13px;">
              ⏱ This link stays active for ${DOWNLOAD_EXPIRY_DAYS} days.
            </p>
            <p style="margin:0;color:#9ca3af;font-size:13px;">
              If you have any questions, reply to this email and we'll be happy to help.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;padding:24px 40px;border-top:1px solid #e5e7eb;">
            <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
              Pixel8 Multimedia · hello@pixel8multimedia.co.uk<br>
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

// ── Branded dispatch email (physical print on the way) ──
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

// ── Handler: "complete" → delivery ────────────────────────────────────────
async function handleComplete(commissionId: string): Promise<Response> {
  const commission = await sanity.fetch(
    `*[_type == "commission" && _id == $id][0]{
      _id, orderRef, customerName, customerEmail,
      deliveryType, status, deliveredAt,
      "serviceTitle": service->title,
      "fileRef": finishedFile.asset._ref
    }`,
    { id: commissionId }
  );

  if (!commission) {
    return new Response('Commission not found', { status: 404 });
  }

  if (commission.status !== 'complete') {
    return new Response('Not in complete status — skipping', { status: 200 });
  }

  // G10: idempotency — never deliver twice. Status flips to 'delivered' after a
  // digital send, but a manual re-toggle back to 'complete' could otherwise
  // re-fire this handler. deliveredAt is the durable guard (mirrors
  // dispatchedAt on the shipped path).
  if (commission.deliveredAt) {
    console.log(`Commission ${commissionId} already delivered at ${commission.deliveredAt} — skipping`);
    return new Response('Already delivered', { status: 200 });
  }

  // Print-only — just mark delivered, no download email.
  if (commission.deliveryType === 'print') {
    await sanity
      .patch(commissionId)
      .set({ status: 'delivered', deliveredAt: new Date().toISOString() })
      .commit();
    return new Response('Print-only order — marked delivered', { status: 200 });
  }

  if (!commission.fileRef) {
    console.error(`Commission ${commissionId}: no finished file uploaded`);
    return new Response('No finished file — cannot deliver', { status: 400 });
  }

  const downloadUrl = generateSignedUrl(commissionId, commission.fileRef);

  const { error: emailError } = await resend.emails.send({
    from: FROM_EMAIL,
    to: commission.customerEmail,
    subject: `Your ${commission.serviceTitle} is ready! — ${commission.orderRef}`,
    html: buildDeliveryEmailHtml(
      commission.customerName,
      commission.serviceTitle,
      commission.orderRef,
      downloadUrl
    ),
  });

  if (emailError) {
    console.error('Resend error (delivery):', emailError);
    return new Response('Email send failed', { status: 500 });
  }

  await sanity
    .patch(commissionId)
    .set({ status: 'delivered', deliveredAt: new Date().toISOString() })
    .commit();

  console.log(`Commission ${commissionId} delivered to ${commission.customerEmail}`);
  return new Response('Delivered', { status: 200 });
}

// ── Handler: "shipped" → dispatch ─────────────────────────────────────────
async function handleShipped(commissionId: string): Promise<Response> {
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
    return new Response('Not in shipped status — skipping', { status: 200 });
  }

  // Digital-only orders cannot be shipped — guard against bad data.
  if (commission.deliveryType === 'digital') {
    console.warn(`Commission ${commissionId} is digital-only but marked shipped — skipping dispatch email`);
    return new Response('Digital-only order — nothing to dispatch', { status: 200 });
  }

  // Idempotency: already dispatched → don't re-send (status stays "shipped").
  if (commission.dispatchedAt) {
    console.log(`Commission ${commissionId} already dispatched at ${commission.dispatchedAt} — skipping`);
    return new Response('Already dispatched', { status: 200 });
  }

  const trackingUrl = buildTrackingUrl(commission.carrier, commission.trackingNumber);

  const { error: emailError } = await resend.emails.send({
    from: FROM_EMAIL,
    to: commission.customerEmail,
    subject: `Your order is on the way! — ${commission.orderRef}`,
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
    console.error('Resend error (dispatch):', emailError);
    return new Response('Email send failed', { status: 500 });
  }

  await sanity
    .patch(commissionId)
    .set({ dispatchedAt: new Date().toISOString() })
    .commit();

  console.log(`Commission ${commissionId} dispatch email sent to ${commission.customerEmail}`);
  return new Response('Dispatched', { status: 200 });
}

export default async function handler(req: Request, _context: Context) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // ── Verify webhook ─────────────────────
  const body = await req.text();
  const sanitySecret = process.env.SANITY_WEBHOOK_SECRET;
  // Fail closed: if no secret is configured, refuse rather than accept
  // unauthenticated webhooks. Requires SANITY_WEBHOOK_SECRET to be set in
  // Netlify AND to match the Secret on the Sanity webhook, or NOTHING delivers.
  if (!sanitySecret) {
    console.error('SANITY_WEBHOOK_SECRET not set — refusing to process webhook');
    return new Response('Webhook secret not configured', { status: 500 });
  }
  const sig = req.headers.get(SIGNATURE_HEADER_NAME) || req.headers.get('sanity-webhook-signature');
  if (!(await verifySanityWebhook(body, sig, sanitySecret))) {
    return new Response('Invalid signature', { status: 401 });
  }

  const payload = JSON.parse(body);
  const commissionId = payload._id;

  if (!commissionId) {
    return new Response('No commission ID', { status: 400 });
  }

  // Route on the status carried in the webhook payload. The handlers re-fetch
  // and re-check status from Sanity, so a stale payload can't trigger the wrong
  // path. If the payload status is neither, fall back to the fetched status.
  const payloadStatus: string | undefined = payload.status;

  try {
    if (payloadStatus === 'shipped') {
      return await handleShipped(commissionId);
    }
    if (payloadStatus === 'complete') {
      return await handleComplete(commissionId);
    }

    // Fallback: payload didn't carry a recognised status (e.g. projection
    // stripped it). Look it up and route accordingly.
    const current = await sanity.fetch(
      `*[_type == "commission" && _id == $id][0].status`,
      { id: commissionId }
    );
    if (current === 'shipped') return await handleShipped(commissionId);
    if (current === 'complete') return await handleComplete(commissionId);

    return new Response('No actionable status — skipping', { status: 200 });
  } catch (err) {
    console.error('commission-deliver error:', err);
    return new Response('Internal error', { status: 500 });
  }
}

export const config = { path: '/.netlify/functions/commission-deliver' };
