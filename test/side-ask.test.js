import test from 'node:test'; import assert from 'node:assert/strict';
import { SIDE_ERRORS, findClaudeExe, childEnv, sideArgs, requestLines, parseReply, withBusyNote, transcriptPathFor, modelFromTranscriptTail } from '../src/main/side-ask.js';

test('findClaudeExe: env override, then ~/.local/bin, then PATH', () => {
  const has = (...ps) => (p) => ps.includes(p);
  assert.equal(findClaudeExe({ env: { AGENT_HUD_CLAUDE_EXE: 'D:\\f\\claude.exe' }, home: 'C:\\U', exists: has('D:\\f\\claude.exe') }), 'D:\\f\\claude.exe');
  assert.equal(findClaudeExe({ env: {}, home: 'C:\\U', exists: has('C:\\U\\.local\\bin\\claude.exe') }), 'C:\\U\\.local\\bin\\claude.exe');
  assert.equal(findClaudeExe({ env: { Path: 'C:\\a;C:\\b' }, home: 'C:\\U', exists: has('C:\\b\\claude.exe') }), 'C:\\b\\claude.exe');
  assert.equal(findClaudeExe({ env: { PATH: 'C:\\a' }, home: 'C:\\U', exists: () => false }), null);
});

test('childEnv strips ELECTRON_RUN_AS_NODE and CLAUDECODE, marks the entrypoint', () => {
  const e = childEnv({ ELECTRON_RUN_AS_NODE: '1', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'claude-vscode', PATH: 'x' });
  assert.deepEqual(e, { PATH: 'x', CLAUDE_CODE_ENTRYPOINT: 'agent-hud-side' });
});

test('sideArgs: the spec\'s flags, --model only when known', () => {
  const base = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--resume', 's1', '--no-session-persistence', '--settings', '{"disableAllHooks":true}'];
  assert.deepEqual(sideArgs({ sessionId: 's1' }), base);
  assert.deepEqual(sideArgs({ sessionId: 's1', model: 'claude-opus-5-5' }), [...base, '--model', 'claude-opus-5-5']);
});

test('requestLines: init then side_question; history only when non-empty', () => {
  const a = requestLines({ question: 'q?', history: [] });
  assert.deepEqual(JSON.parse(a.init), { type: 'control_request', request_id: 'init', request: { subtype: 'initialize' } });
  assert.deepEqual(JSON.parse(a.ask), { type: 'control_request', request_id: 'sq', request: { subtype: 'side_question', question: 'q?' } });
  assert.ok(a.init.endsWith('\n') && a.ask.endsWith('\n'));
  const b = requestLines({ question: 'q2', history: [{ question: 'q1', response: 'r1' }] });
  assert.deepEqual(JSON.parse(b.ask).request.history, [{ question: 'q1', response: 'r1' }]);
});

test('parseReply: success, null answer, error, other ids and noise', () => {
  const ok = JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: 'sq', response: { response: 'MARMALADE', synthetic: false } } });
  assert.deepEqual(parseReply(ok), { answer: 'MARMALADE' });
  const nul = JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: 'sq', response: { response: null } } });
  assert.deepEqual(parseReply(nul), { error: SIDE_ERRORS.noAnswer, detail: 'null response' });
  const err = JSON.stringify({ type: 'control_response', response: { subtype: 'error', request_id: 'sq', error: 'Unknown subtype' } });
  assert.deepEqual(parseReply(err), { error: SIDE_ERRORS.refused, detail: 'Unknown subtype' });
  assert.equal(parseReply(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: 'init', response: {} } })), null);
  assert.equal(parseReply('booting…'), null);
  assert.equal(parseReply(JSON.stringify({ type: 'system', subtype: 'commands_changed' })), null);
});

test('withBusyNote: the exact note while working, the plain question otherwise', () => {
  const now = 100_000;
  assert.equal(withBusyNote('why?', { doing: 'running sleep 25', startedAt: now - 9000 }, now),
    'why?\n\n(Agent HUD note: this chat is still working right now. Current step: running sleep 25, for 9s. Anything unfinished in the conversation is still running, not interrupted.)');
  assert.equal(withBusyNote('why?', { doing: 'running sleep 25', startedAt: now - 9000 }, now, { working: true }),
    'why?\n\n(Agent HUD note: this chat is still working right now. Current step: running sleep 25, for 9s. Anything unfinished in the conversation is still running, not interrupted.)');
  assert.equal(withBusyNote('why?', null, now), 'why?');
  assert.equal(withBusyNote('why?', null, now, { working: false }), 'why?');
});
test('withBusyNote: working between steps (no open step) gets the note without the step clause', () => {
  assert.equal(withBusyNote('why?', null, 5, { working: true }),
    'why?\n\n(Agent HUD note: this chat is still working right now. Anything unfinished in the conversation is still running, not interrupted.)');
});

test('transcriptPathFor replaces every non-alphanumeric character of the cwd', () => {
  assert.equal(transcriptPathFor('C:\\Users\\b', 'c:\\Consortis_projects\\agent-hud', 'abc'),
    'C:\\Users\\b\\.claude\\projects\\c--Consortis-projects-agent-hud\\abc.jsonl');
});

test('modelFromTranscriptTail: the last assistant line\'s model; a cut first line is skipped', () => {
  const t = 'tial line"}\n' + [
    { type: 'assistant', message: { model: 'claude-sonnet-5-5' } }, { type: 'user', message: {} },
    { type: 'assistant', message: { model: 'claude-opus-5-5' } }, { type: 'system' },
  ].map((o) => JSON.stringify(o)).join('\n');
  assert.equal(modelFromTranscriptTail(t), 'claude-opus-5-5');
  assert.equal(modelFromTranscriptTail('{"type":"user"}'), null);
});

test('modelFromTranscriptTail: skips <synthetic> assistant lines', () => {
  const real = JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5-5' } });
  const syn = JSON.stringify({ type: 'assistant', message: { model: '<synthetic>' } });
  assert.equal(modelFromTranscriptTail([real, syn].join('\n')), 'claude-opus-5-5');
  assert.equal(modelFromTranscriptTail(syn), null);
});
