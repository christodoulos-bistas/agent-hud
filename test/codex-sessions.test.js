import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createCodexSessions, hostOf, readRolloutMeta } from '../src/main/codex-sessions.js';
import { displayName } from '../src/main/sessions.js';

const ev = (sessionId, event, at, extra = {}) => ({ sessionId, event, toolName: null, toolInput: {}, cwd: 'c:\\p\\app', at, raw: {}, source: 'codex', ...extra });
const setup = (readMeta = () => ({ originator: 'Codex Desktop', source: 'vscode' })) => {
  let t = 0;
  const cs = createCodexSessions({ now: () => t, readMeta });
  return { cs, set: (v) => { t = v; } };
};
const ID1 = 'aaaaaaaa-0000-0000-0000-0000000000a1';
const ID2 = 'aaaaaaaa-0000-0000-0000-0000000000b2';

test('first codex event creates an interactive session; host from meta; UserPromptSubmit busy, Stop idle, Interrupt idle', () => {
  const { cs, set } = setup();
  set(1000);
  cs.onEvent(ev(ID1, 'SessionStart', 1000, { raw: { transcript_path: 'x' } }));
  let [s] = cs.list();
  assert.equal(s.kind, 'interactive'); assert.equal(s.entrypoint, 'codex'); assert.equal(s.source, 'codex');
  assert.equal(s.host, 'desktop'); assert.equal(s.pid, null); assert.equal(s.status, 'idle');
  assert.equal(s.startedAt, 1000); assert.equal(s.cwd, 'c:\\p\\app'); assert.ok(cs.has(ID1));
  cs.onEvent(ev(ID1, 'UserPromptSubmit', 2000));
  [s] = cs.list(); assert.equal(s.status, 'busy'); assert.equal(s.statusSince, 2000); assert.equal(s.startedAt, 1000);
  cs.onEvent(ev(ID1, 'Stop', 3000));
  [s] = cs.list(); assert.equal(s.status, 'idle'); assert.equal(s.statusSince, 3000);
  cs.onEvent(ev(ID1, 'UserPromptSubmit', 4000));
  cs.onEvent(ev(ID1, 'Interrupt', 5000));
  assert.equal(cs.list()[0].status, 'idle');
});

test('hostOf maps originators; anything else is unknown', () => {
  assert.equal(hostOf({ originator: 'Codex Desktop' }), 'desktop');
  assert.equal(hostOf({ originator: 'codex-tui' }), 'cli');
  assert.equal(hostOf({ originator: 'codex_exec' }), 'cli');
  assert.equal(hostOf({ originator: 'other' }), 'unknown');
  assert.equal(hostOf(null), 'unknown');
  const { cs } = setup(() => null);
  cs.onEvent(ev(ID1, 'UserPromptSubmit', 1));
  assert.equal(cs.list()[0].host, 'unknown');
  const t = setup(() => { throw new Error('boom'); });
  t.cs.onEvent(ev(ID1, 'UserPromptSubmit', 1));
  assert.equal(t.cs.list()[0].host, 'unknown');
});

test('readMeta is called once per session', () => {
  let calls = 0;
  const { cs } = setup(() => { calls++; return null; });
  cs.onEvent(ev(ID1, 'UserPromptSubmit', 1)); cs.onEvent(ev(ID1, 'Stop', 2));
  assert.equal(calls, 1);
});

test('busy with no open tool step goes idle after 15 min; an open PreToolUse without its Post keeps it busy', () => {
  const { cs, set } = setup();
  cs.onEvent(ev(ID1, 'UserPromptSubmit', 0));
  cs.onEvent(ev(ID2, 'UserPromptSubmit', 0));
  cs.onEvent(ev(ID2, 'PreToolUse', 10, { raw: { tool_use_id: 't1' } }));
  set(899999); assert.deepEqual(cs.list().map((s) => s.status), ['busy', 'busy']);
  set(900001);
  assert.deepEqual(cs.list().map((s) => s.status), ['idle', 'busy']);
  assert.equal(cs.list()[0].statusSince, 900000);
  cs.onEvent(ev(ID2, 'PostToolUse', 900100, { raw: { tool_use_id: 't1' } }));
  set(900200); assert.equal(cs.list()[1].status, 'busy');
  set(900100 + 900001); assert.equal(cs.list()[1].status, 'idle');
});

test('list returns copies', () => {
  const { cs } = setup();
  cs.onEvent(ev(ID1, 'UserPromptSubmit', 0));
  cs.list()[0].status = 'x';
  assert.equal(cs.list()[0].status, 'busy');
});

test('SessionEnd removes it; 24 h without an event removes it; any event resets the clock', () => {
  const { cs, set } = setup();
  cs.onEvent(ev(ID1, 'UserPromptSubmit', 0));
  cs.onEvent(ev(ID2, 'UserPromptSubmit', 0));
  cs.onEvent(ev(ID1, 'SessionEnd', 5));
  assert.equal(cs.has(ID1), false); assert.equal(cs.list().length, 1);
  set(86400000 - 1); cs.onEvent(ev(ID2, 'PostToolUse', 86400000 - 1, { raw: { tool_use_id: 'q' } }));
  set(86400000 + 5000); assert.equal(cs.has(ID2), true);
  set(2 * 86400000 - 1); assert.equal(cs.has(ID2), false); assert.deepEqual(cs.list(), []);
});

test('Review Focus 4: two codex sessions in one folder get distinct derived names', () => {
  const { cs } = setup();
  cs.onEvent(ev(ID1, 'UserPromptSubmit', 0)); cs.onEvent(ev(ID2, 'UserPromptSubmit', 0));
  const [s1, s2] = cs.list();
  assert.equal(s1.nameSource, 'derived');
  assert.equal(s1.name, 'codex-a1');
  assert.equal(displayName(s1), 'app · a1');
  assert.notEqual(displayName(s1), displayName(s2));
});

test('readRolloutMeta reads only the first line; bad files give null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rollout-'));
  try {
    const f = path.join(dir, 'r.jsonl');
    fs.writeFileSync(f, JSON.stringify({ type: 'session_meta', payload: { originator: 'codex-tui', source: 'cli', pad: 'x'.repeat(100000) } }) + '\n{not json');
    assert.deepEqual(readRolloutMeta(f, { maxBytes: 200000 }), { originator: 'codex-tui', source: 'cli' });
    fs.writeFileSync(f, 'garbage\n');
    assert.equal(readRolloutMeta(f), null);
    assert.equal(readRolloutMeta(path.join(dir, 'missing')), null);
    assert.equal(readRolloutMeta(undefined), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('PermissionRequest makes an idle chat busy; the unchanged 15 min rule then applies by open steps', () => {
  const { cs, set } = setup();
  cs.onEvent(ev(ID1, 'SessionStart', 0)); cs.onEvent(ev(ID2, 'SessionStart', 0));
  cs.onEvent(ev(ID2, 'PreToolUse', 100, { raw: { tool_use_id: 't1' } }));
  cs.onEvent(ev(ID2, 'Stop', 150)); // Stop closes steps; reopen one below
  cs.onEvent(ev(ID1, 'PermissionRequest', 1000));
  let s = cs.list().find((x) => x.sessionId === ID1);
  assert.equal(s.status, 'busy'); assert.equal(s.statusSince, 1000);
  set(1000 + 899999); assert.equal(cs.list().find((x) => x.sessionId === ID1).status, 'busy');
  set(1000 + 900001); assert.equal(cs.list().find((x) => x.sessionId === ID1).status, 'idle'); // no open step
  cs.onEvent(ev(ID2, 'PreToolUse', 2000, { raw: { tool_use_id: 't2' } }));
  cs.onEvent(ev(ID2, 'PermissionRequest', 2100));
  set(2100 + 900001); assert.equal(cs.list().find((x) => x.sessionId === ID2).status, 'busy'); // open step
});

test('host retry: unknown host is re-read from a later event with a transcript_path', () => {
  const calls = [];
  const answers = [null, { originator: 'Codex Desktop' }];
  const { cs } = setup((p) => { calls.push(p); return answers.shift() ?? null; });
  cs.onEvent(ev(ID1, 'SessionStart', 1, { raw: { transcript_path: 'r' } }));
  assert.equal(cs.list()[0].host, 'unknown');
  cs.onEvent(ev(ID1, 'UserPromptSubmit', 2)); // no transcript_path: no read
  assert.equal(calls.length, 1);
  cs.onEvent(ev(ID1, 'PreToolUse', 3, { raw: { transcript_path: 'r' } }));
  assert.equal(cs.list()[0].host, 'desktop');
  cs.onEvent(ev(ID1, 'PreToolUse', 4, { raw: { transcript_path: 'r' } }));
  assert.equal(calls.length, 2); // resolved: no more reads
});

test('host retry stops after 3 failed attempts', () => {
  let n = 0;
  const { cs } = setup(() => { n++; return null; });
  for (let i = 1; i <= 6; i++) cs.onEvent(ev(ID1, 'PreToolUse', i, { raw: { transcript_path: 'r' } }));
  assert.equal(n, 3);
  assert.equal(cs.list()[0].host, 'unknown');
});
