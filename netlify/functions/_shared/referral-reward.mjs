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
 * not a promotion. Self-referral (own code, same email) is ignored by
 * referralsFrom.
 *
 * Never throws. A failure is logged and written to referralError on the
 * document; the payment, order and other emails are untouched.
 */
import { referralsFrom, issueReward } from './referral.mjs';
import { serverPatch } from './server-patch.mjs';
import { setting } from './site-config.mjs';
import { esc } from './dispatch-email.mjs';

const LOGO_URL = 'https://pixel8multimedia.co.uk/Pixel8_Logo.png';

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
            <img src="${LOGO_URL}" width="180" alt="Pixel8 Multimedia" style="display:block;margin:0 auto;max-width:180px;height:auto;border:0;">
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
 * @returns {Promise<{ rewarded: boolean, rewardCode?: string, referrerEmail?: string, error?: string }>}
 */
export async function rewardReferrer({ stripe, sanity, resend, docId, ref, promos, buyerEmail, log = console, issue = issueReward }) {
  const referrals = referralsFrom(promos, buyerEmail);
  if (!referrals.length) return { rewarded: false };
  const r = referrals[0];
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
