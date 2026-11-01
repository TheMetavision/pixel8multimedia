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

/** Newer Stripe API versions nest shipping under collected_information. */
export const shippingDetailsOf = (session) =>
  session?.collected_information?.shipping_details || session?.shipping_details || null;

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
