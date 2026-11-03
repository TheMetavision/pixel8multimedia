/**
 * A commission's delivery address in the structured form a label needs.
 *
 * commission.shippingAddress is a TEXT block (stripe-webhook-commission joins
 * Stripe's address into lines), which a carrier cannot be given. So:
 *
 *   - new commissions, while SHIPPING_ENABLED is set, also get
 *     shippingAddressFields { name, line1, line2, city, county, postcode,
 *     country } from the same Stripe session (stripe-webhook-commission);
 *   - any other commission is read from Stripe at dispatch time, through its
 *     stripeSessionId. Nothing is backfilled.
 */

/** Stripe's shipping details -> our structured address, or null. */
export function addressFromStripe(details) {
  const a = details?.address;
  if (!a) return null;
  const out = {
    name: details.name || '',
    line1: a.line1 || '',
    line2: a.line2 || '',
    city: a.city || '',
    county: a.state || '',
    postcode: a.postal_code || '',
    country: a.country || '',
  };
  return out.line1 || out.postcode ? out : null;
}

const hasAddress = (d) => !!(d?.address && (d.address.line1 || d.address.postal_code));

/**
 * Where a Checkout Session's delivery address lives depends on the API
 * version of whatever produced the object: Stripe API 2025-03-31 (basil) and
 * later nest it under collected_information.shipping_details, older versions
 * put it at shipping_details, and a session without shipping collection only
 * has the billing address in customer_details. A webhook payload follows the
 * *endpoint's* API version, not the SDK's apiVersion, so read all three.
 *
 * Returns { name, address } from the first location with a usable address
 * (line1 or postcode), or null. The name falls back to customer_details.name.
 */
export function shippingDetailsOf(session) {
  const fallbackName = session?.customer_details?.name || '';
  for (const d of [
    session?.collected_information?.shipping_details,
    session?.shipping_details,
    session?.customer_details,
  ]) {
    if (hasAddress(d)) return { name: d.name || fallbackName, address: d.address };
  }
  return null;
}

/**
 * The commission's address: the stored copy, else from its Stripe session.
 *
 * @param {object} commission
 * @param {{ retrieveSession?: (id: string) => Promise<object> }} deps
 * @returns {Promise<{ address: object|null, source: 'stored'|'stripe'|null, error?: string }>}
 */
export async function commissionAddress(commission, { retrieveSession } = {}) {
  const stored = commission?.shippingAddressFields;
  if (stored && (stored.line1 || stored.postcode)) return { address: stored, source: 'stored' };
  if (!commission?.stripeSessionId) return { address: null, source: null, error: 'the commission has no Stripe session id, so its address cannot be read' };
  if (!retrieveSession) return { address: null, source: null, error: 'Stripe is not configured' };
  try {
    const session = await retrieveSession(commission.stripeSessionId);
    const address = addressFromStripe(shippingDetailsOf(session));
    return address ? { address, source: 'stripe' } : { address: null, source: null, error: 'the Stripe session has no shipping address' };
  } catch (err) {
    return { address: null, source: null, error: `Stripe: ${err?.message || err}` };
  }
}
