/**
 * The customer's "your order is on the way" email -- the ONLY place it is sent
 * from, for shop orders and commissions alike.
 *
 * Who decides something has shipped:
 *   - sanity-orders-webhook, when Alan dispatches by hand: an order set to
 *     Dispatched with a tracking number, or a commission set to Shipped. This
 *     works whether or not SHIPPING_ENABLED is set (shop orders had no
 *     dispatch email at all before this);
 *   - commission-deliver.mts, the old webhook target, kept live until the
 *     router has been tested in production (same function, same claim);
 *   - shipping-event, at a Sendcloud parcel's first carrier scan.
 *
 * ONCE ONLY. Before sending, the document is claimed: dispatchEmailClaimedAt
 * is written with ifRevisionId set to the revision just read, so of two
 * callers racing exactly one write lands and the other re-reads and sees the
 * claim. The claim is given back if the send fails (a later event retries),
 * and a claim older than CLAIM_TTL_MS is treated as abandoned. The sent
 * marker is dispatchEmailSentAt on an order, and the existing dispatchedAt on
 * a commission (so commissions emailed before this change are never emailed
 * again). Both are server fields, written to the draft too (server-patch.mjs).
 *
 * AFTER THE EMAIL. afterDispatchEmail() runs once, after the send is marked,
 * on every path above -- so Sendcloud-shipped orders get it too. It starts the
 * post-delivery sequence (_shared/post-delivery.mjs: the buyer's PIX- referral
 * code and MailerLite "P8 - Customers"). Photo retention still counts from
 * printing (personalisation.mts paidRetentionDays), not dispatch.
 */
import { readDecideWrite, serverPatch } from './server-patch.mjs';
import { carrierName, trackingUrlFor } from './parcel-bands.mjs';
import { orderRefFor } from './order-ref.mjs';
import { setting } from './site-config.mjs';
import { startPostDelivery } from './post-delivery.mjs';
import { emailLogoImg } from './email-logo.mjs';

export const CLAIM_TTL_MS = 10 * 60 * 1000;


export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `£${(Number(n) || 0).toFixed(2)}`;

/** Parcels the shipping service made that have something to track. */
export const trackedParcels = (doc) =>
  (doc?.shipmentResult?.parcels || []).filter((p) => p && (p.trackingNumber || p.trackingUrl));

/* ------------------------------------------------------------------ template */

/**
 * The branded email: the same card layout commission-deliver has always sent
 * (dark header with the logo, white body, purple Track button), now with one
 * tracking block per parcel and an optional items table.
 */
export function dispatchEmailHtml({ customerName, introHtml, parcels, itemsHtml = '', ref }) {
  const site = setting('SITE_URL');
  const blocks = parcels.map((p, i) => `
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;margin:0 0 ${p.trackingUrl ? '8' : '24'}px;">
              <tr><td style="padding:16px 20px;">
                ${parcels.length > 1 ? `<p style="margin:0 0 10px;color:#7c3aed;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Parcel ${i + 1} of ${parcels.length}</p>` : ''}
                <p style="margin:0 0 6px;color:#6b7280;font-size:13px;">Carrier</p>
                <p style="margin:0 0 14px;color:#1a1a2e;font-size:16px;font-weight:700;">${esc(p.carrierName)}</p>
                ${p.trackingNumber ? `<p style="margin:0 0 6px;color:#6b7280;font-size:13px;">Tracking number</p>
                <p style="margin:0;color:#1a1a2e;font-size:16px;font-weight:700;letter-spacing:0.5px;word-break:break-all;">${esc(p.trackingNumber)}</p>` : ''}
              </td></tr>
            </table>${p.trackingUrl ? `
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td align="center" style="padding:8px 0 28px;">
                <a href="${esc(p.trackingUrl)}" style="display:inline-block;padding:14px 36px;background:#7c3aed;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;border-radius:8px;letter-spacing:0.3px;">
                  TRACK YOUR PARCEL${parcels.length > 1 ? ` ${i + 1}` : ''}
                </a>
              </td></tr>
            </table>` : ''}`).join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
        <tr>
          <td style="background:#0e0e14;padding:32px 40px 24px;text-align:center;">
            ${emailLogoImg()}
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <h2 style="margin:0 0 8px;font-size:20px;color:#1a1a2e;">Your order is on the way! \u{1F4E6}</h2>
            <p style="margin:0 0 24px;color:#6b7280;font-size:15px;line-height:1.6;">
              Hi ${esc(customerName || 'there')},<br><br>
              ${introHtml}
            </p>
            ${blocks}
            ${itemsHtml}
            <p style="margin:0;color:#6b7280;font-size:13px;">
              Tracking can take a few hours to update after dispatch. Any questions, just reply to this email — we’re happy to help.
            </p>
            ${ref ? `<p style="margin:16px 0 0;color:#6b7280;font-size:12px;">Order reference: <strong style="color:#1a1a2e;">${esc(ref)}</strong></p>` : ''}
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;padding:24px 40px;border-top:1px solid #e5e7eb;">
            <p style="margin:0;color:#6b7280;font-size:12px;text-align:center;">
              Pixel8 Multimedia · hello@pixel8multimedia.co.uk<br>
              <a href="${site}" style="color:#7c3aed;text-decoration:none;">pixel8multimedia.co.uk</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** The parcels to show: Sendcloud's, or the one entered by hand. */
function parcelsToShow(doc) {
  const tracked = trackedParcels(doc);
  if (tracked.length) {
    return tracked.map((p) => ({ carrierName: carrierName(p.carrier), trackingNumber: p.trackingNumber || '', trackingUrl: p.trackingUrl || null }));
  }
  const number = String(doc.trackingNumber || '').trim();
  return [{
    carrierName: carrierName(doc.carrier, doc.carrierOther),
    trackingNumber: number,
    trackingUrl: trackingUrlFor(doc.carrier, number),
  }];
}

const joinNames = (names) => [...new Set(names)].join(' and ');

/** @returns {{ subject: string, html: string }} */
export function buildOrderDispatchEmail(order) {
  const ref = orderRefFor(order) || order._id;
  const parcels = parcelsToShow(order);
  const carriers = joinNames(parcels.map((p) => p.carrierName));
  const known = carriers && carriers !== 'Courier';
  const rows = (order.lineItems || []).map((l) => `<tr>
    <td style="padding:6px 0;color:#1a1a2e;font-size:14px;">${esc(l.productTitle)}<br><span style="color:#6b7280;font-size:12px;">${esc([l.format, l.size].filter(Boolean).join(' · '))}</span></td>
    <td style="padding:6px 0;color:#6b7280;font-size:14px;text-align:right;white-space:nowrap;">× ${esc(l.quantity || 1)}</td></tr>`).join('');
  const itemsHtml = rows ? `
            <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;">
              <tr><td colspan="2" style="padding:12px 0 4px;color:#6b7280;font-size:13px;">In this order</td></tr>${rows}
              <tr><td colspan="2" style="padding:4px 0 12px;"></td></tr>
            </table>` : '';
  return {
    subject: `Your order is on the way! — ${ref}`,
    html: dispatchEmailHtml({
      customerName: order.customerName,
      introHtml: `Good news — your Pixel8 order (ref: <strong>${esc(ref)}</strong>) has been dispatched${parcels.length > 1 ? ` in ${parcels.length} parcels` : ''} and is on its way to you${known ? ` with <strong>${esc(carriers)}</strong>` : ''}.`,
      parcels,
      itemsHtml,
      ref,
    }),
  };
}

/** @returns {{ subject: string, html: string }} */
export function buildCommissionDispatchEmail(commission) {
  const parcels = parcelsToShow(commission);
  const carriers = joinNames(parcels.map((p) => p.carrierName));
  const known = carriers && carriers !== 'Courier';
  // A commission shipped by hand with no tracking number keeps today's email:
  // no tracking block at all.
  const shown = parcels.filter((p) => p.trackingNumber || p.trackingUrl);
  return {
    subject: `Your order is on the way! — ${commission.orderRef}`,
    html: dispatchEmailHtml({
      customerName: commission.customerName,
      introHtml: `Good news — your <strong>${esc(commission.serviceTitle || 'commission')}</strong> print (ref: <strong>${esc(commission.orderRef)}</strong>) has been dispatched and is on its way to you${known ? ` with <strong>${esc(carriers)}</strong>` : ''}.`,
      parcels: shown,
    }),
  };
}

/* ------------------------------------------------------------------ when due */

/** Why an order's email is not due, or null when it is. Pure. */
export function orderNotDue(order) {
  if (!order || order._type !== 'order') return 'not an order';
  if (order.dispatchEmailSentAt) return 'already sent';
  if (!order.customerEmail) return 'no customer email';
  const tracked = trackedParcels(order).length > 0;
  const byHand = ['dispatched', 'delivered'].includes(order.status) && String(order.trackingNumber || '').trim();
  const scanned = Boolean(order.shipmentResult?.dispatchedAt) && tracked;
  if (!byHand && !scanned) {
    return ['dispatched', 'delivered'].includes(order.status) ? 'dispatched but no tracking number yet' : `status ${order.status || 'unset'}`;
  }
  return null;
}

/** Why a commission's email is not due, or null when it is. Pure. */
export function commissionNotDue(c) {
  if (!c || c._type !== 'commission') return 'not a commission';
  if (c.dispatchedAt) return 'already sent';
  if (c.awaitingVoucherCheck === true) return 'Groupon voucher not confirmed';
  if (c.deliveryType === 'digital') return 'digital-only: nothing to dispatch';
  if (!c.customerEmail) return 'no customer email';
  const scanned = Boolean(c.shipmentResult?.dispatchedAt) && trackedParcels(c).length > 0;
  if (c.status !== 'shipped' && !scanned) return `status ${c.status || 'unset'}`;
  return null;
}

/* ------------------------------------------------------------------ sending */

/**
 * Hook for anything that must follow the dispatch email. Runs once per
 * document, after the send is marked, on every dispatch path. Never throws.
 * Today: the post-delivery sequence (referral code + MailerLite), which has
 * its own once-only claim, since a print + digital commission may already
 * have started it from its download email.
 */
export async function afterDispatchEmail(kind, doc, { log = console, sanity, postDelivery = startPostDelivery } = {}) {
  if (!sanity) return;
  await postDelivery(kind, doc, { sanity, log });
}

/**
 * Send the dispatch email for one order or commission if, and only if, it is
 * due and nobody else is sending it.
 *
 * @param {object} p
 * @param {'order'|'commission'} p.kind
 * @param {string} p.id          published document id
 * @param {object} p.sanity      @sanity/client with a write token
 * @param {Function} p.getResend returns a Resend client, or null if no key
 * @returns {Promise<{ sent: boolean, status: number, reason: string }>}
 *   status is what a webhook handler should answer with (5xx = retry me).
 */
export async function sendDispatchEmail({ kind, id, sanity, getResend, now = () => Date.now(), log = console, after = afterDispatchEmail }) {
  const notDue = kind === 'commission' ? commissionNotDue : orderNotDue;
  const SERVICE = '"serviceTitle": service->title';

  let skip = null;
  const claim = await readDecideWrite(sanity, id, (doc) => {
    const why = notDue(doc);
    if (why) { skip = why; return null; }
    const claimedAt = Date.parse(doc.dispatchEmailClaimedAt || '');
    if (Number.isFinite(claimedAt) && now() - claimedAt < CLAIM_TTL_MS) { skip = 'being sent by another call'; return null; }
    return { set: { dispatchEmailClaimedAt: new Date(now()).toISOString() } };
  });
  if (!claim.written) return { sent: false, status: 200, reason: skip || 'nothing to do' };

  let doc = claim.doc;
  const name = kind === 'commission' ? doc.orderRef : (orderRefFor(doc) || doc._id);
  const release = () => serverPatch(sanity, id, { unset: ['dispatchEmailClaimedAt'] }).catch((e) =>
    log.error(`dispatch-email: ${name}: could not release the claim:`, e?.message || e));

  const resend = getResend();
  if (!resend) {
    log.error(`dispatch-email: RESEND_API_KEY is not set — cannot email ${name}.`);
    await release();
    return { sent: false, status: 503, reason: 'RESEND_API_KEY is not set' };
  }

  if (kind === 'commission' && doc.serviceTitle === undefined) {
    const t = await sanity.fetch(`*[_id == $id][0]{ ${SERVICE} }`, { id }).catch(() => null);
    doc = { ...doc, serviceTitle: t?.serviceTitle };
  }
  const { subject, html } = kind === 'commission' ? buildCommissionDispatchEmail(doc) : buildOrderDispatchEmail(doc);
  try {
    // Resend reports a refusal by RETURNING an error, not by throwing.
    const { error } = await resend.emails.send({ from: setting('EMAIL_FROM'), to: [doc.customerEmail], subject, html });
    if (error) throw new Error(`${error.name || 'Error'}: ${error.message || 'Resend rejected the send'}`);
  } catch (err) {
    log.error(`dispatch-email: ${name}: send failed:`, err?.message || err);
    await release();
    return { sent: false, status: 500, reason: 'Email send failed (will retry)' };
  }

  const at = new Date(now()).toISOString();
  const set = kind === 'commission' ? { dispatchedAt: at } : { dispatchEmailSentAt: at };
  // An order that never had its reference stamped gets it now: it is in the email.
  if (kind === 'order' && !doc.orderNumber && orderRefFor(doc)) set.orderNumber = orderRefFor(doc);
  try {
    await serverPatch(sanity, id, { set, unset: ['dispatchEmailClaimedAt'] });
  } catch (err) {
    // The email has gone: try the marker once more, plainly, and answer 200
    // rather than invite a duplicate. The claim still blocks for CLAIM_TTL_MS.
    log.error(`dispatch-email: ${name}: sent but could not be marked:`, err?.message || err);
    await sanity.patch(id).set(set).commit().catch(() => {});
  }
  log.log(`dispatch-email: ${kind} ${name} emailed`);
  try { await after(kind, { ...doc, ...set }, { log, sanity }); } catch (err) { log.error(`dispatch-email: ${name}: after-send step failed:`, err?.message || err); }
  return { sent: true, status: 200, reason: 'OK' };
}
