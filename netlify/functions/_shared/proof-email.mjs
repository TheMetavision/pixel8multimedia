/**
 * The Your Photo proof email's HTML (personalisation-proof.mts sends it).
 * Kept apart from the function so it can be tested without Sharp, Blobs or
 * Sanity. The proof image itself is an attachment, referenced as cid:proof.
 */
import { emailLogoImg } from './email-logo.mjs';

/**
 * The style / format / size rows of the proof email's details table.
 * @param {Array<[string, string]>} pairs
 */
export function proofDetailsHtml(pairs) {
  return pairs
    .map(([k, v]) => `<tr>
      <td style="padding:6px 0;color:#999;font-size:14px;">${k}</td>
      <td style="padding:6px 0;color:#F5F5F0;font-size:14px;text-align:right;">${v}</td>
    </tr>`)
    .join('');
}

/**
 * @param {{ approveUrl: string, details: string }} args details: the <tr> rows for the style/format/size table
 */
export function proofEmailHtml({ approveUrl, details }) {
  return `
  <div style="background:#0D0D0F;padding:32px 16px;font-family:'DM Sans',Arial,sans-serif;">
    <div style="max-width:600px;margin:0 auto;background:#131316;border:1px solid #2A2A2E;border-radius:8px;overflow:hidden;">
      <div style="background:#000000;padding:24px 28px;text-align:center;border-bottom:1px solid #2A2A2E;">
        ${emailLogoImg()}
      </div>
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
        <p style="color:#8A8A8A;font-size:13px;line-height:1.6;text-align:center;margin:12px 0 0;">
          Once approved we'll print and dispatch within 3–6 working days.
        </p>

        <p style="color:#999;font-size:13px;line-height:1.6;margin:24px 0 0;border-top:1px solid #2A2A2E;padding-top:20px;">
          Not quite right? Just reply to this email and tell us what's wrong — we'll sort it out before anything is printed.
          Because each piece is made from your own photo we can't accept returns once it's printed, which is exactly why we
          ask you to check first.
        </p>
      </div>
    </div>
    <p style="color:#8A8A8A;font-size:12px;text-align:center;margin:20px auto 0;max-width:600px;">
      Pixel8 Multimedia · Made in the UK
    </p>
  </div>`;
}
