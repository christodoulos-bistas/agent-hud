import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStepLog, stepLabel } from '../src/main/steps.js';

const ev = (event, at, { tool, input, raw } = {}) => ({
  sessionId: 's1', event, toolName: tool, toolInput: input, cwd: 'C:\\p', at, raw: { ...(raw || {}) },
});

test('Pre then Post with the same tool_use_id gives one closed ok step', () => {
  const l = createStepLog();
  const input = { file_path: 'C:\\a\\updater.js', description: 'fix the thing' };
  l.push(ev('PreToolUse', 1, { tool: 'Edit', input, raw: { tool_use_id: 't1', tool_input: input } }));
  assert.equal(l.view('s1').current.label, 'Edited updater.js');
  l.push(ev('PostToolUse', 2, { tool: 'Edit', input, raw: { tool_use_id: 't1' } }));
  const v = l.view('s1');
  assert.equal(v.steps.length, 1);
  assert.equal(v.open.length, 0);
  assert.equal(v.current, null);
  assert.equal(v.steps[0].ok, true);
  assert.equal(v.steps[0].label, 'Edited updater.js');
  assert.equal(v.steps[0].why, 'fix the thing');
  assert.equal(v.steps[0].doing, 'editing updater.js');
  assert.equal(v.steps[0].endedAt, 2);
  assert.equal(v.stepCount, 1);
});

test('Post without tool_use_id closes oldest open of same tool; unmatched Post ignored', () => {
  const l = createStepLog();
  l.push(ev('PreToolUse', 1, { tool: 'Bash', input: { command: 'a' } }));
  l.push(ev('PreToolUse', 2, { tool: 'Bash', input: { command: 'b' } }));
  l.push(ev('PostToolUse', 3, { tool: 'Bash' }));
  let v = l.view('s1');
  assert.equal(v.steps[0].label, 'a');
  assert.equal(v.open.length, 1);
  assert.equal(v.current.label, 'b');
  l.push(ev('PostToolUse', 4, { tool: 'Read', raw: { tool_use_id: 'zzz' } }));
  v = l.view('s1');
  assert.equal(v.steps.length, 1);
  assert.equal(v.open.length, 1);
});

test('PostToolUseFailure gives ok false with collapsed, capped stderr', () => {
  const l = createStepLog();
  l.push(ev('PreToolUse', 1, { tool: 'Bash', input: { command: 'x' }, raw: { tool_use_id: 't1' } }));
  const stderr = 'line one\n\n   line   two ' + 'z'.repeat(400);
  l.push(ev('PostToolUseFailure', 2, { tool: 'Bash', raw: { tool_use_id: 't1', tool_response: { stderr } } }));
  const s = l.view('s1').steps[0];
  assert.equal(s.ok, false);
  assert.equal(s.error.length, 300);
  assert.ok(s.error.startsWith('line one line two zzz'));
});

test('error candidates are tried in order', () => {
  const l = createStepLog();
  l.push(ev('PreToolUse', 1, { tool: 'Bash', raw: { tool_use_id: 'a' } }));
  l.push(ev('PostToolUseFailure', 2, { tool: 'Bash', raw: { tool_use_id: 'a', error: 'top', tool_response: { stderr: 'low' } } }));
  l.push(ev('PreToolUse', 3, { tool: 'Bash', raw: { tool_use_id: 'b' } }));
  l.push(ev('PostToolUseFailure', 4, { tool: 'Bash', raw: { tool_use_id: 'b', tool_response: { stderr: '  ', message: 'msg' } } }));
  l.push(ev('PreToolUse', 5, { tool: 'Bash', raw: { tool_use_id: 'c' } }));
  l.push(ev('PostToolUseFailure', 6, { tool: 'Bash', raw: { tool_use_id: 'c', tool_response: 'plain' } }));
  const [c, b, a] = l.view('s1').steps;
  assert.equal(a.error, 'top');
  assert.equal(b.error, 'msg');
  assert.equal(c.error, 'plain');
});

test('non-synthetic UserPromptSubmit sets task, resets stepCount, interrupts open steps', () => {
  const l = createStepLog();
  l.push(ev('PreToolUse', 1, { tool: 'Read', input: { file_path: 'a.js' } }));
  assert.equal(l.view('s1').stepCount, 1);
  l.push(ev('UserPromptSubmit', 5, { raw: { prompt: '  do   the thing ' } }));
  const v = l.view('s1');
  assert.equal(v.task, 'do the thing');
  assert.equal(v.taskAt, 5);
  assert.equal(v.stepCount, 0);
  assert.equal(v.open.length, 0);
  assert.equal(v.steps[0].ok, null);
  assert.equal(v.steps[0].interrupted, true);
  assert.equal(v.steps[0].endedAt, 5);
});

test('synthetic task-notification prompt changes nothing', () => {
  const l = createStepLog();
  l.push(ev('UserPromptSubmit', 1, { raw: { prompt: 'real' } }));
  l.push(ev('PreToolUse', 2, { tool: 'Read', input: { file_path: 'a.js' } }));
  l.push(ev('UserPromptSubmit', 3, { raw: { prompt: ' <task-notification>x</task-notification>' } }));
  const v = l.view('s1');
  assert.equal(v.task, 'real');
  assert.equal(v.taskAt, 1);
  assert.equal(v.stepCount, 1);
  assert.equal(v.open.length, 1);
  assert.equal(v.lastEventAt, 3);
});

test('Stop and SessionEnd interrupt open main-thread steps', () => {
  for (const end of ['Stop', 'SessionEnd']) {
    const l = createStepLog();
    l.push(ev('PreToolUse', 1, { tool: 'Read', input: { file_path: 'a.js' } }));
    l.push(ev(end, 2));
    const v = l.view('s1');
    assert.equal(v.open.length, 0);
    assert.equal(v.steps[0].interrupted, true);
    assert.equal(v.steps[0].ok, null);
  }
});

test('helper events never enter steps; SubagentStart/Stop manage helpers', () => {
  const l = createStepLog();
  l.push(ev('SubagentStart', 1, { raw: { agent_id: 'h1', agent_type: 'Explore' } }));
  assert.deepEqual(l.view('s1').helpers, [{ agentId: 'h1', agentType: 'Explore', doing: null }]);
  l.push(ev('PreToolUse', 2, { tool: 'Grep', input: { pattern: 'x' }, raw: { agent_id: 'h1', agent_type: 'Explore', tool_use_id: 'q' } }));
  let v = l.view('s1');
  assert.equal(v.helpers[0].doing, 'searching code');
  assert.equal(v.open.length, 0);
  assert.equal(v.stepCount, 0);
  assert.equal(v.lastEventAt, 2);
  l.push(ev('PostToolUse', 3, { tool: 'Grep', raw: { agent_id: 'h1', tool_use_id: 'q' } }));
  l.push(ev('SubagentStop', 4, { raw: { agent_id: 'h1', agent_type: 'Explore' } }));
  v = l.view('s1');
  assert.equal(v.steps.length, 0);
  assert.deepEqual(v.helpers, []);
});

test('cap: 25 closed steps gives 20, newest first', () => {
  const l = createStepLog({ cap: 20 });
  for (let n = 0; n < 25; n++) {
    l.push(ev('PreToolUse', n * 2, { tool: 'Bash', input: { command: `c${n}` }, raw: { tool_use_id: `t${n}` } }));
    l.push(ev('PostToolUse', n * 2 + 1, { tool: 'Bash', raw: { tool_use_id: `t${n}` } }));
  }
  const v = l.view('s1');
  assert.equal(v.steps.length, 20);
  assert.equal(v.steps[0].label, 'c24');
  assert.equal(v.steps[19].label, 'c5');
});

test('view of an unknown session is empty; forget clears', () => {
  const l = createStepLog();
  assert.deepEqual(l.view('nope'), { task: null, taskAt: null, stepCount: 0, current: null, steps: [], open: [], helpers: [], lastEventAt: null });
  l.push(ev('UserPromptSubmit', 1, { raw: { prompt: 'hi' } }));
  l.forget('s1');
  assert.equal(l.view('s1').task, null);
});

test('stepLabel for each tool', () => {
  assert.equal(stepLabel('Read', { file_path: 'C:\\a\\b.js' }), 'Read b.js');
  assert.equal(stepLabel('Edit', { file_path: 'C:\\a\\b.js' }), 'Edited b.js');
  assert.equal(stepLabel('Write', { file_path: 'C:\\a\\c.js' }), 'Edited c.js');
  assert.equal(stepLabel('NotebookEdit', { notebook_path: 'C:\\a\\n.ipynb' }), 'Edited n.ipynb');
  assert.equal(stepLabel('Bash', { command: 'npm   test\n  --silent' }), 'npm test --silent');
  assert.equal(stepLabel('PowerShell', { command: 'x'.repeat(100) }).length, 80);
  assert.equal(stepLabel('Grep', { pattern: 'foo' }), 'Searched code for \u201cfoo\u201d');
  assert.equal(stepLabel('Glob', { pattern: '**/*.js' }), 'Listed files **/*.js');
  assert.equal(stepLabel('WebSearch', { query: 'q' }), 'Searched the web for \u201cq\u201d');
  assert.equal(stepLabel('WebFetch', { url: 'https://example.com/x' }), 'Read example.com');
  assert.equal(stepLabel('Agent', { subagent_type: 'Explore' }), 'Sent a Explore helper');
  assert.equal(stepLabel('Task', { subagent_type: 'Plan' }), 'Sent a Plan helper');
  assert.equal(stepLabel('Mcp__x', {}), 'Mcp__x');
});
