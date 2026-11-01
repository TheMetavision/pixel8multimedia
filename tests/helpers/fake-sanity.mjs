/**
 * A small in-memory stand-in for @sanity/client, enough for the shipping code:
 * getDocument, fetch (answered by a handler the test supplies), create,
 * patch(...).ifRevisionId/setIfMissing/set/unset/commit, and transaction()
 * with all-or-nothing revision checks. Dotted paths in set/unset write inside
 * objects, as Sanity's do.
 */
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function setPath(doc, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let o = doc;
  for (const k of keys) {
    if (!o[k] || typeof o[k] !== 'object') o[k] = {};
    o = o[k];
  }
  o[last] = clone(value);
}
function unsetPath(doc, path) {
  const keys = path.split('.');
  const last = keys.pop();
  let o = doc;
  for (const k of keys) { if (!o[k]) return; o = o[k]; }
  delete o[last];
}

export function fakeSanity(docs = [], { fetch: onFetch } = {}) {
  const store = new Map();
  let rev = 0;
  const nextRev = () => `r${++rev}`;
  for (const d of docs) store.set(d._id, { ...clone(d), _rev: d._rev || nextRev() });
  const writes = [];

  const conflict = () => Object.assign(new Error('Document has unexpected revision'), { statusCode: 409 });

  function makePatch(id) {
    const ops = { ifRev: null, setIfMissing: null, set: {}, unset: [] };
    const p = {
      ifRevisionId(r) { ops.ifRev = r; return p; },
      setIfMissing(o) { ops.setIfMissing = { ...(ops.setIfMissing || {}), ...o }; return p; },
      set(o) { Object.assign(ops.set, o); return p; },
      unset(a) { ops.unset.push(...a); return p; },
      commit: async () => { applyAll([{ id, ops }]); return clone(store.get(id)); },
      _ops: ops,
    };
    return p;
  }

  function applyAll(list) {
    for (const { id, ops } of list) {
      const cur = store.get(id);
      if (!cur) throw Object.assign(new Error(`Document ${id} not found`), { statusCode: 404 });
      if (ops.ifRev && cur._rev !== ops.ifRev) throw conflict();
    }
    for (const { id, ops } of list) {
      const doc = clone(store.get(id));
      for (const [k, v] of Object.entries(ops.setIfMissing || {})) if (doc[k] === undefined) doc[k] = clone(v);
      for (const [k, v] of Object.entries(ops.set)) setPath(doc, k, v);
      for (const k of ops.unset) unsetPath(doc, k);
      doc._rev = nextRev();
      store.set(id, doc);
      writes.push({ id, ops: clone(ops) });
    }
  }

  const client = {
    store, writes,
    getDocument: async (id) => clone(store.get(id)),
    fetch: async (query, params) => (onFetch ? onFetch(query, params, client) : null),
    create: async (doc) => {
      if (store.has(doc._id)) throw Object.assign(new Error('exists'), { statusCode: 409 });
      store.set(doc._id, { ...clone(doc), _rev: nextRev() });
      return clone(store.get(doc._id));
    },
    patch: (id) => makePatch(id),
    transaction() {
      const list = [];
      const tx = {
        patch(id, fn) { const p = fn(makePatch(id)); list.push({ id, ops: p._ops }); return tx; },
        commit: async () => { applyAll(list); return { results: list.map((l) => ({ id: l.id })) }; },
      };
      return tx;
    },
    /** Make the next getDocument of `id` see a rival write first (a race). */
    bump(id, set = {}) { const d = store.get(id); Object.assign(d, set); d._rev = nextRev(); },
  };
  return client;
}

/** A Resend stand-in that records what was sent. */
export function fakeResend({ fail = false } = {}) {
  const sent = [];
  return {
    sent,
    emails: {
      send: async (m) => {
        if (fail) return { error: { name: 'test', message: 'refused' } };
        sent.push(m);
        return { data: { id: `e${sent.length}` }, error: null };
      },
    },
  };
}

export const quietLog = { log() {}, warn() {}, error() {}, debug() {} };
