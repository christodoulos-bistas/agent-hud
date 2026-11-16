import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { readSessionFiles, listSessions, displayName } from '../src/main/sessions.js';

const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hud-sess-'));
const file = (pid, o = {}) => JSON.stringify({ pid, sessionId: `sid-${pid}`, cwd: 'c:\\Consortis_projects\\arsenal', startedAt: 5, kind: 'interactive', entrypoint: 'claude-vscode', name: 'arsenal-e0', nameSource: 'derived', status: 'busy', ...o });

test('displayName: derived name uses the suffix after the last dash, custom title is kept', () => {
  assert.equal(displayName({ cwd: 'c:\\Consortis_projects\\arsenal', name: 'arsenal-e0', nameSource: 'derived' }), 'arsenal · e0');
  assert.equal(displayName({ cwd: 'c:\\Consortis_projects\\arsenal\\', name: 'Agent HUD with fantasy characters', nameSource: 'user' }), 'arsenal · Agent HUD with fantasy characters');
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
