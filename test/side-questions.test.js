import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSideLog } from '../src/main/side-log.js';
import { createSideQuestions } from '../src/main/side-questions.js';
import { SIDE_ERRORS } from '../src/main/side-ask.js';

const ID = 'af479eec-aaaa';
const ID2 = 'bf479eec-bbbb';
const tick = () => new Promise((r) => setImmediate(r));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const mkLog = (extra = {}) => createSideLog({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'sq-')), ...extra });

test('one ask per chat; blank and invalid ignored; the answer is logged with the plain question', async () => {
  const log = mkLog();
  const d = deferred(); const asks = [];
  const sq = createSideQuestions({ log, ask: (o) => { asks.push(o); return d.promise; }, now: () => 1000 });
  assert.equal(sq.start(ID, '   ', {}), false);
  assert.equal(sq.start('bad/id', 'q', {}), false);
  assert.equal(sq.start(ID, ' why? ', { cwd: 'c:\\p', model: 'm', current: { doing: 'running x', startedAt: 0 } }), true);
  assert.equal(sq.start(ID, 'again', {}), false);
  assert.match(asks[0].question, /^why\?\n\n\(Agent HUD note: this chat is still working right now\. Current step: running x, for 1s\./);
  assert.deepEqual(sq.asking(ID), { question: 'why?', at: 1000 });
  d.resolve({ answer: 'because' }); await tick();
  assert.equal(sq.asking(ID), null);
  assert.deepEqual(log.list(ID).map((e) => [e.source, e.question, e.response]), [['hud', 'why?', 'because']]);
});

test('busy note between steps: ctx.working without a step adds the short note; nothing when not working', () => {
  const asks = [];
  const sq = createSideQuestions({ log: mkLog(), ask: (o) => { asks.push(o); return new Promise(() => {}); }, now: () => 1000 });
  sq.start(ID, 'q1', { working: true, current: null });
  sq.start(ID2, 'q2', { working: false, current: null });
  assert.equal(asks[0].question, 'q1\n\n(Agent HUD note: this chat is still working right now. Anything unfinished in the conversation is still running, not interrupted.)');
  assert.equal(asks[1].question, 'q2');
});

test('dot: set when not viewing, not when viewing; viewing clears it; VS Code imports never set it', async () => {
  const log = mkLog();
  const ds = [deferred(), deferred()]; let i = 0;
  let changes = 0;
  const sq = createSideQuestions({ log, ask: () => ds[i++].promise, onChange: () => { changes++; } });
  sq.start(ID, 'q1', {});
  ds[0].resolve({ answer: 'a1' }); await tick();
  assert.equal(sq.dot(ID), true);
  sq.setViewing(ID);
  assert.equal(sq.dot(ID), false);
  sq.start(ID, 'q2', {});
  ds[1].resolve({ answer: 'a2' }); await tick();
  assert.equal(sq.dot(ID), false, 'no dot while viewing that chat');
  sq.setViewing(null);
  const before = changes;
  sq.importVscode([{ sessionId: ID2, question: 'vq', response: 'vr', updatedAt: 5 }]);
  assert.equal(sq.dot(ID2), false);
  assert.ok(changes > before, 'import that changed something calls onChange');
  assert.equal(log.count(ID2), 1);
});

test('history from the log goes with the ask', async () => {
  const log = mkLog();
  log.add(ID, { source: 'hud', question: 'q1', response: 'r1' });
  log.add(ID, { source: 'vscode', question: 'q2', response: 'r2' });
  const asks = [];
  const sq = createSideQuestions({ log, ask: (o) => { asks.push(o); return new Promise(() => {}); } });
  sq.start(ID, 'q3', {});
  assert.deepEqual(asks[0].history, [{ question: 'q1', response: 'r1' }, { question: 'q2', response: 'r2' }]);
});

test('retry removes the error entry and asks its question again', async () => {
  const log = mkLog();
  const results = [{ error: SIDE_ERRORS.timeout, detail: 'raw reason' }, { answer: 'second time' }];
  const asks = []; const errors = [];
  const sq = createSideQuestions({ log, ask: (o) => { asks.push(o); return Promise.resolve(results.shift()); }, onError: (m) => errors.push(m) });
  sq.start(ID, 'hard one', {}); await tick();
  const [failed] = log.list(ID);
  assert.equal(failed.error, SIDE_ERRORS.timeout);
  assert.equal(failed.response, null);
  assert.deepEqual(errors, [`side question ${ID}: raw reason`]);
  assert.equal(sq.retry(ID, 'nope', {}), false);
  assert.equal(sq.retry(ID, failed.id, {}), true);
  assert.equal(log.list(ID).length, 0, 'the error entry is gone while the retry runs');
  await tick();
  assert.equal(asks[1].question, 'hard one');
  assert.deepEqual(log.list(ID).map((e) => [e.question, e.response, e.error]), [['hard one', 'second time', undefined]]);
  assert.equal(sq.retry(ID, log.list(ID)[0].id, {}), false, 'an answered entry has no error to retry');
});

test('requestFocus switches to the side tab and stamps focusAsk', () => {
  let t = 10;
  const sq = createSideQuestions({ log: mkLog(), ask: () => new Promise(() => {}), now: () => t });
  assert.equal(sq.tab(ID), 'now');
  assert.equal(sq.view(ID).focusAsk, null);
  sq.requestFocus(ID);
  assert.equal(sq.tab(ID), 'side');
  assert.equal(sq.view(ID).focusAsk, 10);
  t = 20;
  sq.requestFocus(ID);
  assert.equal(sq.view(ID).focusAsk, 20);
  assert.equal(sq.tab(ID2), 'now');
  assert.equal(sq.view(ID2).focusAsk, null);
  sq.setTab(ID, 'whatever');
  assert.equal(sq.tab(ID), 'now');
  sq.setTab(ID, 'side');
  assert.equal(sq.tab(ID), 'side');
});

test('view: newest 50, oldest first, with tab, count, dot, asking, healthy', () => {
  const log = mkLog();
  for (let n = 0; n < 55; n++) log.add(ID, { source: 'hud', question: `q${n}`, response: `r${n}` });
  const sq = createSideQuestions({ log, ask: () => new Promise(() => {}), now: () => 7 });
  const v = sq.view(ID);
  assert.equal(v.entries.length, 50);
  assert.equal(v.entries[0].question, 'q5');
  assert.equal(v.entries[49].question, 'q54');
  assert.equal(v.count, 55);
  assert.equal(v.tab, 'now');
  assert.equal(v.dot, false);
  assert.equal(v.asking, null);
  assert.equal(v.healthy, true);
  sq.setHealthy(false);
  assert.equal(sq.view(ID).healthy, false);
  sq.start(ID, 'pending', {});
  assert.deepEqual(sq.view(ID).asking, { question: 'pending', at: 7 });
});

test('the chat ending mid-ask still logs the answer and does not throw', async () => {
  const log = mkLog();
  const d = deferred();
  const sq = createSideQuestions({ log, ask: () => d.promise });
  sq.start(ID, 'q', {});
  d.resolve({ answer: 'late' });
  await assert.doesNotReject(tick());
  assert.deepEqual(log.list(ID).map((e) => e.response), ['late']);
});

test('stopAll aborts in-flight asks (signal aborted), and a late settle adds nothing', async () => {
  const log = mkLog();
  const d = deferred(); const asks = [];
  const sq = createSideQuestions({ log, ask: (o) => { asks.push(o); return d.promise; } });
  sq.start(ID, 'q', {});
  assert.equal(asks[0].signal.aborted, false);
  sq.stopAll();
  assert.equal(asks[0].signal.aborted, true);
  d.resolve({ error: SIDE_ERRORS.refused }); await tick();
  assert.equal(log.count(ID), 0);
  assert.equal(sq.dot(ID), false);
});

test('stopAll resolves once every aborted ask settled (its child gone), and no later', async () => {
  const d = deferred();
  const sq = createSideQuestions({ log: mkLog(), ask: () => d.promise });
  sq.start(ID, 'q', {});
  let stopped = false;
  const p = sq.stopAll(5000).then(() => { stopped = true; });
  await tick(); await tick();
  assert.equal(stopped, false, 'waits for the ask to settle');
  d.resolve({ error: 'cancelled' });
  await p;
  assert.equal(stopped, true);
  await sq.stopAll(); // nothing in flight: resolves at once
});

test('stopAll is bounded: an ask that never settles does not hold it past maxMs', async () => {
  const sq = createSideQuestions({ log: mkLog(), ask: () => new Promise(() => {}) });
  sq.start(ID, 'q', {});
  const t0 = Date.now();
  await sq.stopAll(50);
  assert.ok(Date.now() - t0 < 1000);
});

test('a rejected or throwing ask is a refused entry; disk errors never throw out', async () => {
  const log = mkLog();
  const sq = createSideQuestions({ log, ask: () => Promise.reject(new Error('x')) });
  sq.start(ID, 'q', {}); await tick();
  assert.equal(log.list(ID)[0].error, SIDE_ERRORS.refused);

  const sq2 = createSideQuestions({ log, ask: () => { throw new Error('sync'); } });
  assert.equal(sq2.start(ID2, 'q', {}), true); await tick();
  assert.equal(log.list(ID2)[0].error, SIDE_ERRORS.refused);

  const errs = [];
  const bad = { validId: () => true, history: () => [], list: () => [], count: () => 0, add: () => { throw new Error('disk'); }, importVscode: () => { throw new Error('disk'); }, remove: () => { throw new Error('disk'); } };
  const sq3 = createSideQuestions({ log: bad, ask: () => Promise.resolve({ answer: 'a' }), onError: (m) => errs.push(m) });
  sq3.start(ID, 'q', {}); await tick();
  assert.equal(sq3.asking(ID), null);
  assert.deepEqual(sq3.importVscode([{ sessionId: ID }]), []);
  assert.ok(errs.length >= 2);
});
