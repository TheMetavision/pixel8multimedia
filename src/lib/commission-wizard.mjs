/**
 * The commission wizard's brief and checkout payload, kept free of React so
 * the tests can drive them (tests/commission-wizard.test.mjs).
 *
 * Every service is ordered through CommissionWorkflow.jsx. A service's
 * questions are its Sanity `briefingFields`; the customer's name and email
 * normally come from two of them (keys customerName / customerEmail).
 * commission-checkout refuses an order without both, so a service with no
 * briefing fields (or one whose fields leave either out) gets the built-in
 * CONTACT_FIELDS instead. Its brief step then shows only "your details".
 *
 * Photos and files come from briefing fields (fieldType photo / photos /
 * file). A service with no briefing fields at all gets the built-in
 * PHOTOS_FIELD instead, except Your Song Your Story: the same rule
 * commission-checkout enforces (_shared/commission-photos.mjs). A service
 * WITH a brief is never given extra upload fields: its own fields (and their
 * showFor) decide, exactly as before.
 */
import { photoOptionalService } from '../../netlify/functions/_shared/commission-photos.mjs';


export const CONTACT_FIELDS = Object.freeze([
  Object.freeze({ key: 'customerName', label: 'Your name', fieldType: 'text', required: true }),
  Object.freeze({ key: 'customerEmail', label: 'Your email', fieldType: 'email', required: true, helperText: 'We send your order confirmation and finished files here.' }),
]);
export const PHOTOS_FIELD = Object.freeze({
  key: 'photos', label: 'Your photos', fieldType: 'photos', required: true, minPhotos: 1, maxPhotos: 10,
  helperText: 'The photo or photos you would like us to work from.',
});
export const CONTACT_KEYS = Object.freeze(['customerName', 'customerEmail', 'customerPhone']);
export const UPLOAD_TYPES = Object.freeze(['photo', 'photos', 'file']);

const DIGITAL_PATHS = ['digital', 'digital-secondary', 'digital-both'];

/**
 * The brief fields for this order type: the service's own, filtered by
 * showFor (style pickers are hidden where the style is chosen elsewhere),
 * with any missing contact field added at the front.
 */
export function briefFieldsFor(briefingFields, orderType, { serviceSlug } = {}) {
  const configured = (Array.isArray(briefingFields) ? briefingFields : []).filter((f) => f && f.key);
  const own = configured.filter((f) => {
    // Style picker hidden for all digital paths (digital includes every style)
    // and singlePrint (style is chosen per print in the prints step).
    if (f.fieldType === 'styleSwatch' && (DIGITAL_PATHS.includes(orderType) || orderType === 'singlePrint')) return false;
    if (Array.isArray(f.showFor) && f.showFor.length > 0) return f.showFor.includes(orderType);
    return true;
  });
  const have = new Set(own.map((f) => f.key));
  const missing = CONTACT_FIELDS.filter((f) => !have.has(f.key));
  const uploads = configured.length === 0 && !photoOptionalService(serviceSlug) ? [PHOTOS_FIELD] : [];
  return [...missing, ...own, ...uploads];
}

/** True when the fields ask anything beyond the customer's details and photos. */
export const hasBriefQuestions = (fields) =>
  (fields || []).some((f) => !CONTACT_KEYS.includes(f.key) && !UPLOAD_TYPES.includes(f.fieldType));

/** The first problem with the brief step, or null. */
export function validateBrief(fields, values = {}, files = {}) {
  for (const f of fields || []) {
    if (!f.required) continue;
    if (f.fieldType === 'photo') {
      if ((files[f.key] || []).length === 0) return `Please upload "${f.label}".`;
    } else if (f.fieldType === 'photos') {
      const min = f.minPhotos || 1;
      if ((files[f.key] || []).length < min) return `Please upload at least ${min} photo${min > 1 ? 's' : ''} for "${f.label}".`;
    } else if (f.fieldType === 'file') {
      if ((files[f.key] || []).length === 0) return `Please upload a file for "${f.label}".`;
    } else if (f.fieldType === 'checkbox') {
      if (values[f.key] !== true) return `Please confirm: "${f.label}"`;
    } else {
      const v = String(values[f.key] || '').trim();
      if (!v) return `Please fill in "${f.label}".`;
      if (f.fieldType === 'email' && !/^\S+@\S+\.\S+$/.test(v)) return `"${f.label}" needs to be a valid email address.`;
    }
  }
  return null;
}

/**
 * The JSON body for /.netlify/functions/commission-checkout. GA ids, the bot
 * proof and the upload grant are added by the component.
 */
export function checkoutPayload({
  service, orderType, fields, briefValues = {}, briefFiles = {},
  prints = [], orderInvolvesPrints = false, includePrintsWithAnimation = false, bundleCollection = 'primary',
  includesDigital = false, digitalConsent = false, digitalConsentVersion,
  marketingOptOut = false, grouponClaim = null,
}) {
  // Photos are already in the private Blobs store; send only their keys.
  const uploadedAssets = [];
  for (const [fieldKey, arr] of Object.entries(briefFiles)) {
    for (const meta of arr || []) if (meta?.uploadKey) uploadedAssets.push({ fieldKey, uploadKey: meta.uploadKey });
  }
  const answers = (fields || []).filter((f) => !UPLOAD_TYPES.includes(f.fieldType));
  const shown = (f) => (f.fieldType === 'checkbox' ? (briefValues[f.key] === true ? 'Yes' : 'No') : null);
  const brief = answers
    .filter((f) => !CONTACT_KEYS.includes(f.key))
    .map((f) => `${f.label}: ${shown(f) ?? (briefValues[f.key] || '(not provided)')}`)
    .join('\n');
  const briefData = answers.map((f) => ({ key: f.key, label: f.label, value: shown(f) ?? (briefValues[f.key] || '') }));
  const validPrints = orderInvolvesPrints
    ? (orderType === 'singlePrint' ? prints.slice(0, 1) : prints).filter((p) => p.format && p.size)
    : [];

  return {
    serviceSlug: service.slug,
    serviceTitle: service.title,
    orderType,
    includePrintsWithAnimation: !!includePrintsWithAnimation,
    bundleCollection,
    name: String(briefValues.customerName || '').trim(),
    email: String(briefValues.customerEmail || '').trim(),
    phone: String(briefValues.customerPhone || '').trim(),
    brief,
    briefData,
    prints: validPrints,
    uploadedAssets,
    ...(grouponClaim ? { grouponClaimToken: grouponClaim.token } : {}),
    ...(includesDigital ? { digitalSupplyConsent: digitalConsent === true, digitalConsentVersion } : {}),
    marketingOptOut: marketingOptOut === true,
  };
}
