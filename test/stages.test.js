import test from 'node:test'; import assert from 'node:assert/strict';
import { stageOf, stuckOf } from '../src/main/stages.js';
import { fmtDuration } from '../src/renderer/format.js';

const V = (o = {}) => ({ task: null, taskAt: null, stepCount: 0, current: null, steps: [], open: [], helpers: [], lastEventAt: null, ...o });
const step = (o = {}) => ({ id: 'x', tool: 'Bash', label: 'npm test', startedAt: 0, endedAt: 1, ok: true, interrupted: false, ...o });
const fail = (o = {}) => step({ ok: false, ...o });

test('priority: needs beats everything; done -> turn; prompt with no step -> thinking; open step -> working even if mood idle; else idle', () => {
  const open = [step({ startedAt: 100, endedAt: null, ok: null })];
  assert.equal(stageOf({ mood: 'needs', view: V({ taskAt: 1, open }), now: 5 }), 'needs');
  assert.equal(stageOf({ mood: 'done', view: V({ taskAt: 1 }), now: 5 }), 'turn');
  assert.equal(stageOf({ mood: 'working', view: V({ taskAt: 10 }), now: 50 }), 'thinking');
  assert.equal(stageOf({ mood: 'working', view: V({ taskAt: 10, steps: [step({ startedAt: 10 })] }), now: 50 }), 'working');
  assert.equal(stageOf({ mood: 'idle', view: V({ taskAt: 10, open }), now: 50 }), 'working');
  assert.equal(stageOf({ mood: 'idle', view: V({ taskAt: 10, steps: [step({ startedAt: 10 })] }), now: 50 }), 'idle');
  assert.equal(stageOf({ mood: 'idle', view: V(), now: 50 }), 'idle');
});

test('repeating: 3 closed failed steps with the same label -> stuck; a success or a different label in between -> null; interrupted steps do not count', () => {
  const run = (steps) => stuckOf({ stage: 'working', view: V({ steps, lastEventAt: 0 }), status: 'idle', now: 1 });
  const r = run([fail(), fail(), fail()]);
  assert.equal(r.reason, 'repeating');
  assert.equal(r.detail, 'the same step failed 3 times in a row: npm test');
  assert.equal(run([fail(), step(), fail(), fail()]), null);
  assert.equal(run([fail(), fail({ label: 'other' }), fail()]), null);
  assert.equal(run([fail(), step({ interrupted: true, ok: null }), fail(), fail()]).reason, 'repeating');
});

test('long: open Bash step started 300001 ms ago -> stuck long; 299999 -> null', () => {
  const at = (age) => stuckOf({ stage: 'working', view: V({ open: [step({ startedAt: 1000000 - age, endedAt: null, ok: null })], lastEventAt: 1000000 }), status: 'busy', now: 1000000 });
  const r = at(300001);
  assert.equal(r.reason, 'long');
  assert.equal(r.detail, 'npm test has been running for 5 min');
  assert.equal(at(299999), null);
});

test('long exemption: open Agent step 10 min old with an active helper -> null; same with no helper -> stuck', () => {
  const open = [step({ tool: 'Agent', label: 'Sent a Explore helper', startedAt: 0, endedAt: null, ok: null })];
  const now = 600000;
  const withHelper = V({ open, helpers: [{ agentId: 'a', agentType: 'Explore', doing: null }], lastEventAt: now });
  assert.equal(stuckOf({ stage: 'working', view: withHelper, status: 'busy', now }), null);
  const none = V({ open, lastEventAt: now });
  assert.equal(stuckOf({ stage: 'working', view: none, status: 'busy', now }).reason, 'long');
});

test('silent: status busy, no event for 180001 ms, no open steps, no helpers -> stuck silent; with an active helper -> null', () => {
  const now = 1000000;
  const v = V({ lastEventAt: now - 180001 });
  const r = stuckOf({ stage: 'working', view: v, status: 'busy', now });
  assert.equal(r.reason, 'silent');
  assert.equal(r.detail, 'no activity for 3 min');
  assert.equal(stuckOf({ stage: 'working', view: V({ lastEventAt: now - 180000 }), status: 'busy', now }), null);
  assert.equal(stuckOf({ stage: 'working', view: V({ lastEventAt: now - 180001, helpers: [{ agentId: 'a' }] }), status: 'busy', now }), null);
});

test('stuck is null for needs, turn and idle', () => {
  const view = V({ steps: [fail(), fail(), fail()], open: [step({ startedAt: 0, endedAt: null })], lastEventAt: 0 });
  for (const stage of ['needs', 'turn', 'idle']) assert.equal(stuckOf({ stage, view, status: 'busy', now: 9e6 }), null);
});

test('fmtDuration', () => {
  assert.equal(fmtDuration(45000), '45s');
  assert.equal(fmtDuration(720000), '12m');
  assert.equal(fmtDuration(7200000), '2h');
  assert.equal(fmtDuration(-5), '0s');
  assert.equal(fmtDuration(NaN), '0s');
});
