// netlify/functions/returns.mts
//
// POST /api/returns   the public /returns page (see _shared/returns-api.mjs).
// 404 unless SHIPPING_ENABLED is "true".

import { handleReturns } from './_shared/returns-api.mjs';
import { shippingEnabled, shippingRequest } from './_shared/shipping-client.mjs';
import { verifyTurnstile } from './_shared/turnstile.mjs';
import { takeSlot, hashKey } from './_shared/rate-limit.mjs';
import { sanity, getResend } from './_shared/shipping-deps.mts';

export default async function handler(req: Request): Promise<Response> {
  let r: { status: number; body: unknown };
  try {
    r = await handleReturns(req, {
      sanity,
      getResend,
      shippingOn: shippingEnabled(),
      turnstile: verifyTurnstile,
      // Keys are hashed, never a raw IP (rate-limit.mjs).
      rateLimit: (store: string, key: string, limit: number, windowMs: number) =>
        takeSlot(store, hashKey(store, key), limit, windowMs),
      // A slow quote must not hold the page: 6 s, then the general wording.
      quote: (body: object) => shippingRequest('quote-return', {
        body, fetchImpl: (url: string, init: RequestInit) => fetch(url, { ...init, signal: AbortSignal.timeout(6000) }),
      }),
    });
  } catch (err: any) {
    console.error('returns: failed:', err?.stack || err);
    r = { status: 500, body: { error: 'Something went wrong. Please try again, or contact us.' } };
  }
  return new Response(JSON.stringify(r.body), {
    status: r.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export const config = { path: '/api/returns' };
