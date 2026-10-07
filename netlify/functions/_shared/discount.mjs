/**
 * The discount on a paid Checkout Session: how much, which code, and whether
 * that code was one of our own Groupon promotion codes.
 *
 * The shop checkout and a voucher-less commission checkout let the customer
 * type a promotion code on Stripe's page (allow_promotion_codes), so the
 * server never sees it before payment. The amount is always on the session
 * (total_details.amount_discount); the CODE needs the breakdown expanded and
 * the promotion code looked up. Shipping is a shipping_options rate, which
 * coupons do not touch, so the discount is goods only.
 *
 * `groupon` is true when a code minted for a Groupon voucher
 * (_shared/groupon.mts mintPromotionCode, metadata.source = 'groupon') was
 * applied. On a voucher checkout that is expected; anywhere else it means a
 * GRPN… code seen on a voucher checkout was typed into the promo box, and the
 * order needs a human before it is worked.
 *
 * Never throws. The payment is taken whatever this finds, so a failed lookup
 * costs the order its code and keeps the amount, which is on the event itself.
 */
export async function readDiscount(stripe, session) {
  const amountPence = session?.total_details?.amount_discount || 0;
  const out = { amountPence, codes: [], groupon: false };
  if (!amountPence) return out;

  try {
    const full = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ['total_details.breakdown'],
    });
    for (const d of full?.total_details?.breakdown?.discounts || []) {
      const disc = d.discount || {};
      let promo = disc.promotion_code;
      if (typeof promo === 'string') {
        try {
          promo = await stripe.promotionCodes.retrieve(promo);
        } catch (err) {
          console.error(`discount: could not look up promotion code ${promo}:`, err?.message);
          promo = null;
        }
      }
      if (promo?.metadata?.source === 'groupon' || disc.coupon?.metadata?.source === 'groupon') {
        out.groupon = true;
      }
      /* A coupon applied without a customer-facing code still gets named, by
         the coupon's own name. */
      const code = promo?.code || disc.coupon?.name || disc.coupon?.id || null;
      if (code && !out.codes.includes(code)) out.codes.push(code);
    }
  } catch (err) {
    console.error(`discount: could not read the discount breakdown for ${session.id}:`, err?.message);
  }
  return out;
}

/** "Discount (PIX10)", or plain "Discount" when the code could not be read. */
export const discountLabel = (codes) =>
  (codes && codes.length ? `Discount (${codes.join(', ')})` : 'Discount');

/** The warning stored on an order/commission when a Groupon code turns up where no voucher was claimed. */
export const GROUPON_MISUSE =
  'A Groupon voucher promotion code was typed into the promo box on a checkout that did not claim that voucher. ' +
  'Check the voucher in Studio before working this order: its value may have been spent twice.';
