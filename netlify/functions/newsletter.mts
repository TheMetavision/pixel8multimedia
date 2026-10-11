// netlify/functions/newsletter.mts
//
// Newsletter signup at /api/newsletter (config.path below), used by every
// .newsletter-form (the footer on every page, and "Join the Gallery").
//
// Hardened against subscription bombing (bots signing real third-party
// addresses up to many lists to bury them in mail). In order, cheapest first:
//
//   1. Honeypot (`p8_nl_extra` must be empty) -- a bot that fills it is told
//      it succeeded and nothing happens.
//   2. Time on page: under MIN_SUBMIT_MS between the page loading and the
//      submit is a script. Missing timestamps do not trip it (a direct POST
//      sends none; Turnstile is the defence there).
//   3. Email format.
//   4. Cloudflare Turnstile, verified server-side with the shared helper. For
//      the newsletter it fails closed even where the helper would skip: no
//      TURNSTILE_SECRET_KEY means sign-ups are closed (503), and an
//      unreachable or slow siteverify is a 503, not a pass.
//   5. Per-IP rate limit: 3 per hour, in Netlify Blobs (hashed IP).
//   6. Domain check: disposable-mail domains and domains with no MX refused.
//   7. Our own double opt-in. Nothing is written to MailerLite or Sanity here;
//      both happen only in /api/newsletter-confirm, once the visitor has
//      confirmed the address.
//
// Double opt-in is ours, not MailerLite's account-wide "double opt-in for API"
// (that sends one account-branded email for every brand on the account). The
// address is looked up (read only) and:
//
//   already active in the Pixel8 group -> nothing
//   unsubscribed, bounced or junk      -> nothing (never re-mailed from a form)
//   anything else -> a branded "Confirm your subscription" email via Resend, at
//     most 1 per address per 24 hours, with a single-use link that expires in
//     48 hours. The form's `source` travels inside the link's encrypted token,
//     for the Sanity log written on confirmation.
//
// Speed: 5, 6 and the MailerLite lookup run in parallel once Turnstile has
// passed, every outside call has a hard limit (_shared/timing.mjs), and the
// confirmation email is sent after the response where the platform allows it
// (context.waitUntil). Each request logs one "[newsletter] timing ..." line.
//
// Every accepted request gets the same reply, so the endpoint cannot be used
// to find out who is on the list (the old "You're already on the list!" is gone).
//
// Env vars: MAILERLITE_API_KEY, MAILERLITE_GROUP_ID, TURNSTILE_SECRET_KEY,
// RESEND_API_KEY, NEWSLETTER_CONFIRM_SECRET; EMAIL_FROM (sender) and
// EMAIL_LOGO_URL as for the contact emails.

import type { Context, Config } from '@netlify/functions';
import { verifyTurnstile, GENERIC_FAILURE } from './_shared/turnstile.mjs';
import { hashKey, takeSlot, releaseSlot } from './_shared/rate-limit.mjs';
import { checkEmailDomain } from './_shared/email-domain.mjs';
import { makeToken } from './_shared/newsletter-token.mjs';
import { confirmationEmail } from './_shared/newsletter-email.mjs';
import { LIMITS_MS, fetchWithTimeout, stopwatch } from './_shared/timing.mjs';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_SUBMIT_MS = 3000;
const IP_LIMIT = 3;
const IP_WINDOW_MS = 60 * 60 * 1000;
const ADDRESS_LIMIT = 1;
const ADDRESS_WINDOW_MS = 24 * 60 * 60 * 1000;
const RATE_STORE = 'newsletter-rate-limits';
const HONEYPOT = 'p8_nl_extra';
const ML = 'https://connect.mailerlite.com/api';
const DEFAULT_FROM = 'Pixel8 Multimedia <hello@pixel8multimedia.co.uk>';

// One answer for every accepted request (see above).
const ACCEPTED = {
  success: true,
  message: "Thanks! If you're new here, check your inbox for a link to confirm your subscription.",
};
const FAILED = 'Could not complete signup. Please try again.';
const UNAVAILABLE = 'Sign-up is temporarily unavailable. Please try again later.';

const COPY = {
  subject: 'Confirm your subscription — Pixel8 Multimedia',
  preheader: 'One click and you’re in the gallery. Didn’t sign up? Ignore this and nothing happens.',
  heading: 'Confirm your subscription',
  intro:
    'Thanks for joining the gallery! Click below to confirm this is your address and we’ll start sending new drops, exclusive collections and pop culture inspiration.',
  button: 'Confirm my subscription',
  signoff: 'The Pixel8 Multimedia team',
};

/** The contact emails' look: the Pixel8 logo on black, pop-orange accent. */
const brand = () => ({
  name: 'Pixel8 Multimedia',
  logoUrl: process.env.EMAIL_LOGO_URL || 'https://pixel8multimedia.co.uk/Pixel8_Logo.png',
  headerBg: '#000000',
  accent: '#F07828',
  siteUrl: 'https://pixel8multimedia.co.uk',
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function clientIp(req: Request, context: Context): string {
  const xff = req.headers.get('x-forwarded-for');
  return (
    (context as any)?.ip ||
    req.headers.get('x-nf-client-connection-ip') ||
    (xff ? xff.split(',')[0].trim() : '') ||
    'unknown'
  );
}

/**
 * Should this address get a confirmation email? Read only: never writes to
 * MailerLite. Returns true/false, or null when MailerLite could not answer
 * (including not within LIMITS_MS.mailerlite) -- the caller fails closed.
 */
async function needsConfirmation(key: string, groupId: string, email: string): Promise<boolean | null> {
  let res: Response;
  try {
    res = await fetchWithTimeout(`${ML}/subscribers/${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    }, LIMITS_MS.mailerlite, 'MailerLite lookup');
  } catch (err: any) {
    console.error('[newsletter] MailerLite lookup failed', err?.message || err);
    return null;
  }
  if (res.status === 404) return true;
  if (res.status !== 200) {
    console.error('[newsletter] MailerLite lookup failed', res.status, await res.text().catch(() => ''));
    return null;
  }
  const sub = (await res.json().catch(() => null))?.data;
  const status = sub?.status;
  if (status === 'unsubscribed' || status === 'bounced' || status === 'junk') return false;
  const inGroup = (sub?.groups || []).some((g: any) => String(g?.id) === String(groupId));
  if (status === 'active' && inGroup) return false;
  return true;
}

/** Send the confirmation email. True when Resend accepted it in time. */
async function sendConfirmation(resendKey: string, message: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetchWithTimeout('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    }, LIMITS_MS.resend, 'Resend send');
    if (res.ok) return true;
    console.error('[newsletter] confirmation email failed', res.status, await res.text().catch(() => ''));
  } catch (err: any) {
    console.error('[newsletter] confirmation email failed', err?.message || err);
  }
  return false;
}

export default async (req: Request, context: Context) => {
  const clock = stopwatch('[newsletter]');
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
  if (!body || typeof body !== 'object') return json({ error: 'Invalid request.' }, 400);

  // 1. Honeypot: only a non-empty string trips it.
  if (typeof body[HONEYPOT] === 'string' && body[HONEYPOT].trim()) {
    console.warn('[newsletter] bot signal: honeypot filled - discarded');
    return json(ACCEPTED);
  }

  // 2. Time on page, from the visitor's own clock (no client/server skew).
  const elapsed = Number(body.p8_nl_ts_submit) - Number(body.p8_nl_ts_load);
  if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < MIN_SUBMIT_MS) {
    console.warn(`[newsletter] bot signal: submitted ${elapsed}ms after load - discarded`);
    return json(ACCEPTED);
  }

  // 3. Format.
  const email = (body?.email || '').toString().trim().toLowerCase().slice(0, 254);
  const source = (body?.source || 'unknown').toString().replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'unknown';
  if (!email) return json({ error: 'Email is required.' }, 400);
  if (!EMAIL_REGEX.test(email)) return json({ error: 'Please enter a valid email address.' }, 400);

  // 4. Turnstile, closed when it cannot run.
  const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;
  if (!turnstileSecret) {
    console.error('[newsletter] TURNSTILE_SECRET_KEY not set - sign-ups closed');
    return json({ error: UNAVAILABLE }, 503);
  }
  const human = await clock.time('turnstile', verifyTurnstile(body?.turnstile ? String(body.turnstile) : null, {
    context: 'newsletter',
    secret: turnstileSecret,
    timeoutMs: LIMITS_MS.turnstile,
  }));
  if (!human.ok) {
    if (human.codes?.includes('siteverify-unreachable')) {
      clock.log('turnstile unreachable');
      return json({ error: 'Could not run the anti-spam check right now. Please try again in a moment.' }, 503);
    }
    clock.log('turnstile 403');
    return json({ error: GENERIC_FAILURE, turnstile: true }, 403);
  }

  // Everything the rest needs, checked before the request counts against anyone.
  const key = process.env.MAILERLITE_API_KEY;
  const groupId = process.env.MAILERLITE_GROUP_ID;
  const resendKey = process.env.RESEND_API_KEY;
  const confirmSecret = process.env.NEWSLETTER_CONFIRM_SECRET;
  const from = process.env.EMAIL_FROM || DEFAULT_FROM;
  const site = (process.env.SITE_URL || process.env.URL || new URL(req.url).origin).replace(/\/$/, '');
  if (!key || !groupId || !resendKey || !confirmSecret) {
    console.error(
      '[newsletter] not configured, missing:',
      [!key && 'MAILERLITE_API_KEY', !groupId && 'MAILERLITE_GROUP_ID', !resendKey && 'RESEND_API_KEY',
        !confirmSecret && 'NEWSLETTER_CONFIRM_SECRET'].filter(Boolean).join(', '),
    );
    return json({ error: UNAVAILABLE }, 503);
  }

  // 5, 6 and the MailerLite lookup are independent of each other: run them
  // together. The IP is hashed with the day so it is never stored raw.
  const ip = clientIp(req, context);
  const day = new Date().toISOString().slice(0, 10);
  const [ipSlot, domain, needed] = await Promise.all([
    clock.time('ip', takeSlot(RATE_STORE, hashKey('ip', ip, day), IP_LIMIT, IP_WINDOW_MS)),
    clock.time('mx', checkEmailDomain(email)),
    clock.time('lookup', needsConfirmation(key, groupId, email)),
  ]);

  // 5. Per IP.
  if (!ipSlot) {
    clock.log('429');
    return json({ error: 'Too many sign-ups from your connection. Please try again later.' }, 429);
  }

  // 6. Domain.
  if (!domain.ok) {
    clock.log(`domain ${domain.reason}`);
    return json({
      error:
        domain.reason === 'disposable'
          ? 'Please use a permanent email address, not a disposable one.'
          : "That email domain can't receive mail. Please check the address.",
    }, 400);
  }

  // 7. Double opt-in.
  if (needed === null) {
    clock.log('lookup failed');
    return json({ error: FAILED }, 502);
  }
  if (!needed) {
    clock.log(`source=${source} already subscribed or opted out - nothing sent`);
    return json(ACCEPTED);
  }

  // At most one confirmation per address per day, whichever IPs ask.
  const addrKey = hashKey('addr', email);
  const addrSlot = await clock.time('addr', takeSlot(RATE_STORE, addrKey, ADDRESS_LIMIT, ADDRESS_WINDOW_MS));
  if (!addrSlot) {
    clock.log(`source=${source} confirmation already sent to this address today - nothing sent`);
    return json(ACCEPTED);
  }

  const { token: confirmToken } = makeToken(confirmSecret, email, Date.now(), { source });
  const mail = confirmationEmail({
    brand: brand(),
    copy: COPY,
    confirmUrl: `${site}/newsletter/confirm/?t=${encodeURIComponent(confirmToken)}`,
  });
  // A failed send gives the address its slot back, so the visitor can simply
  // try again rather than wait out the day.
  const send = (async () => {
    const t0 = Date.now();
    const sent = await sendConfirmation(resendKey, { from, to: [email], subject: mail.subject, html: mail.html, text: mail.text });
    if (!sent) await releaseSlot(RATE_STORE, addrKey, addrSlot);
    console.info(`[newsletter] confirmation email ${sent ? 'sent' : 'NOT sent'} in ${Date.now() - t0}ms`);
    return sent;
  })();

  // After the response where the platform allows it, so the visitor is not
  // kept waiting on Resend. Elsewhere (tests, older runtimes) wait and report.
  const waitUntil = (context as any)?.waitUntil;
  if (typeof waitUntil === 'function') {
    waitUntil.call(context, send);
    clock.log(`source=${source} confirmation queued`);
    return json(ACCEPTED);
  }
  const sent = await send;
  clock.log(`source=${source} ${sent ? 'confirmation sent' : 'confirmation failed'}`);
  return sent ? json(ACCEPTED) : json({ error: FAILED }, 502);
};

export const config: Config = {
  path: '/api/newsletter',
};
