import test from 'node:test'; import assert from 'node:assert/strict';
import { createQueue } from '../src/main/queue.js';
import { RELEASE } from '../src/main/answers.js';

function fake() {
  let t = 0, nextId = 1; const timers = new Map();
  return {
    now: () => t,
    setTimer: (fn, ms) => { const id = nextId++; timers.set(id, { fn, at: t + ms }); return id; },
    clearTimer: (id) => { timers.delete(id); },
    pending: () => timers.size,
    tick(ms) {
      t += ms;
      for (;;) {
        const due = [...timers].filter(([, v]) => v.at <= t).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]); due[1].fn();
      }
    },
  };
}
const mk = () => { const f = fake(); return [f, createQueue({ now: f.now, setTimer: f.setTimer, clearTimer: f.clearTimer })]; };
const it = (id, kind = 'permission', sessionId = 's1') => ({ id, sessionId, kind, payload: {} });
const settled = (p) => { let v = 'pending'; p.then((x) => { v = x; }); return () => v; };

test('order: reply added first, then permission -> active() is the permission', () => {
  const [, q] = mk(); q.add(it('r', 'reply')); q.add(it('p', 'permission'));
  assert.equal(q.active().id, 'p');
  assert.deepEqual(q.list().map((i) => i.id), ['p', 'r']);
});
test('two permissions from the same session stay in arrival order', () => {
  const [, q] = mk(); q.add(it('a')); q.add(it('b', 'choice')); q.add(it('c'));
  assert.deepEqual(q.list().map((i) => i.id), ['a', 'b', 'c']);
});
test('answer resolves the promise with the given response and removes the item', async () => {
  const [, q] = mk(); const p = q.add(it('a')); const r = { ok: 1 };
  q.answer('a', r);
  assert.equal(await p, r); assert.equal(q.active(), null); assert.deepEqual(q.handedBack(), []);
});
test('permission not answered in 60 000 ms resolves RELEASE and appears in handedBack()', async () => {
  const [f, q] = mk(); const p = q.add(it('a'));
  f.tick(59999); assert.equal(q.list().length, 1);
  f.tick(1);
  assert.equal(await p, RELEASE); assert.equal(q.list().length, 0);
  assert.deepEqual(q.handedBack(), [{ sessionId: 's1', agentId: null, at: 60000 }]);
});
test('reply not answered in 540 000 ms resolves RELEASE; at 539 999 ms still pending', async () => {
  const [f, q] = mk(); const p = q.add(it('a', 'reply')); const s = settled(p);
  f.tick(539999); await Promise.resolve(); assert.equal(s(), 'pending');
  f.tick(1); assert.equal(await p, RELEASE);
});
test('clock starts at arrival: item queued behind another for 50 s still releases at 60 s', async () => {
  const [f, q] = mk(); q.add(it('a')); f.tick(50000);
  const p = q.add(it('b')); const s = settled(p);
  f.tick(10000); // a expires (t=60s); b has waited 10s
  await Promise.resolve(); assert.equal(s(), 'pending');
  f.tick(50000); assert.equal(await p, RELEASE);
  // and one added at t=0 behind nothing releases at its own 60s: covered by a
});
test('drop removes without resolving; releaseAll resolves every pending item with RELEASE', async () => {
  const [f, q] = mk(); const a = q.add(it('a')); const sa = settled(a);
  const b = q.add(it('b')); const c = q.add(it('c', 'reply'));
  q.drop('a'); await Promise.resolve(); assert.equal(sa(), 'pending');
  assert.deepEqual(q.list().map((i) => i.id), ['b', 'c']);
  q.releaseAll();
  assert.equal(await b, RELEASE); assert.equal(await c, RELEASE);
  assert.equal(q.list().length, 0); assert.equal(f.pending(), 0);
});
test("releaseSession(s, ['reply']) releases only that session's reply", async () => {
  const [, q] = mk();
  q.add(it('p1', 'permission', 's1')); const r1 = q.add(it('r1', 'reply', 's1'));
  q.add(it('r2', 'reply', 's2'));
  q.releaseSession('s1', ['reply']);
  assert.equal(await r1, RELEASE);
  assert.deepEqual(q.list().map((i) => i.id), ['p1', 'r2']);
  assert.deepEqual(q.handedBack(), []);
});
test('releaseSession without kinds releases every kind for the session', async () => {
  const [, q] = mk(); const a = q.add(it('a')); const b = q.add(it('b', 'reply')); q.add(it('c', 'permission', 's2'));
  q.releaseSession('s1');
  assert.equal(await a, RELEASE); assert.equal(await b, RELEASE);
  assert.deepEqual(q.list().map((i) => i.id), ['c']);
});
test('answer(id, RELEASE) resolves RELEASE, removes the item, and is not handed back', async () => {
  const [, q] = mk(); const p = q.add(it('a'));
  q.answer('a', RELEASE);
  assert.equal(await p, RELEASE); assert.equal(q.list().length, 0); assert.deepEqual(q.handedBack(), []);
});
test('answer/drop on unknown or resolved ids are no-ops; resolved timer never fires', async () => {
  const [f, q] = mk(); const p = q.add(it('a')); q.answer('a', { x: 1 });
  assert.equal(f.pending(), 0);
  assert.doesNotThrow(() => { q.answer('a', { y: 2 }); q.answer('zzz', {}); q.drop('a'); q.drop('zzz'); });
  f.tick(600000); assert.deepEqual(await p, { x: 1 }); assert.deepEqual(q.handedBack(), []);
});
test('clearHandedBack removes that session entries; onChange fires on changes and unsubscribes', () => {
  const [f, q] = mk(); let n = 0; const off = q.onChange(() => { n++; });
  q.add(it('a')); q.add(it('b', 'permission', 's2')); assert.equal(n, 2);
  f.tick(60000); assert.equal(q.handedBack().length, 2);
  const before = n; q.clearHandedBack('s1', null);
  assert.equal(n, before + 1); assert.deepEqual(q.handedBack().map((h) => h.sessionId), ['s2']);
  off(); q.add(it('c')); assert.equal(n, before + 1);
});

const mkE = (errs) => { const f = fake(); return [f, createQueue({ now: f.now, setTimer: f.setTimer, clearTimer: f.clearTimer, onError: (e) => errs.push(e) })]; };
test('throwing listener does not reject add and item still resolves on answer', async () => {
  const errs = []; const [, q] = mkE(errs); q.onChange(() => { throw new Error('boom'); });
  const p = q.add(it('a')); q.answer('a', { ok: 1 });
  assert.deepEqual(await p, { ok: 1 }); assert.equal(errs.length, 2);
});
test('throwing listener during timer expiry does not throw out of tick; item resolves RELEASE', async () => {
  const errs = []; const [f, q] = mkE(errs); const p = q.add(it('a'));
  q.onChange(() => { throw new Error('boom'); });
  assert.doesNotThrow(() => f.tick(60000));
  assert.equal(await p, RELEASE); assert.equal(errs.length, 1);
});
test('second listener still runs after the first throws', () => {
  const [, q] = mkE([]); let ran = 0;
  q.onChange(() => { throw new Error('boom'); }); q.onChange(() => { ran++; });
  q.add(it('a')); assert.equal(ran, 1);
});

test('R19: add stamps item.addedAt with now() at arrival', () => {
  const [f, q] = mk(); q.add(it('a')); f.tick(1234); q.add(it('b', 'reply'));
  const byId = Object.fromEntries(q.list().map((i) => [i.id, i.addedAt]));
  assert.deepEqual(byId, { a: 0, b: 1234 });
});

test("I3: a hand-back carries the item's agent_id; clearHandedBack(sessionId, agentId) clears only that agent's entries", () => {
  const [f, q] = mk();
  q.add(it('m')); q.add({ id: 's', sessionId: 's1', kind: 'permission', payload: { agent_id: 'a1' } });
  f.tick(60000);
  assert.deepEqual(q.handedBack(), [{ sessionId: 's1', agentId: null, at: 60000 }, { sessionId: 's1', agentId: 'a1', at: 60000 }]);
  q.clearHandedBack('s1', 'a1');
  assert.deepEqual(q.handedBack().map((h) => h.agentId), [null]);
  q.clearHandedBack('s1', 'a2');
  assert.deepEqual(q.handedBack().map((h) => h.agentId), [null]);
  q.clearHandedBack('s1', null);
  assert.deepEqual(q.handedBack(), []);
});

test('I2a: a reply that times out resolves RELEASE but is not recorded as a hand-back', async () => {
  const [f, q] = mk(); const p = q.add(it('r', 'reply'));
  f.tick(540000);
  assert.equal(await p, RELEASE); assert.equal(q.list().length, 0);
  assert.deepEqual(q.handedBack(), []);
});

test('plan: held for planMs, then released and recorded in handedBack', () => {
  const f = fake();
  const q = createQueue({ holdMs: 60000, replyMs: 540000, planMs: 540000, now: f.now, setTimer: f.setTimer, clearTimer: f.clearTimer });
  const s = settled(q.add(it('pl', 'plan')));
  f.tick(539999);
  assert.equal(q.list().length, 1, 'still held just before planMs');
  f.tick(1);
  assert.equal(q.list().length, 0);
  return Promise.resolve().then(() => {
    assert.equal(s(), RELEASE);
    assert.deepEqual(q.handedBack().map((h) => h.sessionId), ['s1']);
  });
});

test('plan sorts with the questions, ahead of an earlier reply', () => {
  const [, q] = mk(); q.add(it('r', 'reply')); q.add(it('pl', 'plan'));
  assert.deepEqual(q.list().map((i) => i.id), ['pl', 'r']);
});

test('expiresAt === addedAt + the hold for its kind', () => {
  const f = fake(); f.tick(1000);
  const q = createQueue({ holdMs: 111, replyMs: 222, planMs: 333, now: f.now, setTimer: f.setTimer, clearTimer: f.clearTimer });
  for (const [kind, ms] of [['permission', 111], ['choice', 111], ['reply', 222], ['plan', 333]]) {
    const item = it(kind, kind); q.add(item);
    assert.equal(item.expiresAt, item.addedAt + ms, kind);
  }
});
