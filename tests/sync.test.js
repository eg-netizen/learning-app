import test from 'node:test';
import assert from 'node:assert/strict';
import { createSync, localEntities, stable, hashStr } from '../src/sync.js';

// A fake cloud database shared by simulated devices.
function fakeCloud() {
  const docs = new Map();
  const listeners = new Set();
  const writes = [];
  return {
    docs, writes,
    adapter() {
      let online = true;
      const dev = {
        offline() { online = false; }, online() { online = true; flush(); },
        queue: [],
        subscribe(cb) {
          const l = (changes) => cb(changes);
          dev._l = l; listeners.add(l);
          cb([...docs].map(([path, doc]) => ({ path, doc })));
          return () => listeners.delete(l);
        },
        set(path, doc) {
          return new Promise((resolve, reject) => {
            const run = () => { docs.set(path, doc); writes.push(path); for (const l of listeners) l([{ path, doc }]); resolve(); };
            if (online) run(); else dev.queue.push(run);
          });
        },
      };
      function flush() { const q = dev.queue.splice(0); q.forEach(f => f()); }
      return dev;
    },
  };
}

function device(cloud, D, t0 = 1000) {
  let t = t0;
  const ad = cloud.adapter();
  const s = { D, status: null, applied: 0, ad, tick(n = 10) { t += n; return t; } };
  s.sync = createSync({ adapter: ad, getD: () => s.D, now: () => (t += 1), onApplied: () => { s.applied++; }, onStatus: (x) => { s.status = x; } });
  return s;
}
const fresh = () => ({ v: 1, profiles: [], banks: [], sessions: [], paused: {}, pinHash: null });
const settle = (...devs) => new Promise(r => setTimeout(r, 20));

test('a player, a session and the PIN made on one device appear on another', async () => {
  const cloud = fakeCloud();
  const a = device(cloud, fresh());
  a.D.profiles.push({ id: 'p1', name: 'Alice', color: '#fff' });
  a.D.sessions.push({ id: 's1', profileId: 'p1', startedAt: 5, items: [{ qid: 'q', answer: ['1'] }] });
  a.D.pinHash = 'abc';
  a.sync.start(); await settle();
  const b = device(cloud, fresh());
  b.sync.start(); await settle();
  assert.deepEqual(b.D.profiles.map(p => p.name), ['Alice']);
  assert.equal(b.D.sessions.length, 1);
  assert.equal(b.D.pinHash, 'abc');
  assert.equal(b.status.state, 'synced');
});

test('changes flow both ways and a deletion reaches the other device', async () => {
  const cloud = fakeCloud();
  const a = device(cloud, fresh()); const b = device(cloud, fresh());
  a.D.profiles.push({ id: 'p1', name: 'Alice', showTimer: false });
  a.sync.start(); b.sync.start(); await settle();
  assert.equal(b.D.profiles.length, 1);
  b.D.profiles[0] = { ...b.D.profiles[0], showTimer: true };
  await b.sync.syncNow(); await settle();
  assert.equal(a.D.profiles[0].showTimer, true);
  a.D.profiles = []; a.D.sessions = [];
  await a.sync.syncNow(); await settle();
  assert.equal(b.D.profiles.length, 0);
});

test('a saved session follows her between devices and is cleared when finished', async () => {
  const cloud = fakeCloud();
  const a = device(cloud, fresh()); const b = device(cloud, fresh());
  a.sync.start(); b.sync.start(); await settle();
  a.D.paused.p1 = { idx: 5, qids: ['a', 'b'], items: [], savedAt: 1 };
  await a.sync.syncNow(); await settle();
  assert.equal(b.D.paused.p1.idx, 5);
  delete b.D.paused.p1;
  await b.sync.syncNow(); await settle();
  assert.equal(a.D.paused.p1, undefined);
});

test('a question bank is split into pieces in the cloud and rebuilt on the other device', async () => {
  const cloud = fakeCloud();
  const questions = Array.from({ length: 45 }, (_, i) => ({ id: 'Q' + i, text: 'text ' + i, fields: [{ kind: 'num', answer: String(i) }], hints: ['h'], image: i === 3 ? 'data:image/svg+xml;charset=utf-8,%3Csvg%3E' : undefined }));
  const a = device(cloud, fresh());
  a.D.banks.push({ id: 'b1', name: 'My bank', questions });
  a.sync.start(); await settle();
  const chunkDocs = [...cloud.docs.keys()].filter(k => k.startsWith('bankq/'));
  assert.equal(chunkDocs.length, 3);
  const b = device(cloud, fresh());
  b.D.banks.push({ id: 'sample', name: 'Sample', builtIn: true, questions: [] }); // the built-in bank never syncs
  b.sync.start(); await settle();
  const got = b.D.banks.find(x => x.id === 'b1');
  assert.equal(got.questions.length, 45);
  assert.equal(got.questions[44].fields[0].answer, '44');
  assert.equal(stable(got.questions), stable(questions));
  assert.ok(!cloud.docs.has('banks/sample'));
  // removing the bank removes it everywhere, pieces included
  a.D.banks = a.D.banks.filter(x => x.id !== 'b1');
  await a.sync.syncNow(); await settle();
  assert.equal(b.D.banks.some(x => x.id === 'b1'), false);
  assert.ok([...cloud.docs].filter(([k]) => k.startsWith('bankq/')).every(([, d]) => d.deleted));
});

test('nothing is written when nothing has changed', async () => {
  const cloud = fakeCloud();
  const a = device(cloud, fresh());
  a.D.profiles.push({ id: 'p1', name: 'Alice' });
  a.sync.start(); await settle();
  const before = cloud.writes.length;
  await a.sync.syncNow(); await a.sync.syncNow(); await settle();
  assert.equal(cloud.writes.length, before);
  const b = device(cloud, fresh());
  b.sync.start(); await settle();
  await b.sync.syncNow(); await settle();
  assert.equal(cloud.writes.length, before); // the second device only reads
});

test('edits made while offline are uploaded when the device is back online', async () => {
  const cloud = fakeCloud();
  const a = device(cloud, fresh()); const b = device(cloud, fresh());
  a.sync.start(); b.sync.start(); await settle();
  a.ad.offline();
  a.D.sessions.push({ id: 's9', profileId: 'p', startedAt: 9, items: [] });
  a.sync.syncNow(); await settle();
  assert.equal(b.D.sessions.length, 0);
  a.ad.online(); await settle();
  assert.equal(b.D.sessions.length, 1);
});

test('if both devices change the same thing, the later change wins on both', async () => {
  const cloud = fakeCloud();
  const a = device(cloud, fresh(), 1000); const b = device(cloud, fresh(), 5000);
  a.D.profiles.push({ id: 'p1', name: 'Alice', color: 'red' });
  a.sync.start(); b.sync.start(); await settle();
  b.ad.offline(); a.ad.offline();
  a.D.profiles[0] = { id: 'p1', name: 'Alice A', color: 'red' };
  b.D.profiles[0] = { id: 'p1', name: 'Alice B', color: 'red' }; // later clock
  a.sync.syncNow(); b.sync.syncNow(); await settle();
  a.ad.online(); b.ad.online(); await settle();
  await a.sync.syncNow(); await b.sync.syncNow(); await settle();
  assert.equal(a.D.profiles[0].name, 'Alice B');
  assert.equal(b.D.profiles[0].name, 'Alice B');
});

test('a new device with its own PIN takes the family PIN on first sync', async () => {
  const cloud = fakeCloud();
  const a = device(cloud, fresh());
  a.D.pinHash = 'family';
  a.sync.start(); await settle();
  const b = device(cloud, fresh());
  b.D.pinHash = 'newdevice';
  b.sync.start(); await settle();
  assert.equal(b.D.pinHash, 'family');
});

test('what the device holds is described the same way after a round trip', () => {
  const D = { profiles: [{ id: 'p', name: 'A', z: undefined }], sessions: [], banks: [], paused: {}, pinHash: null };
  const j = localEntities(D).get('profiles/p');
  assert.equal(hashStr(j), hashStr(stable(JSON.parse(j))));
});
