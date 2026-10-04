/**
 * GA4 purchase, reported server-side from the Stripe webhooks (webhook.mjs
 * for the shop, stripe-webhook-commission.mts for commissions) via the
 * Measurement Protocol. The browser only sends view_item / add_to_cart /
 * begin_checkout (src/lib/analytics.ts); the purchase is sent from here so it
 * counts even if the buyer never returns from Stripe.
 *
 * Only sessions whose buyer accepted analytics cookies carry ga_client_id
 * (set by checkout.mjs / commission-checkout.mts), so a session without one
 * is skipped. So is everything when GA4_MEASUREMENT_ID or GA4_API_SECRET is
 * unset. This never throws: a GA problem must not fail or slow the webhook
 * beyond its timeout.
 */

/** GA client ids look like "<random>.<timestamp>". */
export const GA_CLIENT_ID_RE = /^\d{1,20}\.\d{1,20}$/;

/**
 * Session metadata for a client id sent by the browser: { ga_client_id } or {}.
 * @param {unknown} gaClientId
 * @returns {Record<string, string>}
 */
export const gaClientIdMetadata = (gaClientId) =>
  typeof gaClientId === 'string' && GA_CLIENT_ID_RE.test(gaClientId) ? { ga_client_id: gaClientId } : {};

const pounds = (pence) => Math.round(pence || 0) / 100;
const money = (n) => Math.round(Number(n || 0) * 100) / 100;

/** GA4 items for shop cart lines (_shared/order-lines.mjs itemsFromLineItems). */
export function shopGaItems(cartItems) {
  return (cartItems || []).map((item) => ({
    item_id: item.slug || item.productId || 'unknown',
    item_name: item.title,
    item_variant: `${item.formatKey || item.format}/${item.sizeKey || item.size}`,
    price: money(item.unitPrice),
    quantity: item.quantity || 1,
  }));
}

/**
 * GA4 items for a commission's Stripe line items. Each line is a part of the
 * commission ("<service> — <what>"), so item_id is the service slug and
 * item_variant is the part. price is what Stripe charged for the line (after
 * any Groupon voucher, which Stripe spreads across the lines), with the
 * voucher's share as `discount`, so the items add up to the amount paid.
 */
export function commissionGaItems(lineItems, serviceSlug) {
  return (lineItems || []).map((li) => {
    const name = li.description || 'Commission';
    const [service, ...part] = name.split(' — ');
    const quantity = li.quantity || 1;
    const charged = li.amount_total ?? (li.price?.unit_amount || 0) * quantity;
    const discount = li.amount_discount || 0;
    return {
      item_id: serviceSlug || 'commission',
      item_name: service,
      ...(part.length ? { item_variant: part.join(' — ') } : {}),
      price: pounds(charged / quantity),
      ...(discount ? { discount: pounds(discount / quantity) } : {}),
      quantity,
    };
  });
}

/** What Stripe charged, less shipping, in pounds. */
export const chargedExShipping = (session) =>
  pounds((session.amount_total || 0) - (session.total_details?.amount_shipping || 0));

/**
 * The Measurement Protocol body for one Stripe session, or null if it
 * shouldn't be sent. value is the items alone (price × quantity) unless
 * given; shipping is reported separately.
 */
export function purchasePayload(session, items, value) {
  const clientId = session?.metadata?.ga_client_id;
  if (!clientId || !GA_CLIENT_ID_RE.test(clientId)) return null;
  const itemsValue = money((items || []).reduce((sum, i) => sum + i.price * i.quantity, 0));
  const shipping = pounds(session.total_details?.amount_shipping);
  return {
    client_id: clientId,
    events: [{
      name: 'purchase',
      params: {
        transaction_id: session.id,
        value: value ?? itemsValue,
        currency: (session.currency || 'gbp').toUpperCase(),
        ...(shipping ? { shipping } : {}),
        items: items || [],
      },
    }],
  };
}

/**
 * Send the purchase. `items` is GA4 items (shopGaItems / commissionGaItems),
 * or a function returning them, so a session without a client id doesn't
 * cost the webhook a Stripe call. `value` overrides the items' total.
 * @param {any} session
 * @param {any[] | (() => Promise<any[]>)} items
 * @param {{ value?: number, timeoutMs?: number, fetchImpl?: typeof fetch }} [options]
 */
export async function sendPurchase(session, items, { value, timeoutMs = 2000, fetchImpl = fetch } = {}) {
  const measurementId = process.env.GA4_MEASUREMENT_ID;
  const apiSecret = process.env.GA4_API_SECRET;
  if (!measurementId || !apiSecret) return;
  if (!GA_CLIENT_ID_RE.test(session?.metadata?.ga_client_id || '')) return;
  // One deadline for the whole thing, including any Stripe lookup in items().
  // A plain timer rather than AbortSignal.timeout(), whose timer is unref'd
  // and so can't be relied on to fire while this await is all that's pending.
  const controller = new AbortController();
  const { signal } = controller;
  let timer;
  const timedOut = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`timed out after ${timeoutMs} ms`));
    }, timeoutMs);
  });
  timedOut.catch(() => {});
  try {
    const resolved = typeof items === 'function' ? await Promise.race([items(), timedOut]) : items;
    const payload = purchasePayload(session, resolved, value);
    if (!payload) return;
    const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
    if (!res.ok) console.warn(`ga4: purchase for ${session.id} got HTTP ${res.status}`);
    else console.log(`ga4: purchase sent for ${session.id}`);
  } catch (err) {
    console.warn(`ga4: purchase for ${session?.id} not sent:`, err?.message);
  } finally {
    clearTimeout(timer);
  }
}
