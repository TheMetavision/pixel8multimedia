/**
 * The referrer's thank-you: when a paid shop order or commission used
 * someone's PIX- code, issue them a single-use 10% THANKS- code and email it.
 *
 * Called by webhook.mjs (shop) and stripe-webhook-commission.mts, after the
 * customer and team emails. Each runs at most once per checkout: the shop
 * webhook's create-once order id, and the commission webhook's paidAt check.
 *
 * The email is only the promised reward: the code and the footer's site
 * link, no "shop" button, so it is the referral programme keeping its word,
 * not a promotion.
 *
 * New customers only (Alan, 3 Nov 2026). The PIX coupon carries Stripe's
 * first_time_transaction restriction, but Stripe judges "first time" per
 * Customer and these checkouts are guests, so it lets anyone through. The
 * discount is still accepted (an accepted risk); the REWARD is not.
 * checkReferral decides, before the team email goes, and the reward is
 * issued only when
 *   a) the buyer is not the code's owner (emails trimmed, lower-cased), and
 *   b) there is no earlier paid shop order or paid commission from the
 *      buyer's email (this document, drafts, unpaid commissions and
 *      anything refunded before it was dispatched do not count).
 * Refused: no code, no email, referralError = self_referral /
 * repeat_customer, and a line on the team email (referralNote). A failed
 * lookup is logged, skips the reward, records lookup_failed and is flagged
 * on the team email; it never blocks the order or its emails.
 *
 * Never throws. A failure is logged and written to referralError on the
 * document; the payment, order and other emails are untouched.
 */
import { issueReward, isFriendCode } from './referral.mjs';
import { serverPatch } from './server-patch.mjs';
import { setting } from './site-config.mjs';
import { esc } from './dispatch-email.mjs';
import { emailLogoImg } from './email-logo.mjs';

export const SELF_REFERRAL = 'self_referral';
export const REPEAT_CUSTOMER = 'repeat_customer';
export const LOOKUP_FAILED = 'lookup_failed';

/** An email as the referral checks compare it: trimmed, lower-cased. */
export const normEmail = (email) => String(email || '').trim().toLowerCase();

/**
 * The buyer's earliest other paid order or commission. Shop orders are only
 * written once paid; a commission exists from checkout, so it counts once
 * paidAt is set. Refunded with no tracking, dispatch or delivery recorded =
 * refunded before dispatch, which does not count.
 */
export const EARLIER_ORDER_QUERY =
  '*[_type in ["order", "commission"] && !(_id in path("drafts.**")) && _id != $docId && stripeSessionId != $sid' +
  ' && lower(customerEmail) == $email && (_type == "order" || defined(paidAt))' +
  ' && !(status == "refunded" && !defined(trackingNumber) && !defined(dispatchedAt) && !defined(deliveredAt)' +
  ' && !defined(shipmentResult.dispatchedAt) && !defined(shipmentResult.deliveredAt))]' +
  ' | order(coalesce(paidAt, createdAt, _createdAt) asc)[0]{ _id, _type, "orderRef": coalesce(orderRef, orderNumber) }';

/**
 * Is the PIX code on this checkout (if any) entitled to a thank-you? Never throws.
 * @returns {Promise<null | { code, referrerEmail, referrerOrder, eligible: boolean, reason?, earlier?, error? }>}
 *   null when there is no friend code with a known referrer.
 */
export async function checkReferral({ sanity, promos, buyerEmail, docId, sessionId, log = console }) {
  const p = (promos || []).find((x) => isFriendCode(x) && normEmail(x.metadata?.referrer_email));
  if (!p) return null;
  const r = { code: p.code, referrerEmail: normEmail(p.metadata.referrer_email), referrerOrder: p.metadata.referrer_order || '' };
  const buyer = normEmail(buyerEmail);
  if (buyer && buyer === r.referrerEmail) return { ...r, eligible: false, reason: SELF_REFERRAL };
  try {
    if (!buyer) throw new Error('no buyer email on the checkout');
    if (!sanity || typeof sanity.fetch !== 'function') throw new Error('no Sanity client');
    const earlier = await sanity.fetch(EARLIER_ORDER_QUERY, { email: buyer, docId: docId || '', sid: sessionId || '' });
    if (earlier && earlier._id) return { ...r, eligible: false, reason: REPEAT_CUSTOMER, earlier };
    return { ...r, eligible: true };
  } catch (err) {
    const msg = err?.message || String(err);
    log.error(`referral: new-customer check for ${r.code} failed, no reward issued:`, msg);
    return { ...r, eligible: false, reason: LOOKUP_FAILED, error: msg };
  }
}

/** The team email's line for a refused or unchecked reward; '' otherwise. */
export function referralNote(check) {
  if (!check || check.eligible) return '';
  if (check.reason === SELF_REFERRAL) {
    return `Friend code ${check.code} used by an existing customer (the code's own owner) — no reward issued (self-referral).`;
  }
  if (check.reason === REPEAT_CUSTOMER) {
    const e = check.earlier || {};
    const ref = e.orderRef || e._id || '';
    return `Friend code ${check.code} used by an existing customer${ref ? ` (earlier ${e._type === 'commission' ? 'commission' : 'order'} ${ref})` : ''} — no reward issued (repeat customer).`;
  }
  return `Friend code ${check.code} used, but the new-customer check failed (${check.error || 'unknown error'}) — no reward issued. ` +
    `If this is a genuinely new customer, issue the referrer (${check.referrerEmail}) a thank-you code by hand.`;
}


/** @returns {{ subject: string, html: string }} */
export function rewardEmail(rewardCode) {
  const site = setting('SITE_URL');
  return {
    subject: 'Your friend ordered. Here’s your 10% thank you',
    html: `
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
            <p style="margin:18px 0 0;color:rgba(255,255,255,0.55);font-size:12px;letter-spacing:2px;text-transform:uppercase;">POP. ART. MOTION.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <h2 style="margin:0 0 8px;font-size:20px;color:#1a1a2e;">Thank you for sending a friend our way</h2>
            <p style="margin:0 0 24px;color:#6b7280;font-size:15px;line-height:1.6;">
              Someone you shared your code with has just placed their first Pixel8 order. As promised, here's 10% off your next order:
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;margin:0 0 24px;">
              <tr><td align="center" style="padding:20px;">
                <p style="margin:0;color:#7c3aed;font-size:24px;font-weight:700;letter-spacing:2px;">${esc(rewardCode)}</p>
              </td></tr>
            </table>
            <p style="margin:0;color:#9ca3af;font-size:13px;line-height:1.6;">
              Enter it in the promo code box at checkout. It works once, on anything in the shop or on a commission.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;padding:24px 40px;border-top:1px solid #e5e7eb;">
            <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
              Pixel8 Multimedia · hello@pixel8multimedia.co.uk<br>
              <a href="${site}" style="color:#7c3aed;text-decoration:none;">pixel8multimedia.co.uk</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };
}

/**
 * @param {object} p
 * @param {object} p.stripe
 * @param {object} p.sanity
 * @param {object|null} p.resend
 * @param {string} p.docId        the order or commission (published id)
 * @param {string} p.ref          P8-… or PX-…, for the code's metadata and the logs
 * @param {object[]} p.promos     readDiscount().promos
 * @param {string} p.buyerEmail
 * @param {string} [p.sessionId]  the Stripe checkout session, so the check skips this document
 * @param {object|null} [p.check] checkReferral()'s answer, when the caller already has it
 * @returns {Promise<{ rewarded: boolean, rewardCode?: string, referrerEmail?: string, refused?: string, error?: string }>}
 */
export async function rewardReferrer({ stripe, sanity, resend, docId, ref, promos, buyerEmail, sessionId, check, log = console, issue = issueReward }) {
  const c = check !== undefined ? check : await checkReferral({ sanity, promos, buyerEmail, docId, sessionId, log });
  if (!c) return { rewarded: false };
  if (!c.eligible) {
    log.warn(`referral: ${ref}: ${c.code} — no reward (${c.reason})`);
    const why = c.reason === LOOKUP_FAILED ? `${LOOKUP_FAILED} — ${String(c.error || '').slice(0, 300)}` : c.reason;
    await serverPatch(sanity, docId, { set: { referralError: why } })
      .catch((e) => log.error(`referral: could not record the refusal on ${ref}:`, e?.message || e));
    return { rewarded: false, refused: c.reason };
  }
  const r = { code: c.code, referrerEmail: c.referrerEmail, referrerOrder: c.referrerOrder };
  try {
    const rewardCode = await issue(stripe, { referrerEmail: r.referrerEmail, referredOrder: ref });
    await serverPatch(sanity, docId, {
      set: { referredBy: { code: r.code, referrerEmail: r.referrerEmail, referrerOrder: r.referrerOrder, rewardCode } },
    });
    if (!resend) throw new Error('RESEND_API_KEY is not set on this deploy');
    const { subject, html } = rewardEmail(rewardCode);
    const { error } = await resend.emails.send({ from: setting('EMAIL_FROM'), to: [r.referrerEmail], subject, html });
    if (error) throw new Error(`${error.name || 'Error'}: ${error.message || 'Resend rejected the send'}`);
    log.log(`referral: reward ${rewardCode} sent to the referrer of ${ref} (${r.code})`);
    return { rewarded: true, rewardCode, referrerEmail: r.referrerEmail };
  } catch (err) {
    const msg = err?.message || String(err);
    log.error(`referral: reward for ${ref} failed:`, msg);
    await serverPatch(sanity, docId, { set: { referralError: `${new Date().toISOString()} — ${msg.slice(0, 300)}` } })
      .catch((e) => log.error(`referral: could not record the error on ${ref}:`, e?.message || e));
    return { rewarded: false, error: msg };
  }
}
