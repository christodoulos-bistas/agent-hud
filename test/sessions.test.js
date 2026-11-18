import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { readSessionFiles, listSessions, displayName } from '../src/main/sessions.js';

const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hud-sess-'));
const file = (pid, o = {}) => JSON.stringify({ pid, sessionId: `sid-${pid}`, cwd: 'c:\\Consortis_projects\\arsenal', startedAt: 5, kind: 'interactive', entrypoint: 'claude-vscode', name: 'arsenal-e0', nameSource: 'derived', status: 'busy', ...o });

test('displayName: derived name uses the suffix after the last dash, custom title is kept', () => {
  assert.equal(displayName({ cwd: 'c:\\Consortis_projects\\arsenal', name: 'arsenal-e0', nameSource: 'derived' }), 'arsenal · e0');
  // A chat with its own title shows the title alone: two chats in one folder would otherwise both
  // read "Consortis_projects · …" once the row truncates them.
  assert.equal(displayName({ cwd: 'c:\\Consortis_projects\\arsenal\\', name: 'Agent HUD with fantasy characters', nameSource: 'user' }), 'Agent HUD with fantasy characters');
  assert.equal(displayName({ cwd: 'C:\\Consortis_projects', name: 'Consortis GIS site down', nameSource: '' }), 'Consortis GIS site down');
  assert.equal(displayName({ cwd: 'C:\\Consortis_projects', name: '', nameSource: '' }), 'Consortis_projects');
});

test('readSessionFiles skips half-written JSON and non-.json files; does not filter liveness', () => {
  const dir = mk();
  fs.writeFileSync(path.join(dir, '1.json'), file(1));
  fs.writeFileSync(path.join(dir, '2.json'), '{"pid":2,"sessi');
  fs.writeFileSync(path.join(dir, '3.abc.key'), 'secret');
  const l = readSessionFiles(dir);
  assert.deepEqual(l.map((s) => s.sessionId), ['sid-1']);
  assert.equal(l[0].startedAt, 5);
  assert.equal(l[0].status, 'busy');
});

test('listSessions reads only .json files, drops dead pids and half-written files', async () => {
  const dir = mk();
  fs.writeFileSync(path.join(dir, '10.json'), file(10));
  fs.writeFileSync(path.join(dir, '11.json'), file(11));
  fs.writeFileSync(path.join(dir, '12.json'), '{"pid":12');
  fs.writeFileSync(path.join(dir, '10.h.key'), 'x');
  const l = await listSessions({ dir, isAlive: (pid) => pid === 10 });
  assert.deepEqual(l.map((s) => s.pid), [10]);
});

test('listSessions with a missing dir returns []', async () => {
  assert.deepEqual(await listSessions({ dir: path.join(os.tmpdir(), 'nope-' + Date.now()), isAlive: () => true }), []);
  assert.deepEqual(readSessionFiles(path.join(os.tmpdir(), 'nope-' + Date.now())), []);
});

test('M9: a startedAt that is missing, zero, negative or not a finite number is unknown (null)', () => {
  const dir = mk();
  const cases = { 21: {}, 22: { startedAt: 0 }, 23: { startedAt: -5 }, 24: { startedAt: 'soon' }, 25: { startedAt: 1794810688780 } };
  for (const [pid, o] of Object.entries(cases)) {
    const f = JSON.parse(file(Number(pid), o));
    if (!('startedAt' in o)) delete f.startedAt;
    fs.writeFileSync(path.join(dir, `${pid}.json`), JSON.stringify(f));
  }
  const by = Object.fromEntries(readSessionFiles(dir).map((s) => [s.pid, s.startedAt]));
  assert.deepEqual(by, { 21: null, 22: null, 23: null, 24: null, 25: 1794810688780 });
});

// v1.3: the file's statusUpdatedAt is when its busy/idle status last changed (the idle clock for chats without hooks).
test('readSessionFiles keeps statusUpdatedAt as statusSince; zero or missing is unknown', () => {
  const dir = mk();
  const file = (name, extra) => fs.writeFileSync(path.join(dir, name), JSON.stringify({ sessionId: name, pid: 1, cwd: 'c:\p', status: 'idle', ...extra }));
  file('a.json', { statusUpdatedAt: 1794810712245 });
  file('b.json', { statusUpdatedAt: 0 });
  const byId = Object.fromEntries(readSessionFiles(dir).map((s) => [s.sessionId, s]));
  assert.equal(byId['a.json'].statusSince, 1794810712245);
  assert.equal(byId['b.json'].statusSince, null);
});

test('listSessions keeps one entry per sessionId: the newest process wins (a stale file whose pid was reused)', async () => {
  const dir = mk();
  // The same chat, first in process 36420 (dead; its pid since reused, so it still "looks" alive), then in 48896.
  fs.writeFileSync(path.join(dir, '36420.json'), file(36420, { sessionId: 'same', startedAt: 1000, procStart: 10, status: 'busy' }));
  fs.writeFileSync(path.join(dir, '48896.json'), file(48896, { sessionId: 'same', startedAt: 2000, procStart: 20, status: 'idle' }));
  fs.writeFileSync(path.join(dir, '7.json'), file(7));
  const l = await listSessions({ dir, isAlive: () => true });
  assert.deepEqual(l.map((s) => [s.sessionId, s.pid]).sort(), [['same', 48896], ['sid-7', 7]]);
});

test('listSessions dedupe: equal start times fall back to procStart; missing times lose to known ones', async () => {
  const dir = mk();
  fs.writeFileSync(path.join(dir, '1.json'), file(1, { sessionId: 'x', startedAt: 5, procStart: 30 }));
  fs.writeFileSync(path.join(dir, '2.json'), file(2, { sessionId: 'x', startedAt: 5, procStart: 40 }));
  fs.writeFileSync(path.join(dir, '3.json'), file(3, { sessionId: 'y', startedAt: 0 }));
  fs.writeFileSync(path.join(dir, '4.json'), file(4, { sessionId: 'y', startedAt: 9 }));
  const l = await listSessions({ dir, isAlive: () => true });
  assert.deepEqual(l.map((s) => [s.sessionId, s.pid]).sort(), [['x', 2], ['y', 4]]);
});
