// netlify/functions/groupon-redeem.mts
//
// Step 1 of the Groupon fulfilment flow.
//
// The customer bought a voucher on Groupon and lands on /groupon. They type the
// code. This endpoint decides whether that code is good, and if it is, hands
// back a short-lived claim token plus the service they are entitled to. The
// browser then sends them into the normal commission wizard carrying that
// token; commission-checkout turns it into a Stripe discount.
//
// What this endpoint deliberately does NOT do: hand the customer anything they
// could reuse or share. The claim token is single-use, expires in two hours,
// and is stored only as a hash.

import type { Context } from '@netlify/functions';
import { createClient } from '@sanity/client';
import {
  normaliseCode,
  looksLikeGrouponCode,
  newClaimToken,
  minutesFromNow,
  rejectionFor,
  REJECTION_MESSAGE,
  clientIp,
  rateLimit,
  recordFailure,
  claimCookie,
  CLAIM_TTL_MINUTES,
  type VoucherDoc,
} from './_shared/groupon.mts';

const sanity = createClient({
  projectId: 'bqb4w421',
  dataset: 'production',
  apiVersion: '2024-12-01',
  token: process.env.SANITY_TOKEN,
  useCdn: false,
});

// When true, a well-formed code that isn't in our imported list is accepted and
// recorded as unverified, to be reconciled against a Groupon report later.
// Default OFF — leaving it on means anyone who guesses the code format gets
// free work. Only turn it on if Groupon volume outruns the import cadence, and
// watch the unverified queue daily if you do.
const ALLOW_UNVERIFIED = process.env.GROUPON_ALLOW_UNVERIFIED === 'true';
const UNVERIFIED_SERVICE_SLUG = process.env.GROUPON_UNVERIFIED_SERVICE_SLUG || '';
const UNVERIFIED_VALUE_PENCE = Number(process.env.GROUPON_UNVERIFIED_VALUE_PENCE || 0);

const NOT_ORDERABLE =
  'Your voucher is valid, but that service is not taking orders online at the moment. ' +
  'Email hello@pixel8multimedia.co.uk with your Groupon order number and we will set it up by hand — ' +
  'your voucher has not been used.';

function json(body: unknown, status = 200, setCookie?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };
  if (setCookie) headers['Set-Cookie'] = setCookie;
  return new Response(JSON.stringify(body), { status, headers });
}

/**
 * Can a customer actually place this order on the site right now? A voucher for
 * a service whose wizard won't render would be claimed and then stranded for
 * two hours, so we check before touching the voucher at all.
 */
async function serviceIsOrderable(slug: string): Promise<boolean> {
  const svc = await sanity.fetch(
    `*[_type == "service" && slug.current == $slug][0]{
      commissionEnabled, "briefFieldCount": count(briefingFields)
    }`,
    { slug }
  );
  return !!svc && svc.commissionEnabled !== false && (svc.briefFieldCount || 0) > 0;
}

export default async function handler(req: Request, _context: Context) {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const ip = clientIp(req);
  if (!rateLimit(`redeem:${ip}`, 10, 10 * 60_000)) {
    return json(
      { error: 'Too many attempts. Please wait a few minutes and try again.' },
      429
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Expected JSON body.' }, 400);
  }

  const code = normaliseCode(body.code);
  if (!code) {
    return json({ error: 'Please enter your Groupon code.' }, 400);
  }
  if (!looksLikeGrouponCode(code)) {
    // Same message as a genuine miss — a malformed code shouldn't teach an
    // attacker what the format is.
    recordFailure(`redeem:${ip}`);
    return json({ error: REJECTION_MESSAGE['not-found'] }, 404);
  }

  try {
    const voucher: VoucherDoc | null = await sanity.fetch(
      `*[_type == "grouponVoucher" && code == $code][0]{
        _id, code, status, serviceSlug, entitlementOrderType, valuePence,
        expiresAt, claimTokenHash, claimExpiresAt, claimCount,
        campaignName, optionLabel, stripeCouponId, stripePromotionCodeId,
        stripeSessionId, verified,
        "commissionPaidAt": commission->paidAt
      }`,
      { code }
    );

    if (!voucher) {
      if (!ALLOW_UNVERIFIED || !UNVERIFIED_SERVICE_SLUG || !UNVERIFIED_VALUE_PENCE) {
        console.log(`groupon-redeem: unknown code from ${ip}`);
        recordFailure(`redeem:${ip}`);
        return json({ error: REJECTION_MESSAGE['not-found'] }, 404);
      }
      if (!(await serviceIsOrderable(UNVERIFIED_SERVICE_SLUG))) {
        return json({ error: NOT_ORDERABLE }, 503);
      }
      // Unverified path — create the record, flag it, and let it through.
      const { token, hash } = newClaimToken();
      const created = await sanity.create({
        _type: 'grouponVoucher',
        code,
        status: 'claimed',
        serviceSlug: UNVERIFIED_SERVICE_SLUG,
        valuePence: UNVERIFIED_VALUE_PENCE,
        verified: false,
        flags: ['unverified'],
        claimTokenHash: hash,
        claimedAt: new Date().toISOString(),
        claimExpiresAt: minutesFromNow(CLAIM_TTL_MINUTES),
        claimCount: 1,
        notes: `Accepted unverified from ${ip}. Reconcile against a Groupon redemption report before delivering.`,
      });
      console.warn(`groupon-redeem: UNVERIFIED code ${code} accepted (${created._id})`);
      return json({
        ok: true,
        verified: false,
        claimToken: token,
        serviceSlug: UNVERIFIED_SERVICE_SLUG,
        valuePence: UNVERIFIED_VALUE_PENCE,
        claimExpiresAt: minutesFromNow(CLAIM_TTL_MINUTES),
      }, 200, claimCookie(token));
    }

    const rejection = rejectionFor(voucher);
    if (rejection) {
      console.log(`groupon-redeem: ${code} refused (${rejection})`);
      return json({ error: REJECTION_MESSAGE[rejection], reason: rejection }, 409);
    }

    // Check the service BEFORE mutating the voucher — a claim we can't honour
    // locks the customer out for the whole claim window for no reason.
    if (!(await serviceIsOrderable(voucher.serviceSlug))) {
      console.warn(`groupon-redeem: ${code} valid but ${voucher.serviceSlug} is not orderable`);
      return json({ error: NOT_ORDERABLE }, 503);
    }

    // Claimable. Mint a fresh token — this invalidates any previous claim on
    // the same code, which is what we want when a customer restarts.
    const { token, hash } = newClaimToken();
    const claimExpiresAt = minutesFromNow(CLAIM_TTL_MINUTES);
    const claimCount = (voucher.claimCount || 0) + 1;

    const patch: Record<string, unknown> = {
      status: 'claimed',
      claimTokenHash: hash,
      claimedAt: new Date().toISOString(),
      claimExpiresAt,
      claimCount,
    };

    await sanity
      .patch(voucher._id)
      .set(patch)
      .commit();

    // Repeated claims aren't proof of anything, but they're the shape of a
    // shared code doing the rounds. Flag rather than block.
    if (claimCount >= 4) {
      try {
        await sanity
          .patch(voucher._id)
          .setIfMissing({ flags: [] })
          .append('flags', ['repeat-claims'])
          .commit();
      } catch { /* advisory only */ }
    }

    console.log(`groupon-redeem: ${code} claimed (${voucher.serviceSlug}, claim #${claimCount})`);

    return json({
      ok: true,
      verified: voucher.verified !== false,
      claimToken: token,
      serviceSlug: voucher.serviceSlug,
      entitlementOrderType: voucher.entitlementOrderType || null,
      valuePence: voucher.valuePence,
      campaignName: voucher.campaignName || null,
      optionLabel: voucher.optionLabel || null,
      claimExpiresAt,
    }, 200, claimCookie(token));
  } catch (err: any) {
    console.error('groupon-redeem error:', err);
    return json(
      { error: 'Something went wrong checking that code. Please try again in a moment.' },
      500
    );
  }
}

export const config = { path: '/.netlify/functions/groupon-redeem' };
