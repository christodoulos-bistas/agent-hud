import test from 'node:test'; import assert from 'node:assert/strict';
import { pickOurUntrusted, trustEdits, trustSummary, isOurs, findCodexExe } from '../src/main/codex-trust.js';

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

// ---- trustCodexHooks against the fake app-server ----
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { spawn } from 'node:child_process';
import { trustCodexHooks } from '../src/main/codex-trust.js';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-codex-app-server.mjs');
const exe = { file: process.execPath, args: [FIXTURE] };
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

function setup(mode = 'normal', hooks) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-trust-'));
  const state = path.join(dir, 'state.json');
  fs.writeFileSync(state, JSON.stringify({ hooks: hooks || [
    hook({}),
    hook({ key: `${HP}:pre_tool_use:1:0`, eventName: 'preToolUse', trustStatus: 'trusted' }),
    hook({ key: `${HP}:stop:0:0`, command: 'node other.js' }),
  ] }));
  const env = { ...process.env, FAKE_CODEX_STATE: state, FAKE_CODEX_MODE: mode };
  return { dir, state, env, writes: `${state}.writes.jsonl` };
}
const run = (env, extra = {}) => trustCodexHooks({ exe, hooksPath: HP, command: CMD, cwd: os.tmpdir(), env, ...extra });

for (const mode of ['normal', 'noise']) {
  test(mode === 'normal' ? 'trust: untrusted ours -> one batchWrite, now trusted' : 'skips non-JSON lines', async () => {
    const s = setup(mode);
    const r = await run(s.env);
    assert.deepEqual(r, { ok: true, trusted: ['stop'], already: ['preToolUse'], untrusted: [] });
    const lines = fs.readFileSync(s.writes, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
    const w = JSON.parse(lines[0]);
    assert.equal(w.filePath, null); assert.equal(w.expectedVersion, null); assert.equal(w.reloadUserConfig, true);
    assert.equal(w.edits.length, 1);
    assert.deepEqual(w.edits, trustEdits([{ key: `${HP}:stop:2:0`, hash: 'sha256:aa' }]));
    const st = readJson(s.state).hooks;
    assert.equal(st.find((h) => h.command === 'node other.js').trustStatus, 'untrusted');
  });
}

test('all trusted -> no batchWrite', async () => {
  const s = setup('normal', [hook({ trustStatus: 'trusted' })]);
  const r = await run(s.env);
  assert.equal(r.ok, true); assert.deepEqual(r.trusted, []);
  assert.equal(fs.existsSync(s.writes), false);
});

test('hang -> timeout, child killed', async () => {
  const s = setup('hang');
  let child;
  const spawnFn = (...a) => (child = spawn(...a));
  const t0 = Date.now();
  const r = await run(s.env, { timeoutMs: 500, spawnFn });
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(r.ok, false); assert.equal(r.error, 'timeout');
  await new Promise((res) => setTimeout(res, 300));
  assert.ok(child.exitCode !== null || child.signalCode !== null);
});

test('batchWrite error -> rpc', async () => {
  const r = await run(setup('error').env);
  assert.equal(r.ok, false); assert.equal(r.error, 'rpc'); assert.deepEqual(r.untrusted, ['stop']);
});

test('server exits -> exit', async () => {
  const r = await run(setup('exit').env);
  assert.equal(r.ok, false); assert.equal(r.error, 'exit');
});

test('exe null -> not-found', async () => {
  let called = false;
  const r = await trustCodexHooks({ exe: null, hooksPath: HP, command: CMD, cwd: os.tmpdir(), spawnFn: () => { called = true; } });
  assert.deepEqual(r, { ok: false, trusted: [], already: [], untrusted: [], error: 'not-found' });
  assert.equal(called, false);
});

// findCodexExe: every lookup is injected, so no real PowerShell or filesystem is touched.
const LA = 'C:\\Users\\u\\AppData\\Local';
const ALIAS = `${LA}\\Microsoft\\WindowsApps\\chatgpt-desktop.exe`;
const APP = 'C:\\PF\\WindowsApps\\OpenAI.Codex_1\\app';
const ALIAS_EXE = `${APP}\\resources\\codex.exe`;
const APPX_ROOT = 'C:\\PF\\WindowsApps\\OpenAI.Codex_2';
const APPX_EXE = `${APPX_ROOT}\\app\\resources\\codex.exe`;
const finder = ({ env = { LOCALAPPDATA: LA }, readlink, present = [], ps = '' } = {}) => {
  const calls = { readlink: [], ps: [] };
  return {
    calls,
    run: () => findCodexExe({
      env,
      readlink: (p) => { calls.readlink.push(p); return readlink(p); },
      exists: (p) => present.includes(p),
      runPs: async (s) => { calls.ps.push(s); return ps; },
    }),
  };
};
const throwing = () => { throw new Error('nope'); };

test('findCodexExe: env override wins', async () => {
  const f = finder({ env: { AGENT_HUD_CODEX_EXE: 'D:\\x\\codex.exe', LOCALAPPDATA: LA }, readlink: () => `${APP}\\ChatGPT.exe`, present: ['D:\\x\\codex.exe', ALIAS_EXE] });
  assert.deepEqual(await f.run(), { file: 'D:\\x\\codex.exe', args: [] });
});

test('findCodexExe: env override missing on disk -> null, no other lookups', async () => {
  const f = finder({ env: { AGENT_HUD_CODEX_EXE: 'D:\\x\\codex.exe', LOCALAPPDATA: LA }, readlink: () => `${APP}\\ChatGPT.exe`, present: [ALIAS_EXE, APPX_EXE], ps: APPX_ROOT });
  assert.equal(await f.run(), null);
  assert.equal(f.calls.readlink.length, 0);
  assert.equal(f.calls.ps.length, 0);
});

test('findCodexExe: alias link -> resources\\codex.exe', async () => {
  const f = finder({ readlink: () => `${APP}\\ChatGPT.exe`, present: [ALIAS_EXE] });
  assert.deepEqual(await f.run(), { file: ALIAS_EXE, args: [] });
  assert.deepEqual(f.calls.readlink, [ALIAS]);
  assert.equal(f.calls.ps.length, 0);
});

test('findCodexExe: alias throws -> Appx location', async () => {
  const f = finder({ readlink: throwing, present: [APPX_EXE], ps: APPX_ROOT });
  assert.deepEqual(await f.run(), { file: APPX_EXE, args: [] });
  assert.match(f.calls.ps[0], /Get-AppxPackage -Name OpenAI\.Codex/);
});

test('findCodexExe: alias result missing on disk -> Appx location', async () => {
  const f = finder({ readlink: () => `${APP}\\ChatGPT.exe`, present: [APPX_EXE], ps: APPX_ROOT });
  assert.deepEqual(await f.run(), { file: APPX_EXE, args: [] });
});

test('findCodexExe: nothing found -> null', async () => {
  const f = finder({ readlink: throwing, ps: '' });
  assert.equal(await f.run(), null);
});

test('findCodexExe: no LOCALAPPDATA skips the alias step', async () => {
  const f = finder({ env: {}, readlink: () => `${APP}\\ChatGPT.exe`, present: [ALIAS_EXE] });
  assert.equal(await f.run(), null);
  assert.equal(f.calls.readlink.length, 0);
});
