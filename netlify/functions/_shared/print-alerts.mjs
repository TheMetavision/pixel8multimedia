/**
 * netlify/functions/_shared/print-alerts.mjs
 *
 * "PRINT FILE MISSING" for the Stripe webhook: alert, never block the sale.
 *
 * For each NEW keyed line (historic lines are never looked at): a stock line
 * needs its master in Blobs "print-masters"; a personalised line needs its
 * styled render. Metadata only, all in parallel, under one short deadline. If
 * Blobs can't be reached the check is skipped (logged, nothing flagged) — the
 * order and emails go ahead exactly as if it had passed.
 */
import { findMissingSources, lineSpec } from './print-sources.mjs';
import { FORMAT_LABELS, SIZE_LABELS } from './print-spec.mjs';

export const PRINT_CHECK_TIMEOUT_MS = 1500;
export const SUBJECT_PREFIX = 'PRINT FILE MISSING — ';

/**
 * Sets printFileMissing: true on each Sanity order line whose source is absent.
 * @returns {Promise<{ missing: Array, skipped?: string }>}  missing = the flagged lines
 */
export async function flagMissingPrintFiles(lineItems, stores, { timeoutMs = PRINT_CHECK_TIMEOUT_MS } = {}) {
  const r = await findMissingSources(lineItems, stores, { timeoutMs });
  if (r.error) return { missing: [], skipped: r.error };
  const missing = [];
  lineItems.forEach((line, i) => {
    if (r.missing.has(i)) { line.printFileMissing = true; missing.push(line); }
  });
  return { missing };
}

export const teamSubject = ({ total, customerName, missingCount }) =>
  `${missingCount ? SUBJECT_PREFIX : ''}NEW ORDER — £${Number(total).toFixed(2)} — ${customerName}`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Team email only: which lines have no print source, and what to do. */
export function missingBlockHtml(missing) {
  if (!missing.length) return '';
  const rows = missing.map((l) => {
    const spec = lineSpec(l);
    const what = spec.kind === 'personalised'
      ? `personalised render ${esc(spec.styleKey)} for ${esc(spec.pid)} not found`
      : `no print master uploaded for <code>${esc(spec.slug)}</code>`;
    return `<li>${esc(l.productTitle)} — ${esc(FORMAT_LABELS[l.formatKey] || l.formatKey)}, ${esc(SIZE_LABELS[l.sizeKey] || l.sizeKey)} × ${esc(l.quantity)}: ${what}</li>`;
  }).join('');
  return `
    <div style="margin: 0 0 20px; padding: 16px; background: #FFEBEE; border-left: 4px solid #D32F2F; border-radius: 4px; color: #1a1a1a;">
      <strong>PRINT FILE MISSING</strong> — the sale is fine, but ${missing.length === 1 ? 'this line has' : 'these lines have'} no print source yet:
      <ul style="margin: 8px 0 8px 18px; padding: 0;">${rows}</ul>
      Upload the master (tools/print-masters/upload-masters.mjs), then open the order in Studio
      (Orders → Needs attention) and use "Download print file".
    </div>`;
}
