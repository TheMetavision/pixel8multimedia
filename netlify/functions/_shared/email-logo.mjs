/**
 * The Pixel8 logo, as every email shows it: customer and team, shop,
 * commission, shipping, returns, proofs, contact and newsletter.
 *
 * The URL is EMAIL_LOGO_URL in site-config.mjs (env override allowed), so it
 * is changed in one place. The image is 400x233; it is shown at `width` px
 * with height auto, so it keeps its shape and stays sharp on 2x screens.
 */
import { setting } from './site-config.mjs';

const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** The logo's URL. */
export const emailLogoUrl = (env = process.env) => setting('EMAIL_LOGO_URL', env);

/**
 * The logo as an <img>, centred, for any email.
 *
 * @param {{ width?: number, style?: string }} [opts] style is appended to the inline style
 */
export function emailLogoImg({ width = 180, style = '' } = {}) {
  return `<img src="${attr(emailLogoUrl())}" width="${width}" alt="Pixel8 Multimedia" style="display:block;margin:0 auto;width:${width}px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;${style}">`;
}
