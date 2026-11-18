import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStepLog, stepLabel, activityLine, patchPaths, recapOf } from '../src/main/steps.js';

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
  assert.deepEqual(l.view('nope'), { task: null, taskAt: null, stepCount: 0, current: null, steps: [], open: [], helpers: [], lastEventAt: null, lastMessage: null, recap: { files: 0, commands: 0, failed: 0, helpers: 0, endedAt: null } });
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

test('I3a: closeDenied closes the oldest open main-thread step of that tool as failed "Denied"; its late Post closes nothing else', () => {
  const l = createStepLog();
  l.push(ev('PreToolUse', 1, { tool: 'Bash', input: { command: 'rm -rf build' }, raw: { tool_use_id: 'b1' } }));
  l.push(ev('PreToolUse', 2, { tool: 'Read', input: { file_path: 'a.js' }, raw: { tool_use_id: 'r1' } }));
  l.push(ev('PreToolUse', 3, { tool: 'Bash', input: { command: 'ls' }, raw: { tool_use_id: 'b2' } }));
  assert.equal(l.closeDenied('s1', 'Bash', 9), true);
  let v = l.view('s1');
  assert.deepEqual(v.open.map((s) => s.id), ['r1', 'b2']);
  assert.equal(v.steps[0].id, 'b1');
  assert.equal(v.steps[0].ok, false);
  assert.equal(v.steps[0].error, 'Denied');
  assert.equal(v.steps[0].endedAt, 9);
  assert.equal(v.steps[0].interrupted, false);
  // If Claude Code does send a Post for the denied call, it must not close b2 by the tool fallback.
  l.push(ev('PostToolUseFailure', 10, { tool: 'Bash', raw: { tool_use_id: 'b1', error: 'denied' } }));
  v = l.view('s1');
  assert.deepEqual(v.open.map((s) => s.id), ['r1', 'b2']);
  assert.equal(v.steps.length, 1);
  assert.equal(l.closeDenied('s1', 'Write', 11), false, 'no open step of that tool: nothing changes');
  assert.equal(l.closeDenied('nobody', 'Bash', 11), false);
  assert.equal(l.view('s1').open.length, 2);
});

test('I3b: a new main-thread PreToolUse supersedes open non-Agent steps started over 10 s earlier (interrupted, not failed)', () => {
  const l = createStepLog();
  l.push(ev('PreToolUse', 0, { tool: 'Bash', input: { command: 'npm test' }, raw: { tool_use_id: 'b1' } }));
  l.push(ev('PreToolUse', 1, { tool: 'Agent', input: { subagent_type: 'Explore' }, raw: { tool_use_id: 'a1' } }));
  l.push(ev('PreToolUse', 5, { tool: 'Read', input: { file_path: 'x.js' }, raw: { tool_use_id: 'r1' } }));
  assert.equal(l.view('s1').open.length, 3, 'parallel calls start within ms of each other: all stay open');
  l.push(ev('PreToolUse', 10005, { tool: 'Grep', input: { pattern: 'q' }, raw: { tool_use_id: 'g1' } }));
  let v = l.view('s1');
  assert.deepEqual(v.open.map((s) => s.id), ['a1', 'r1', 'g1'], 'exactly 10 000 ms earlier is not "more than"');
  assert.deepEqual(v.steps.map((s) => s.id), ['b1']);
  assert.equal(v.steps[0].interrupted, true);
  assert.equal(v.steps[0].ok, null);
  assert.equal(v.steps[0].endedAt, 10005);
  // A helper's PreToolUse supersedes nothing on the main thread.
  l.push(ev('PreToolUse', 30000, { tool: 'Read', input: { file_path: 'y.js' }, raw: { agent_id: 'h1', tool_use_id: 'hr' } }));
  assert.equal(l.view('s1').open.length, 3);
  l.push(ev('PreToolUse', 30001, { tool: 'Bash', input: { command: 'ls' }, raw: { tool_use_id: 'b2' } }));
  v = l.view('s1');
  assert.deepEqual(v.open.map((s) => s.id), ['a1', 'b2'], 'the Agent step is never superseded');
  assert.deepEqual(v.steps.map((s) => s.id), ['g1', 'r1', 'b1']);
  assert.ok(v.steps.slice(0, 2).every((s) => s.interrupted && s.ok === null));
});

test('M1: a main-thread Stop with background_tasks keeps only the helpers still running there', () => {
  const l = createStepLog();
  for (const id of ['h1', 'h2', 'h3']) l.push(ev('SubagentStart', 1, { raw: { agent_id: id, agent_type: 'Explore' } }));
  l.push(ev('Stop', 2));
  assert.equal(l.view('s1').helpers.length, 3, 'no background_tasks array: helpers untouched');
  l.push(ev('Stop', 3, { raw: { agent_id: 'h1', background_tasks: [] } }));
  assert.equal(l.view('s1').helpers.length, 3, 'a helper\'s Stop reconciles nothing');
  l.push(ev('Stop', 4, { raw: { background_tasks: [
    { id: 'h1', type: 'subagent', status: 'running' }, { id: 'h2', type: 'subagent', status: 'completed' },
    { id: 'h3', type: 'shell', status: 'running' }, null,
  ] } }));
  assert.deepEqual(l.view('s1').helpers.map((h) => h.agentId), ['h1']);
  l.push(ev('Stop', 5, { raw: { background_tasks: [] } }));
  assert.deepEqual(l.view('s1').helpers, []);
});

test('M5: a Bash/PowerShell step keeps its command (whitespace collapsed, capped at 300); other tools have none', () => {
  const l = createStepLog();
  const long = 'npm   run build\n  -- ' + 'x'.repeat(400);
  l.push(ev('PreToolUse', 1, { tool: 'Bash', input: { command: long } }));
  l.push(ev('PreToolUse', 2, { tool: 'PowerShell', input: { command: 'Get-ChildItem -Force' } }));
  l.push(ev('PreToolUse', 3, { tool: 'Read', input: { file_path: 'a.js' } }));
  const [bash, ps, read] = l.view('s1').open;
  assert.equal(bash.command.length, 300);
  assert.ok(bash.command.startsWith('npm run build -- xxx'));
  assert.equal(ps.command, 'Get-ChildItem -Force');
  assert.equal(read.command, null);
});

test('M8: why is whitespace-collapsed and capped at 300 chars', () => {
  const l = createStepLog();
  l.push(ev('PreToolUse', 1, { tool: 'Bash', input: { command: 'x', description: '  Run   the\n tests ' + 'w'.repeat(400) } }));
  l.push(ev('PreToolUse', 2, { tool: 'Bash', input: { command: 'y', description: '   ' } }));
  const [a, b] = l.view('s1').open;
  assert.equal(a.why.length, 300);
  assert.ok(a.why.startsWith('Run the tests www'));
  assert.equal(b.why, null);
});

test('Stop sets lastMessage (collapsed, 600 cap); a new real prompt clears it; helper Stop ignored', () => {
  const log = createStepLog();
  assert.equal(log.view('s1').lastMessage, null);
  log.push(ev('Stop', 1, { raw: { last_assistant_message: 'All\n\n  done   now ' + 'x'.repeat(700) } }));
  const m = log.view('s1').lastMessage;
  assert.equal(m.length, 600); assert.ok(m.startsWith('All done now xxx'));
  log.push(ev('Stop', 2, { raw: { agent_id: 'h1', last_assistant_message: 'helper' } }));
  assert.equal(log.view('s1').lastMessage, m);
  log.push(ev('UserPromptSubmit', 3, { raw: { prompt: '<task-notification>x' } }));
  assert.equal(log.view('s1').lastMessage, m);
  log.push(ev('UserPromptSubmit', 4, { raw: { prompt: 'next' } }));
  assert.equal(log.view('s1').lastMessage, null);
  log.push(ev('Stop', 5, { raw: { last_assistant_message: '   ' } }));
  assert.equal(log.view('s1').lastMessage, null);
});

// 2026-11-17: a helper that started before the HUD (its SubagentStart missed) showed nowhere in the panel.
test('a helper first seen by its own tool joins the helpers (still not a step); SubagentStop or the main Stop removes it', () => {
  const l = createStepLog();
  l.push(ev('PreToolUse', 1, { tool: 'Read', input: { file_path: 'C:/a/x.js' }, raw: { agent_id: 'h9', agent_type: 'Explore', tool_use_id: 't1' } }));
  assert.deepEqual(l.view('s1').helpers, [{ agentId: 'h9', agentType: 'Explore', doing: 'reading x.js' }]);
  assert.equal(l.view('s1').steps.length + l.view('s1').open.length, 0, 'a helper tool is never a main-thread step');
  l.push(ev('PreToolUse', 2, { tool: 'Grep', input: {}, raw: { agent_id: 'h9', tool_use_id: 't2' } }));
  assert.deepEqual(l.view('s1').helpers, [{ agentId: 'h9', agentType: 'Explore', doing: 'searching code' }], 'one entry, latest doing');
  l.push(ev('PostToolUse', 3, { tool: 'Grep', input: {}, raw: { agent_id: 'h7', tool_use_id: 't3' } }));
  assert.equal(l.view('s1').helpers.length, 1, 'only a PreToolUse adds a helper');
  l.push(ev('SubagentStop', 4, { raw: { agent_id: 'h9' } }));
  assert.deepEqual(l.view('s1').helpers, []);
  l.push(ev('PreToolUse', 5, { tool: 'Grep', input: {}, raw: { agent_id: 'h8', tool_use_id: 't4' } }));
  l.push(ev('Stop', 6, { raw: { background_tasks: [] } }));
  assert.deepEqual(l.view('s1').helpers, [], 'the main Stop reconciles it away like any helper');
});

const PATCH = '*** Begin Patch\n*** Update File: src/a.ts\n@@\n-x\n+y\n*** Add File: README.md\n+hi\n*** Delete File: old.js\n*** Update File: src/a.ts\n@@\n-1\n+2\n*** End Patch\n';
const APPLY_PATCH_FIELD = 'command';

test('patchPaths lists Add/Update/Delete paths in order, deduplicated', () => {
  assert.deepEqual(patchPaths(PATCH), ['src/a.ts', 'README.md', 'old.js']);
  assert.deepEqual(patchPaths(undefined), []);
});

test('apply_patch: stepLabel and activityLine name the first file and count the rest', () => {
  assert.equal(stepLabel('apply_patch', { [APPLY_PATCH_FIELD]: PATCH }), 'Edited a.ts +2');
  assert.equal(stepLabel('apply_patch', { [APPLY_PATCH_FIELD]: '*** Begin Patch\n*** Add File: C:\\x\\b.js\n+1\n*** End Patch\n' }), 'Edited b.js');
  assert.equal(activityLine({ event: 'PreToolUse', toolName: 'apply_patch', toolInput: { [APPLY_PATCH_FIELD]: PATCH } }), 'editing a.ts');
});

test('Codex Bash (command string) labels like Claude Bash', () => {
  const input = { command: 'npm   test' };
  assert.equal(stepLabel('Bash', input), 'npm test');
  assert.equal(activityLine({ event: 'PreToolUse', toolName: 'Bash', toolInput: input }), 'running npm   test');
});

test('recap counts edited files once, commands, failed commands and helpers, helpers included', () => {
  const log = createStepLog({});
  const e = (event, x = {}) => log.push({ sessionId: 's', event, at: x.at ?? 1000, toolName: x.tool, toolInput: x.input, raw: { tool_name: x.tool, tool_input: x.input, ...x.raw } });
  e('UserPromptSubmit', { raw: { prompt: 'do it' }, at: 0 });
  e('PreToolUse', { tool: 'Edit', input: { file_path: 'C:/a/x.ts' } });
  e('PreToolUse', { tool: 'Write', input: { file_path: 'C:/a/x.ts' } });
  e('PreToolUse', { tool: 'apply_patch', input: { command: '*** Update File: y.ts\n*** Add File: z.ts' } });
  e('PreToolUse', { tool: 'Bash', input: { command: 'npm test' } });
  e('PostToolUseFailure', { tool: 'Bash', input: { command: 'npm test' } });
  e('PostToolUseFailure', { tool: 'Read', input: { file_path: 'q' } });
  e('SubagentStart', { raw: { agent_id: 'h1', agent_type: 'Explore' } });
  e('PreToolUse', { tool: 'PowerShell', input: { command: 'ls' }, raw: { agent_id: 'h1' } });
  e('PreToolUse', { tool: 'Edit', input: { file_path: 'C:/a/w.ts' }, raw: { agent_id: 'h1' } });
  e('Stop', { at: 252000, raw: { last_assistant_message: 'done' } });
  assert.deepEqual(log.view('s').recap, { files: 4, commands: 2, failed: 1, helpers: 1, endedAt: 252000 });
});

test('recap resets on a real prompt, not on <task-notification>, and survives the 20-step cap', () => {
  const log = createStepLog({});
  const e = (event, at, x = {}) => log.push({ sessionId: 's', event, at, toolName: x.tool, toolInput: x.input, raw: { tool_name: x.tool, tool_input: x.input, ...x.raw } });
  e('UserPromptSubmit', 0, { raw: { prompt: 'go' } });
  for (let i = 0; i < 25; i++) {
    e('PreToolUse', 1000 + i * 10, { tool: 'Bash', input: { command: `c${i}` }, raw: { tool_use_id: `t${i}` } });
    e('PostToolUse', 1005 + i * 10, { tool: 'Bash', raw: { tool_use_id: `t${i}` } });
  }
  assert.equal(log.view('s').recap.commands, 25);
  e('UserPromptSubmit', 5000, { raw: { prompt: '<task-notification>bg done</task-notification>' } });
  assert.equal(log.view('s').recap.commands, 25);
  e('UserPromptSubmit', 6000, { raw: { prompt: 'next' } });
  assert.deepEqual(log.view('s').recap, { files: 0, commands: 0, failed: 0, helpers: 0, endedAt: null });
});

test('recapOf formats parts, omits zeros, and marks tasks from before the HUD', () => {
  assert.equal(recapOf({ files: 6, commands: 12, failed: 1, helpers: 2, endedAt: 252000 }, 0), 'Done in 4m 12s · 6 files edited · 12 commands (1 failed) · 2 helpers');
  assert.equal(recapOf({ files: 1, commands: 0, failed: 0, helpers: 0, endedAt: 8000 }, 0), 'Done in 8s · 1 file edited');
  assert.equal(recapOf({ files: 0, commands: 0, failed: 0, helpers: 0, endedAt: 8000 }, 0), 'Done in 8s · no tool steps');
  assert.equal(recapOf({ files: 0, commands: 3, failed: 0, helpers: 0, endedAt: 8000 }, null), 'Since the HUD started: 3 commands');
  assert.equal(recapOf({ files: 0, commands: 0, failed: 0, helpers: 0, endedAt: 3_900_000 }, 0), 'Done in 1h 5m · no tool steps');
  assert.equal(recapOf(null, 0), null);
});
