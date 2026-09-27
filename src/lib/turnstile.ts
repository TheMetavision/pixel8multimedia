// src/lib/turnstile.ts
//
// Cloudflare Turnstile for every public form (Your Photo, contact, newsletter,
// commission). The pattern from fix/turnstile-upload, shared:
//   - api.js is loaded ONCE per page, from this module, with render=explicit,
//     after the onload hook exists (an implicit widget raced the page module
//     and its token was never captured);
//   - each form renders its own widget into its own element;
//   - the token is cleared on expiry / timeout / error;
//   - callers reset the widget after every attempt (tokens are single-use).
// With no PUBLIC_TURNSTILE_SITE_KEY the widget is a no-op, matching the
// server, which skips the check while TURNSTILE_SECRET_KEY is unset.

export type TurnstileWidget = {
  /** false when no site key is configured (dev / pre-launch) */
  enabled: boolean;
  /** the current token, or '' */
  token(): string;
  /** the token, waiting up to `ms` for one (an interaction-only widget solves in the background) */
  waitForToken(ms?: number): Promise<string>;
  /** spend the token: clear it and get a fresh challenge */
  reset(): void;
};

type Options = {
  size?: 'normal' | 'flexible' | 'compact';
  /** 'interaction-only' keeps the widget hidden unless Cloudflare needs the visitor to click */
  appearance?: 'always' | 'execute' | 'interaction-only';
  action?: string;
};

const SITE_KEY: string = import.meta.env.PUBLIC_TURNSTILE_SITE_KEY || '';
const API = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__pixel8TurnstileReady';

let api: Promise<any> | null = null;
function loadApi(): Promise<any> {
  const w = window as any;
  if (w.turnstile) return Promise.resolve(w.turnstile);
  if (!api) {
    api = new Promise((resolve, reject) => {
      w.__pixel8TurnstileReady = () => resolve(w.turnstile);
      const s = document.createElement('script');
      s.src = API;
      s.async = true;
      s.onerror = () => { api = null; reject(new Error('Turnstile failed to load')); };
      document.head.appendChild(s);
    });
  }
  return api;
}

const NOOP: TurnstileWidget = { enabled: false, token: () => '', waitForToken: async () => '', reset() {} };

export function mountTurnstile(el: HTMLElement | null, opts: Options = {}): TurnstileWidget {
  if (!SITE_KEY || !el) return NOOP;
  let tok = '';
  let id: string | null = null;
  let waiters: Array<(t: string) => void> = [];
  const ts = () => (window as any).turnstile;
  const current = () => tok || (id !== null ? ts()?.getResponse(id) || '' : '');

  loadApi().then((t) => {
    id = t.render(el, {
      sitekey: SITE_KEY,
      size: opts.size || 'flexible',
      appearance: opts.appearance || 'always',
      ...(opts.action ? { action: opts.action } : {}),
      callback: (token: string) => { tok = token; const w = waiters; waiters = []; w.forEach((fn) => fn(token)); },
      'expired-callback': () => { tok = ''; },
      'timeout-callback': () => { tok = ''; },
      'error-callback': () => { tok = ''; },
    });
  }).catch(() => { /* blocked by an extension etc.: token() stays '' and the form says so */ });

  return {
    enabled: true,
    token: current,
    waitForToken(ms = 8000) {
      const now = current();
      if (now) return Promise.resolve(now);
      return new Promise((resolve) => {
        const done = (t: string) => { clearTimeout(timer); resolve(t); };
        const timer = setTimeout(() => { waiters = waiters.filter((w) => w !== done); resolve(''); }, ms);
        waiters.push(done);
      });
    },
    reset() {
      tok = '';
      if (id !== null) ts()?.reset(id);
    },
  };
}

/** Shown when no token arrives: the check didn't load or didn't finish. */
export const TURNSTILE_WAIT_MESSAGE =
  'We’re still running a quick security check. Give it a moment and try again. If it doesn’t finish, turn off any ad or script blocker for this page.';
