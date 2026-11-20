import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path';

// main.js has no unit harness (Electron): pin the start() order that the hooks-follow-the-HUD design relies on.
const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'main', 'main.js'), 'utf8');
const startBody = src.slice(src.indexOf('async function start()'), src.indexOf('\n}\n', src.indexOf('async function start()')));

test('start() restores the Claude hooks before any first-run dialog can block it', () => {
  const sync = startBody.indexOf("syncHooks('start')");
  const first = startBody.indexOf('await firstRun()');
  assert.ok(sync > 0 && first > 0, 'both calls are in start()');
  assert.ok(sync < first, 'syncHooks(\'start\') must run before await firstRun() (a pending Codex offer must not keep Claude hooks out)');
});

test('v1.7: every push marks the chat whose details are open as seen, before the snapshot is sent', () => {
  const body = src.slice(src.indexOf('const pushNow'), src.indexOf('const push = createThrottle'));
  const seen = body.indexOf('store.markSeen(');
  assert.ok(seen > 0, 'pushNow calls store.markSeen');
  assert.ok(seen < body.indexOf("webContents.send('snapshot'"), 'before the snapshot goes out');
});
