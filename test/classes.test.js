import test from 'node:test'; import assert from 'node:assert/strict';
import { CLASS_IDS, signalsFromEvent, createClassEngine, moodOf } from '../src/main/classes.js';

const ev = (tool, input, at, event = 'PreToolUse', extra = {}) =>
  ({ sessionId: 's', event, toolName: tool, toolInput: input, at, ...extra });
const cls = (e) => signalsFromEvent(e).map((s) => s.cls);

test('CLASS_IDS has the twelve ids', () => assert.equal(CLASS_IDS.length, 12));

test('signals: Read -> pathfinder, Edit .ts -> runesmith, Edit README.md -> loremaster, Write roads.geojson -> cartographer', () => {
  assert.deepEqual(signalsFromEvent(ev('Read', { file_path: 'a.js' }, 0)), [{ cls: 'pathfinder', weight: 1 }]);
  assert.deepEqual(cls(ev('Edit', { file_path: 'src/a.ts' }, 0)), ['runesmith']);
  assert.deepEqual(cls(ev('Edit', { file_path: 'README.md' }, 0)), ['loremaster']);
  assert.deepEqual(cls(ev('Write', { file_path: 'roads.geojson' }, 0)), ['cartographer']);
  assert.deepEqual(cls(ev('ExitPlanMode', {}, 0)), ['star-reader']);
  assert.deepEqual(cls(ev('mcp__azure-devops__repo_pull_request', {}, 0)), ['herald']);
});

test('signals: Bash "npm test" -> alchemist, "git push origin main" -> herald, "psql -f m.sql" -> vaultkeeper', () => {
  assert.deepEqual(cls(ev('Bash', { command: 'npm test' }, 0)), ['alchemist']);
  assert.deepEqual(cls(ev('Bash', { command: 'git push origin main' }, 0)), ['herald']);
  assert.deepEqual(cls(ev('Bash', { command: 'psql -f m.sql' }, 0)), ['vaultkeeper']);
  assert.deepEqual(cls(ev('Bash', { command: 'cat x.sql' }, 0)), ['vaultkeeper']);
  assert.deepEqual(cls(ev('Bash', { command: 'ls' }, 0)), []);
});

test('M1: PowerShell commands signal exactly like Bash', () => {
  assert.deepEqual(cls(ev('PowerShell', { command: 'npm test' }, 0)), ['alchemist']);
  assert.deepEqual(cls(ev('PowerShell', { command: 'git push origin main' }, 0)), ['herald']);
  assert.deepEqual(cls(ev('PowerShell', { command: 'psql -f m.sql' }, 0)), ['vaultkeeper']);
  assert.deepEqual(cls(ev('PowerShell', { command: 'Get-ChildItem -Force' }, 0)), []);
});

test('signals: PostToolUseFailure -> hexbreaker; Agent subagent_type Explore -> pathfinder weight 3', () => {
  assert.deepEqual(signalsFromEvent(ev('Bash', { command: 'x' }, 0, 'PostToolUseFailure')), [{ cls: 'hexbreaker', weight: 1 }]);
  assert.deepEqual(signalsFromEvent(ev('Agent', { subagent_type: 'Explore' }, 0)), [{ cls: 'pathfinder', weight: 3 }]);
  assert.deepEqual(signalsFromEvent(ev('Agent', { subagent_type: 'Plan' }, 0)), [{ cls: 'star-reader', weight: 3 }]);
  assert.deepEqual(signalsFromEvent(ev('Agent', { subagent_type: 'whatever' }, 0)), []);
});

test('signals: tool event inside a mapped subagent emits that class at weight 1 instead of the tool class', () => {
  const e = ev('Read', { file_path: 'a.js' }, 0, 'PreToolUse', { raw: { agent_id: 'a1', agent_type: 'change-reviewer' } });
  assert.deepEqual(signalsFromEvent(e), [{ cls: 'arbiter', weight: 1 }]);
  const u = ev('Read', { file_path: 'a.js' }, 0, 'PreToolUse', { raw: { agent_id: 'a1', agent_type: 'unknown-type' } });
  assert.deepEqual(signalsFromEvent(u), [{ cls: 'pathfinder', weight: 1 }]);
});

const edits = (e) => { for (let t = 0; t <= 60000; t += 5000) e.push(ev('Edit', { file_path: 'a.ts' }, t)); };

test('sticky: edits every 5 s for 60 s -> runesmith', () => {
  const e = createClassEngine(); edits(e);
  assert.equal(e.classOf('s', 60000), 'runesmith');
});

test('sticky: unknown session starts as pathfinder', () => assert.equal(createClassEngine().classOf('zz', 0), 'pathfinder'));

test('sticky: two Reads at 62 s and 64 s -> still runesmith at 65000', () => {
  const e = createClassEngine(); edits(e);
  e.push(ev('Read', {}, 62000)); e.push(ev('Read', {}, 64000));
  assert.equal(e.classOf('s', 65000), 'runesmith');
});

test('sticky: Bash "npm test" every 10 s from 70 s to 200 s -> alchemist at 200000', () => {
  const e = createClassEngine(); edits(e);
  e.push(ev('Read', {}, 62000)); e.push(ev('Read', {}, 64000));
  for (let t = 70000; t <= 200000; t += 10000) e.push(ev('Bash', { command: 'npm test' }, t));
  assert.equal(e.classOf('s', 200000), 'alchemist');
});

test('summoner: two SubagentStart without stops -> summoner; after one SubagentStop -> scored class', () => {
  const e = createClassEngine(); edits(e);
  e.push({ sessionId: 's', event: 'SubagentStart', at: 61000, raw: { agent_id: 'a1', agent_type: 'Explore' } });
  e.push({ sessionId: 's', event: 'SubagentStart', at: 61500, raw: { agent_id: 'a2', agent_type: 'Explore' } });
  assert.equal(e.activeSubagents('s'), 2);
  assert.equal(e.classOf('s', 62000), 'summoner');
  e.push({ sessionId: 's', event: 'SubagentStop', at: 63000, raw: { agent_id: 'a1' } });
  assert.equal(e.activeSubagents('s'), 1);
  assert.equal(e.classOf('s', 64000), 'runesmith');
});

test('summoner: set semantics ignore duplicate starts; missing agent_id falls back to counting', () => {
  const e = createClassEngine();
  e.push({ sessionId: 's', event: 'SubagentStart', at: 1, raw: { agent_id: 'a1' } });
  e.push({ sessionId: 's', event: 'SubagentStart', at: 2, raw: { agent_id: 'a1' } });
  assert.equal(e.activeSubagents('s'), 1);
  e.push({ sessionId: 's', event: 'SubagentStart', at: 3 });
  assert.equal(e.activeSubagents('s'), 2);
  e.push({ sessionId: 's', event: 'SubagentStop', at: 4 });
  assert.equal(e.activeSubagents('s'), 1);
});

test('mood: priorities', () => {
  assert.equal(moodOf({ pending: true, stoppedAt: 5, lastActivityAt: 1 }, 10), 'needs');
  assert.equal(moodOf({ pending: false, stoppedAt: 5000, lastActivityAt: 1000 }, 6000), 'done');
  assert.equal(moodOf({ pending: false, lastActivityAt: 85000 }, 100000), 'working');
  assert.equal(moodOf({ pending: false, lastActivityAt: 75000, status: 'idle' }, 100000), 'idle');
  assert.equal(moodOf({ pending: false, lastActivityAt: 75000, status: 'busy' }, 100000), 'working');
});

test('bash: quoted keywords and precedence', () => {
  assert.deepEqual(cls(ev('Bash', { command: 'git commit -m "fix test"' }, 0)), ['herald']);
  assert.deepEqual(cls(ev('Bash', { command: 'gh pr create --title "add build step"' }, 0)), ['herald']);
  assert.deepEqual(cls(ev('Bash', { command: 'git push && npm test' }, 0)), ['herald']);
  assert.deepEqual(cls(ev('Bash', { command: 'npm test' }, 0)), ['alchemist']);
  assert.deepEqual(cls(ev('Bash', { command: 'psql -f m.sql' }, 0)), ['vaultkeeper']);
});

test('expiry: forget and SessionEnd drop session state', () => {
  const sub = (id, at) => ({ sessionId: 's', event: 'SubagentStart', at, raw: { agent_id: id } });
  for (const drop of [(e) => e.forget('s'), (e) => e.push({ sessionId: 's', event: 'SessionEnd', at: 5 })]) {
    const e = createClassEngine(); edits(e); e.push(sub('a1', 1)); e.push(sub('a2', 2));
    assert.equal(e.classOf('s', 60000), 'summoner');
    drop(e);
    assert.equal(e.activeSubagents('s'), 0);
    assert.equal(e.classOf('s', 60000), 'pathfinder');
  }
});

test('expiry: Stop reconciles active subagents to running background_tasks', () => {
  const e = createClassEngine();
  for (const id of ['a1', 'a2', 'a3']) e.push({ sessionId: 's', event: 'SubagentStart', at: 1, raw: { agent_id: id } });
  e.push({ sessionId: 's', event: 'Stop', at: 2, raw: { background_tasks: [
    { id: 'a3', type: 'subagent', status: 'running' }, { id: 'a2', type: 'subagent', status: 'done' }, { id: 'x', type: 'shell', status: 'running' }] } });
  assert.equal(e.activeSubagents('s'), 1);
  e.push({ sessionId: 's', event: 'Stop', at: 3, raw: {} });
  assert.equal(e.activeSubagents('s'), 1);
  e.push({ sessionId: 's', event: 'Stop', at: 4, raw: { background_tasks: [] } });
  assert.equal(e.activeSubagents('s'), 0);
});

const burst = (e, cmd, from, n) => { for (let i = 0; i < n; i++) e.push(ev('Bash', { command: cmd }, from + i * 100)); };

test('sticky: >1.5x lead for less than holdMs stays, then switches', () => {
  const e = createClassEngine(); edits(e); burst(e, 'npm test', 61000, 20);
  assert.equal(e.classOf('s', 65000), 'runesmith');
  assert.equal(e.classOf('s', 73000), 'alchemist');
});

test('sticky: top above current but below 1.5x never switches', () => {
  const e = createClassEngine(); edits(e); burst(e, 'npm test', 61000, 15);
  assert.equal(e.classOf('s', 100000), 'runesmith');
});

test('sticky: hold resets when the top scorer changes', () => {
  const e = createClassEngine(); edits(e); burst(e, 'npm test', 61000, 20); burst(e, 'psql -f m.sql', 63000, 25);
  assert.equal(e.classOf('s', 73000), 'runesmith');
  assert.equal(e.classOf('s', 76000), 'vaultkeeper');
});

test('sticky: old signals fall out of the window', () => {
  const e = createClassEngine(); edits(e);
  for (const t of [190000, 191000, 192000]) e.push(ev('Read', {}, t));
  assert.equal(e.classOf('s', 192000), 'runesmith');
  assert.equal(e.classOf('s', 201000), 'pathfinder');
});
