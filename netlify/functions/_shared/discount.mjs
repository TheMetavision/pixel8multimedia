/**
 * The discount on a paid Checkout Session: how much, which code, and whether
 * any of it came from a Groupon voucher.
 *
 * The shop checkout and a voucher-less commission checkout let the customer
 * type a promotion code on Stripe's page (allow_promotion_codes), so the
 * server never sees it before payment. The amount is always on the session
 * (total_details.amount_discount); the CODE needs the breakdown expanded and
 * the promotion code looked up. Shipping is a shipping_options rate, which
 * coupons do not touch, so the discount is goods only.
 *
 * Groupon vouchers are applied by commission-checkout as a single-use coupon
 * (`discounts: [{ coupon }]`, _shared/groupon.mts mintVoucherCoupon) whose
 * metadata names the voucher. Nothing about one can be typed into the promo
 * box. Voucher checkouts begun before that change applied a single-use GRPN
 * promotion code instead, whose metadata also names the voucher. Either way
 * the voucher is identified by metadata (source = 'groupon',
 * grouponVoucherId), never by the code's text:
 *
 *   welcomeCodes — codes from `codes` that are welcome offers (see
 *             isWelcomeCode), for the webhook's repeat-customer check.
 *   groupon — a Groupon discount that does NOT belong to the voucher this
 *             session claimed (session.metadata.grouponVoucherId). Kept as a
 *             backstop: it means a legacy GRPN code was typed into another
 *             checkout, and the order needs a human before it is worked.
 *
 * The session's own voucher is not a promotion code and gets no
 * "Discount (CODE)" line; stripe-webhook-commission records it as before.
 *
 * Never throws. The payment is taken whatever this finds, so a failed lookup
 * costs the order its code and keeps the amount, which is on the event itself.
 */
export async function readDiscount(stripe, session) {
  const amountPence = session?.total_details?.amount_discount || 0;
  const out = { amountPence, codes: [], welcomeCodes: [], groupon: false };
  if (!amountPence) return out;
  const claimed = session?.metadata?.grouponVoucherId || null;

  try {
    const full = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ['total_details.breakdown'],
    });
    for (const d of full?.total_details?.breakdown?.discounts || []) {
      const disc = d.discount || {};
      const coupon = typeof disc.coupon === 'object' && disc.coupon ? disc.coupon : null;
      let promo = disc.promotion_code;
      if (typeof promo === 'string') {
        try {
          promo = await stripe.promotionCodes.retrieve(promo);
        } catch (err) {
          console.error(`discount: could not look up promotion code ${promo}:`, err?.message);
          promo = null;
        }
      }

      const meta = { ...(coupon?.metadata || {}), ...(promo?.metadata || {}) };
      if (meta.source === 'groupon') {
        // Ours only if it is the voucher this checkout claimed. A shared
        // legacy coupon carries no voucher id, so a typed code on it is
        // matched through the promotion code's own metadata instead.
        const voucherId = meta.grouponVoucherId || null;
        if (voucherId && voucherId === claimed) continue;
        out.groupon = true; // and named below, so the flag says which code
      }

      /* A coupon applied without a customer-facing code still gets named, by
         the coupon's own name. */
      const code = promo?.code || coupon?.name || coupon?.id || null;
      if (code && !out.codes.includes(code)) out.codes.push(code);
      if (code && isWelcomeCode(promo) && !out.welcomeCodes.includes(code)) out.welcomeCodes.push(code);
    }
  } catch (err) {
    console.error(`discount: could not read the discount breakdown for ${session.id}:`, err?.message);
  }
  return out;
}

/** "Discount (PIX10)", or plain "Discount" when the code could not be read. */
export const discountLabel = (codes) =>
  (codes && codes.length ? `Discount (${codes.join(', ')})` : 'Discount');

/** The warning stored on an order/commission when a Groupon discount turns up where its voucher was not claimed. */
export const GROUPON_MISUSE =
  'A Groupon voucher discount was applied to a checkout that did not claim that voucher. ' +
  'Check the voucher in Studio before working this order: its value may have been spent twice.';

/**
 * The welcome offer from the newsletter (PIX10), which is meant to be used
 * once per customer. Recognised by the promotion code's own "first-time
 * order only" restriction, so a future welcome code needs no change here;
 * WELCOME_CODES is the fallback for one created without it.
 */
export const WELCOME_CODES = ['PIX10'];
export function isWelcomeCode(promo) {
  if (!promo || typeof promo !== 'object') return false;
  return promo.restrictions?.first_time_transaction === true
    || WELCOME_CODES.includes(String(promo.code || '').toUpperCase());
}

/** The warning stored on a shop order when a welcome code was used by an email that has ordered before. */
export const repeatWelcomeNote = (codes, earlier) =>
  `${codes.join(', ')} is a first-order welcome code, and this email already has a paid order ` +
  `(${earlier._id}${earlier.createdAt ? `, ${String(earlier.createdAt).slice(0, 10)}` : ''}). ` +
  'Stripe cannot refuse it on a guest checkout. The order stands; decide whether to follow up.';
