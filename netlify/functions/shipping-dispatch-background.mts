// netlify/functions/shipping-dispatch-background.mts
//
// POST /api/shipping/dispatch-background   (started by sanity-orders-webhook)
//
// Buys the labels for one order or commission set to "Ready to ship" and
// emails the team "Label ready" -- see _shared/shipping-dispatch.mjs. A
// background function: each create-parcel is a Sendcloud announcement of a
// few seconds, and several parcels would not fit a synchronous limit.
//
// Only our own functions may start it (the internal shipping key), and it
// does nothing unless SHIPPING_ENABLED is "true".

import { dispatchShipment } from './_shared/shipping-dispatch.mjs';
import { shippingEnabled } from './_shared/shipping-client.mjs';
import { isShippingInternal } from './_shared/shipping-internal.mjs';
import { sanity, getResend, shipping, retrieveSession } from './_shared/shipping-deps.mts';

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!isShippingInternal(req)) {
    console.warn('shipping-dispatch: request without the internal key — ignored');
    return new Response('Forbidden', { status: 403 });
  }
  if (!shippingEnabled()) return new Response('Shipping is not enabled — ignored');
  let body: any;
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400 }); }
  if (typeof body?._id !== 'string' || body._id.startsWith('drafts.') || !['order', 'commission'].includes(body?._type)) {
    return new Response('Not a published order or commission — ignored');
  }
  try {
    const r = await dispatchShipment(body._id, { sanity, shipping, getResend, retrieveSession });
    console.log(`shipping-dispatch: ${body._id}: ${r.outcome}${r.reason ? ` (${String(r.reason).split('\n')[0]})` : ''}`);
    return new Response(JSON.stringify({ outcome: r.outcome }));
  } catch (err: any) {
    console.error('shipping-dispatch: failed:', err?.stack || err);
    return new Response('Failed', { status: 500 });
  }
}

export const config = { path: '/api/shipping/dispatch-background' };
