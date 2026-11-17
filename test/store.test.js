import test from 'node:test'; import assert from 'node:assert/strict';
import { activityLine, createStore } from '../src/main/store.js';
import { createQueue } from '../src/main/queue.js';
import { createClassEngine } from '../src/main/classes.js';

const S = (id, o = {}) => ({ sessionId: id, pid: 1, cwd: `c:\\p\\${id}`, kind: 'interactive', entrypoint: 'claude-vscode', name: `${id}-e0`, nameSource: 'derived', status: 'idle', startedAt: 0, ...o });
const ev = (sessionId, event, at, extra = {}) => ({ sessionId, event, toolName: null, toolInput: {}, cwd: null, at, raw: {}, ...extra });
const setup = (t0 = 1000) => {
  let t = t0; const engine = createClassEngine(); const queue = createQueue({ now: () => t, setTimer: () => 0, clearTimer: () => {} });
  const store = createStore({ engine, queue, now: () => t });
  return { engine, queue, store, set: (v) => { t = v; } };
};

test('activityLine for each tool in the table', () => {
  const l = (toolName, toolInput, event = 'PreToolUse') => activityLine({ event, toolName, toolInput });
  assert.equal(l('Read', { file_path: 'c:\\a\\b\\x.js' }), 'reading x.js');
  assert.equal(l('Edit', { file_path: '/a/b/y.ts' }), 'editing y.ts');
  assert.equal(l('Write', { file_path: 'z.md' }), 'editing z.md');
  assert.equal(l('Bash', { command: 'x'.repeat(60) }), 'running ' + 'x'.repeat(40));
  assert.equal(l('PowerShell', { command: 'Get-ChildItem -Force' }), 'running Get-ChildItem -Force');
  assert.equal(l('Grep', {}), 'searching code');
  assert.equal(l('Glob', {}), 'searching code');
  assert.equal(l('WebSearch', {}), 'searching the web');
  assert.equal(l('WebFetch', { url: 'https://example.com/a/b' }), 'reading example.com');
  assert.equal(l('Agent', { subagent_type: 'Explore' }), 'sending a Explore helper');
  assert.equal(l(null, {}, 'UserPromptSubmit'), 'thinking');
  assert.equal(l('mcp__x__y', {}), 'mcp__x__y');
});

test('snapshot: permission pending for s1 -> mood needs, card permission; next names the second item', () => {
  const { queue, store } = setup();
  store.setSessions([S('s1'), S('s2')]);
  queue.add({ id: 'a', sessionId: 's1', kind: 'permission', payload: { tool_name: 'Bash' } });
  queue.add({ id: 'b', sessionId: 's2', kind: 'choice', payload: {} });
  const snap = store.snapshot();
  assert.equal(snap.agents.find((a) => a.id === 's1').mood, 'needs');
  assert.equal(snap.card.kind, 'permission');
  assert.equal(snap.card.display, 's1 · e0');
  assert.equal(snap.next, 'Next: s2 · e0 asks a question');
  assert.deepEqual(snap.counts, { total: 2, needs: 2 });
});

test('next line for a reply item', () => {
  const { queue, store } = setup();
  store.setSessions([S('s1'), S('s2')]);
  queue.add({ id: 'a', sessionId: 's1', kind: 'permission', payload: {} });
  queue.add({ id: 'b', sessionId: 's2', kind: 'reply', payload: {} });
  assert.equal(store.snapshot().next, 'Next: s2 · e0 wants a reply');
});

test('handed-back item -> handedBack true until the next event for that session', () => {
  let t = 0; const timers = [];
  const queue = createQueue({ now: () => t, setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => {} });
  const store = createStore({ engine: createClassEngine(), queue, now: () => t });
  store.setSessions([S('s1')]);
  queue.add({ id: 'a', sessionId: 's1', kind: 'permission', payload: {} });
  timers[0]();
  assert.equal(store.snapshot().agents[0].handedBack, true);
  assert.equal(store.snapshot().agents[0].mood, 'needs');
  store.onEvent(ev('s1', 'Notification', 1, { raw: { notification_type: 'idle_prompt' } }));
  assert.equal(store.snapshot().agents[0].handedBack, true);
  store.onEvent(ev('s1', 'PreToolUse', 2, { toolName: 'Read', toolInput: { file_path: 'a.js' } }));
  assert.equal(store.snapshot().agents[0].handedBack, false);
});

test('permission_prompt notification -> needs until activity', () => {
  const { store } = setup();
  store.setSessions([S('s1')]);
  store.onEvent(ev('s1', 'Notification', 1000, { raw: { notification_type: 'permission_prompt' } }));
  assert.equal(store.snapshot().agents[0].mood, 'needs');
  store.onEvent(ev('s1', 'PostToolUse', 1001));
  assert.notEqual(store.snapshot().agents[0].mood, 'needs');
});

test('activity, familiars, cls, ordering by startedAt, entrypoint and cwd', () => {
  const { store, engine } = setup();
  store.setSessions([S('b', { startedAt: 20 }), S('a', { startedAt: 10, entrypoint: 'claude-desktop' })]);
  assert.deepEqual(store.snapshot().agents.map((x) => x.id), ['a', 'b']);
  store.onEvent(ev('a', 'PreToolUse', 1000, { toolName: 'Read', toolInput: { file_path: 'q.js' } }));
  for (let i = 0; i < 5; i++) engine.push(ev('a', 'SubagentStart', 1000, { raw: { agent_id: 'x' + i } }));
  const a = store.snapshot().agents[0];
  assert.equal(a.activity, 'reading q.js');
  assert.equal(a.familiars, 3);
  assert.equal(a.cls, 'summoner');
  assert.equal(a.mood, 'working');
  assert.equal(a.entrypoint, 'claude-desktop');
  assert.equal(a.cwd, 'c:\\p\\a');
});

test('setReplyOptIn is reflected in the snapshot', () => {
  const { store } = setup();
  store.setSessions([S('s1')]);
  store.setReplyOptIn('s1', true);
  assert.equal(store.snapshot().agents[0].replyOptIn, true);
});

test('R9: Stop with a running background task does not set stoppedAt; plain Stop does', () => {
  const { store, set } = setup(1000);
  store.setSessions([S('s1')]);
  store.onEvent(ev('s1', 'PostToolUse', 1000));
  set(1010);
  store.onEvent(ev('s1', 'Stop', 1010, { raw: { background_tasks: [{ id: 'x', type: 'subagent', status: 'running' }] } }));
  assert.equal(store.snapshot().agents[0].mood, 'working');
  set(1020);
  store.onEvent(ev('s1', 'Stop', 1020, { raw: { background_tasks: [{ id: 'x', type: 'subagent', status: 'completed' }] } }));
  assert.equal(store.snapshot().agents[0].mood, 'done');
});

test('R10: synthetic task-notification prompt resumes work and keeps the previous activity line', () => {
  const { store, set } = setup(1000);
  store.setSessions([S('s1')]);
  store.onEvent(ev('s1', 'PreToolUse', 1000, { toolName: 'Grep' }));
  store.onEvent(ev('s1', 'Stop', 1010));
  set(1020);
  assert.equal(store.snapshot().agents[0].mood, 'done');
  store.onEvent(ev('s1', 'UserPromptSubmit', 1020, { raw: { prompt: '  <task-notification>x' } }));
  const a = store.snapshot().agents[0];
  assert.equal(a.mood, 'working');
  assert.equal(a.activity, 'searching code');
  store.onEvent(ev('s1', 'UserPromptSubmit', 1030, { raw: { prompt: 'hi' } }));
  assert.equal(store.snapshot().agents[0].activity, 'thinking');
});

test('R3/I8: setSessions forgets a session missing from two polls in a row and drops its state', () => {
  const { store, engine } = setup();
  const forgot = []; const orig = engine.forget; engine.forget = (id) => { forgot.push(id); orig(id); };
  store.setSessions([S('s1'), S('s2')]);
  store.onEvent(ev('s1', 'PreToolUse', 1000, { toolName: 'Grep' }));
  store.setSessions([S('s2')]);
  assert.deepEqual(forgot, []);
  store.setSessions([S('s2')]);
  assert.deepEqual(forgot, ['s1']);
  assert.deepEqual(store.snapshot().agents.map((a) => a.id), ['s2']);
  store.setSessions([S('s1'), S('s2')]);
  assert.equal(store.snapshot().agents.find((a) => a.id === 's1').activity, '');
});

test('R7: events for unknown sessions are kept but not listed; card falls back to cwd basename or unknown', () => {
  const { store, queue } = setup();
  store.setSessions([S('s1')]);
  store.onEvent(ev('zz', 'PreToolUse', 1000, { toolName: 'Grep', cwd: 'C:\\x\\proj\\' }));
  assert.deepEqual(store.snapshot().agents.map((a) => a.id), ['s1']);
  queue.add({ id: 'a', sessionId: 'zz', kind: 'permission', payload: {} });
  assert.equal(store.snapshot().card.display, 'proj');
  queue.add({ id: 'b', sessionId: 'qq', kind: 'permission', payload: {} });
  queue.answer('a', {});
  assert.equal(store.snapshot().card.display, 'unknown');
  assert.equal(store.snapshot().counts.needs, 0);
});

test('R20: next line for a queued permission reads "asks permission"', () => {
  const { queue, store } = setup();
  store.setSessions([S('s1'), S('s2')]);
  queue.add({ id: 'a', sessionId: 's1', kind: 'choice', payload: {} });
  queue.add({ id: 'b', sessionId: 's2', kind: 'permission', payload: {} });
  assert.equal(store.snapshot().next, 'Next: s2 · e0 asks permission');
});

test('R19: card carries sessionId and expiresAt = addedAt + holdMs (default 60 000 ms)', () => {
  const { queue, store, set } = setup(1000);
  store.setSessions([S('s1')]);
  queue.add({ id: 'a', sessionId: 's1', kind: 'permission', payload: {} });
  set(5000);
  const card = store.snapshot().card;
  assert.equal(card.sessionId, 's1');
  assert.equal(card.expiresAt, 61000);
});

test('R19: reply card expiresAt = addedAt + replyMs (default 540 000 ms)', () => {
  const { queue, store } = setup(2000);
  store.setSessions([S('s1')]);
  queue.add({ id: 'r', sessionId: 's1', kind: 'reply', payload: {} });
  assert.equal(store.snapshot().card.expiresAt, 542000);
});

test('R19: createStore takes holdMs and replyMs for the card deadline', () => {
  let t = 100;
  const queue = createQueue({ now: () => t, setTimer: () => 0, clearTimer: () => {} });
  const store = createStore({ engine: createClassEngine(), queue, now: () => t, holdMs: 5000, replyMs: 9000 });
  queue.add({ id: 'c', sessionId: 's1', kind: 'choice', payload: {} });
  assert.equal(store.snapshot().card.expiresAt, 5100);
  queue.answer('c', {});
  t = 200;
  queue.add({ id: 'r', sessionId: 's1', kind: 'reply', payload: {} });
  assert.equal(store.snapshot().card.expiresAt, 9200);
});

test("I3: a subagent event does not clear the main thread's hand-back; a main-thread event does", () => {
  let t = 0; const timers = [];
  const queue = createQueue({ now: () => t, setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => {} });
  const store = createStore({ engine: createClassEngine(), queue, now: () => t });
  store.setSessions([S('s1')]);
  queue.add({ id: 'a', sessionId: 's1', kind: 'permission', payload: {} });
  queue.add({ id: 'b', sessionId: 's1', kind: 'permission', payload: { agent_id: 'a1' } });
  timers[0](); timers[1]();
  store.onEvent(ev('s1', 'PreToolUse', 1, { toolName: 'Read', raw: { agent_id: 'a1', agent_type: 'Explore' } }));
  assert.deepEqual(queue.handedBack().map((h) => h.agentId), [null]);
  assert.equal(store.snapshot().agents[0].handedBack, true);
  store.onEvent(ev('s1', 'PreToolUse', 2, { toolName: 'Read' }));
  assert.deepEqual(queue.handedBack(), []);
  assert.equal(store.snapshot().agents[0].handedBack, false);
});

test('I3: subagent activity does not make a needs Notification stale; main-thread activity does', () => {
  const { store } = setup(1000);
  store.setSessions([S('s1')]);
  store.onEvent(ev('s1', 'Notification', 1000, { raw: { notification_type: 'permission_prompt' } }));
  store.onEvent(ev('s1', 'PreToolUse', 1001, { toolName: 'Read', raw: { agent_id: 'a1', agent_type: 'Explore' } }));
  store.onEvent(ev('s1', 'PostToolUse', 1002, { toolName: 'Read', raw: { agent_id: 'a1' } }));
  assert.equal(store.snapshot().agents[0].mood, 'needs');
  store.onEvent(ev('s1', 'PostToolUse', 1003, { toolName: 'Bash' }));
  assert.notEqual(store.snapshot().agents[0].mood, 'needs');
});

test('I8: a session missing from one poll (half-written file) keeps its row, data, activity and reply toggle', () => {
  const { store, engine } = setup();
  const forgot = []; const orig = engine.forget; engine.forget = (id) => { forgot.push(id); orig(id); };
  store.setSessions([S('s1', { startedAt: 5, name: 'mine' , nameSource: 'user' }), S('s2', { startedAt: 9 })]);
  store.onEvent(ev('s1', 'PreToolUse', 1000, { toolName: 'Grep' }));
  store.setReplyOptIn('s1', true);
  store.setSessions([S('s2', { startedAt: 9 })]);
  const a = store.snapshot().agents;
  assert.deepEqual(a.map((x) => x.id), ['s1', 's2']);
  assert.equal(a[0].display, 'mine');
  assert.equal(a[0].activity, 'searching code');
  assert.equal(a[0].replyOptIn, true);
  assert.deepEqual(forgot, []);
  store.setSessions([S('s1', { startedAt: 5 }), S('s2', { startedAt: 9 })]); // back: the miss count resets
  store.setSessions([S('s2', { startedAt: 9 })]);
  assert.deepEqual(forgot, []);
  assert.equal(store.snapshot().agents[0].replyOptIn, true);
  store.setSessions([S('s2', { startedAt: 9 })]);
  assert.deepEqual(forgot, ['s1']);
  assert.deepEqual(store.snapshot().agents.map((x) => x.id), ['s2']);
});

test('M3: after a reply is sent the row reads working, not finished', () => {
  const { store, set } = setup(1000);
  store.setSessions([S('s1')]);
  store.onEvent(ev('s1', 'PreToolUse', 1000, { toolName: 'Read', toolInput: { file_path: 'a.js' } }));
  set(1010);
  store.onEvent(ev('s1', 'Stop', 1010));
  set(30000);
  assert.equal(store.snapshot().agents[0].mood, 'done');
  store.replySent('s1');
  const a = store.snapshot().agents[0];
  assert.equal(a.mood, 'working');
  assert.equal(a.activity, 'thinking');
  set(30000 + 21000);
  assert.equal(store.snapshot().agents[0].mood, 'idle', 'no longer "finished" even after the working window');
});

test('M3: replySent counts as main-thread activity (a needs Notification before it goes stale)', () => {
  const { store, set } = setup(1000);
  store.setSessions([S('s1')]);
  store.onEvent(ev('s1', 'Notification', 1000, { raw: { notification_type: 'agent_needs_input' } }));
  assert.equal(store.snapshot().agents[0].mood, 'needs');
  set(1005);
  store.replySent('s1');
  assert.equal(store.snapshot().agents[0].mood, 'working');
});

test('I2b: a needs-type Notification is cleared by Stop', () => {
  const { store, set } = setup(1000);
  store.setSessions([S('s1')]);
  store.onEvent(ev('s1', 'Notification', 1000, { raw: { notification_type: 'permission_prompt' } }));
  assert.equal(store.snapshot().agents[0].mood, 'needs');
  set(1010);
  store.onEvent(ev('s1', 'Stop', 1010));
  assert.equal(store.snapshot().agents[0].mood, 'done');
});

test('I2b: a needs-type Notification is cleared by SessionEnd', () => {
  const { store } = setup(1000);
  store.setSessions([S('s1')]);
  store.onEvent(ev('s1', 'Notification', 1000, { raw: { notification_type: 'elicitation_dialog' } }));
  assert.equal(store.snapshot().agents[0].mood, 'needs');
  store.onEvent(ev('s1', 'SessionEnd', 1000, { raw: { reason: 'other' } }));
  assert.notEqual(store.snapshot().agents[0].mood, 'needs');
});

test('AgentView carries stage, stuck, stageSince, currentStepStartedAt, lastActivityAt', () => {
  const { store, set } = setup(1000);
  store.setSessions([S('s1', { status: 'busy' })]);
  store.onEvent(ev('s1', 'UserPromptSubmit', 1000, { raw: { prompt: 'do it' } }));
  let a = store.snapshot().agents[0];
  assert.equal(a.stage, 'thinking'); assert.equal(a.mood, 'working'); assert.equal(a.stuck, null);
  assert.equal(a.stageSince, 1000); assert.equal(a.currentStepStartedAt, null); assert.equal(a.lastActivityAt, 1000);
  set(2000);
  store.onEvent(ev('s1', 'PreToolUse', 2000, { toolName: 'Read', toolInput: { file_path: 'a.js' }, raw: { tool_use_id: 't1' } }));
  a = store.snapshot().agents[0];
  assert.equal(a.stage, 'working'); assert.equal(a.currentStepStartedAt, 2000); assert.equal(a.lastActivityAt, 2000);
});

test('stageSince only changes when the stage changes', () => {
  const { store, set } = setup(1000);
  store.setSessions([S('s1', { status: 'busy' })]);
  store.onEvent(ev('s1', 'UserPromptSubmit', 1000, { raw: { prompt: 'x' } }));
  assert.equal(store.snapshot().agents[0].stageSince, 1000);
  set(5000);
  assert.equal(store.snapshot().agents[0].stageSince, 1000);
  store.onEvent(ev('s1', 'PreToolUse', 5000, { toolName: 'Read', toolInput: { file_path: 'a.js' }, raw: { tool_use_id: 't1' } }));
  assert.equal(store.snapshot().agents[0].stageSince, 5000);
  set(6000);
  store.onEvent(ev('s1', 'PostToolUse', 6000, { toolName: 'Read', raw: { tool_use_id: 't1' } }));
  assert.equal(store.snapshot().agents[0].stage, 'working');
  assert.equal(store.snapshot().agents[0].stageSince, 5000);
});

test('detail(id): task/current/steps/helpers from the log; session started before the HUD -> task null, startedAt from the session file', () => {
  const { store } = setup(1000);
  store.setSessions([S('s1', { status: 'busy', startedAt: 77 }), S('s2', { startedAt: 88 })]);
  assert.equal(store.detail('nope'), null);
  const d0 = store.detail('s2');
  assert.equal(d0.task, null); assert.equal(d0.startedAt, 88);
  store.onEvent(ev('s1', 'UserPromptSubmit', 1000, { raw: { prompt: 'fix the bug' } }));
  store.onEvent(ev('s1', 'PreToolUse', 1000, { toolName: 'Read', toolInput: { file_path: 'a.js' }, raw: { tool_use_id: 't1' } }));
  store.onEvent(ev('s1', 'PostToolUse', 1000, { toolName: 'Read', raw: { tool_use_id: 't1' } }));
  store.onEvent(ev('s1', 'PreToolUse', 1000, { toolName: 'Bash', toolInput: { command: 'ls' }, raw: { tool_use_id: 't2' } }));
  store.onEvent(ev('s1', 'SubagentStart', 1000, { raw: { agent_id: 'h1', agent_type: 'Explore' } }));
  const d = store.detail('s1');
  assert.equal(d.id, 's1'); assert.equal(d.task, 'fix the bug'); assert.equal(d.startedAt, 1000);
  assert.equal(d.stepCount, 2); assert.equal(d.current.label, 'ls'); assert.equal(d.steps.length, 1);
  assert.equal(d.helpers.length, 1); assert.equal(d.stage, 'working');
  assert.equal(d.currentStepStartedAt, 1000); assert.equal(d.lastActivityAt, 1000); assert.equal(d.stageSince, 1000);
});

test('stageKey changes when a long step crosses 5 min with no new event (fake clock)', () => {
  const { store, set } = setup(1000);
  store.setSessions([S('s1', { status: 'busy' })]);
  store.onEvent(ev('s1', 'PreToolUse', 1000, { toolName: 'Bash', toolInput: { command: 'sleep' }, raw: { tool_use_id: 't1' } }));
  set(1000 + 299000);
  const k1 = store.stageKey();
  assert.equal(k1, 's1:working:');
  set(1000 + 301000);
  assert.notEqual(store.stageKey(), k1);
  assert.equal(store.stageKey(), 's1:working:long');
});

test('forgetting a session drops its step log', () => {
  const { store } = setup(1000);
  store.setSessions([S('s1')]);
  store.onEvent(ev('s1', 'UserPromptSubmit', 1000, { raw: { prompt: 'hello' } }));
  store.setSessions([]); store.setSessions([]);
  store.setSessions([S('s1')]);
  assert.equal(store.detail('s1').task, null);
});

test('I2: a stale open step on an idle session is not current: detail.current and currentStepStartedAt are null', () => {
  const { store, set } = setup(1000);
  store.setSessions([S('s1', { status: 'idle' })]);
  store.onEvent(ev('s1', 'UserPromptSubmit', 1000, { raw: { prompt: 'run the tests' } }));
  store.onEvent(ev('s1', 'PreToolUse', 1000, { toolName: 'Bash', toolInput: { command: 'npm test' }, raw: { tool_use_id: 't1' } }));
  set(1000 + 12 * 60000); // Esc-interrupted: no Post, no Stop
  const a = store.snapshot().agents[0];
  assert.equal(a.stage, 'idle');
  assert.equal(a.currentStepStartedAt, null);
  const d = store.detail('s1');
  assert.equal(d.current, null);
  assert.equal(d.currentStepStartedAt, null);
  store.setSessions([S('s1', { status: 'busy' })]);
  assert.equal(store.detail('s1').current.label, 'npm test', 'busy again: the open step is current');
  assert.equal(store.snapshot().agents[0].currentStepStartedAt, 1000);
});

test('I3a: permissionDenied closes the denied main-thread step; a helper\'s denied permission leaves main-thread steps open', () => {
  const { store, set } = setup(1000);
  store.setSessions([S('s1', { status: 'busy' })]);
  store.onEvent(ev('s1', 'PreToolUse', 1000, { toolName: 'Bash', toolInput: { command: 'rm x' }, raw: { tool_use_id: 't1' } }));
  set(2000);
  store.permissionDenied({ id: 'p', sessionId: 's1', kind: 'permission', payload: { tool_name: 'Bash', agent_id: 'h1' } });
  assert.equal(store.detail('s1').current.label, 'rm x');
  store.permissionDenied({ id: 'p', sessionId: 's1', kind: 'permission', payload: { tool_name: 'Bash' } });
  const d = store.detail('s1');
  assert.equal(d.current, null);
  assert.equal(d.steps[0].error, 'Denied');
  assert.equal(d.steps[0].endedAt, 2000);
  set(1000 + 400000);
  assert.notEqual(store.snapshot().agents[0].stuck?.reason, 'long', 'no false "Stuck? long" on a denied call');
});

test('M3: detail carries hasCard (a queued card for this session) and handedBack', () => {
  let t = 0; const timers = [];
  const queue = createQueue({ now: () => t, setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => {} });
  const store = createStore({ engine: createClassEngine(), queue, now: () => t });
  store.setSessions([S('s1'), S('s2')]);
  let d = store.detail('s1');
  assert.equal(d.hasCard, false); assert.equal(d.handedBack, false);
  queue.add({ id: 'a', sessionId: 's1', kind: 'permission', payload: {} });
  queue.add({ id: 'b', sessionId: 's2', kind: 'choice', payload: {} });
  assert.equal(store.detail('s1').hasCard, true);
  assert.equal(store.detail('s2').hasCard, true, 'queued behind another card still counts');
  timers[0]();
  d = store.detail('s1');
  assert.equal(d.hasCard, false); assert.equal(d.handedBack, true); assert.equal(d.stage, 'needs');
});

test('M6: a throwing step log never skips the hand-back clear or the v1 state updates', () => {
  let t = 0; const timers = []; const errors = [];
  const queue = createQueue({ now: () => t, setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => {} });
  const empty = { task: null, taskAt: null, stepCount: 0, current: null, steps: [], open: [], helpers: [], lastEventAt: null };
  const stepLog = { push() { throw new Error('step log broke'); }, view: () => empty, forget() {}, closeDenied() { return false; } };
  const store = createStore({ engine: createClassEngine(), queue, now: () => t, stepLog, onError: (e) => errors.push(e.message) });
  store.setSessions([S('s1')]);
  queue.add({ id: 'a', sessionId: 's1', kind: 'permission', payload: {} });
  timers[0]();
  assert.equal(store.snapshot().agents[0].handedBack, true);
  assert.doesNotThrow(() => store.onEvent(ev('s1', 'PreToolUse', 1, { toolName: 'Read', toolInput: { file_path: 'a.js' } })));
  const a = store.snapshot().agents[0];
  assert.equal(a.handedBack, false);
  assert.equal(a.activity, 'reading a.js');
  assert.deepEqual(errors, ['step log broke']);
});

test('M9: a session start of 0 is unknown: detail.startedAt null until a task is seen', () => {
  const { store } = setup(1000);
  store.setSessions([S('s1', { startedAt: 0 }), S('s2', { startedAt: null })]);
  assert.equal(store.detail('s1').startedAt, null);
  assert.equal(store.detail('s2').startedAt, null);
  store.onEvent(ev('s1', 'UserPromptSubmit', 1000, { raw: { prompt: 'go' } }));
  assert.equal(store.detail('s1').startedAt, 1000);
});

test('canOpen: agents, the card and detail say whether the session can be focused (no folder fallback)', () => {
  let t = 1000; const engine = createClassEngine(); const queue = createQueue({ now: () => t, setTimer: () => 0, clearTimer: () => {} });
  const store = createStore({ engine, queue, now: () => t, canOpen: (s) => s.entrypoint === 'claude-desktop' });
  store.setSessions([S('a', { entrypoint: 'claude-desktop' }), S('b', { entrypoint: 'cli' })]);
  queue.add({ id: 'q1', sessionId: 'b', kind: 'permission', payload: { tool_name: 'Bash', tool_input: {} } });
  const snap = store.snapshot();
  assert.equal(snap.agents.find((x) => x.id === 'a').canOpen, true);
  assert.equal(snap.agents.find((x) => x.id === 'b').canOpen, false);
  assert.equal(snap.card.canOpen, false);
  assert.equal(store.detail('a').canOpen, true);
  queue.releaseAll();
});

test('canOpen defaults to true when no predicate is given', () => {
  const { store } = setup();
  store.setSessions([S('a')]);
  assert.equal(store.snapshot().agents[0].canOpen, true);
});

test('detail.lastMessage only while stage is turn', () => {
  const { store, set } = setup(1000);
  store.setSessions([S('s1', { status: 'busy' })]);
  store.onEvent(ev('s1', 'UserPromptSubmit', 1000, { raw: { prompt: 'x' } }));
  assert.equal(store.detail('s1').lastMessage, null);
  set(2000);
  store.onEvent(ev('s1', 'Stop', 2000, { raw: { last_assistant_message: 'Finished it.' } }));
  const d = store.detail('s1');
  assert.equal(d.stage, 'turn'); assert.equal(d.lastMessage, 'Finished it.');
  set(3000);
  store.onEvent(ev('s1', 'UserPromptSubmit', 3000, { raw: { prompt: 'again' } }));
  const d2 = store.detail('s1');
  assert.notEqual(d2.stage, 'turn'); assert.equal(d2.lastMessage, null);
});

test('detail.card is the active card for that session, null for others', () => {
  const { queue, store } = setup();
  store.setSessions([S('s1'), S('s2')]);
  assert.equal(store.detail('s1').card, null);
  queue.add({ id: 'a', sessionId: 's1', kind: 'permission', payload: { tool_name: 'Bash' } });
  queue.add({ id: 'b', sessionId: 's2', kind: 'choice', payload: {} });
  const snap = store.snapshot();
  assert.deepEqual(store.detail('s1').card, snap.card);
  assert.equal(store.detail('s1').card.id, 'a');
  assert.ok('expiresAt' in store.detail('s1').card && 'canOpen' in store.detail('s1').card);
  assert.equal(store.detail('s2').card, null);
});

// 2026-11-17: the panel tells a chat that never reported (no hooks for its folder) from one that
// started before the HUD; any hook event from the session marks it connected.
test('detail.connected: false for a session known only from its session file, true after any hook event', () => {
  const { store } = setup();
  store.setSessions([S('s1'), S('s2')]);
  store.snapshot(); // computing the rows must not count as hearing from a session
  assert.equal(store.detail('s1').connected, false);
  store.onEvent(ev('s1', 'SessionStart', 1000));
  assert.equal(store.detail('s1').connected, true);
  assert.equal(store.detail('s2').connected, false);
});

// v1.3: quiet chats tuck away; a ✕ hides one until it wakes (a new turn) or asks.
test('v1.3: a session idle for an hour moves to tucked; counts cover visible rows only', () => {
  const { store, set } = setup(1000);
  store.setSessions([S('s1', { status: 'idle', statusSince: 1000 }), S('s2', { status: 'busy', statusSince: 1000 })]);
  set(1000 + 3_600_000);
  const snap = store.snapshot();
  assert.deepEqual(snap.agents.map((a) => a.id), ['s2']);
  assert.deepEqual(snap.tucked.map((a) => [a.id, a.tuck]), [['s1', 'idle']]);
  assert.equal(snap.counts.total, 1);
});

test('v1.3: a ✕-hidden working chat stays hidden through tool events; a real prompt brings it back, a task-notification does not', () => {
  const { store, set } = setup(1000);
  store.setSessions([S('s1', { status: 'busy' })]);
  store.onEvent(ev('s1', 'PreToolUse', 1000, { toolName: 'Read', toolInput: { file_path: 'a.js' } }));
  store.hide('s1');
  set(2000); store.onEvent(ev('s1', 'PreToolUse', 2000, { toolName: 'Read', toolInput: { file_path: 'b.js' } }));
  assert.equal(store.snapshot().tucked[0].tuck, 'hidden');
  set(3000); store.onEvent(ev('s1', 'UserPromptSubmit', 3000, { raw: { prompt: '<task-notification>done</task-notification>' } }));
  assert.equal(store.snapshot().tucked.length, 1);
  set(4000); store.onEvent(ev('s1', 'UserPromptSubmit', 4000, { raw: { prompt: 'next thing' } }));
  assert.deepEqual(store.snapshot().agents.map((a) => a.id), ['s1']);
});

test('v1.3: a hidden chat that asks comes back and stays back after the question goes; hide is ignored while it asks', () => {
  const { queue, store } = setup();
  store.setSessions([S('s1')]);
  store.hide('s1');
  assert.equal(store.snapshot().tucked.length, 1);
  queue.add({ id: 'a', sessionId: 's1', kind: 'permission', payload: { tool_name: 'Bash' } });
  assert.deepEqual(store.snapshot().agents.map((a) => a.id), ['s1']);
  store.hide('s1');
  assert.equal(store.snapshot().tucked.length, 0, 'no hiding a chat that is asking');
  queue.answer('a', { decision: 'allow' });
  assert.equal(store.snapshot().tucked.length, 0, 'the old hide is gone for good');
});

test('v1.3: a hidden chat without hooks wakes when its session file turns busy', () => {
  const { store, set } = setup(1000);
  store.setSessions([S('s1', { status: 'idle' })]);
  store.hide('s1');
  assert.equal(store.snapshot().tucked.length, 1);
  set(2000); store.setSessions([S('s1', { status: 'busy' })]);
  assert.deepEqual(store.snapshot().agents.map((a) => a.id), ['s1']);
});

test('v1.3: stageKey changes when a chat crosses the one-hour line with no event', () => {
  const { store, set } = setup(1000);
  store.setSessions([S('s1', { status: 'idle', statusSince: 1000 })]);
  const before = store.stageKey();
  set(1000 + 3_600_000);
  assert.notEqual(store.stageKey(), before);
});

// v1.3 final review I1: a chat with hooks wakes only on a real prompt; its file going busy (a
// <task-notification> turn, or the poll after the prompt that preceded the ✕) must not bring it back.
test('v1.3 I1: a hidden chat with hooks stays hidden when its session file turns busy', () => {
  const { store, set } = setup(1000);
  store.setSessions([S('s1', { status: 'idle' })]);
  store.onEvent(ev('s1', 'Stop', 1000));
  store.hide('s1');
  set(2000); store.setSessions([S('s1', { status: 'busy' })]);
  assert.equal(store.snapshot().tucked.length, 1, 'still hidden');
  set(3000); store.onEvent(ev('s1', 'UserPromptSubmit', 3000, { raw: { prompt: 'go on' } }));
  assert.equal(store.snapshot().tucked.length, 0, 'a real prompt still wakes it');
});

// v1.3 final review I2: "wait for my reply" must keep working for a chat that is tucked or hidden.
test('v1.3 I2: wantsReply answers for tucked and hidden chats too', () => {
  const { store } = setup(1000);
  store.setSessions([S('s1'), S('s2')]);
  store.setReplyOptIn('s1', true);
  store.hide('s1');
  assert.equal(store.snapshot().tucked[0].id, 's1');
  assert.equal(store.wantsReply('s1'), true);
  assert.equal(store.wantsReply('s2'), false);
  assert.equal(store.wantsReply('nope'), false);
});
