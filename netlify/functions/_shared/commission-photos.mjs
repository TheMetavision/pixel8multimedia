/**
 * Which commissions need a photo. One rule, read by commission-checkout (which
 * refuses an order without one) and the wizard (src/lib/commission-wizard.mjs,
 * which offers its built-in photo upload to a service with no briefing fields).
 *
 * Every commission service needs at least one photo except Your Song Your
 * Story, whose audio-only order is made from the brief alone; if that order
 * includes a print (the lyrics poster), a photo is required again.
 */
export const PHOTO_OPTIONAL_SERVICES = new Set(['your-song-your-story']);

/** Does a service ever work without a photo? */
export const photoOptionalService = (serviceSlug) => PHOTO_OPTIONAL_SERVICES.has(String(serviceSlug || ''));

/** Must this order carry at least one photo? */
export const photoRequiredFor = (serviceSlug, orderHasPrint) => !photoOptionalService(serviceSlug) || Boolean(orderHasPrint);
