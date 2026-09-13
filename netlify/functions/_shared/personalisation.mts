// netlify/functions/_shared/personalisation.mts
//
// Shared plumbing for the "Your Photo" builder functions.
//
// Storage:
//   Sanity  pendingPersonalisation  — state + audit trail (see studio/schemas)
//   Blobs   store "personalisation" — images, keyed personalisation/<pid>/…
//   Blobs   store "personalisation-guards" — daily counters for abuse caps
//
// The pid is a 128-bit random id and doubles as the capability to read/write
// that session — anyone holding it can poll and fetch watermarked previews.
// That's the same trust model as an unguessable share link; nothing more
// sensitive than the customer's own preview is behind it.

import { createClient } from '@sanity/client';
import { getStore } from '@netlify/blobs';
import { createHash, randomBytes } from 'node:crypto';

// ── Tunables (env override → default) ────────────────────────────────────────
const num = (name: string, dflt: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
};

export const LIMITS = {
  maxUploadBytes: num('PERSONALISATION_MAX_UPLOAD_MB', 12) * 1024 * 1024,
  squarePx: 2048,                                        // stored square size
  callsPerSession: num('PERSONALISATION_CALLS_PER_SESSION', 16),
  freeSwitches: num('PERSONALISATION_FREE_SWITCHES', 3), // distinct styles beyond the first
  regensPerStyle: num('PERSONALISATION_REGENS_PER_STYLE', 2),
  callsPerIpPerDay: num('PERSONALISATION_IP_DAILY_CAP', 24),
  callsPerDayGlobal: num('PERSONALISATION_DAILY_CAP', 400), // ≈ £40/day at 2K
  unpaidTtlHours: num('PERSONALISATION_UNPAID_TTL_HOURS', 48),
  paidRetentionDays: num('PERSONALISATION_PAID_RETENTION_DAYS', 90),
};

export const CONSENT_VERSION = process.env.PERSONALISATION_CONSENT_VERSION || '2026-09';

// ── Clients ──────────────────────────────────────────────────────────────────
export const sanity = createClient({
  projectId: 'bqb4w421',
  dataset: process.env.SANITY_DATASET || 'production',
  apiVersion: '2026-04-14',
  token: process.env.SANITY_TOKEN,
  useCdn: false,
});

export const images = () => getStore({ name: 'personalisation', consistency: 'strong' });
export const guards = () => getStore({ name: 'personalisation-guards', consistency: 'strong' });

// ── Keys / ids ───────────────────────────────────────────────────────────────
export const newPid = () => randomBytes(16).toString('base64url');
export const isPid = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_-]{20,24}$/.test(s);
export const docId = (pid: string) => `pendingPersonalisation.${pid}`;

export const blobKey = {
  square: (pid: string) => `personalisation/${pid}/square.jpg`,
  render: (pid: string, styleKey: string) => `personalisation/${pid}/${styleKey}.png`,
  print: (pid: string) => `personalisation/${pid}/print.png`,
  prefix: (pid: string) => `personalisation/${pid}/`,
};

/** @netlify/blobs accepts ArrayBuffer, not Buffer — copy out the exact byte range. */
export const toArrayBuffer = (b: Buffer): ArrayBuffer =>
  b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

export const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

export function ipHash(req: Request): string {
  const ip =
    req.headers.get('x-nf-client-connection-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    'unknown';
  const salt = process.env.PERSONALISATION_SALT || 'dev-salt';
  return sha256(`${salt}:${ip}`).slice(0, 32);
}

export const nowIso = () => new Date().toISOString();
export const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

// ── Responses ────────────────────────────────────────────────────────────────
export const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const bad = (msg: string, status = 400) => json(status, { ok: false, error: msg });

// ── Session doc ──────────────────────────────────────────────────────────────
export type Render = {
  _key: string;
  styleKey: string;
  blobKey?: string;
  model?: string;
  ms?: number;
  createdAt: string;
  error?: string;
};

export type Session = {
  _id: string;
  pid: string;
  status: string;
  photoKey?: string;
  photoSha256?: string;
  renders?: Render[];
  selectedStyleKey?: string;
  callsUsed?: number;
  switchesUsed?: number;
  ipHash?: string;
  expiresAt?: string;
  customerEmail?: string;
  digitalBundle?: boolean;
};

export async function getSession(pid: string): Promise<Session | null> {
  return sanity.getDocument<Session>(docId(pid)) as Promise<Session | null>;
}

/** Distinct styles that have a successful render (or are in flight). */
export function stylesTried(s: Session): string[] {
  return [...new Set((s.renders || []).filter((r) => !r.error).map((r) => r.styleKey))];
}

// ── Daily guards (soft counters; a race can over-count by one, never under) ──
const today = () => new Date().toISOString().slice(0, 10);

async function bump(key: string): Promise<number> {
  const g = guards();
  const cur = ((await g.get(key, { type: 'json' })) as { n?: number } | null)?.n ?? 0;
  await g.setJSON(key, { n: cur + 1 });
  return cur + 1;
}

export type GuardResult = { ok: true } | { ok: false; reason: 'ip' | 'global' };

/** Count one intended generation against the IP and global daily caps. */
export async function chargeGuards(ip: string): Promise<GuardResult> {
  const d = today();
  const global = await bump(`global/${d}`);
  if (global > LIMITS.callsPerDayGlobal) return { ok: false, reason: 'global' };
  const perIp = await bump(`ip/${ip}/${d}`);
  if (perIp > LIMITS.callsPerIpPerDay) return { ok: false, reason: 'ip' };
  return { ok: true };
}

/** Internal calls (foreground → background) carry this header. */
export const INTERNAL_HEADER = 'x-personalisation-key';
export const internalKey = () => sha256(`internal:${process.env.PERSONALISATION_SALT || 'dev-salt'}`).slice(0, 40);
export const isInternal = (req: Request) => req.headers.get(INTERNAL_HEADER) === internalKey();

export const siteUrl = () => process.env.URL || process.env.SITE_URL || 'https://pixel8multimedia.co.uk';
