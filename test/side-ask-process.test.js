import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SIDE_ERRORS, childEnv, askSide, killTree } from '../src/main/side-ask.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude.mjs');
const exe = { file: process.execPath, args: [FIX] };
const readOut = (out) => (fs.existsSync(out) ? fs.readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
// The tree kill is the test's own (never taskkill): it notes the kill in the fixture's output, then kills.
const run = (mode, extra = {}) => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hud-side-')), 'out.jsonl');
  const env = { ...process.env, FAKE_CLAUDE_MODE: mode, FAKE_CLAUDE_OUT: out, ELECTRON_RUN_AS_NODE: '1' };
  const treeKill = (child) => { fs.appendFileSync(out, JSON.stringify({ event: 'kill' }) + '\n'); child.kill(); };
  return askSide({ exe, sessionId: 's1', cwd: os.tmpdir(), question: 'q?', env: childEnv(env), initFallbackMs: 200, exitGraceMs: 500, treeKill, ...extra })
    .then((r) => ({ r, out, calls: readOut(out) }));
};
const events = (calls) => calls.filter((c) => c.event).map((c) => c.event);

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
const dead = async (pid) => {
  for (let i = 0; i < 100; i++) {
    try { process.kill(pid, 0); } catch { return true; }
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
};
test('askSide: hang -> timeout, child killed', async () => {
  const { r, calls } = await run('hang', { timeoutMs: 400 });
  assert.equal(r.error, SIDE_ERRORS.timeout);
  assert.ok(await dead(calls[0].pid), 'child process is gone');
});
test('askSide: UTF-8 character split across chunks survives', async () => assert.equal((await run('split-utf8')).r.answer, 'Ναι, ξεκίνα'));
test('askSide: missing exe -> notFound', async () => assert.equal((await askSide({ exe: null, sessionId: 's', cwd: '.', question: 'q', env: {} })).error, SIDE_ERRORS.notFound));
test('askSide: abort mid-ask kills the child (HUD quitting), stdin EOF first', async () => {
  const ac = new AbortController();
  const p = run('hang', { signal: ac.signal });
  setTimeout(() => ac.abort(), 150);
  const { r, calls, out } = await p;
  assert.equal(r.error, 'cancelled');
  assert.ok(await dead(calls[0].pid), 'child process is gone');
  assert.deepEqual(events(readOut(out)), ['stdin-end', 'kill'], 'EOF, then the kill after the grace');
});
test('askSide: an aborted child gets stdin EOF before any kill; one that exits on EOF is never killed', async () => {
  const ac = new AbortController();
  const p = run('hang-eof', { signal: ac.signal });
  setTimeout(() => ac.abort(), 150);
  const { r, calls } = await p;
  assert.equal(r.error, 'cancelled');
  assert.deepEqual(events(calls), ['stdin-end'], 'resolved only after the child left; no kill');
  assert.ok(await dead(calls[0].pid), 'child process is gone');
});
test('askSide: timeout ends stdin first; a child that exits on EOF is never killed', async () => {
  const { r, out } = await run('hang-eof', { timeoutMs: 300 });
  assert.equal(r.error, SIDE_ERRORS.timeout);
  const calls = readOut(out);
  assert.ok(await dead(calls[0].pid), 'child process is gone');
  assert.deepEqual(events(readOut(out)), ['stdin-end']);
});
test('askSide: a missing cwd is refused before spawning (not "CLI not found")', async () => {
  let spawned = false;
  const r = await askSide({ exe: { file: 'x' }, sessionId: 's1', cwd: path.join(os.tmpdir(), 'no-such-dir-hud-' + process.pid), question: 'q', env: {},
    spawnFn: () => { spawned = true; throw new Error('no'); } });
  assert.equal(r.error, SIDE_ERRORS.refused);
  assert.equal(r.detail, 'cwd missing: ' + path.join(os.tmpdir(), 'no-such-dir-hud-' + process.pid));
  assert.equal(spawned, false);
  assert.equal((await askSide({ exe: { file: 'x' }, sessionId: 's1', cwd: undefined, question: 'q', env: {} })).detail, 'cwd missing: undefined');
});
test('askSide: an exit keeps the stderr tail and the last non-control stdout line in detail', async () => {
  const { r } = await run('exit-noisy');
  assert.equal(r.error, SIDE_ERRORS.refused);
  assert.equal(r.detail, 'exited 1 | stderr: warn: something\nfatal: cannot resume | stdout: Error: No conversation found with session ID: s1');
});
test('killTree: taskkill /PID <pid> /T /F on Windows (no shell, hidden); child.kill() elsewhere', async () => {
  const spawned = [];
  const fakeSpawn = (file, args, opts) => {
    spawned.push({ file, args, opts });
    const listeners = {};
    setImmediate(() => listeners.exit?.(0));
    return { once: (ev, fn) => { listeners[ev] = fn; } };
  };
  let kills = 0;
  const child = { pid: 4242, kill: () => { kills++; } };
  await killTree(child, { platform: 'win32', spawnFn: fakeSpawn });
  assert.equal(spawned.length, 1);
  assert.match(spawned[0].file, /taskkill\.exe$/i);
  assert.deepEqual(spawned[0].args, ['/PID', '4242', '/T', '/F']);
  assert.equal(spawned[0].opts.windowsHide, true);
  assert.equal(spawned[0].opts.shell, undefined);
  assert.equal(kills, 0);
  await killTree(child, { platform: 'linux', spawnFn: fakeSpawn });
  assert.equal(spawned.length, 1);
  assert.equal(kills, 1);
  await killTree(child, { platform: 'win32', spawnFn: () => { throw new Error('no taskkill'); } });
  assert.equal(kills, 2, 'taskkill unavailable: falls back to child.kill()');
});
