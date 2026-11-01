/**
 * The shop order's customer-facing reference: "P8-" + the last 8 characters
 * of its Stripe Checkout session id, e.g. cs_live_a1…Zq9xK2bT -> P8-Zq9xK2bT.
 *
 * Derived, not counted: no counter document, no race, and an order made
 * before the reference existed still has one (its stripeSessionId is on the
 * order). webhook.mjs stamps it on new orders as `orderNumber`; the shipping
 * flow stamps it on older orders the first time they are shipped.
 *
 * Session ids are mixed case. The reference keeps the case it was minted with
 * (that is what the label and emails show), but anything a customer types is
 * matched case-insensitively.
 *
 * Commissions already have their own reference (PX-XXXXXXXX, `orderRef`).
 */

export const ORDER_REF_PREFIX = 'P8-';

/** 'cs_live_…' -> 'P8-XXXXXXXX', or null if there is no usable session id. */
export function orderRefFromSession(sessionId) {
  const s = String(sessionId || '').trim();
  if (s.length < 8 || !/^[A-Za-z0-9_]+$/.test(s)) return null;
  return `${ORDER_REF_PREFIX}${s.slice(-8)}`;
}

/** An order's reference: the stamped one, else derived from its session. */
export const orderRefFor = (order) =>
  (order && (order.orderNumber || orderRefFromSession(order.stripeSessionId))) || null;

/** What a customer typed -> a canonical 'P8-xxxxxxxx' (lower case) or null. */
export function normaliseOrderRef(input) {
  const s = String(input || '').trim().replace(/^#/, '').replace(/\s+/g, '');
  const m = /^(?:P8-?)?([A-Za-z0-9_]{8})$/i.exec(s);
  return m ? `p8-${m[1].toLowerCase()}` : null;
}

/** True when an order answers to what the customer typed. */
export function orderMatchesRef(order, input) {
  const want = normaliseOrderRef(input);
  const have = orderRefFor(order);
  return Boolean(want && have && have.toLowerCase() === want);
}

/** A Stripe PaymentIntent id the customer may have from the confirmation email. */
export const isPaymentIntentId = (s) => /^pi_[A-Za-z0-9_]{8,80}$/.test(String(s || '').trim());

/** Commission references (PX-XXXXXXXX): never returnable through /returns. */
export const isCommissionRef = (s) => /^#?\s*PX-?[A-Z0-9]{6,12}$/i.test(String(s || '').trim());
