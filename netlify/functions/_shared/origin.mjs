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
 * Differs from CSC's version in taking `init` (method, headers, body) so it
 * can POST, and three optional bounds:
 *   timeoutMs       per-attempt timeout
 *   budgetMs        total time for all attempts AND backoff; each attempt's
 *                   timeout is cut to what remains, and no attempt starts with
 *                   less than minAttemptMs left
 *   retryOnTimeout  false: a timed-out attempt is not retried. For endpoints
 *                   that do real work (the proof email): a timeout means "may
 *                   still be running", and a second call could run it twice.
 */
export async function fetchWithRetry(url, {
  init, attempts = 3, baseDelayMs = 300, timeoutMs, budgetMs, minAttemptMs = 500,
  retryOnTimeout = true, fetchImpl = fetch, sleep, now = Date.now,
} = {}) {
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const deadline = budgetMs ? now() + budgetMs : Infinity;
  let last = null;
  let lastRes = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const remaining = deadline - now();
    if (attempt > 1 && remaining < minAttemptMs) break;
    const limit = Math.min(timeoutMs ?? Infinity, remaining);
    try {
      const opts = Number.isFinite(limit) ? { ...init, signal: AbortSignal.timeout(Math.max(1, limit)) } : init;
      const res = await fetchImpl(url, opts);
      if (res.ok || res.status < 500) return res;
      last = new Error(`HTTP ${res.status}`);
      lastRes = res;
      if (attempt === attempts) return res;
    } catch (err) {
      last = err;
      lastRes = null;
      if (attempt === attempts) throw err;
      if (!retryOnTimeout && err?.name === 'TimeoutError') throw err;
    }
    const delay = baseDelayMs * Math.pow(3, attempt - 1);
    if (now() + delay + minAttemptMs > deadline) break;
    await wait(delay);
  }
  // Out of budget: hand back the last 5xx, or throw the last error.
  if (lastRes) return lastRes;
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
  body, headers = {}, req, env, attempts = 3, baseDelayMs = 300, timeoutMs = 8000,
  budgetMs, minAttemptMs, retryOnTimeout, fetchImpl, sleep, now,
} = {}) {
  const url = `${internalOrigin(req, env)}${path}`;
  try {
    const res = await fetchWithRetry(url, {
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body ?? {}),
      },
      attempts, baseDelayMs, timeoutMs, budgetMs, minAttemptMs, retryOnTimeout, fetchImpl, sleep, now,
    });
    if (res.ok) return { ok: true, status: res.status, url };
    return { ok: false, status: res.status, error: `HTTP ${res.status}`, url };
  } catch (err) {
    return { ok: false, error: err?.name === 'TimeoutError' ? 'timed out' : (err?.message || String(err)), url };
  }
}

/**
 * Trigger budgets, in one place so the tests check the real numbers.
 * Netlify limits (not configurable): synchronous 60 s, scheduled 30 s,
 * background 15 min — https://docs.netlify.com/build/functions/configuration/
 */
export const TRIGGER_BUDGETS = {
  // Stripe webhook → proof email. Stripe wants a prompt 2xx (it documents no
  // number), so ≤ 6 s total. The proof endpoint does real work (sends an
  // email, mints the approve token): a timeout isn't retried, or a slow first
  // call and a retry could both send, the second token voiding the first link.
  webhookProof: { attempts: 2, baseDelayMs: 200, timeoutMs: 5000, budgetMs: 6000, retryOnTimeout: false },
  // Proof approval page → print build. A background function answers 202 in
  // well under a second and a rebuild is harmless, so timeouts may be
  // retried; 10 s total only so the customer's page never hangs.
  approvePrint: { attempts: 3, baseDelayMs: 300, timeoutMs: 5000, budgetMs: 10000, retryOnTimeout: true },
  // Hourly sweep re-trying a flagged trigger. Same shape as the webhook's.
  sweepRetry: { attempts: 2, baseDelayMs: 200, timeoutMs: 5000, budgetMs: 6000, retryOnTimeout: false },
};
