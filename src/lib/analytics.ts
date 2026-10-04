/**
 * Google Analytics 4, behind the cookie banner (UK PECR).
 *
 * Nothing Google-related loads until the visitor accepts: no gtag.js, no
 * dataLayer, no cookies. The choice lives in localStorage under `p8-consent`
 * ("granted" | "denied"); no key means they haven't chosen yet and the banner
 * shows (src/components/ConsentBanner.astro).
 *
 * Purchases are not sent from here. checkout passes the GA client id to
 * Stripe and the webhook reports the purchase server-side (see
 * netlify/functions/_shared/ga4.mjs), so it's counted even if the buyer never
 * comes back from Stripe.
 */

export const GA_MEASUREMENT_ID = 'G-B5KJJGZCC2';
export const CONSENT_KEY = 'p8-consent';
export const CONSENT_OPEN_EVENT = 'p8:open-consent';

export type Consent = 'granted' | 'denied';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

// Fallback for when localStorage is blocked: the choice holds for this page.
let pageConsent: Consent | null = null;

export function getConsent(): Consent | null {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    if (v === 'granted' || v === 'denied') return v;
  } catch {
    // fall through
  }
  return pageConsent;
}

export const hasConsent = () => getConsent() === 'granted';

export function setConsent(choice: Consent) {
  pageConsent = choice;
  try {
    localStorage.setItem(CONSENT_KEY, choice);
  } catch {
    // Private mode / blocked storage: pageConsent covers this page.
  }
  if (choice === 'granted') {
    loadAnalytics();
  } else {
    // Withdrawn after accepting: stop this page sending anything more and
    // remove the cookies GA already set.
    (window as any)[`ga-disable-${GA_MEASUREMENT_ID}`] = true;
    clearGaCookies();
  }
}

/** Ask the banner to show again (footer "Cookie settings"). */
export function openConsentSettings() {
  document.dispatchEvent(new CustomEvent(CONSENT_OPEN_EVENT));
}

let loaded = false;

/** Inject gtag.js and send the page_view. Call only once consent is granted. */
export function loadAnalytics() {
  if (loaded || !hasConsent()) return;
  loaded = true;
  (window as any)[`ga-disable-${GA_MEASUREMENT_ID}`] = false;

  window.dataLayer = window.dataLayer || [];
  // gtag.js reads the `arguments` object, not an array, so this can't be an arrow.
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  // Analytics only: the banner doesn't ask about advertising.
  window.gtag('consent', 'default', {
    analytics_storage: 'granted',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  });
  window.gtag('js', new Date());
  window.gtag('config', GA_MEASUREMENT_ID); // sends page_view

  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(s);
}

/** Send a GA4 event, only with consent. Never throws. */
export function track(name: string, params: Record<string, unknown> = {}) {
  try {
    if (!hasConsent()) return;
    loadAnalytics();
    window.gtag?.('event', name, params);
  } catch {
    // Analytics must never break the shop.
  }
}

/**
 * Send an event and wait (at most `timeoutMs`) for gtag to hand it off, for
 * events fired just before leaving the page.
 */
export function trackThen(name: string, params: Record<string, unknown>, timeoutMs = 800): Promise<void> {
  return new Promise((resolve) => {
    if (!hasConsent()) return resolve();
    const timer = setTimeout(resolve, timeoutMs);
    track(name, {
      ...params,
      event_callback: () => {
        clearTimeout(timer);
        resolve();
      },
    });
  });
}

/**
 * The GA client id, from gtag itself, or null without consent or if gtag
 * hasn't answered within `timeoutMs`. Asking gtag (rather than reading the
 * `_ga` cookie) waits for gtag.js to load and set the id, so a buyer who
 * accepts and checks out on their first page view is still tracked.
 */
export function gaClientId(timeoutMs = 800): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      if (!hasConsent()) return resolve(null);
      loadAnalytics();
      const timer = setTimeout(() => resolve(null), timeoutMs);
      window.gtag!('get', GA_MEASUREMENT_ID, 'client_id', (id: unknown) => {
        clearTimeout(timer);
        resolve(typeof id === 'string' && id ? id : null);
      });
    } catch {
      resolve(null);
    }
  });
}

function clearGaCookies() {
  const names = document.cookie
    .split(';')
    .map((c) => c.split('=')[0].trim())
    .filter((n) => n === '_ga' || n.startsWith('_ga_') || n === '_gid' || n === '_gat');
  // GA sets them on the registrable domain (.pixel8multimedia.co.uk); try the
  // host and each parent so whichever it used is cleared.
  const parts = location.hostname.split('.');
  const domains = [''];
  for (let i = 0; i < parts.length - 1; i++) domains.push(`; domain=.${parts.slice(i).join('.')}`);
  for (const n of names) {
    for (const d of domains) document.cookie = `${n}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${d}`;
  }
}

/** One GA4 ecommerce item. item_variant is "<format>/<size>", as the webhook sends it. */
export function gaItem(line: {
  slug: string;
  title: string;
  format: string;
  size: string;
  unitPrice: number;
  quantity: number;
}) {
  return {
    item_id: line.slug,
    item_name: line.title,
    item_variant: `${line.format}/${line.size}`,
    price: Number(line.unitPrice.toFixed(2)),
    quantity: line.quantity,
  };
}
