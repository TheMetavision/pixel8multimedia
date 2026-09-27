/**
 * netlify/functions/_shared/print-adhoc.mjs
 *
 * Print files for a stock product with NO site order: a marketplace sale
 * (Amazon, Etsy, Groupon…) printed from the same master. /admin/print-any.
 *
 * Same spec, renderer, start/status and download as order lines (print-job.mjs
 * startKeyed / statusKeyed / renderKeyed); only the key differs:
 *   print/adhoc/<slug>/<size>-<format>-<masterIdentity>-<wrap>.jpg  (+ .state)
 * so the same product, size, finish and wrap from the same master is a cache
 * hit, whoever asks and for whichever marketplace order.
 *
 * History: a small JSON index in the print-files store (HISTORY_KEY), newest
 * first — date, channel, reference, slug, size, finish, key. The reference is
 * the marketplace's order number; the page says not to put names in it, and it
 * is never logged.
 *
 * Stock only. Personalised (Your Photo) and commission artwork have no master
 * in print-masters and aren't covered.
 *
 * deps: as print-job.mjs, plus
 *   findProduct(slug) → { slug, title } for a stock product, or null
 */
import { sourceInfo } from './print-sources.mjs';
import { adhocKey, adhocStateKey, isAdhocKey, isHexColour, isSlug } from './print-keys.mjs';
import { SIZE_DIMENSIONS, isFormatKey, isSizeKey } from './print-spec.mjs';
import { startKeyed, statusKeyed, renderKeyed, geometryOf } from './print-job.mjs';

export const CHANNELS = { amazon: 'Amazon', etsy: 'Etsy', groupon: 'Groupon', other: 'Other' };
export const HISTORY_KEY = 'adhoc/history.json';
export const HISTORY_KEEP = 1000;
export const HISTORY_SHOWN = 50;

// The page offers 12/16/20 and poster/standard/gallery; the spec's own keys work too.
const SIZE_ALIASES = { 12: 'small', 16: 'medium', 20: 'large' };
const FORMAT_ALIASES = { standard: 'canvasStandard', gallery: 'canvasGallery' };

/** A marketplace order number: printable text, one line, ≤ 60 characters. */
export const cleanReference = (s) =>
  String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);

/**
 * Check the request's shape (no I/O).
 * @returns {{ ok: true, spec, channel, reference } | { ok: false, error }}
 */
export function validateAdhoc(input = {}) {
  const slug = String(input.slug ?? '').trim();
  const sizeKey = SIZE_ALIASES[input.size] || input.size;
  const formatKey = FORMAT_ALIASES[input.finish] || input.finish;
  if (!isSlug(slug)) return { ok: false, error: 'Choose a product from the list.' };
  if (!isSizeKey(sizeKey)) return { ok: false, error: `Unknown size "${String(input.size ?? '')}" — 12, 16 or 20.` };
  if (!isFormatKey(formatKey)) return { ok: false, error: `Unknown finish "${String(input.finish ?? '')}" — poster, standard or gallery.` };
  let wrapColour = String(input.wrap ?? '').trim();
  if (wrapColour && !isHexColour(wrapColour)) return { ok: false, error: `Wrap colour "${wrapColour}" is not #rrggbb.` };
  // A poster has no wrap: an override would change the key, not the file.
  if (formatKey === 'poster') wrapColour = '';
  if (wrapColour && !wrapColour.startsWith('#')) wrapColour = `#${wrapColour}`;
  const channel = String(input.channel ?? '').toLowerCase();
  if (!(channel in CHANNELS)) return { ok: false, error: 'Choose a channel: Amazon, Etsy, Groupon or Other.' };
  const letter = (/-style-([a-j])$/.exec(slug) || [])[1] || 'x';
  return {
    ok: true,
    spec: { kind: 'stock', slug, sizeKey, formatKey, wrapColour: wrapColour.toLowerCase(), style: letter },
    channel,
    reference: cleanReference(input.reference),
  };
}

/** Download name: slug, finish and size (and the wrap override, if any). */
export function adhocFileName(spec) {
  const wrap = spec.wrapColour ? `-wrap${spec.wrapColour.replace('#', '')}` : '';
  return `pixel8-${spec.slug}-${spec.formatKey}-${SIZE_DIMENSIONS[spec.sizeKey]}${wrap}.jpg`.replace(/[^A-Za-z0-9._-]/g, '-');
}

/**
 * Validate, confirm the product and its master, and work out the key.
 * @returns {{ status: 'ok', spec, source, key, product, channel, reference } | { status: 'invalid'|'unknown'|'no-source', message }}
 */
export async function planAdhoc(input, deps) {
  const v = validateAdhoc(input);
  if (!v.ok) return { status: 'invalid', message: v.error };
  const product = await deps.findProduct(v.spec.slug);
  if (!product) return { status: 'unknown', message: `No stock product "${v.spec.slug}". Personalised and commission artwork can't be printed from here.` };
  const source = await sourceInfo(v.spec, deps.stores);
  if (!source.exists) return { status: 'no-source', message: `No print master has been uploaded for ${v.spec.slug}.` };
  const key = adhocKey({ ...v.spec, identity: source.identity });
  return { status: 'ok', spec: v.spec, source, key, product, channel: v.channel, reference: v.reference };
}

/** The last `n` history entries, newest first. */
export async function readHistory(deps, n = HISTORY_SHOWN) {
  const h = await deps.files.get(HISTORY_KEY, { type: 'json' }).catch(() => null);
  return (Array.isArray(h?.entries) ? h.entries : []).slice(0, n);
}

/**
 * Add one entry. Read-modify-write: two admins starting files in the same
 * instant could lose one entry (the file itself is unaffected). One person
 * uses this page, so that's accepted rather than adding a lock.
 */
export async function appendHistory(entry, deps) {
  const h = await deps.files.get(HISTORY_KEY, { type: 'json' }).catch(() => null);
  const entries = Array.isArray(h?.entries) ? h.entries : [];
  entries.unshift(entry);
  await deps.files.setJSON(HISTORY_KEY, { entries: entries.slice(0, HISTORY_KEEP) });
}

/**
 * Start (idempotent), as for an order line, and record it in the history.
 * Refusals are not recorded.
 */
export async function startAdhoc(input, deps) {
  const plan = await planAdhoc(input, deps);
  if (plan.status !== 'ok') return { state: plan.status, message: plan.message };
  const { spec } = plan;
  const trigger = { adhoc: { slug: spec.slug, size: spec.sizeKey, finish: spec.formatKey, wrap: spec.wrapColour, channel: plan.channel }, key: plan.key };
  const r = await startKeyed(plan.key, adhocStateKey(plan.key), trigger, deps);
  if (r.state === 'ready' || r.state === 'pending') {
    await appendHistory({
      at: new Date(deps.now()).toISOString(),
      channel: plan.channel,
      reference: plan.reference,
      slug: spec.slug,
      title: plan.product.title || '',
      sizeKey: spec.sizeKey,
      formatKey: spec.formatKey,
      wrap: spec.wrapColour || 'auto',
      key: plan.key,
    }, deps).catch((err) => { r.historyError = String(err?.message || err).slice(0, 200); });
  }
  return { ...r, ...geometryOf(spec.sizeKey, spec.formatKey), slug: spec.slug, title: plan.product.title || '' };
}

/** Status of an ad-hoc file by its key. */
export async function adhocStatus(key, deps) {
  if (!isAdhocKey(key)) return { state: 'invalid', message: 'bad key' };
  const r = await statusKeyed(adhocStateKey(key), deps);
  return { ...r, ...(r.sizeKey ? geometryOf(r.sizeKey, r.formatKey) : {}) };
}

/**
 * The background half: re-plan from the request (never trust the caller's
 * key), render, store. If the master changed since the start (so the key
 * did), the note the page is polling is told to start again.
 */
export async function runAdhocRender(input, expectedKey, deps) {
  const plan = await planAdhoc(input, deps);
  if (plan.status !== 'ok') {
    if (isAdhocKey(expectedKey)) {
      await deps.files.setJSON(adhocStateKey(expectedKey), { state: 'failed', key: expectedKey, error: plan.message, at: new Date(deps.now()).toISOString() });
    }
    return { ok: false, error: plan.message };
  }
  if (expectedKey && expectedKey !== plan.key && isAdhocKey(expectedKey)) {
    await deps.files.setJSON(adhocStateKey(expectedKey), {
      state: 'failed', key: expectedKey, error: 'the master changed while this was queued — start again', at: new Date(deps.now()).toISOString(),
    });
  }
  return renderKeyed({ key: plan.key, spec: plan.spec, source: plan.source, filename: adhocFileName(plan.spec) }, adhocStateKey(plan.key), deps);
}
