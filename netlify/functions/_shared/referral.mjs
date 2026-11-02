/**
 * Referral programme: "give 10%, get 10%", as Comic Strip Canvas runs it.
 *
 *   FRIEND side   Every buyer gets their own Stripe promotion code (PIX-XXXXXX)
 *                 when their first order is dispatched or delivered. A friend
 *                 who uses it gets 10% off a first order. One code per buyer
 *                 email, reused on later orders and commissions.
 *   REFERRER side When a paid order or commission used someone's PIX- code,
 *                 the payment webhook issues the referrer a single-use 10%
 *                 code (THANKS-XXXXXX) and emails it (referral-reward.mjs).
 *
 * Pixel8 has its own Stripe account (Alan, 1 Nov 2026), so these codes only
 * work on pixel8multimedia.co.uk. Coupons are created on first use with fixed
 * ids, so there is nothing to set up in the Stripe Dashboard. Promotion codes
 * carry metadata.kind so the rest of the code can tell them apart from the
 * PIX10 welcome code (isWelcomeCode in discount.mjs).
 *
 * Everything here is best-effort: a referral problem never blocks an order,
 * a dispatch email or a payment. Callers log and carry on.
 */

export const FRIEND_PREFIX = 'PIX';
export const REWARD_PREFIX = 'THANKS';
export const FRIEND_COUPON_ID = 'p8-referral-friend-10';
export const REWARD_COUPON_ID = 'p8-referral-reward-10';
export const KIND_FRIEND = 'p8-referral';
export const KIND_REWARD = 'p8-referral-reward';

// No 0/O/1/I/L: codes get read out loud and typed off phones.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** A random code body, e.g. "K7QM2X". `rand` is injectable for tests. */
export function codeBody(len = 6, rand = Math.random) {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  return s;
}

/** Is this Stripe promotion code one of our friend (PIX-) codes? */
export const isFriendCode = (promo) =>
  !!promo && typeof promo === 'object' && promo.metadata?.kind === KIND_FRIEND;

/** Is this Stripe promotion code a referrer's thank-you code? */
export const isRewardCode = (promo) =>
  !!promo && typeof promo === 'object' && promo.metadata?.kind === KIND_REWARD;

/** Create the coupon if it does not exist yet. Returns its id. */
export async function ensureCoupon(stripe, id, name) {
  try {
    await stripe.coupons.retrieve(id);
    return id;
  } catch (err) {
    if (err?.statusCode !== 404 && err?.code !== 'resource_missing') throw err;
  }
  try {
    await stripe.coupons.create({ id, name, percent_off: 10, duration: 'once' });
  } catch (err) {
    // Two deliveries racing to create it: the other one won, which is fine.
    if (err?.code !== 'resource_already_exists') throw err;
  }
  return id;
}

/** Create a promotion code, retrying on the (very unlikely) clash of a random code. */
async function createPromo(stripe, prefix, params, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const code = `${prefix}-${codeBody()}`;
    try {
      return await stripe.promotionCodes.create({ ...params, code });
    } catch (err) {
      lastErr = err;
      if (!/already exists/i.test(err?.message || '')) throw err;
    }
  }
  throw lastErr;
}

/**
 * The buyer's friend code: reuse one already recorded on an earlier order or
 * commission from the same email (`existingCode`), otherwise create a new one.
 * Returns the code string.
 */
export async function friendCodeFor(stripe, { email, orderRef, existingCode }) {
  if (existingCode) return existingCode;
  await ensureCoupon(stripe, FRIEND_COUPON_ID, 'Referral: friend 10% off first order');
  const promo = await createPromo(stripe, FRIEND_PREFIX, {
    coupon: FRIEND_COUPON_ID,
    restrictions: { first_time_transaction: true },
    metadata: { kind: KIND_FRIEND, referrer_email: String(email || '').trim().toLowerCase(), referrer_order: orderRef || '' },
  });
  return promo.code;
}

/** A single-use 10% thank-you code for the referrer. Returns the code string. */
export async function issueReward(stripe, { referrerEmail, referredOrder }) {
  await ensureCoupon(stripe, REWARD_COUPON_ID, 'Referral: thank-you 10% off next order');
  const promo = await createPromo(stripe, REWARD_PREFIX, {
    coupon: REWARD_COUPON_ID,
    max_redemptions: 1,
    metadata: { kind: KIND_REWARD, referrer_email: String(referrerEmail || '').trim().toLowerCase(), referred_order: referredOrder || '' },
  });
  return promo.code;
}

/**
 * Pick out the friend codes used on a paid checkout, and whether each is a
 * real referral: not the buyer's own code, and the referrer email is known.
 * `promos` are expanded Stripe promotion code objects (readDiscount().promos).
 */
export function referralsFrom(promos, buyerEmail) {
  const buyer = String(buyerEmail || '').trim().toLowerCase();
  return (promos || [])
    .filter(isFriendCode)
    .map((p) => ({
      code: p.code,
      referrerEmail: String(p.metadata?.referrer_email || '').toLowerCase(),
      referrerOrder: p.metadata?.referrer_order || '',
    }))
    .filter((r) => r.referrerEmail && r.referrerEmail !== buyer);
}
