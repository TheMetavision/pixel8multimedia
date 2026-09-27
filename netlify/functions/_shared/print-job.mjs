/**
 * netlify/functions/_shared/print-job.mjs
 *
 * The on-demand print file for one order line: plan, start, status, render.
 * Ported from Comic Strip Canvas's order-print-file (start/status/download
 * with a .state note), adapted to Pixel8's square spec and sources.
 *
 * Blobs store "print-files" (strong consistency):
 *   print/<orderId>/<lineKey>/<size>-<format>-<style>-<identity>-<wrap>.jpg   the file
 *   print/<orderId>/<lineKey>.state   { state: pending|ready|failed, key, at, error? }
 *
 * The key names everything that makes the file what it is: size, finish,
 * style, the SOURCE'S identity (master sha256, or pid+style+render hash) and
 * the wrap colour (an override's hex, or "auto" — the automatic colour is a
 * pure function of the source, so the identity already pins it). Change any of
 * them and it's a different key, so a new file; ask again with none changed and
 * it's the same key, so a cache hit that returns at once.
 *
 * Everything with I/O is injected so the tests can drive it:
 *   deps.files          print-files store: get(key,{type:'json'}), setJSON, getMetadata, set
 *   deps.stores(name)   source stores (print-masters, personalisation)
 *   deps.fetchOrder(id) → the order doc (published) or null
 *   deps.trigger(body)  → Promise<{ ok, error? }>  starts the background render
 *   deps.now()          → ms
 */
import { lineSpec, sourceInfo } from './print-sources.mjs';
import { FILES_STORE, isSafeId, isHexColour, stateKey, wrapToken, cacheKey } from './print-keys.mjs';

export { FILES_STORE, isSafeId, stateKey, wrapToken, cacheKey };
/** A pending job older than this is assumed dead (the background limit is 15 min). */
export const STALE_PENDING_MS = 16 * 60 * 1000;

/** Download file name: what a person sees in their downloads folder. */
export function fileName({ order, spec }) {
  const who = spec.kind === 'stock' ? spec.slug : `personalised-${spec.pid}-${spec.styleKey}`;
  const ref = String(order?._id || '').replace(/^order\./, '').slice(-10);
  return `pixel8-${who}-${spec.formatKey}-${spec.sizeKey}-${ref}.jpg`.replace(/[^A-Za-z0-9._-]/g, '-');
}

/**
 * Work out everything about a line without touching the file store.
 * @returns {{ status: 'ok', order, line, spec, source, key }
 *         | { status: 'not-found'|'historic'|'invalid'|'no-source', message }}
 */
export async function planLine(orderId, lineKey, deps) {
  if (!isSafeId(orderId) || !isSafeId(lineKey)) return { status: 'invalid', message: 'bad order or line id' };
  const order = await deps.fetchOrder(orderId);
  if (!order) return { status: 'not-found', message: 'order not found' };
  const line = (order.lineItems || []).find((l) => l._key === lineKey);
  if (!line) return { status: 'not-found', message: 'line not found on this order' };
  const spec = lineSpec(line);
  if (spec.kind === 'historic') return { status: 'historic', message: 'historic line — no print data' };
  if (spec.kind === 'invalid') return { status: 'invalid', message: spec.reason };
  if (spec.wrapColour && !isHexColour(spec.wrapColour)) {
    return { status: 'invalid', message: `wrap colour "${spec.wrapColour}" is not #rrggbb` };
  }
  const source = await sourceInfo(spec, deps.stores);
  if (!source.exists) {
    return {
      status: 'no-source',
      message: spec.kind === 'stock'
        ? `no print master uploaded for ${spec.slug}`
        : `the personalised render ${spec.styleKey} for ${spec.pid} is gone`,
    };
  }
  const key = cacheKey({ orderId, lineKey, ...spec, identity: source.identity });
  return { status: 'ok', order, line, spec, source, key };
}

const readState = (deps, orderId, lineKey) =>
  deps.files.get(stateKey(orderId, lineKey), { type: 'json' }).catch(() => null);
const writeState = (deps, orderId, lineKey, state) =>
  deps.files.setJSON(stateKey(orderId, lineKey), { ...state, at: new Date(deps.now()).toISOString() });

/**
 * Start (idempotent). A cache hit answers "ready" at once. A job already
 * pending for the same key isn't started twice. Otherwise the pending note is
 * written BEFORE the trigger — the renderer can finish before the trigger call
 * returns, and a note written afterwards would overwrite its "ready".
 */
export async function startJob(orderId, lineKey, deps) {
  const plan = await planLine(orderId, lineKey, deps);
  if (plan.status !== 'ok') return { state: plan.status, message: plan.message };

  const hit = await deps.files.getMetadata(plan.key);
  if (hit) {
    await writeState(deps, orderId, lineKey, { state: 'ready', key: plan.key });
    return { state: 'ready', cached: true, key: plan.key, ...hit.metadata };
  }

  const cur = await readState(deps, orderId, lineKey);
  if (cur?.state === 'pending' && cur.key === plan.key && deps.now() - Date.parse(cur.at) < STALE_PENDING_MS) {
    return { state: 'pending', key: plan.key, already: true };
  }

  await writeState(deps, orderId, lineKey, { state: 'pending', key: plan.key });
  const r = await deps.trigger({ orderId, lineKey, key: plan.key });
  if (!r.ok) {
    const error = `could not start the renderer: ${r.error || 'unknown error'}`;
    await writeState(deps, orderId, lineKey, { state: 'failed', key: plan.key, error });
    return { state: 'failed', key: plan.key, error };
  }
  const now = await readState(deps, orderId, lineKey);
  if (now?.state === 'ready' && now.key === plan.key) {
    const meta = await deps.files.getMetadata(plan.key);
    if (meta) return { state: 'ready', cached: false, key: plan.key, ...meta.metadata };
  }
  return { state: 'pending', key: plan.key };
}

/** Status: what the note says, checked against the store. */
export async function jobStatus(orderId, lineKey, deps) {
  if (!isSafeId(orderId) || !isSafeId(lineKey)) return { state: 'invalid', message: 'bad order or line id' };
  const s = await readState(deps, orderId, lineKey);
  if (!s) return { state: 'absent' };
  if (s.state === 'ready') {
    const meta = await deps.files.getMetadata(s.key);
    return meta ? { state: 'ready', key: s.key, ...meta.metadata } : { state: 'absent' };
  }
  if (s.state === 'pending' && deps.now() - Date.parse(s.at) >= STALE_PENDING_MS) {
    return { state: 'failed', key: s.key, error: 'the renderer stopped without finishing — start again' };
  }
  return s;
}

/**
 * The background half: re-plan from Sanity (never trust the caller beyond the
 * ids), load the source, render, store, mark ready. Any failure is written to
 * the note so the page stops polling and says why.
 *
 * deps additionally: loadSource(info) → Buffer, render(opts) → renderPrint result,
 *                    prepare(buffer, spec, geometry) → Buffer (personalised upscale)
 */
export async function runRender(orderId, lineKey, deps) {
  const plan = await planLine(orderId, lineKey, deps);
  if (plan.status !== 'ok') {
    await writeState(deps, orderId, lineKey, { state: 'failed', error: plan.message });
    return { ok: false, error: plan.message };
  }
  try {
    if (await deps.files.getMetadata(plan.key)) {
      await writeState(deps, orderId, lineKey, { state: 'ready', key: plan.key });
      return { ok: true, cached: true, key: plan.key };
    }
    let source = await deps.loadSource(plan.source);
    if (!source) throw new Error('source disappeared before it could be read');
    if (deps.prepare) source = await deps.prepare(source, plan.spec);
    const out = await deps.render({
      source, sizeKey: plan.spec.sizeKey, formatKey: plan.spec.formatKey,
      wrapColour: plan.spec.wrapColour || undefined, identity: plan.source.identity,
    });
    const metadata = {
      width: out.width, height: out.height, dpi: out.dpi, bytes: out.bytes,
      wrapColour: out.wrapColour, wrapSource: out.wrapSource, identity: out.identity,
      sizeKey: plan.spec.sizeKey, formatKey: plan.spec.formatKey, style: plan.spec.style,
      padded: out.padded, filename: fileName(plan), renderedAt: new Date(deps.now()).toISOString(),
    };
    await deps.files.set(plan.key, out.buffer, { metadata });
    await writeState(deps, orderId, lineKey, { state: 'ready', key: plan.key });
    return { ok: true, key: plan.key, metadata };
  } catch (err) {
    const error = String(err?.message || err).slice(0, 300);
    await writeState(deps, orderId, lineKey, { state: 'failed', key: plan.key, error }).catch(() => {});
    return { ok: false, error };
  }
}
