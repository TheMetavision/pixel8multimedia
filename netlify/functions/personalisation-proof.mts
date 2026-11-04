// netlify/functions/personalisation-proof.mts
//
// POST /api/personalisation/proof   { pid }   (internal only)
//
// Sends the customer their proof and the approve link. Called by the Stripe
// webhook once a personalised line is marked paid, and safe to call again by
// hand from the Studio if an email needs resending.
//
// The proof shows the design at 900px with a thin border and the order
// details underneath — enough to judge the artwork, not enough to print from.
// The full-resolution file stays in Blobs until approval.
//
// The approve token is 128-bit random and single-use: approving clears it, so
// a forwarded email can't re-approve or change anything.

import { setting } from './_shared/site-config.mjs';
import { Resend } from 'resend';
import sharp from 'sharp';
import { randomBytes } from 'node:crypto';
import {
  sanity, images, docId, blobKey, getSession, isInternal, nowIso, json, bad,
  toArrayBuffer, siteUrl,
} from './_shared/personalisation.mts';
import { STYLE_META } from './_shared/styles.mjs';
import { proofEmailHtml, proofDetailsHtml } from './_shared/proof-email.mjs';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = setting('EMAIL_FROM');

import { SIZE_LABELS as SPEC_SIZE_LABELS, FORMAT_LABELS as SPEC_FORMAT_LABELS } from './_shared/print-spec.mjs';

// The same labels as the shop, cart, order emails and Studio.
const SIZE_LABELS: Record<string, string> = SPEC_SIZE_LABELS;
const FORMAT_LABELS: Record<string, string> = SPEC_FORMAT_LABELS;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return bad('Method not allowed', 405);
  if (!isInternal(req)) return bad('Forbidden', 403);

  const { pid, resend: isResend = false } = (await req.json()) as { pid?: string; resend?: boolean };
  if (!pid) return bad('Bad request');

  const s = await getSession(pid);
  if (!s) return bad('Session not found', 404);
  if (!s.customerEmail) return bad('No customer email on this session', 409);
  if (!s.selectedStyleKey) return bad('No style selected', 409);
  if (s.status === 'approved' || s.status === 'printed') return json(200, { ok: true, skipped: 'already approved' });
  if (s.status === 'proof-sent' && !isResend) return json(200, { ok: true, skipped: 'already sent' });

  const doc = s as any;
  const styleKey = s.selectedStyleKey;
  const meta = (STYLE_META as Record<string, { letter: string; label: string }>)[styleKey];
  const label = meta?.label || styleKey;

  // Proof image: 900px, unwatermarked (they've paid) but not print resolution.
  const src = await images().get(blobKey.render(pid, styleKey), { type: 'arrayBuffer' });
  if (!src) return bad('Render missing from storage', 410);
  const proof = await sharp(Buffer.from(src))
    .resize(900, 900, { fit: 'cover' })
    .jpeg({ quality: 88 })
    .toBuffer();
  const proofKey = `personalisation/${pid}/proof.jpg`;
  await images().set(proofKey, toArrayBuffer(proof), { metadata: { pid, styleKey } });

  // One-shot token
  const token = doc.proofToken || randomBytes(16).toString('base64url');
  const approveUrl = `${siteUrl()}/api/personalisation/approve?pid=${pid}&token=${token}`;

  const details = proofDetailsHtml([
    ['Style', `Option ${meta?.letter || ''} — ${label}`],
    ['Format', FORMAT_LABELS[doc.format] || doc.format || '—'],
    ['Size', SIZE_LABELS[doc.size] || doc.size || '—'],
  ]);

  const html = proofEmailHtml({ approveUrl, details });

  await resend.emails.send({
    from: FROM,
    to: [s.customerEmail],
    replyTo: process.env.EMAIL_REPLY_TO || 'hello@pixel8multimedia.co.uk',
    subject: 'Your Pixel8 proof — one click to approve',
    html,
    attachments: [{ filename: 'your-design-proof.jpg', content: proof.toString('base64'), contentId: 'proof' }],
  });

  await sanity
    .patch(docId(pid))
    .set({ status: 'proof-sent', proofToken: token, proofSentAt: nowIso(), proofKey })
    .unset(['proofTriggerError']) // e.g. resent by hand after a failed trigger
    .commit();

  console.log(`personalisation-proof: sent for ${pid} (${styleKey})`);
  return json(200, { ok: true });
}

export const config = { path: '/api/personalisation/proof' };
