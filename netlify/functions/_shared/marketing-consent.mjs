/**
 * Marketing consent for an order or commission.
 *
 * Pixel8 relies on the UK soft opt-in for existing customers (PECR reg. 22):
 * marketing about our own similar products to people who bought from us, as
 * long as they were given a simple way to refuse when their details were
 * collected, and in every message after. The refusal is an unticked
 * "Don't send me offers or referral emails" box:
 *
 *   shop (cart drawer, which Your Photo uses too)
 *     CartPanel sends `marketingOptOut`, checkout.mjs stamps it on the Stripe
 *     session as metadata.marketing_opt_out, webhook.mjs records it.
 *   commissions (CommissionWorkflow, including Groupon voucher checkouts, and
 *   the older CommissionForm)
 *     commission-checkout writes it straight onto the commission when it is
 *     created, and stamps the same metadata for the record.
 *
 * Stripe's own marketing checkbox (consent_collection.promotions) is refused
 * for UK accounts, so it is never used.
 *
 * Values on a document (`marketingConsent`):
 *   'refused'    ticked the box
 *   'not_asked'  did not tick it, or bought before the box existed
 */

/** checkout: the metadata value. Only a literal `true` counts as opting out. */
export function optOutMetadata(marketingOptOut) {
  return marketingOptOut === true ? 'true' : 'false';
}

/** commission-checkout: the marketingConsent for the new commission. */
export function consentFromOptOut(marketingOptOut) {
  return marketingOptOut === true ? 'refused' : 'not_asked';
}

/** webhook.mjs: the marketingConsent to record for a paid shop session. */
export function consentFromSession(session) {
  return session?.metadata?.marketing_opt_out === 'true' ? 'refused' : 'not_asked';
}

/** True when this buyer must get no marketing: no PIX- code, not added to MailerLite. */
export function marketingRefused(consent) {
  return consent === 'refused' || consent === 'opt_out';
}
