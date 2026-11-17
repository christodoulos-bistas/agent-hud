import test from 'node:test'; import assert from 'node:assert/strict';
import { pickOurUntrusted, trustEdits, trustSummary, isOurs } from '../src/main/codex-trust.js';

const HP = 'C:\\Users\\u\\.codex\\hooks.json';
const CMD = '"C:\\Users\\u\\AppData\\Local\\Programs\\Agent HUD\\resources\\codex-hook.cmd"';
const OPTS = { hooksPath: HP, command: CMD };
const hook = (o) => ({ key: `${HP}:stop:2:0`, eventName: 'stop', command: CMD, sourcePath: HP, source: 'user', isManaged: false, currentHash: 'sha256:aa', trustStatus: 'untrusted', ...o });

test('pickOurUntrusted: only our user-layer hooks', () => {
  const list = { data: [{ cwd: 'C:\\Users\\u', hooks: [
    hook({}),
    hook({ key: `${HP}:stop:0:0`, command: 'node other.js' }),
    hook({ key: 'C:\\p\\.codex\\hooks.json:stop:0:0', sourcePath: 'C:\\p\\.codex\\hooks.json', source: 'project' }),
    hook({ key: 'x@m:hooks.json:stop:0:0', source: 'plugin' }),
    hook({ key: `${HP}:session_end:1:0`, eventName: 'sessionEnd', sourcePath: 'c:\\users\\u\\.codex\\hooks.json' }),
    hook({ key: `${HP}:pre_tool_use:1:0`, eventName: 'preToolUse', trustStatus: 'trusted' }),
    hook({ key: `${HP}:interrupt:0:0`, isManaged: true }),
  ] }] };
  assert.deepEqual(pickOurUntrusted(list, OPTS).map((h) => h.key), [`${HP}:stop:2:0`, `${HP}:session_end:1:0`]);
});

test('pickOurUntrusted: same hook under two cwds counts once', () => {
  assert.equal(pickOurUntrusted({ data: [{ hooks: [hook({})] }, { hooks: [hook({})] }] }, OPTS).length, 1);
});

test('pickOurUntrusted: malformed result -> []', () => {
  for (const r of [null, {}, { data: null }, { data: [{ hooks: null }] }]) assert.deepEqual(pickOurUntrusted(r, OPTS), []);
});

test('trustEdits: one quoted-key upsert per hook', () => {
  assert.deepEqual(trustEdits([{ key: `${HP}:stop:2:0`, hash: 'sha256:aa', event: 'stop' }]),
    [{ keyPath: `hooks.state.${JSON.stringify(`${HP}:stop:2:0`)}.trusted_hash`, value: 'sha256:aa', mergeStrategy: 'upsert' }]);
});

test('trustSummary: counts ours, splits by trust', () => {
  const list = { data: [{ hooks: [hook({}), hook({ key: `${HP}:pre_tool_use:1:0`, eventName: 'preToolUse', trustStatus: 'trusted' }), hook({ key: 'k', command: 'x' })] }] };
  assert.deepEqual(trustSummary(list, OPTS), { ours: 2, trusted: ['preToolUse'], untrusted: ['stop'] });
});

test('isOurs: ignores trust status, requires exact command and user-layer source', () => {
  assert.equal(isOurs(hook({ trustStatus: 'trusted' }), OPTS), true);
  assert.equal(isOurs(hook({ command: CMD + ' ' }), OPTS), false);
  assert.equal(isOurs(hook({ source: 'session' }), OPTS), false);
});
