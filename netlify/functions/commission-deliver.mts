// netlify/functions/commission-deliver.mts
// Triggered by Sanity GROQ webhook: filter = delta::before(status) != "complete" && status == "complete"
// 1. Generates a signed, time-limited URL for the finished file
// 2. Sends branded delivery email via Resend
// 3. Patches commission: status → delivered, deliveredAt timestamp

import type { Context } from '@netlify/functions';
import { createClient } from '@sanity/client';
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
const DOWNLOAD_SECRET = process.env.DOWNLOAD_LINK_SECRET!;
const DOWNLOAD_EXPIRY_HOURS = 72;

// ── Verify Sanity webhook signature ──────
function verifySanityWebhook(body: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(body);
  const digest = hmac.digest('base64');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

// ── Generate signed download URL ─────────
function generateSignedUrl(commissionId: string, fileRef: string): string {
  const expiry = Date.now() + DOWNLOAD_EXPIRY_HOURS * 60 * 60 * 1000;
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

// ── Branded email HTML ───────────────────
function buildEmailHtml(
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
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#7c3aed 0%,#a855f7 100%);padding:32px 40px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:800;letter-spacing:-0.5px;">Pixel8 Multimedia</h1>
            <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:13px;letter-spacing:0.5px;">POP. ART. MOTION.</p>
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
              ⏱ This link expires in ${DOWNLOAD_EXPIRY_HOURS} hours for security.
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

export default async function handler(req: Request, _context: Context) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // ── Verify webhook ─────────────────────
  const body = await req.text();
  const sanitySecret = process.env.SANITY_WEBHOOK_SECRET;
  if (sanitySecret) {
    const sig = req.headers.get('sanity-webhook-signature');
    if (!verifySanityWebhook(body, sig, sanitySecret)) {
      return new Response('Invalid signature', { status: 401 });
    }
  }

  const payload = JSON.parse(body);
  const commissionId = payload._id;

  if (!commissionId) {
    return new Response('No commission ID', { status: 400 });
  }

  try {
    // ── Fetch full commission with service title ──
    const commission = await sanity.fetch(
      `*[_type == "commission" && _id == $id][0]{
        _id, orderRef, customerName, customerEmail,
        deliveryType, status,
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

    // Only send digital delivery if the order includes digital
    if (commission.deliveryType === 'print') {
      // Print-only — just mark as delivered, no email download
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

    // ── Generate secure download link ────
    const downloadUrl = generateSignedUrl(commissionId, commission.fileRef);

    // ── Send email ───────────────────────
    const { error: emailError } = await resend.emails.send({
      from: 'Pixel8 Multimedia <hello@pixel8multimedia.co.uk>',
      to: commission.customerEmail,
      subject: `Your ${commission.serviceTitle} is ready! — ${commission.orderRef}`,
      html: buildEmailHtml(
        commission.customerName,
        commission.serviceTitle,
        commission.orderRef,
        downloadUrl
      ),
    });

    if (emailError) {
      console.error('Resend error:', emailError);
      return new Response('Email send failed', { status: 500 });
    }

    // ── Mark as delivered ────────────────
    await sanity
      .patch(commissionId)
      .set({ status: 'delivered', deliveredAt: new Date().toISOString() })
      .commit();

    console.log(`Commission ${commissionId} delivered to ${commission.customerEmail}`);
    return new Response('Delivered', { status: 200 });
  } catch (err) {
    console.error('commission-deliver error:', err);
    return new Response('Internal error', { status: 500 });
  }
}

export const config = { path: '/.netlify/functions/commission-deliver' };
