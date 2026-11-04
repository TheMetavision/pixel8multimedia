// netlify/functions/shipping-event.mts
//
// POST /api/shipping-event   the shipping service's tracking callback
// (CALLBACK_URL_PIXEL8 on metavision-shipping). Signed with SHIPPING_SECRET.
//
// Answers fast: checks the signature and the event's shape, hands the
// unchanged signed body to shipping-event-background (which does the work --
// see _shared/shipping-event-handoff.mjs and _shared/shipping-events.mjs),
// and replies 200 once that has started. Bad signature 401 at once; 503 while
// SHIPPING_ENABLED is off or if the background start fails, so the service
// keeps the event and retries.
//
// Imports nothing that talks to Sanity, Resend, Stripe or MailerLite.

import { acceptShippingEvent } from './_shared/shipping-event-handoff.mjs';

// Pixel8 routes its functions with config.path (the background one too).
const EVENT_BACKGROUND_PATH = '/api/shipping/event-background';

export default async function handler(req: Request): Promise<Response> {
  const r = await acceptShippingEvent(req, { path: EVENT_BACKGROUND_PATH });
  return new Response(r.body, { status: r.status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

export const config = { path: '/api/shipping-event' };
