/**
 * The Stripe Customer for an order email: found, or created.
 *
 * Why commission checkouts need one: a promotion code restricted to
 * "first-time order only" (PIX10) is judged per Stripe CUSTOMER, and a
 * Checkout session opened with just customer_email is a guest, so every
 * guest counts as first-time and the restriction does nothing. Passing the
 * same Customer on every commission for an email makes Stripe refuse the
 * code once that Customer has a successful payment.
 *
 * The email is lower-cased both when looking up and when creating:
 * customers.list({ email }) is an exact, case-sensitive match, so
 * "Jo@x.com" and "jo@x.com" would otherwise become two first-time customers.
 * customers.list rather than customers.search, because search is eventually
 * consistent and a customer created a moment ago may not be found yet.
 *
 * Never throws: on any failure it returns null and the caller falls back to
 * customer_email, so a Stripe hiccup costs the first-time check, never the
 * order.
 */
export async function customerForEmail(stripe, email, { name } = {}) {
  const normalised = String(email || '').trim().toLowerCase();
  if (!normalised) return null;
  try {
    const found = await stripe.customers.list({ email: normalised, limit: 1 });
    if (found?.data?.[0]?.id) return found.data[0].id;
    const created = await stripe.customers.create({
      email: normalised,
      ...(name ? { name } : {}),
      metadata: { source: 'pixel8-checkout' },
    });
    return created?.id || null;
  } catch (err) {
    console.error('stripe-customer: could not find or create a customer — falling back to customer_email:', err?.message);
    return null;
  }
}
