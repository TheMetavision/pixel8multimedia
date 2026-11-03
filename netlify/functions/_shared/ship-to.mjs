import { esc } from './dispatch-email.mjs';

/**
 * The inner HTML of an order email's "Ship to" block: name, then each address
 * line that is present, escaped. With no address at all it says so loudly
 * instead of printing a name over blank lines (order P8-5TMdlih8).
 *
 * @param {string} name
 * @param {{ line1?, line2?, city?, state?, postal_code?, country? }} address  Stripe's shape
 */
export function shipToHtml(name, address = {}) {
  const a = address || {};
  const cityLine = [a.city, a.state].filter(Boolean).join(', ');
  const lines = [a.line1, a.line2, cityLine, a.postal_code, a.country].filter(Boolean);
  if (!lines.length) {
    return `${esc(name || '')}<br/><strong style="color: #FF5252;">&#9888; No delivery address was found on the Stripe session.</strong>`;
  }
  return [name, ...lines].filter(Boolean).map((l) => esc(l)).join('<br/>');
}
