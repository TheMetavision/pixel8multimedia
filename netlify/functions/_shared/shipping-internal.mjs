/**
 * The key our own functions use to start the shipping background functions.
 *
 * sanity-orders-webhook checks Sanity's signature, decides what to start, and
 * POSTs { _id, _type } to /api/shipping/dispatch-background or
 * /api/shipping/return-background with this key in SHIPPING_INTERNAL_HEADER.
 *
 * Derived from PERSONALISATION_SALT, so it needs no environment variable of
 * its own (the 4 KB function-env limit), but it is NOT the personalisation
 * key: an HMAC under a fixed label, so knowing one key says nothing about the
 * other, and either can be rotated by changing its label.
 *
 * Fails closed: with no PERSONALISATION_SALT there is no key and nothing is
 * accepted (the personalisation key falls back to 'dev-salt'; this does not).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SHIPPING_INTERNAL_HEADER = 'x-p8-shipping-key';
const LABEL = 'pixel8:shipping-internal:v1';

/** The key, or null when PERSONALISATION_SALT is unset. */
export function shippingInternalKey(env = process.env) {
  const salt = env.PERSONALISATION_SALT;
  if (!salt) return null;
  return createHmac('sha256', salt).update(LABEL).digest('hex').slice(0, 48);
}

/** Constant-time check of a request's header. */
export function isShippingInternal(req, env = process.env) {
  const want = shippingInternalKey(env);
  if (!want) return false;
  const got = Buffer.from(req.headers.get(SHIPPING_INTERNAL_HEADER) || '');
  const w = Buffer.from(want);
  return got.length === w.length && timingSafeEqual(got, w);
}
