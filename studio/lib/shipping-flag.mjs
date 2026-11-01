/**
 * Whether the Studio shows the Sendcloud dispatch and returns UI.
 *
 * The Netlify functions read SHIPPING_ENABLED, which the Studio cannot see: it
 * is a separate bundle, built by `npx sanity deploy`. Sanity inlines any
 * SANITY_STUDIO_* variable at build time, so this one is set in studio/.env
 * (SANITY_STUDIO_SHIPPING_ENABLED=true) before deploying. A switch, not a
 * secret -- the Studio bundle is public.
 *
 * Off (unset), the order and commission forms, the desk and the actions are as
 * before: the shipment fields are hidden and the Shipping / Returns lists and
 * the Create return button are not there. (The carrier field and the
 * dispatch-email stamp show either way: hand dispatch emails do not need
 * Sendcloud.)
 */
export const SHIPPING_UI = (typeof process !== 'undefined' && process.env
  && process.env.SANITY_STUDIO_SHIPPING_ENABLED === 'true') || false;
