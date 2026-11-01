// netlify/functions/sanity-orders-webhook.mts
//
// POST /api/sanity-orders-webhook   the Sanity webhook "Pixel8 orders"
// (formerly "Commission Delivery", edited in place: the plan allows two
// webhooks and "Netlify rebuild" holds the other).
//
// Verified with SANITY_WEBHOOK_SECRET, the secret "Commission Delivery"
// already has, so editing that webhook keeps it. What each delivery starts is
// decided in _shared/orders-router.mjs:
//   - dispatch emails (orders dispatched by hand, commissions shipped) and the
//     commission download email: ALWAYS, whether or not SHIPPING_ENABLED is set;
//   - Sendcloud labels and returns: only when SHIPPING_ENABLED is "true",
//     started as background functions with an AWAITED request carrying the
//     internal shipping key (an un-awaited one is frozen with this function).

import { isValidSignature, SIGNATURE_HEADER_NAME } from '@sanity/webhook';
import { runRoute, BACKGROUND_PATHS } from './_shared/orders-router.mjs';
import { sendDispatchEmail } from './_shared/dispatch-email.mjs';
import { deliverCommission } from './_shared/commission-delivery.mts';
import { shippingEnabled } from './_shared/shipping-client.mjs';
import { SHIPPING_INTERNAL_HEADER, shippingInternalKey } from './_shared/shipping-internal.mjs';
import { triggerInternal, TRIGGER_BUDGETS } from './_shared/origin.mjs';
import { sanity, getResend } from './_shared/shipping-deps.mts';

const text = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return text('Method not allowed', 405);
  const secret = process.env.SANITY_WEBHOOK_SECRET;
  if (!secret) {
    console.error('sanity-orders-webhook: SANITY_WEBHOOK_SECRET not set — refusing');
    return text('Webhook secret not configured', 500);
  }
  const rawBody = await req.text();
  const sig = req.headers.get(SIGNATURE_HEADER_NAME);
  let valid = false;
  try { valid = Boolean(sig) && (await isValidSignature(rawBody, sig!, secret)); } catch { valid = false; }
  if (!valid) return text('Invalid signature', 401);

  let doc: any;
  try { doc = JSON.parse(rawBody); } catch { return text('Bad JSON', 400); }

  try {
    const r = await runRoute(doc, {
      shippingOn: shippingEnabled(),
      sendDispatch: (type: string, id: string) =>
        sendDispatchEmail({ kind: type === 'commission' ? 'commission' : 'order', id, sanity, getResend }),
      completeCommission: async (id: string) => {
        const resend = getResend();
        if (!resend) return { status: 500, body: 'RESEND_API_KEY not set' };
        const res = await deliverCommission(id, { sanity, resend });
        return { status: res.status, body: await res.text() };
      },
      start: async (action: string, d: any) => {
        const key = shippingInternalKey();
        if (!key) return { ok: false, error: 'PERSONALISATION_SALT is not set' };
        return triggerInternal(BACKGROUND_PATHS[action as keyof typeof BACKGROUND_PATHS], {
          req,
          body: { _id: d._id, _type: d._type },
          headers: { [SHIPPING_INTERNAL_HEADER]: key },
          ...TRIGGER_BUDGETS.prewarm,
        });
      },
    });
    return text(r.body, r.status);
  } catch (err: any) {
    console.error('sanity-orders-webhook: failed:', err?.stack || err);
    return text('Failed', 500);
  }
}

export const config = { path: '/api/sanity-orders-webhook' };
