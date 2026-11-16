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

test('R3: setSessions forgets sessions that disappeared and drops their state', () => {
  const { store, engine } = setup();
  const forgot = []; const orig = engine.forget; engine.forget = (id) => { forgot.push(id); orig(id); };
  store.setSessions([S('s1'), S('s2')]);
  store.onEvent(ev('s1', 'PreToolUse', 1000, { toolName: 'Grep' }));
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
