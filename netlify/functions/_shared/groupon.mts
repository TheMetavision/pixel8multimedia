// netlify/functions/_shared/groupon.mts
//
// Shared helpers for the Groupon voucher redemption flow.
//
// The rule the whole flow turns on: a Groupon voucher is an ENTITLEMENT worth
// a fixed number of pence against one specific service. It is not "100% off
// whatever is in the basket". Applying it as a fixed amount_off means a
// customer who bought a £14.99 digital option and then adds a canvas print at
// checkout pays for the canvas — which is the entire point of the digital-first
// / hard-copy-upgrade strategy.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type Stripe from 'stripe';
import campaignData from '../../../src/data/groupon-campaigns.json' with { type: 'json' };

export const CLAIM_TTL_MINUTES = 1440;     // a day to get through the wizard, on any device
export const CHECKOUT_TTL_MINUTES = 60;    // and 1h more to finish paying

export interface DealOption {
  key: string;
  label: string;
  valuePence: number;
  dealPence: number | null;
  orderType: string;
  match: string;
  dealId: string;
  campaignName: string;
  serviceSlug: string;
}

/** Every sellable Groupon option, flattened. */
export function allDealOptions(): DealOption[] {
  const out: DealOption[] = [];
  const campaigns = (campaignData as any).campaigns || {};
  for (const [dealId, c] of Object.entries<any>(campaigns)) {
    for (const o of c.options || []) {
      out.push({
        key: o.key,
        label: o.label,
        valuePence: o.valuePence,
        dealPence: o.dealPence ?? null,
        orderType: o.orderType,
        match: o.match || '',
        dealId,
        campaignName: c.campaignName,
        serviceSlug: c.serviceSlug,
      });
    }
  }
  return out;
}

export function dealOptionByKey(key: string): DealOption | null {
  if (!key) return null;
  return allDealOptions().find((o) => o.key === key) || null;
}

export type VoucherStatus =
  | 'imported'
  | 'claimed'
  | 'checkout'
  | 'redeemed'
  | 'expired'
  | 'refunded'
  | 'void';

export interface VoucherDoc {
  _id: string;
  _rev?: string;
  code: string;
  status: VoucherStatus;
  serviceSlug: string;
  entitlementOrderType?: string;
  valuePence: number;
  expiresAt?: string;
  claimTokenHash?: string;
  claimExpiresAt?: string;
  claimCount?: number;
  campaignName?: string;
  optionLabel?: string;
  stripeCouponId?: string;
  stripePromotionCodeId?: string;
  stripeSessionId?: string;
  verified?: boolean;
  /** Denormalised from commission->paidAt. Set means the voucher is spent, whatever its status says. */
  commissionPaidAt?: string | null;
  /**
   * Whether this code has been confirmed against Groupon. Separate from `status`
   * on purpose: a voucher can be fully redeemed here and still not confirmed as
   * real, and it is the confirmation — not the redemption — that releases the
   * work to be made.
   */
  verificationStatus?: VerificationStatus;
  declaredDealKey?: string;
}

export type VerificationStatus = 'unchecked' | 'verified' | 'mismatch' | 'rejected';

/**
 * Normalise anything a customer might type into the canonical stored form.
 * Groupon codes get read off a phone screen and retyped, so we are generous:
 * strip whitespace, hyphens, underscores; uppercase. We deliberately do NOT
 * fold O/0 or I/1 — that would collapse two distinct real codes into one.
 */
export function normaliseCode(input: unknown): string {
  return String(input ?? '')
    .toUpperCase()
    .replace(/[\s\-_.]/g, '')
    .trim();
}

/** Cheap structural gate before we touch the database. */
export function looksLikeGrouponCode(code: string): boolean {
  return /^[A-Z0-9]{6,24}$/.test(code);
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function newClaimToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('hex');
  return { token, hash: sha256(token) };
}

/** Constant-time compare of two hex digests of equal length. */
export function hashesMatch(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

export function minutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

export function isPast(iso?: string | null): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t < Date.now();
}

/**
 * A voucher is available to claim if it is `imported`, or if it is sitting in
 * `claimed` / `checkout` with a lapsed window (abandoned wizard, expired
 * session). Lapsed claims self-heal here rather than needing a sweeper.
 */
export function isClaimable(v: VoucherDoc): boolean {
  // A paid order is the real record of redemption. If the webhook failed to
  // move the voucher to `redeemed`, its status is stale — trusting it would
  // hand a spent voucher back to the pool.
  if (v.commissionPaidAt) return false;
  // Claiming is deliberately NOT exclusive. A customer who starts on a phone and
  // finishes on a laptop must not be told their own voucher is "in use
  // elsewhere" — that lockout generated support mail and protected nothing.
  // Exclusivity belongs at checkout, where the compare-and-swap enforces it.
  return v.status === 'imported' || v.status === 'claimed' || v.status === 'checkout';
}

export type VoucherRejection =
  | 'not-found'
  | 'already-redeemed'
  | 'expired'
  | 'refunded'
  | 'void';

/** Why a voucher can't be used right now — or null if it can. */
export function rejectionFor(v: VoucherDoc): VoucherRejection | null {
  if (v.status === 'redeemed' || v.commissionPaidAt) return 'already-redeemed';
  if (v.status === 'refunded') return 'refunded';
  if (v.status === 'void') return 'void';
  if (v.status === 'expired' || isPast(v.expiresAt)) return 'expired';
  if (!isClaimable(v)) return 'already-redeemed';
  return null;
}

/**
 * Customer-facing copy for each rejection. Deliberately specific: "already
 * used" and "expired" need different actions from the customer, and a vague
 * message just generates support email.
 */
export const REJECTION_MESSAGE: Record<VoucherRejection, string> = {
  'not-found':
    "We couldn't find that code. Check it against your Groupon voucher and try again — if it still doesn't work, email hello@pixel8multimedia.co.uk and we'll sort it out.",
  'already-redeemed':
    "That voucher has already been redeemed. If you didn't place an order with it, email hello@pixel8multimedia.co.uk and we'll look into it.",
  expired:
    'That voucher has passed its expiry date. Groupon vouchers usually keep their paid value after expiry — contact Groupon, then get in touch and we will honour what they confirm.',
  refunded:
    'That voucher was refunded by Groupon, so it can no longer be redeemed here.',
  void: 'That voucher is no longer valid. Please email hello@pixel8multimedia.co.uk.',
};

/**
 * One Stripe coupon per (service, value) pair, reused across every voucher of
 * that shape. `amount_off` — never `percent_off` — so the discount is capped at
 * what the customer actually bought and upgrades stay chargeable.
 *
 * Deterministic id means this is safe to call on every redemption: we look it
 * up first and only create when missing.
 */
export function couponIdFor(serviceSlug: string, valuePence: number): string {
  return `groupon-${serviceSlug}-${valuePence}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

export async function ensureCoupon(
  stripe: Stripe,
  serviceSlug: string,
  valuePence: number,
  serviceTitle?: string
): Promise<Stripe.Coupon> {
  const id = couponIdFor(serviceSlug, valuePence);
  try {
    const existing = await stripe.coupons.retrieve(id);
    if (!existing.deleted) return existing as Stripe.Coupon;
  } catch (err: any) {
    if (err?.statusCode !== 404 && err?.raw?.code !== 'resource_missing') throw err;
  }
  try {
    return await stripe.coupons.create({
      id,
      amount_off: valuePence,
      currency: 'gbp',
      duration: 'once',
      name: `Groupon voucher — ${serviceTitle || serviceSlug} (£${(valuePence / 100).toFixed(2)})`,
      metadata: { source: 'groupon', serviceSlug, valuePence: String(valuePence) },
    });
  } catch (err: any) {
    // Two first-ever redemptions of the same shape can race here. The id is
    // deterministic, so the loser just reads what the winner created.
    if (err?.raw?.code === 'resource_already_exists') {
      return (await stripe.coupons.retrieve(id)) as Stripe.Coupon;
    }
    throw err;
  }
}

/**
 * How much of the entitlement this particular order may actually consume.
 *
 * The voucher buys the SERVICE, not the basket. Capping the discount at the
 * value of the base tier the customer chose means a £29.99 animation voucher
 * spent on a £14.99 digital tier plus a £30 canvas takes £14.99 off, not
 * £29.99 — the canvas stays chargeable, which is the whole point of the
 * digital-first / hard-copy-upgrade model. Any unused entitlement is forfeited,
 * exactly as it would be on Groupon.
 */
export function effectiveDiscountPence(valuePence: number, baseTierPence: number): number {
  return Math.max(0, Math.min(Math.round(valuePence), Math.round(baseTierPence)));
}

/** Read one cookie out of a request. */
export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

export const CLAIM_COOKIE = 'p8_groupon_claim';

/**
 * The claim token also travels as an HttpOnly cookie. sessionStorage is the
 * primary channel, but it is unavailable in some private-browsing modes — and
 * a customer who thinks they are redeeming a voucher must never be quietly
 * charged full price because their browser blocked site data. HttpOnly keeps it
 * out of reach of page scripts, and it never appears in a URL.
 */
export function claimCookie(token: string, ttlMinutes = CLAIM_TTL_MINUTES): string {
  return [
    `${CLAIM_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${ttlMinutes * 60}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ].join('; ');
}

export function clearClaimCookie(): string {
  return `${CLAIM_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

/**
 * A single-use promotion code bound to one voucher. Stripe enforcing
 * max_redemptions = 1 is the second lock: even if our own state machine were
 * raced, Stripe refuses the second application.
 *
 * The generated code is NOT the Groupon code — Groupon codes never leave our
 * database, and a Stripe promotion code is visible on receipts.
 */
export async function mintPromotionCode(
  stripe: Stripe,
  coupon: Stripe.Coupon,
  voucher: VoucherDoc,
  ttlMinutes = CHECKOUT_TTL_MINUTES
): Promise<Stripe.PromotionCode> {
  const suffix = randomBytes(5).toString('hex').toUpperCase();
  return stripe.promotionCodes.create({
    coupon: coupon.id,
    code: `GRPN${suffix}`,
    max_redemptions: 1,
    expires_at: Math.floor(Date.now() / 1000) + ttlMinutes * 60,
    metadata: {
      source: 'groupon',
      grouponVoucherId: voucher._id,
      grouponCode: voucher.code,
      serviceSlug: voucher.serviceSlug,
    },
  });
}

/** Best-effort teardown of an unused promotion code (abandoned checkout). */
export async function deactivatePromotionCode(stripe: Stripe, id?: string): Promise<void> {
  if (!id) return;
  try {
    await stripe.promotionCodes.update(id, { active: false });
  } catch (err) {
    console.warn('groupon: could not deactivate promotion code', id, err);
  }
}

/** Client IP for rate limiting, tolerant of Netlify's header shapes. */
export function clientIp(req: Request): string {
  const xf = req.headers.get('x-nf-client-connection-ip')
    || req.headers.get('x-forwarded-for')
    || '';
  return xf.split(',')[0].trim() || 'unknown';
}

/**
 * Per-instance sliding-window limiter. Netlify may run several instances, so
 * this is a speed bump rather than a wall — enough to stop a single client
 * brute-forcing codes from one connection. The real protection is that codes
 * are long, and that an unknown code never reveals whether it nearly matched.
 */
const attempts = new Map<string, number[]>();

function liveHits(key: string, windowMs: number): number[] {
  const now = Date.now();
  const hits = (attempts.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length) attempts.set(key, hits);
  else attempts.delete(key);
  if (attempts.size > 5000) {
    for (const [k, v] of attempts) {
      if (v.every((t) => now - t >= windowMs)) attempts.delete(k);
    }
  }
  return hits;
}

/**
 * Is this caller still under the limit? Checking does NOT consume an attempt —
 * only `recordFailure` does. A household or office behind one NAT redeeming
 * several vouchers must not lock each other out; someone guessing codes still
 * runs out quickly.
 */
export function rateLimit(key: string, max = 10, windowMs = 10 * 60_000): boolean {
  return liveHits(key, windowMs).length < max;
}

export function recordFailure(key: string, windowMs = 10 * 60_000): void {
  const hits = liveHits(key, windowMs);
  hits.push(Date.now());
  attempts.set(key, hits);
}
