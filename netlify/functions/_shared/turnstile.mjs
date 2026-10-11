/**
 * netlify/functions/_shared/turnstile.mjs
 *
 * Cloudflare Turnstile check for every public form: Your Photo upload,
 * contact, newsletter, and the commission flow (uploads + checkout).
 * The same behaviour as fix/turnstile-upload, in one place:
 *   - TURNSTILE_SECRET_KEY unset → skipped (dev / pre-launch)
 *   - no token → fails ("missing-input-response")
 *   - siteverify with an 8 s timeout (timeoutMs to change it: the newsletter
 *     uses 4 s); unreachable or slow → fails closed
 *   - on failure, logs Cloudflare's error-codes and hostname — never the
 *     token or the secret; the caller returns a generic message
 */

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const GENERIC_FAILURE = 'Verification failed — please try again.';

/**
 * @param {string|null|undefined} token
 * @param {{ context: string, secret?: string, fetchImpl?: typeof fetch, log?: (msg: string) => void, timeoutMs?: number }} opts
 * @returns {Promise<{ ok: boolean, skipped?: boolean, codes?: string[], hostname?: string }>}
 */
export async function verifyTurnstile(token, { context, secret = process.env.TURNSTILE_SECRET_KEY, fetchImpl = fetch, log = console.warn, timeoutMs = 8000 } = {}) {
  if (!secret) return { ok: true, skipped: true };
  if (!token || typeof token !== 'string') {
    log(`${context}: turnstile failed codes=[missing-input-response] hostname=- (no token)`);
    return { ok: false, codes: ['missing-input-response'] };
  }
  try {
    const res = await fetchImpl(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json();
    if (data?.success === true) return { ok: true, hostname: data.hostname };
    const codes = data?.['error-codes'] || [];
    log(`${context}: turnstile failed codes=[${codes.join(',')}] hostname=${data?.hostname || '-'} http=${res.status}`);
    return { ok: false, codes, hostname: data?.hostname };
  } catch (err) {
    log(`${context}: turnstile siteverify unreachable ${err?.name || ''} ${err?.message || ''}`);
    return { ok: false, codes: ['siteverify-unreachable'] };
  }
}
