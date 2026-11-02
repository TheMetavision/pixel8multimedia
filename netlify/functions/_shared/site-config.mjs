/**
 * Pixel8's non-secret settings, committed instead of held as Netlify
 * environment variables.
 *
 * WHY. Every variable scoped to Functions is copied into every function (and
 * edge function), and AWS Lambda refuses a function whose environment is over
 * 4 KB. A brand address, a group id or a public URL costs the same bytes as a
 * secret but protects nothing, so they live here and only secrets stay in
 * Netlify. (Comic Strip Canvas had a deploy fail on exactly this.)
 *
 * OVERRIDES. Each key is the name of the environment variable it replaced. If
 * that variable is set (non-empty) it still wins, so a value can be changed
 * for one deploy context without a commit. Unset is the normal state: once
 * this is live, EMAIL_FROM, TEAM_EMAIL, MAILERLITE_GROUP_ID,
 * GA4_MEASUREMENT_ID, SANITY_PROJECT_ID and SANITY_DATASET can be deleted
 * from Netlify.
 *
 * NOTHING SECRET GOES IN THIS FILE. It is in the repository's history for
 * ever. Tokens, API keys and webhook secrets stay in Netlify.
 */

export const SITE_CONFIG = Object.freeze({
  SITE_URL: 'https://pixel8multimedia.co.uk',

  SANITY_PROJECT_ID: 'bqb4w421',
  SANITY_DATASET: 'production',
  STUDIO_URL: 'https://pixel8multimedia.sanity.studio',

  // Customer emails come from here (the value Netlify held, 2026-11-01).
  EMAIL_FROM: 'Pixel8 Multimedia <hello@pixel8multimedia.co.uk>',
  // Order, shipping, returns and alert emails to the team.
  TEAM_EMAIL: 'contact@pixel8multimedia.co.uk',

  // Newsletter group (newsletter.mts, newsletter-confirm.mts).
  MAILERLITE_GROUP_ID: '185280836058219588',
  // "P8 - Customers": joining it starts the post-delivery automation
  // (_shared/mailerlite-customer.mjs).
  MAILERLITE_CUSTOMERS_GROUP_ID: '200039636809024846',

  // GA4 Measurement Protocol. The id is public (it is in every page's gtag);
  // GA4_API_SECRET is the secret half and stays in Netlify.
  GA4_MEASUREMENT_ID: 'G-B5KJJGZCC2',

  // The metavision-shipping service. Every call is HMAC-signed with
  // SHIPPING_SECRET, which stays in Netlify.
  SHIPPING_API_URL: 'https://mv-shipping-svc-26.netlify.app',
  SHIPPING_BRAND: 'PIXEL8',

  // Where each carrier's returns are collected from. For the team's "ready to
  // collect" email only; never sent to a customer.
  RETURN_POINT_INPOST: 'InPost locker, 59 West Road, Shoeburyness',
  RETURN_POINT_EVRI: 'ASDA Shoebury, North Shoebury Road',
  RETURN_POINT_UPS: 'Skanda, 93-95 West Road, Shoeburyness',
});

/**
 * A setting: the environment variable of the same name if it is set, else the
 * committed value.
 *
 * @param {keyof typeof SITE_CONFIG} name
 * @param {Record<string, string|undefined>} [env] defaults to process.env; tests pass their own
 */
export function setting(name, env = process.env) {
  if (!(name in SITE_CONFIG)) throw new Error(`site-config: unknown setting ${name}`);
  const v = env?.[name];
  return typeof v === 'string' && v.trim() ? v.trim() : SITE_CONFIG[name];
}

/**
 * The Sanity token for a function that WRITES.
 *
 * Pixel8 grew three write tokens (SANITY_TOKEN, SANITY_API_TOKEN,
 * SANITY_WRITE_TOKEN), about 180 bytes each of the 4 KB function environment.
 * Every function now reads through here, so they can be consolidated into
 * SANITY_WRITE_TOKEN without a code change:
 *
 *   1. today, each caller passes the name it always used as `preferred`, so
 *      nothing changes on deploy;
 *   2. Alan checks SANITY_WRITE_TOKEN is an Editor token (webhook.mjs already
 *      creates orders with it), then deletes SANITY_TOKEN and SANITY_API_TOKEN
 *      from Netlify, and every caller falls through to SANITY_WRITE_TOKEN.
 *
 * SANITY_READ_TOKEN is separate on purpose: the build and the SSR pages
 * (src/lib/sanity.ts) only read, with a Viewer token.
 *
 * @param {'SANITY_TOKEN'|'SANITY_API_TOKEN'|'SANITY_WRITE_TOKEN'} [preferred]
 */
export function sanityWriteToken(preferred = 'SANITY_WRITE_TOKEN', env = process.env) {
  for (const name of [preferred, 'SANITY_WRITE_TOKEN', 'SANITY_TOKEN', 'SANITY_API_TOKEN']) {
    const v = env?.[name];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}
