/**
 * netlify/functions/_shared/digital-consent.mjs
 *
 * Commission digital files are digital content, not goods. Under the
 * Consumer Contracts (Information, Cancellation and Additional Charges)
 * Regulations 2013 (reg. 37), supplying it inside the 14-day cancellation
 * period ends the right to cancel only if the customer has given EXPRESS
 * consent to supply starting straight away AND acknowledged that they lose
 * the right to cancel — and we confirm both on a durable medium (the order
 * confirmation email). This applies to every order that includes digital
 * files — on their own ('digital') or with prints ('both'); a print-only
 * order is goods and doesn't ask.
 *
 * One wording, used by the commission form's required checkbox, recorded on
 * the commission (digitalSupplyConsent), and repeated in the confirmation
 * email. Change the version whenever the wording changes.
 */

export const DIGITAL_CONSENT_VERSION = '2026-09-29';

/** The checkbox label (the customer's own statement). */
export const DIGITAL_CONSENT_LABEL =
  'Please start work on my order and supply my digital files straight away. I understand that once they have been supplied, I lose my right to cancel.';

/** The confirmation email's statement of what the customer agreed to. */
export const DIGITAL_CONSENT_CONFIRMATION =
  'You asked us to start work on your order and supply your digital files straight away, and acknowledged that you lose your right to cancel once they have been supplied. Your rights if anything is faulty or not as described are unaffected.';

/** Every order that includes digital files: 'digital' or 'both'. Print-only orders don't. */
export const needsDigitalConsent = (deliveryType) => deliveryType === 'digital' || deliveryType === 'both';
