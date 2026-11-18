import test from 'node:test'; import assert from 'node:assert/strict';
import { createPlanNotices } from '../src/main/plans.js';

const ev = (event, extra = {}, raw = {}) => ({ sessionId: 's1', event, toolName: null, toolInput: {}, source: 'claude', at: 100, raw, ...extra });
const plan = (event = 'PreToolUse', input = { plan: '# Do it\n## Step one', planFilePath: 'C:\\Users\\u\\.claude\\plans\\p.md' }, raw = {}, extra = {}) =>
  ev(event, { toolName: 'ExitPlanMode', toolInput: input, ...extra }, { tool_name: 'ExitPlanMode', tool_input: input, ...raw });

test('plans: a main-thread ExitPlanMode on PreToolUse sets a notice with plan, planFilePath, at', () => {
  const p = createPlanNotices();
  p.onEvent(plan('PreToolUse', undefined, {}, { at: 123 }));
  assert.deepEqual(p.get('s1'), { id: 'plan:s1:1', sessionId: 's1', plan: '# Do it\n## Step one', planFilePath: 'C:\\Users\\u\\.claude\\plans\\p.md', at: 123 });
  assert.deepEqual(p.list().map((n) => n.id), ['plan:s1:1']);
  assert.equal(p.get('nope'), null);
});

test('plans: PermissionRequest sets one too', () => {
  const p = createPlanNotices();
  p.onEvent(plan('PermissionRequest'));
  assert.equal(p.get('s1').id, 'plan:s1:1');
});

test('plans: the id is kept from PreToolUse to PermissionRequest; the plan text updates', () => {
  const p = createPlanNotices();
  p.onEvent(plan('PreToolUse', { plan: 'a' }));
  p.onEvent(plan('PermissionRequest', { plan: 'b', planFilePath: 'x.md' }, {}, { at: 200 }));
  const n = p.get('s1');
  assert.equal(n.id, 'plan:s1:1'); assert.equal(n.plan, 'b'); assert.equal(n.planFilePath, 'x.md'); assert.equal(n.at, 200);
  assert.equal(p.list().length, 1);
});

test('plans: a new plan after a clear gets a new id from the counter', () => {
  const p = createPlanNotices();
  p.onEvent(plan());
  p.onEvent(ev('Stop'));
  p.onEvent(plan());
  assert.equal(p.get('s1').id, 'plan:s1:2');
});

test('plans: the counter is per tracker', () => {
  const a = createPlanNotices(); const b = createPlanNotices();
  a.onEvent(plan()); b.onEvent(plan());
  assert.equal(a.get('s1').id, 'plan:s1:1'); assert.equal(b.get('s1').id, 'plan:s1:1');
});

test('plans: a subagent ExitPlanMode (agent_id) never sets one, on either event', () => {
  const p = createPlanNotices();
  for (const e of ['PreToolUse', 'PermissionRequest']) p.onEvent(plan(e, undefined, { agent_id: 'sub' }));
  assert.equal(p.get('s1'), null); assert.deepEqual(p.list(), []);
});

test('plans: Codex events never set one', () => {
  const p = createPlanNotices();
  for (const e of ['PreToolUse', 'PermissionRequest']) p.onEvent(plan(e, undefined, {}, { source: 'codex' }));
  assert.equal(p.get('s1'), null);
});

test('plans: tool name read from raw when toolName is missing; missing input fields become empty', () => {
  const p = createPlanNotices();
  p.onEvent({ sessionId: 's1', event: 'PreToolUse', source: 'claude', at: 1, raw: { tool_name: 'ExitPlanMode' } });
  assert.deepEqual(p.get('s1'), { id: 'plan:s1:1', sessionId: 's1', plan: '', planFilePath: null, at: 1 });
});

const clears = [
  ['PostToolUse for ExitPlanMode', ev('PostToolUse', { toolName: 'ExitPlanMode' })],
  ['PostToolUseFailure for ExitPlanMode', ev('PostToolUseFailure', { toolName: 'ExitPlanMode' })],
  ['a real UserPromptSubmit', ev('UserPromptSubmit', {}, { prompt: 'go' })],
  ['Stop', ev('Stop')],
  ['Stop with background tasks running', ev('Stop', {}, { background_tasks: [{ status: 'running' }] })],
  ['SessionEnd', ev('SessionEnd')],
  ['another main-thread PreToolUse', ev('PreToolUse', { toolName: 'Read' })],
];
for (const [name, e] of clears) {
  test(`plans: ${name} clears the notice`, () => {
    const p = createPlanNotices();
    p.onEvent(plan());
    p.onEvent(e);
    assert.equal(p.get('s1'), null); assert.deepEqual(p.list(), []);
  });
}

const keeps = [
  ['a synthetic <task-notification> prompt', ev('UserPromptSubmit', {}, { prompt: '  <task-notification> done' })],
  ['a subagent PreToolUse', ev('PreToolUse', { toolName: 'Read' }, { agent_id: 'sub' })],
  ['a subagent PostToolUse for ExitPlanMode', ev('PostToolUse', { toolName: 'ExitPlanMode' }, { agent_id: 'sub' })],
  ['a PostToolUse for another tool', ev('PostToolUse', { toolName: 'Read' })],
  ['a Notification', ev('Notification', {}, { notification_type: 'permission_prompt' })],
  ['another session\'s Stop', ev('Stop', { sessionId: 's2' })],
  ['a Codex Stop', ev('Stop', { source: 'codex' })],
];
for (const [name, e] of keeps) {
  test(`plans: ${name} keeps the notice`, () => {
    const p = createPlanNotices();
    p.onEvent(plan());
    p.onEvent(e);
    assert.equal(p.get('s1')?.id, 'plan:s1:1');
  });
}

test('plans: forget drops the session\'s notice; list keeps arrival order', () => {
  const p = createPlanNotices();
  p.onEvent(plan());
  p.onEvent(plan('PreToolUse', undefined, {}, { sessionId: 's2' }));
  assert.deepEqual(p.list().map((n) => n.sessionId), ['s1', 's2']);
  p.forget('s1');
  assert.deepEqual(p.list().map((n) => n.sessionId), ['s2']);
  p.forget('nope');
});

test('plans: list and get hand out copies', () => {
  const p = createPlanNotices();
  p.onEvent(plan());
  p.list()[0].plan = 'x'; p.get('s1').id = 'y';
  assert.equal(p.get('s1').plan, '# Do it\n## Step one'); assert.equal(p.get('s1').id, 'plan:s1:1');
});

test('plans: odd events never throw', () => {
  const p = createPlanNotices();
  for (const e of [null, undefined, {}, { event: 'PreToolUse' }, { sessionId: 's1', event: 'PreToolUse', toolName: 'ExitPlanMode', toolInput: null, raw: null }]) p.onEvent(e);
  assert.equal(p.get('s1')?.plan, '');
});
