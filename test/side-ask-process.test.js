import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SIDE_ERRORS, childEnv, askSide } from '../src/main/side-ask.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude.mjs');
const exe = { file: process.execPath, args: [FIX] };
const run = (mode, extra = {}) => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hud-side-')), 'out.jsonl');
  const env = { ...process.env, FAKE_CLAUDE_MODE: mode, FAKE_CLAUDE_OUT: out, ELECTRON_RUN_AS_NODE: '1' };
  return askSide({ exe, sessionId: 's1', cwd: os.tmpdir(), question: 'q?', env: childEnv(env), initFallbackMs: 200, exitGraceMs: 500, ...extra })
    .then((r) => ({ r, calls: fs.existsSync(out) ? fs.readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [] }));
};

test('askSide: answer, with history; the child is marked and has no ELECTRON_RUN_AS_NODE', async () => {
  const { r, calls } = await run('answer', { history: [{ question: 'a', response: 'b' }], model: 'claude-opus-5-5' });
  assert.deepEqual(r, { answer: 'A:q?|h1' });
  assert.equal(calls[0].entry, 'agent-hud-side');
  assert.equal(calls[0].runAsNode, null);
  assert.ok(calls[0].argv.includes('--no-session-persistence') && calls[0].argv.includes('claude-opus-5-5'));
});
test('askSide: null answer -> noAnswer', async () => assert.equal((await run('null')).r.error, SIDE_ERRORS.noAnswer));
test('askSide: error subtype -> refused, detail kept', async () => assert.deepEqual((await run('error')).r, { error: SIDE_ERRORS.refused, detail: 'Unknown subtype' }));
test('askSide: no init reply -> asks after the fallback', async () => assert.equal((await run('noinit')).r.answer, 'A:q?|h0'));
test('askSide: reply split across chunks', async () => assert.equal((await run('split')).r.answer, 'A:q?|h0'));
test('askSide: exits before replying -> refused', async () => assert.equal((await run('exit')).r.error, SIDE_ERRORS.refused));
test('askSide: hang -> timeout, child killed', async () => assert.equal((await run('hang', { timeoutMs: 400 })).r.error, SIDE_ERRORS.timeout));
test('askSide: missing exe -> notFound', async () => assert.equal((await askSide({ exe: null, sessionId: 's', cwd: '.', question: 'q', env: {} })).error, SIDE_ERRORS.notFound));
test('askSide: abort mid-ask kills the child (HUD quitting)', async () => {
  const ac = new AbortController();
  const p = run('hang', { signal: ac.signal });
  setTimeout(() => ac.abort(), 150);
  assert.equal((await p).r.error, 'cancelled');
});
