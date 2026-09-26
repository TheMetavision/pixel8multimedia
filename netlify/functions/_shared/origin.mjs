/**
 * netlify/functions/_shared/origin.mjs
 *
 * Which address a function should use to reach its OWN site, and a fetch that
 * retries. Ported from Comic Strip Canvas (netlify/functions/_shared/origin.mjs).
 *
 * A link a CUSTOMER clicks (Stripe return URL, email link) must be the public
 * domain: process.env.URL. A request the site makes of ITSELF — one function
 * starting another — is different: nobody sees that address, and sending it
 * through the custom domain stakes it on that domain's DNS and CDN edge being
 * healthy at that moment. `https://<SITE_NAME>.netlify.app` is served by
 * Netlify directly.
 *
 * SITE_NAME, not DEPLOY_PRIME_URL: the deploy URLs are BUILD variables. At
 * function runtime Netlify provides only URL, SITE_NAME and SITE_ID.
 *
 * The triggers that use this used to be fire-and-forget: `fetch(...).catch()`
 * with no await, then `return`. Once the handler returns, the function can be
 * frozen before the request ever leaves, so on this estate those triggers
 * silently never ran in production. Every trigger now awaits.
 */

/** Hosts that are this machine, whatever the environment claims to be. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']);

/** The origin of the request being served, when there is one to read. */
const originOf = (req) => {
  try { return req && req.url ? new URL(req.url).origin : null; }
  catch { return null; }
};

/**
 * Where to POST to this site's own functions.
 *
 * @param {Request} [req] the request being served, if this is a handler
 * @param {Record<string, string | undefined>} [env] defaults to process.env (tests pass their own)
 */
export function internalOrigin(req, env = process.env) {
  const here = originOf(req);

  // A request that arrived on localhost cannot have come from production —
  // under `netlify dev`, keep the call on this machine (it must not start
  // production's background functions from a laptop).
  if (here && LOCAL_HOSTS.has(new URL(here).hostname)) return here;
  if (env.NETLIFY_DEV === 'true' || env.NETLIFY_LOCAL === 'true') {
    return here || env.URL || 'http://localhost:8888';
  }

  // A deploy preview or branch deploy is already on a netlify.app host and
  // must call ITS OWN functions, not production's.
  if (here && /\.netlify\.app$/.test(new URL(here).hostname)) return here;

  if (env.SITE_NAME) return `https://${env.SITE_NAME}.netlify.app`;

  // No SITE_NAME: not running on Netlify (a test or script).
  return env.URL || here || 'https://pixel8multimedia.co.uk';
}

/** The address to put in front of a customer. Never the deploy's own host. */
export const publicOrigin = (req, env = process.env) =>
  env.URL || originOf(req) || 'https://pixel8multimedia.co.uk';

/**
 * Fetch with a short retry on failures worth retrying: connection errors and
 * 5xx (a bad few seconds at an edge). A 4xx is returned at once — asking again
 * won't change it. The LAST 5xx response is returned rather than thrown so the
 * caller can report its status.
 *
 * Differs from CSC's version only in taking `init` (method, headers, body) so
 * it can POST, and an optional per-attempt timeout.
 */
export async function fetchWithRetry(url, {
  init, attempts = 3, baseDelayMs = 300, timeoutMs, fetchImpl = fetch, sleep,
} = {}) {
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const opts = timeoutMs ? { ...init, signal: AbortSignal.timeout(timeoutMs) } : init;
      const res = await fetchImpl(url, opts);
      if (res.ok || res.status < 500) return res;
      last = new Error(`HTTP ${res.status}`);
      if (attempt === attempts) return res;
    } catch (err) {
      last = err;
      if (attempt === attempts) throw err;
    }
    await wait(baseDelayMs * Math.pow(3, attempt - 1));
  }
  throw last || new Error(`Could not fetch ${url}`);
}

/**
 * POST a JSON body to one of this site's own functions and wait for it to be
 * accepted. A background function answers 202 as soon as it is queued; a
 * synchronous one answers 200 when done. Both count as success.
 *
 * Never throws: returns { ok, status?, error? } so the caller decides what a
 * failure means (typically: record it where staff will see it, and carry on).
 */
export async function triggerInternal(path, {
  body, headers = {}, req, env, attempts = 3, baseDelayMs = 300, timeoutMs = 8000, fetchImpl, sleep,
} = {}) {
  const url = `${internalOrigin(req, env)}${path}`;
  try {
    const res = await fetchWithRetry(url, {
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body ?? {}),
      },
      attempts, baseDelayMs, timeoutMs, fetchImpl, sleep,
    });
    if (res.ok) return { ok: true, status: res.status, url };
    return { ok: false, status: res.status, error: `HTTP ${res.status}`, url };
  } catch (err) {
    return { ok: false, error: err?.name === 'TimeoutError' ? 'timed out' : (err?.message || String(err)), url };
  }
}
