// Cross-device sync. The app keeps working from this device's own storage; this module keeps a copy of
// the players, results, saved sessions, question banks and PIN in a cloud database and merges changes
// from other devices.
//
// Each thing that syncs is a "document" at a path such as profiles/<id>. The cloud stores it as
// { json, updatedAt, deleted }. For every path we remember what was last in sync (a hash and a time) in
// D.sync.base. Comparing that with the device now and the cloud now tells us who changed what:
//   only this device changed it   -> upload it
//   only the cloud changed it     -> take it
//   both changed it               -> the later change wins (clocks are the family's own devices)
// Deleting something uploads a "deleted" marker, so the deletion reaches the other devices too.
//
// The cloud itself is behind a small adapter, so this logic is tested without a network:
//   adapter.subscribe(onChanges)  onChanges([{ path, doc }]) with doc = null when removed; returns unsubscribe
//   adapter.set(path, doc)        resolves when the write is safely stored

const CHUNK = 20; // questions per cloud document (each document must stay well under 1MB)

export function stable(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(x => (x === undefined ? 'null' : stable(x))).join(',') + ']';
  return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
}

export function hashStr(s) { // cyrb53: short, fast, plenty for change detection
  let h1 = 0xdeadbeef; let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const jsonCache = new WeakMap(); // object -> its stable JSON (sessions and banks are large and rarely change)
function cachedStable(obj) {
  let s = jsonCache.get(obj);
  if (s === undefined) { s = stable(obj); jsonCache.set(obj, s); }
  return s;
}

// What this device holds, as path -> JSON text.
export function localEntities(D) {
  const out = new Map();
  for (const p of D.profiles) out.set('profiles/' + p.id, stable(p));
  for (const s of D.sessions) out.set('sessions/' + s.id, cachedStable(s));
  for (const [pid, pz] of Object.entries(D.paused || {})) if (pz) out.set('paused/' + pid, stable(pz));
  for (const b of D.banks) {
    if (b.builtIn) continue;
    out.set('banks/' + b.id, stable({ id: b.id, name: b.name, n: b.questions.length, rev: hashStr(cachedStable(b.questions)), chunks: Math.ceil(b.questions.length / CHUNK) }));
  }
  if (D.pinHash) out.set('meta/settings', stable({ pinHash: D.pinHash }));
  return out;
}

function putLocal(D, path, json) {
  const slash = path.indexOf('/');
  const col = path.slice(0, slash);
  const id = path.slice(slash + 1);
  const obj = json === null ? null : JSON.parse(json);
  const upsert = (list) => { const i = list.findIndex(x => x.id === id); if (obj === null) { if (i >= 0) list.splice(i, 1); } else if (i >= 0) list[i] = obj; else list.push(obj); };
  if (col === 'profiles') upsert(D.profiles);
  else if (col === 'sessions') { upsert(D.sessions); D.sessions.sort((a, b) => a.startedAt - b.startedAt); }
  else if (col === 'paused') { D.paused = D.paused || {}; if (obj === null) delete D.paused[id]; else D.paused[id] = obj; }
  else if (col === 'meta') D.pinHash = obj ? obj.pinHash : null;
}

export function createSync({ adapter, getD, now = Date.now, onApplied = () => {}, onStatus = () => {}, onSaveBase = () => {} }) {
  const remote = new Map(); // path -> { json, updatedAt, deleted, rev? }
  let unsubscribe = null;
  let running = false;
  let again = false;
  let timer = null;

  const state = (D) => D.sync || (D.sync = { base: {}, dirty: {} });
  const rdoc = (path) => remote.get(path);
  const rjson = (path) => { const r = rdoc(path); return r && !r.deleted ? r.json : null; };

  async function pushBank(path, json, t) {
    const meta = JSON.parse(json);
    const D = getD();
    const bank = D.banks.find(b => b.id === meta.id);
    for (let k = 0; k < meta.chunks; k++) {
      const part = bank.questions.slice(k * CHUNK, (k + 1) * CHUNK);
      await adapter.set('bankq/' + meta.id + '_' + k, { json: stable(part), rev: meta.rev, updatedAt: t, deleted: false });
    }
    await adapter.set(path, { json, updatedAt: t, deleted: false });
  }

  async function reconcileOnce() {
    const D = getD();
    const st = state(D);
    const L = localEntities(D);
    const paths = new Set([...L.keys(), ...Object.keys(st.base)]);
    for (const p of remote.keys()) if (!p.startsWith('bankq/')) paths.add(p);
    let applied = false;
    const writes = [];
    for (const path of paths) {
      const Lj = L.has(path) ? L.get(path) : null;
      const hL = Lj === null ? null : hashStr(Lj);
      const B = st.base[path];
      const R = rdoc(path);
      const remoteChanged = !!R && (!B || R.updatedAt > B.t);
      let localChanged = hL !== (B ? B.h : null);
      if (localChanged && remoteChanged) { // both sides hold the same thing already: nothing to do
        const rj = R.deleted ? null : R.json;
        if ((rj === null ? null : hashStr(rj)) === hL) { st.base[path] = { h: hL, t: R.updatedAt }; delete st.dirty[path]; localChanged = false; applied = true; continue; }
      }
      if (localChanged) {
        const dirtyAt = st.dirty[path] ?? (st.dirty[path] = now());
        const remoteWins = remoteChanged && (dirtyAt < R.updatedAt || (!B && path === 'meta/settings' && !R.deleted));
        if (!remoteWins) {
          writes.push({ path, Lj, hL, t: dirtyAt });
          continue;
        }
      } else if (!remoteChanged) continue;
      // take the cloud's version
      if (R.deleted) { putLocal(D, path, null); if (path.startsWith('banks/')) D.banks = D.banks.filter(b => b.id !== path.slice(6)); st.base[path] = { h: null, t: R.updatedAt }; applied = true; continue; }
      if (path.startsWith('banks/')) {
        const meta = JSON.parse(R.json);
        const parts = [];
        for (let k = 0; k < meta.chunks; k++) { const c = rdoc('bankq/' + meta.id + '_' + k); if (c && !c.deleted && c.rev === meta.rev) parts.push(JSON.parse(c.json)); }
        if (parts.length !== meta.chunks) continue; // the question chunks are still arriving; we will be called again
        const bank = { id: meta.id, name: meta.name, questions: parts.flat() };
        const i = D.banks.findIndex(b => b.id === meta.id);
        if (i >= 0) D.banks[i] = bank; else D.banks.push(bank);
      } else putLocal(D, path, R.json);
      st.base[path] = { h: hashStr(R.json), t: R.updatedAt };
      delete st.dirty[path];
      applied = true;
    }
    let failed = null;
    for (const w of writes) {
      try {
        if (w.path.startsWith('banks/') && w.Lj !== null) await pushBank(w.path, w.Lj, w.t);
        else if (w.Lj === null) {
          await adapter.set(w.path, { json: '', updatedAt: w.t, deleted: true });
          if (w.path.startsWith('banks/')) for (const p of [...remote.keys()]) if (p.startsWith('bankq/' + w.path.slice(6) + '_')) await adapter.set(p, { json: '', rev: '', updatedAt: w.t, deleted: true });
        } else await adapter.set(w.path, { json: w.Lj, updatedAt: w.t, deleted: false });
        st.base[w.path] = { h: w.hL, t: w.t };
        delete st.dirty[w.path];
        applied = true; // the saved base needs storing
      } catch (e) { failed = e; }
    }
    if (applied) onApplied();
    if (failed) throw failed;
  }

  async function reconcile() {
    if (running) { again = true; return; }
    running = true;
    try {
      do { again = false; await reconcileOnce(); } while (again);
      onStatus({ state: 'synced', at: now() });
    } catch (e) {
      onStatus({ state: 'error', message: String((e && e.message) || e) });
    } finally { running = false; }
  }

  return {
    start() {
      onStatus({ state: 'connecting' });
      unsubscribe = adapter.subscribe((changes) => {
        for (const { path, doc } of changes) { if (doc) remote.set(path, doc); else remote.delete(path); }
        reconcile();
      }, (e) => onStatus({ state: 'error', message: String((e && e.message) || e) }));
    },
    // Call after anything changes on this device. Waits a moment so a burst of changes becomes one upload.
    notify(delay = 1200) { clearTimeout(timer); timer = setTimeout(reconcile, delay); },
    syncNow: reconcile,
    stop() { clearTimeout(timer); if (unsubscribe) unsubscribe(); unsubscribe = null; remote.clear(); },
  };
}
