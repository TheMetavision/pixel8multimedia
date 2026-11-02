/**
 * The post-delivery sequence: the buyer's own PIX- referral code, then
 * "P8 - Customers" in MailerLite, whose automation sends the three emails.
 *
 * WHEN. Once per order or commission, at the first email that tells the
 * customer it has reached them:
 *
 *   shop order / Your Photo order   the dispatch email (by hand, or Sendcloud's
 *                                   first scan): dispatch-email.mjs
 *                                   afterDispatchEmail()
 *   print commission                the dispatch email (Shipped), same hook
 *   digital commission              the download email (Complete):
 *                                   commission-delivery.mts
 *   print + digital commission      whichever of those two comes first
 *                                   (p8_delivery 'print' either way)
 *
 * ONCE ONLY. postDeliveryStartedAt is claimed with ifRevisionId before
 * anything is created, so a second email on the same document (the other
 * half of a print + digital commission, a webhook retry) does nothing.
 *
 * A buyer who ticked "Don't send me offers or referral emails" gets neither a
 * code nor MailerLite, and no claim is written. The customer email has
 * already gone; it is transactional and unaffected.
 *
 * Never throws: a referral or MailerLite problem is logged, and written to
 * postDeliveryError for Studio, and never holds up the email that called it.
 */
import Stripe from 'stripe';
import { readDecideWrite, serverPatch } from './server-patch.mjs';
import { marketingRefused } from './marketing-consent.mjs';
import { friendCodeFor } from './referral.mjs';
import { addDeliveredCustomer } from './mailerlite-customer.mjs';
import { orderRefFor } from './order-ref.mjs';

/** The referral code on an earlier order or commission from this email, if any. */
export const EARLIER_CODE_QUERY =
  `*[_type in ["order", "commission"] && !(_id in path("drafts.**")) && lower(customerEmail) == $email && defined(referralCode)]` +
  ` | order(_createdAt asc)[0].referralCode`;

/**
 * @param {'order'|'commission'} kind
 * @param {object} doc    the document as the calling email saw it (published id)
 * @param {object} ctx    { sanity, log }
 * @param {object} [deps] tests swap the Stripe and MailerLite calls
 */
export async function startPostDelivery(kind, doc, { sanity, log = console }, deps = {}) {
  const {
    friendCode = friendCodeFor,
    addCustomer = addDeliveredCustomer,
    stripeKey = process.env.STRIPE_SECRET_KEY,
    makeStripe = (key) => new Stripe(key, { apiVersion: '2024-12-18.acacia' }),
    now = () => Date.now(),
  } = deps;
  const id = doc?._id;
  const name = (kind === 'commission' ? doc?.orderRef : orderRefFor(doc)) || id || '?';
  try {
    if (!id || String(id).startsWith('drafts.')) return { skipped: 'no published document' };
    if (marketingRefused(doc.marketingConsent)) {
      log.log(`post-delivery: ${name}: buyer refused marketing at checkout; no referral code, not added to MailerLite`);
      return { skipped: 'refused' };
    }

    let skip = null;
    const claim = await readDecideWrite(sanity, id, (fresh) => {
      if (!fresh) { skip = 'document not found'; return null; }
      if (fresh.postDeliveryStartedAt) { skip = 'already started'; return null; }
      if (marketingRefused(fresh.marketingConsent)) { skip = 'refused'; return null; }
      return { set: { postDeliveryStartedAt: new Date(now()).toISOString() } };
    });
    if (!claim.written) {
      log.log(`post-delivery: ${name}: ${skip || 'nothing to do'}`);
      return { skipped: skip || 'nothing to do' };
    }
    // The fresh read wins for stored fields; the caller's copy adds what it
    // fetched (serviceTitle) or has just written (the email stamps).
    const full = { ...claim.doc, ...doc, marketingConsent: claim.doc?.marketingConsent ?? doc.marketingConsent };

    const problems = [];
    let referralCode = '';
    try {
      if (!stripeKey) throw new Error('STRIPE_SECRET_KEY is not set');
      const email = String(full.customerEmail || '').trim().toLowerCase();
      const earlier = email ? await sanity.fetch(EARLIER_CODE_QUERY, { email }) : null;
      referralCode = await friendCode(makeStripe(stripeKey), { email, orderRef: name, existingCode: earlier || null });
      await serverPatch(sanity, id, { set: { referralCode } });
    } catch (err) {
      log.error(`post-delivery: ${name}: referral code failed:`, err?.message || err);
      problems.push(`referral code: ${err?.message || err}`);
    }

    const ml = await addCustomer(kind, full, { referralCode });
    if (ml.ok) log.log(`post-delivery: ${name}: added to MailerLite "P8 - Customers"${referralCode ? ` with ${referralCode}` : ''}`);
    else {
      log.error(`post-delivery: ${name}: MailerLite ${ml.skipped ? 'skipped' : 'failed'}:`, ml.skipped || ml.status || '', ml.error || '');
      problems.push(`MailerLite: ${ml.skipped || `${ml.status || ''} ${String(ml.error || '').slice(0, 200)}`.trim()}`);
    }

    if (problems.length) {
      await serverPatch(sanity, id, { set: { postDeliveryError: `${new Date(now()).toISOString()} — ${problems.join('; ')}` } })
        .catch((e) => log.error(`post-delivery: ${name}: could not record the error:`, e?.message || e));
    }
    return { referralCode, mailerlite: ml };
  } catch (err) {
    log.error(`post-delivery: ${name}: failed:`, err?.message || err);
    return { error: err?.message || String(err) };
  }
}
