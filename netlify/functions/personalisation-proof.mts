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

import { Resend } from 'resend';
import sharp from 'sharp';
import { randomBytes } from 'node:crypto';
import {
  sanity, images, docId, blobKey, getSession, isInternal, nowIso, json, bad,
  toArrayBuffer, siteUrl,
} from './_shared/personalisation.mts';
import { STYLE_META } from './_shared/styles.mjs';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.EMAIL_FROM || 'Pixel8 Multimedia <orders@pixel8multimedia.co.uk>';

const SIZE_LABELS: Record<string, string> = { small: '12×12"', medium: '16×16"', large: '20×20"' };
const FORMAT_LABELS: Record<string, string> = {
  poster: 'Poster Print',
  canvasStandard: 'Canvas (Standard Frame)',
  canvasGallery: 'Canvas (Gallery Frame)',
};

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

  const details = [
    ['Style', `Option ${meta?.letter || ''} — ${label}`],
    ['Format', FORMAT_LABELS[doc.format] || doc.format || '—'],
    ['Size', SIZE_LABELS[doc.size] || doc.size || '—'],
  ]
    .map(([k, v]) => `<tr>
      <td style="padding:6px 0;color:#999;font-size:14px;">${k}</td>
      <td style="padding:6px 0;color:#F5F5F0;font-size:14px;text-align:right;">${v}</td>
    </tr>`)
    .join('');

  const html = `
  <div style="background:#0D0D0F;padding:32px 16px;font-family:'DM Sans',Arial,sans-serif;">
    <div style="max-width:600px;margin:0 auto;background:#131316;border:1px solid #2A2A2E;border-radius:8px;overflow:hidden;">
      <div style="padding:28px 28px 8px;">
        <h1 style="color:#F5F5F0;font-family:Montserrat,Arial,sans-serif;font-size:22px;margin:0 0 8px;">Your proof is ready</h1>
        <p style="color:#999;line-height:1.6;margin:0 0 20px;">
          Here's your design. Have a proper look, and if you're happy, approve it below — we won't print anything until you do.
        </p>
      </div>

      <img src="cid:proof" alt="Your personalised design" width="600" style="display:block;width:100%;height:auto;border-top:1px solid #2A2A2E;border-bottom:1px solid #2A2A2E;" />

      <div style="padding:24px 28px;">
        <table style="width:100%;border-collapse:collapse;">${details}</table>

        <div style="text-align:center;margin:28px 0 8px;">
          <a href="${approveUrl}"
             style="display:inline-block;background:#F07828;color:#000;font-family:Montserrat,Arial,sans-serif;font-weight:700;font-size:15px;text-decoration:none;padding:14px 32px;border-radius:6px;">
            Approve &amp; print this
          </a>
        </div>
        <p style="color:#666;font-size:13px;line-height:1.6;text-align:center;margin:12px 0 0;">
          Once approved we'll print and dispatch within 3–6 working days.
        </p>

        <p style="color:#999;font-size:13px;line-height:1.6;margin:24px 0 0;border-top:1px solid #2A2A2E;padding-top:20px;">
          Not quite right? Just reply to this email and tell us what's wrong — we'll sort it out before anything is printed.
          Because each piece is made from your own photo we can't accept returns once it's printed, which is exactly why we
          ask you to check first.
        </p>
      </div>
    </div>
    <p style="color:#555;font-size:12px;text-align:center;margin:20px auto 0;max-width:600px;">
      Pixel8 Multimedia · The Metavision Multimedia Limited · Made in the UK
    </p>
  </div>`;

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
