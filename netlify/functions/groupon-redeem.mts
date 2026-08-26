// netlify/functions/groupon-redeem.mts
//
// Step 1 of the Groupon fulfilment flow: accept-then-verify.
//
// Groupon publishes no API for checking whether a voucher code is real, so this
// endpoint CANNOT know. Gating redemption on our imported list would have meant
// turning away anyone who bought a voucher since the last import — which is
// most people, on the evening they buy. So the code is accepted here, the order
// is taken, and the order is held until the code has been confirmed against
// Merchant Center. A bad code costs a minute of checking; it never costs work.
//
// Two grades of claim come out of this:
//
//   verified   — the code is in our imported list, so the service, option and
//                value are authoritative and the customer's own selection is
//                overridden. Nothing to check later.
//   unchecked  — the code is newer than our last import. We record the deal the
//                customer says they bought and flag the order for confirmation.

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
  dealOptionByKey,
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

// STRICT MODE (default): a code that is not in our imported list is refused at
// input. Nothing gets created, no order can exist against an unverified code.
// The price is that a customer who bought their voucher AFTER the last import
// is turned away until the next one — the rejection message tells them so.
// Set GROUPON_ACCEPT_UNKNOWN=true to switch to accept-then-verify instead,
// where unknown codes are taken on the customer's word and the order is held
// until the code is confirmed. All of that machinery remains in place.
const ACCEPT_UNKNOWN = process.env.GROUPON_ACCEPT_UNKNOWN === 'true';

// How many unconfirmed vouchers one address may have in flight at once. Someone
// inventing codes hits this quickly; a real customer never sees it.
const MAX_UNCHECKED_PER_IP = Number(process.env.GROUPON_MAX_UNCHECKED_PER_IP || 3);

const NOT_ORDERABLE =
  'Your voucher is fine, but that service is not taking orders online at the moment. ' +
  'Email hello@pixel8multimedia.co.uk with your Groupon order number and we will set it up by hand — ' +
  'your voucher has not been used.';

const NEEDS_DEAL =
  'Please tell us which deal you bought so we apply the right credit.';

const CODE_NOT_ON_FILE =
  "We couldn't match that code to a voucher. If you bought your deal in the last day or two, " +
  'it may not have reached our system yet — codes arrive from Groupon on a daily update, so ' +
  'please try again tomorrow. If it still fails, email hello@pixel8multimedia.co.uk with your ' +
  "Groupon order number and we'll set your order up by hand the same day.";

const TOO_MANY =
  'We have a few unconfirmed vouchers from you already. Email hello@pixel8multimedia.co.uk ' +
  'with your Groupon order numbers and we will sort them out by hand.';

function json(body: unknown, status = 200, setCookie?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };
  if (setCookie) headers['Set-Cookie'] = setCookie;
  return new Response(JSON.stringify(body), { status, headers });
}

/** Can a customer actually place this order right now? */
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
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const ip = clientIp(req);
  if (!rateLimit(`redeem:${ip}`, 10, 10 * 60_000)) {
    return json({ error: 'Too many attempts. Please wait a few minutes and try again.' }, 429);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Expected JSON body.' }, 400);
  }

  const code = normaliseCode(body.code);
  const dealKey = String(body.dealKey || '').trim();

  if (!code) return json({ error: 'Please enter your Groupon code.' }, 400);
  if (!looksLikeGrouponCode(code)) {
    recordFailure(`redeem:${ip}`);
    return json({ error: REJECTION_MESSAGE['not-found'] }, 400);
  }

  try {
    const voucher: VoucherDoc | null = await sanity.fetch(
      `*[_type == "grouponVoucher" && code == $code][0]{
        _id, code, status, serviceSlug, entitlementOrderType, valuePence,
        expiresAt, claimTokenHash, claimExpiresAt, claimCount, campaignName,
        optionLabel, stripeCouponId, stripePromotionCodeId, stripeSessionId,
        verified, verificationStatus, declaredDealKey,
        "commissionPaidAt": commission->paidAt
      }`,
      { code }
    );

    // ── Known code: our record wins over anything the customer selected ──
    if (voucher) {
      const rejection = rejectionFor(voucher);
      if (rejection) {
        console.log(`groupon-redeem: ${code} refused (${rejection})`);
        return json({ error: REJECTION_MESSAGE[rejection], reason: rejection }, 409);
      }
      if (!(await serviceIsOrderable(voucher.serviceSlug))) {
        return json({ error: NOT_ORDERABLE }, 503);
      }

      const { token, hash } = newClaimToken();
      const claimExpiresAt = minutesFromNow(CLAIM_TTL_MINUTES);
      const claimCount = (voucher.claimCount || 0) + 1;

      await sanity.patch(voucher._id).set({
        status: 'claimed',
        claimTokenHash: hash,
        claimedAt: new Date().toISOString(),
        claimExpiresAt,
        claimCount,
      }).commit();

      console.log(`groupon-redeem: ${code} claimed (${voucher.serviceSlug}, claim #${claimCount})`);

      return json({
        ok: true,
        verified: voucher.verificationStatus === 'verified' || voucher.verified === true,
        claimToken: token,
        serviceSlug: voucher.serviceSlug,
        entitlementOrderType: voucher.entitlementOrderType || null,
        valuePence: voucher.valuePence,
        campaignName: voucher.campaignName || null,
        optionLabel: voucher.optionLabel || null,
        // A known code overrides the customer's pick, so tell the page when the
        // two disagreed — it needs to explain the change rather than silently
        // send them somewhere they didn't choose.
        correctedFromDeal: dealKey && dealOptionByKey(dealKey)?.serviceSlug !== voucher.serviceSlug
          ? dealKey
          : null,
        claimExpiresAt,
      }, 200, claimCookie(token));
    }

    // ── Unknown code ─────────────────────────────────────────────────────
    if (!ACCEPT_UNKNOWN) {
      // Strict mode: refuse at input. No record is created, so no order can
      // ever exist against a code Groupon hasn't told us about.
      recordFailure(`redeem:${ip}`);
      console.log(`groupon-redeem: unknown code refused (strict mode) from ${ip}`);
      return json({ error: CODE_NOT_ON_FILE, reason: 'not-on-file' }, 404);
    }

    // Accept-then-verify mode: take the customer's word, flag it for checking.
    const option = dealOptionByKey(dealKey);
    if (!option) return json({ error: NEEDS_DEAL, needsDeal: true }, 400);

    if (!(await serviceIsOrderable(option.serviceSlug))) {
      return json({ error: NOT_ORDERABLE }, 503);
    }

    const uncheckedFromIp = await sanity.fetch(
      `count(*[_type == "grouponVoucher" && verificationStatus == "unchecked" && claimIp == $ip])`,
      { ip }
    );
    if (uncheckedFromIp >= MAX_UNCHECKED_PER_IP) {
      console.warn(`groupon-redeem: ${ip} has ${uncheckedFromIp} unchecked vouchers — refusing`);
      return json({ error: TOO_MANY }, 429);
    }

    const { token, hash } = newClaimToken();
    const claimExpiresAt = minutesFromNow(CLAIM_TTL_MINUTES);

    const created = await sanity.create({
      _type: 'grouponVoucher',
      code,
      status: 'claimed',
      dealId: option.dealId,
      campaignName: option.campaignName,
      optionLabel: option.label,
      serviceSlug: option.serviceSlug,
      entitlementOrderType: option.orderType,
      valuePence: option.valuePence,
      paidPence: option.dealPence ?? undefined,
      declaredDealKey: option.key,
      verified: false,
      verificationStatus: 'unchecked',
      claimIp: ip,
      claimTokenHash: hash,
      claimedAt: new Date().toISOString(),
      claimExpiresAt,
      claimCount: 1,
      notes:
        'Code accepted before confirmation — it was not in the imported list. ' +
        'The deal above is what the CUSTOMER says they bought. Confirm in Merchant Center ' +
        'before this order is worked.',
    });

    console.log(`groupon-redeem: ${code} accepted UNCHECKED as ${option.key} (${created._id})`);

    return json({
      ok: true,
      verified: false,
      claimToken: token,
      serviceSlug: option.serviceSlug,
      entitlementOrderType: option.orderType,
      valuePence: option.valuePence,
      campaignName: option.campaignName,
      optionLabel: option.label,
      correctedFromDeal: null,
      claimExpiresAt,
    }, 200, claimCookie(token));
  } catch (err: any) {
    console.error('groupon-redeem error:', err);
    return json({ error: 'Something went wrong checking that code. Please try again in a moment.' }, 500);
  }
}

export const config = { path: '/.netlify/functions/groupon-redeem' };
