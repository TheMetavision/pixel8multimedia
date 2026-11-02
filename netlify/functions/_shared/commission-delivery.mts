// netlify/functions/_shared/commission-delivery.mts
//
// A commission set to 'complete': the digital download email (signed links to
// the finished artwork), or, for a print-only order, just 'delivered'.
//
// Moved here unchanged from commission-deliver.mts so that function and the
// router (sanity-orders-webhook.mts) run the same code while both are live.
// The dispatch ('shipped') half is now _shared/dispatch-email.mjs, shared with
// shop orders, with an atomic once-only claim.

import crypto from 'crypto';
import { fileRefFor } from './artwork-keys.mjs';
import { startPostDelivery } from './post-delivery.mjs';

const SITE_URL = process.env.URL || 'https://pixel8multimedia.co.uk';
const FROM_EMAIL = 'Pixel8 Multimedia <hello@pixel8multimedia.co.uk>';
const LOGO_URL = 'https://pixel8multimedia.co.uk/Pixel8_Logo.png';
const DOWNLOAD_EXPIRY_DAYS = 30;

// ── Generate signed download URL (delivery) ──
// Sanity-hosted files (finishedFile, legacy) are served by the
// commission-download function; Blobs artwork (finishedArtwork) by the
// commission-artwork-download edge function, which has no size limit. Same
// parameters, same signature, same expiry: only the path differs.
const SANITY_FILE_PATH = '/.netlify/functions/commission-download';
const BLOB_FILE_PATH = '/download/artwork';

function generateSignedUrl(commissionId: string, fileRef: string, path: string = SANITY_FILE_PATH): string {
  const expiry = Date.now() + DOWNLOAD_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
  const payload = `${commissionId}:${fileRef}:${expiry}`;
  const hmac = crypto.createHmac('sha256', process.env.DOWNLOAD_LINK_SECRET!);
  hmac.update(payload);
  const sig = hmac.digest('hex');

  const params = new URLSearchParams({
    id: commissionId,
    file: fileRef,
    exp: expiry.toString(),
    sig,
  });

  return `${SITE_URL}${path}?${params.toString()}`;
}


// ── Branded delivery email (digital download) ──
function buildDeliveryEmailHtml(
  customerName: string,
  serviceTitle: string,
  orderRef: string,
  downloads: Array<{ url: string; filename?: string }>
): string {
  const button = (url: string, label: string) => `
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td align="center" style="padding:8px 0 28px;">
                <a href="${url}" style="display:inline-block;padding:14px 36px;background:#7c3aed;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;border-radius:8px;letter-spacing:0.3px;">
                  ${label}
                </a>
              </td></tr>
            </table>
`;
  const buttons = downloads.length === 1
    ? button(downloads[0].url, 'Download Your File')
    : downloads.map((d, i) => button(d.url, `Download file ${i + 1} of ${downloads.length}${d.filename ? ` — ${d.filename}` : ''}`)).join('');
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

            <!-- Download Button -->${buttons}
            <p style="margin:0 0 4px;color:#9ca3af;font-size:13px;">
              ⏱ ${downloads.length === 1 ? 'This link stays' : 'These links stay'} active for ${DOWNLOAD_EXPIRY_DAYS} days.
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

// ── Handler: "complete" → delivery ────────────────────────────────────────
export async function deliverCommission(
  commissionId: string,
  { sanity, resend }: { sanity: any; resend: any },
): Promise<Response> {
  const commission = await sanity.fetch(
    `*[_type == "commission" && _id == $id][0]{
      _id, orderRef, customerName, customerEmail,
      deliveryType, status, deliveredAt, awaitingVoucherCheck,
      paidAt, marketingConsent,
      "serviceTitle": service->title,
      "fileRef": finishedFile.asset._ref,
      "artwork": finishedArtwork[defined(uploadId)]{ uploadId, filename }
    }`,
    { id: commissionId }
  );

  if (!commission) {
    return new Response('Commission not found', { status: 404 });
  }

  // An unconfirmed Groupon code must never reach delivery. The Studio blocks
  // the status change, but delivery is the irreversible step — once the file is
  // sent it cannot be recalled — so it refuses for itself rather than trusting
  // that nothing else patched the document.
  if (commission.awaitingVoucherCheck === true) {
    console.warn(
      `[GROUPON] Refusing to deliver ${commission.orderRef} — its voucher has not been confirmed.`
    );
    return new Response('Blocked: voucher not confirmed', { status: 200 });
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

  // Finished artwork: files uploaded to Blobs (finishedArtwork, one link each)
  // or, for older commissions, the Sanity file (finishedFile).
  const artwork: Array<{ uploadId: string; filename?: string }> = commission.artwork || [];
  if (!artwork.length && !commission.fileRef) {
    console.error(`Commission ${commissionId}: no finished file uploaded`);
    return new Response('No finished file — cannot deliver', { status: 400 });
  }

  const downloads = artwork.length
    ? artwork.map((a) => ({ url: generateSignedUrl(commissionId, fileRefFor(commission.orderRef, a.uploadId), BLOB_FILE_PATH), filename: a.filename }))
    : [{ url: generateSignedUrl(commissionId, commission.fileRef) }];

  const { error: emailError } = await resend.emails.send({
    from: FROM_EMAIL,
    to: commission.customerEmail,
    subject: `Your ${commission.serviceTitle} is ready! — ${commission.orderRef}`,
    html: buildDeliveryEmailHtml(
      commission.customerName,
      commission.serviceTitle,
      commission.orderRef,
      downloads
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

  console.log(`Commission ${commissionId} (${commission.orderRef}) download email sent — ${downloads.length} link(s), ${artwork.length ? 'Blobs' : 'Sanity file'}`);

  // The post-delivery sequence (referral code + MailerLite). For a digital
  // commission this email is the delivery; for print + digital it may come
  // before or after the dispatch email, and whichever is first starts it
  // (its own once-only claim). Never throws.
  await startPostDelivery('commission', commission, { sanity, log: console });
  return new Response('Delivered', { status: 200 });
}

