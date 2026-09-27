/**
 * netlify/functions/_shared/commission-grant.mjs
 *
 * One Turnstile check for the whole commission form. Tokens are single-use,
 * and a customer uploads several photos and then checks out, so:
 *   - the FIRST photo upload carries a Turnstile token; once it verifies,
 *     upload.mts returns a grant bound to that visit's uploadId
 *   - later uploads, and commission-checkout, present the grant instead
 *   - checkout also accepts a fresh token (a service with no photo field)
 *
 * grant = "<uploadId>.<expiresMs>.<hmac>", HMAC-SHA256 with a key derived
 * from PERSONALISATION_SALT (already a long random secret). Stateless; valid
 * GRANT_TTL_MS. It only proves "this visit passed Turnstile recently".
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const GRANT_TTL_MS = 4 * 60 * 60 * 1000; // a long form plus a coffee

const keyFrom = (salt) => createHmac('sha256', String(salt || 'dev-salt')).update('commission-grant:v1').digest();

export function makeGrant(uploadId, { now = Date.now(), salt = process.env.PERSONALISATION_SALT } = {}) {
  const exp = now + GRANT_TTL_MS;
  const sig = createHmac('sha256', keyFrom(salt)).update(`${uploadId}.${exp}`).digest('base64url');
  return `${uploadId}.${exp}.${sig}`;
}

/** @returns {string|null} the uploadId the grant is for, if it is valid and unexpired */
export function verifyGrant(grant, { now = Date.now(), salt = process.env.PERSONALISATION_SALT } = {}) {
  if (typeof grant !== 'string') return null;
  const m = /^([0-9a-f-]{36})\.(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(grant);
  if (!m) return null;
  const [, uploadId, exp, sig] = m;
  if (Number(exp) < now) return null;
  const want = createHmac('sha256', keyFrom(salt)).update(`${uploadId}.${exp}`).digest();
  const got = Buffer.from(sig, 'base64url');
  return got.length === want.length && timingSafeEqual(got, want) ? uploadId : null;
}
