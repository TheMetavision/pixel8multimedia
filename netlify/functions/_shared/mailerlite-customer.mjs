/**
 * Add or update a buyer in the MailerLite group "P8 - Customers" when their
 * order or commission reaches them (_shared/post-delivery.mjs). Joining the
 * group starts the post-delivery automation: Email 1 (day 1), Email 2 (day 4,
 * branching on p8_delivery: "did it land safely" for print, "want it on your
 * wall?" for digital) and the day-21 referral email, sent only when
 * p8_marketing_ok = yes.
 *
 * FIELDS. MailerLite custom fields are shared by every brand in the account,
 * so one person who buys from Pixel8 and Comic Strip Canvas is one
 * subscriber. Pixel8 writes only its own p8_ fields, plus the shared default
 * `name`, so neither brand's emails can show the other's code or order:
 *
 *   name                 first name (shared default field)
 *   p8_order_id          P8-XXXXXXXX (shop, Your Photo) or PX-XXXXXXXX (commission)
 *   p8_product           "Product and 2 more", or the commission's service
 *   p8_last_order_date   YYYY-MM-DD (date field)
 *   p8_referral_code     PIX-XXXXXX, or '' if Stripe was unavailable
 *   p8_delivery          'print' or 'digital' (a print + digital commission is 'print')
 *   p8_marketing_ok      'yes' only if they saw the opt-out box and left it
 *                        unticked; 'no' for orders from before the box
 *
 * A buyer who ticked "Don't send me offers or referral emails" is never added
 * at all, so the automation never starts for them; p8_marketing_ok stays as a
 * second guard on the referral email.
 *
 * MailerLite's POST /subscribers is an upsert. No `status` is sent, so it
 * never resubscribes someone who unsubscribed.
 *
 * Env: MAILERLITE_API_KEY (already set for the newsletter). The group id is
 * MAILERLITE_CUSTOMERS_GROUP_ID in site-config.mjs (env override allowed).
 *
 * Never throws: returns { ok, skipped?, status?, error? } for the caller to log.
 */
import { fetchWithTimeout } from './timing.mjs';
import { setting } from './site-config.mjs';
import { marketingRefused, marketingOk } from './marketing-consent.mjs';
import { orderRefFor } from './order-ref.mjs';

const ML = 'https://connect.mailerlite.com/api';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "Pikachu Pop Art", or "Pikachu Pop Art and 2 more" for a multi-line order. */
export function productTitleFor(lineItems) {
  const items = Array.isArray(lineItems) ? lineItems : [];
  const first = String(items[0]?.productTitle || '').trim();
  if (!first) return 'your order';
  const more = items.length - 1;
  return more > 0 ? `${first} and ${more} more` : first;
}

/** 'print' or 'digital'. Shop orders are always print; a 'both' commission counts as print. */
export function deliveryFor(kind, doc) {
  return kind === 'commission' && doc?.deliveryType === 'digital' ? 'digital' : 'print';
}

/** The MailerLite subscriber body for one delivered order or commission. */
export function customerPayload(kind, doc, { referralCode, groupId }) {
  const commission = kind === 'commission';
  return {
    email: String(doc.customerEmail || '').trim(),
    groups: [String(groupId)],
    fields: {
      name: String(doc.customerName || '').trim().split(/\s+/)[0] || '',
      p8_order_id: (commission ? doc.orderRef : orderRefFor(doc)) || '',
      p8_product: commission ? String(doc.serviceTitle || 'your commission') : productTitleFor(doc.lineItems),
      p8_last_order_date: String((commission ? doc.paidAt : doc.createdAt) || doc._createdAt || '').slice(0, 10),
      p8_referral_code: referralCode || '',
      p8_delivery: deliveryFor(kind, doc),
      // 'yes' only for 'not_asked' (saw the box, left it unticked), which
      // allows the referral email under the soft opt-in. No consent recorded
      // (ordered before the box existed) is 'no' (marketing-consent.mjs).
      p8_marketing_ok: marketingOk(doc.marketingConsent),
    },
  };
}

export async function addDeliveredCustomer(kind, doc, { referralCode } = {}, env = process.env, fetchFn = fetchWithTimeout) {
  if (marketingRefused(doc?.marketingConsent)) return { ok: false, skipped: 'buyer refused marketing at checkout' };
  const apiKey = env.MAILERLITE_API_KEY;
  const groupId = setting('MAILERLITE_CUSTOMERS_GROUP_ID', env);
  if (!apiKey || !groupId) return { ok: false, skipped: 'MAILERLITE_API_KEY or MAILERLITE_CUSTOMERS_GROUP_ID not set' };
  const body = customerPayload(kind, doc, { referralCode, groupId });
  if (!EMAIL_RE.test(body.email)) return { ok: false, skipped: 'no valid email' };
  try {
    const res = await fetchFn(`${ML}/subscribers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    }, 4000, 'MailerLite customer');
    if (!res.ok) return { ok: false, status: res.status, error: await res.text().catch(() => '') };
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}
