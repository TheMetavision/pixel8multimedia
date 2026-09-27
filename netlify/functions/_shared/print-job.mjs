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
 *
 * The same start / status / render steps also serve ad-hoc files
 * (print-adhoc.mjs) and pre-warming (prewarmLines, below): one code path, one
 * set of cache keys, whichever way a file is asked for.
 */
import { lineSpec, sourceInfo } from './print-sources.mjs';
import { FILES_STORE, isSafeId, isHexColour, stateKey, wrapToken, cacheKey } from './print-keys.mjs';
import { printGeometry } from './print-spec.mjs';

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

const readNote = (deps, sk) => deps.files.get(sk, { type: 'json' }).catch(() => null);
const writeNote = (deps, sk, state) =>
  deps.files.setJSON(sk, { ...state, at: new Date(deps.now()).toISOString() });
const isFreshPending = (note, key, deps) =>
  note?.state === 'pending' && note.key === key && deps.now() - Date.parse(note.at) < STALE_PENDING_MS;

/** Face and wrap in pixels, for the pages to show beside the file. */
export function geometryOf(sizeKey, formatKey) {
  try { const g = printGeometry(sizeKey, formatKey); return { facePx: g.facePx, wrapPx: g.wrapPx }; }
  catch { return {}; }
}

/**
 * The shared start: a cache hit answers "ready" at once; a job already
 * pending for the same key isn't started twice; otherwise the pending note is
 * written BEFORE the trigger — the renderer can finish before the trigger call
 * returns, and a note written afterwards would overwrite its "ready".
 * @param key          the file's cache key
 * @param sk           where its .state note lives
 * @param triggerBody  what the background renderer is sent
 */
export async function startKeyed(key, sk, triggerBody, deps) {
  const hit = await deps.files.getMetadata(key);
  if (hit) {
    await writeNote(deps, sk, { state: 'ready', key });
    return { state: 'ready', cached: true, key, ...hit.metadata };
  }

  if (isFreshPending(await readNote(deps, sk), key, deps)) return { state: 'pending', key, already: true };

  await writeNote(deps, sk, { state: 'pending', key });
  const r = await deps.trigger(triggerBody);
  if (!r.ok) {
    const error = `could not start the renderer: ${r.error || 'unknown error'}`;
    await writeNote(deps, sk, { state: 'failed', key, error });
    return { state: 'failed', key, error };
  }
  const now = await readNote(deps, sk);
  if (now?.state === 'ready' && now.key === key) {
    const meta = await deps.files.getMetadata(key);
    if (meta) return { state: 'ready', cached: false, key, ...meta.metadata };
  }
  return { state: 'pending', key };
}

/** The shared status: what the note says, checked against the store. */
export async function statusKeyed(sk, deps) {
  const s = await readNote(deps, sk);
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
 * The shared render: load the source, render, store with its metadata, mark
 * the note ready. A key already in the store is just marked ready. Any failure
 * is written to the note so the page stops polling and says why.
 * @param job  { key, spec, source, filename } — spec from lineSpec (or the
 *             ad-hoc equivalent), source from sourceInfo
 */
export async function renderKeyed(job, sk, deps) {
  const { key, spec, source: info, filename } = job;
  try {
    if (await deps.files.getMetadata(key)) {
      await writeNote(deps, sk, { state: 'ready', key });
      return { ok: true, cached: true, key };
    }
    let source = await deps.loadSource(info);
    if (!source) throw new Error('source disappeared before it could be read');
    if (deps.prepare) source = await deps.prepare(source, spec);
    const out = await deps.render({
      source, sizeKey: spec.sizeKey, formatKey: spec.formatKey,
      wrapColour: spec.wrapColour || undefined, identity: info.identity,
    });
    const metadata = {
      width: out.width, height: out.height, dpi: out.dpi, bytes: out.bytes,
      wrapColour: out.wrapColour, wrapSource: out.wrapSource, identity: out.identity,
      sizeKey: spec.sizeKey, formatKey: spec.formatKey, style: spec.style,
      padded: out.padded, filename, renderedAt: new Date(deps.now()).toISOString(),
    };
    await deps.files.set(key, out.buffer, { metadata });
    await writeNote(deps, sk, { state: 'ready', key });
    return { ok: true, key, metadata };
  } catch (err) {
    const error = String(err?.message || err).slice(0, 300);
    await writeNote(deps, sk, { state: 'failed', key, error }).catch(() => {});
    return { ok: false, error };
  }
}

/** Start (idempotent) for one order line. */
export async function startJob(orderId, lineKey, deps) {
  const plan = await planLine(orderId, lineKey, deps);
  if (plan.status !== 'ok') return { state: plan.status, message: plan.message };
  return startKeyed(plan.key, stateKey(orderId, lineKey), { orderId, lineKey, key: plan.key }, deps);
}

/** Status for one order line. */
export async function jobStatus(orderId, lineKey, deps) {
  if (!isSafeId(orderId) || !isSafeId(lineKey)) return { state: 'invalid', message: 'bad order or line id' };
  return statusKeyed(stateKey(orderId, lineKey), deps);
}

/**
 * The background half for one order line: re-plan from Sanity (never trust
 * the caller beyond the ids), then the shared render.
 *
 * deps additionally: loadSource(info) → Buffer, render(opts) → renderPrint result,
 *                    prepare(buffer, spec, geometry) → Buffer (personalised upscale)
 */
export async function runRender(orderId, lineKey, deps) {
  const plan = await planLine(orderId, lineKey, deps);
  if (plan.status !== 'ok') {
    await writeNote(deps, stateKey(orderId, lineKey), { state: 'failed', error: plan.message });
    return { ok: false, error: plan.message };
  }
  const job = { key: plan.key, spec: plan.spec, source: plan.source, filename: fileName(plan) };
  return renderKeyed(job, stateKey(orderId, lineKey), deps);
}

// ── Pre-warming ──────────────────────────────────────────────────────────────
// Make an order's print files before anyone opens them. Same plan, same keys,
// same notes and same render as on-demand, so opening the print-file page
// later is a cache hit ("Ready (already made)").

/** At most this many lines per pre-warm call (a big order still finishes well inside 15 min). */
export const PREWARM_MAX_LINES = 40;

/** The lines of an order worth pre-warming from the webhook: keyed stock lines. */
export function stockLineKeys(order) {
  return (order?.lineItems || []).filter((l) => lineSpec(l).kind === 'stock').map((l) => l._key);
}

/**
 * The lines to pre-warm when a personalised proof is approved: the pid's
 * orderedLines (one per order line it was bought on, see order-lines.mjs
 * personalisedLinesByPid), as { orderId, lineKey }, de-duplicated.
 */
export function orderedLineTargets(orderedLines) {
  const seen = new Set();
  const out = [];
  for (const l of Array.isArray(orderedLines) ? orderedLines : []) {
    if (!isSafeId(l?.orderId) || !isSafeId(l?._key)) continue;
    const id = `${l.orderId}/${l._key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ orderId: l.orderId, lineKey: l._key });
  }
  return out;
}

/**
 * Pre-warm one line. Nothing is written for a line that can't be made
 * (historic, invalid, no master): the print-file page reports those itself
 * when it's opened, exactly as before.
 * @returns {{ lineKey, result: 'rendered'|'ready'|'pending'|'failed'|'historic'|'no-source'|'invalid'|'not-found', error? }}
 */
export async function prewarmLine(orderId, lineKey, deps) {
  const plan = await planLine(orderId, lineKey, deps);
  if (plan.status !== 'ok') return { lineKey, result: plan.status };
  const sk = stateKey(orderId, lineKey);
  if (await deps.files.getMetadata(plan.key)) {
    await writeNote(deps, sk, { state: 'ready', key: plan.key });
    return { lineKey, result: 'ready' };
  }
  if (isFreshPending(await readNote(deps, sk), plan.key, deps)) return { lineKey, result: 'pending' };
  await writeNote(deps, sk, { state: 'pending', key: plan.key });
  const job = { key: plan.key, spec: plan.spec, source: plan.source, filename: fileName(plan) };
  const r = await renderKeyed(job, sk, deps);
  return r.ok ? { lineKey, result: 'rendered' } : { lineKey, result: 'failed', error: r.error };
}

/**
 * Pre-warm several lines, one after another (one render in memory at a time).
 * @param targets  [{ orderId, lineKey }]
 */
export async function prewarmLines(targets, deps) {
  const seen = new Set();
  const out = [];
  for (const t of targets) {
    const id = `${t.orderId}/${t.lineKey}`;
    if (seen.has(id)) continue;
    seen.add(id);
    if (out.length >= PREWARM_MAX_LINES) { out.push({ orderId: t.orderId, lineKey: t.lineKey, result: 'skipped-limit' }); continue; }
    out.push({ orderId: t.orderId, ...(await prewarmLine(t.orderId, t.lineKey, deps)) });
  }
  return out;
}
