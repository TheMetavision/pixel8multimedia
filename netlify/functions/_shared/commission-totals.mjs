/**
 * What a commission costs at Stripe: P&P and the Groupon voucher cap.
 *
 * One source of truth, read by commission-checkout.mts (which builds the Stripe
 * session) and by CommissionWorkflow.jsx (the review step), so the total the
 * customer sees before paying is the total Stripe shows. Plain .mjs with no
 * imports, so the browser bundle can use it too. Tested in
 * tests/commission-totals.test.mjs.
 *
 * P&P: UK only. £4.95 on orders under £50, free at £50 and over, none at all
 * for digital-only orders. The threshold is judged on the order before any
 * discount -- the same `breakdown.total` the checkout has always used -- and
 * Stripe never discounts shipping.
 */

export const FREE_SHIPPING_THRESHOLD_GBP = 50;
export const STANDARD_SHIPPING_PENCE = 495;

const pence = (gbp) => Math.round((Number(gbp) || 0) * 100);

/**
 * @param {{ hasPrints: boolean, subtotalGbp: number }} order
 * @returns {{ applies: boolean, free: boolean, pence: number, label: string }}
 */
export function commissionShipping({ hasPrints, subtotalGbp }) {
  if (!hasPrints) return { applies: false, free: false, pence: 0, label: '' };
  const free = Number(subtotalGbp) >= FREE_SHIPPING_THRESHOLD_GBP;
  return {
    applies: true,
    free,
    pence: free ? 0 : STANDARD_SHIPPING_PENCE,
    label: free ? 'FREE UK P&P' : `UK Standard P&P (£${(STANDARD_SHIPPING_PENCE / 100).toFixed(2)})`,
  };
}

/**
 * A Groupon voucher buys the service, not the basket: it comes off the base
 * tier the customer chose (digital or animation) and never off prints or P&P.
 * Any unused entitlement is forfeited, as on Groupon.
 */
export function effectiveDiscountPence(valuePence, baseTierPence) {
  return Math.max(0, Math.min(Math.round(valuePence), Math.round(baseTierPence)));
}

/**
 * The review step's figures, in pence, matching the Stripe session.
 *
 * @param {object} o
 * @param {number}  o.subtotalGbp        the order before P&P and discount
 * @param {boolean} o.hasPrints          any physical print in the order
 * @param {number}  [o.baseTierGbp]      the digital / animation part (voucher cap)
 * @param {number}  [o.voucherValuePence] a claimed Groupon voucher's value
 */
export function commissionReviewTotals({ subtotalGbp, hasPrints, baseTierGbp = 0, voucherValuePence = 0 }) {
  const subtotalPence = pence(subtotalGbp);
  const shipping = commissionShipping({ hasPrints, subtotalGbp });
  const discountPence = voucherValuePence > 0 ? effectiveDiscountPence(voucherValuePence, pence(baseTierGbp)) : 0;
  return {
    subtotalPence,
    shipping,
    discountPence,
    totalPence: subtotalPence + shipping.pence - discountPence,
  };
}
