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
