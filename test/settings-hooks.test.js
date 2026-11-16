import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { HUD_EVENTS, buildHookEntries, mergeHooks, unmergeHooks, installHooks, uninstallHooks } from '../src/main/settings-hooks.js';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'settings.user.json');
const load = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const entries = (port = 4321, secret = 's3cret') => buildHookEntries({ port, secret });
const isHud = (g) => g.hooks.some((h) => h.type === 'http' && h.url.includes('/agent-hud/'));

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hud-'));
  return { dir, file: path.join(dir, 'settings.json'), done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('buildHookEntries shape', () => {
  const e = entries(1234, 'abc');
  assert.deepEqual(Object.keys(e), HUD_EVENTS);
  assert.deepEqual(e.Stop, [{ matcher: '', hooks: [{ type: 'http', url: 'http://127.0.0.1:1234/agent-hud/hook', headers: { 'X-Agent-HUD': 'abc' }, timeout: 600 }] }]);
});

test('merge adds one http group per HUD event and keeps every existing group in order', () => {
  const x = load();
  const m = mergeHooks(x, entries());
  for (const ev of HUD_EVENTS) {
    const before = x.hooks[ev] ?? [];
    assert.deepEqual(m.hooks[ev].slice(0, before.length), before);
    assert.equal(m.hooks[ev].length, before.length + 1);
    assert.equal(m.hooks[ev].filter(isHud).length, 1);
    assert.ok(isHud(m.hooks[ev].at(-1)));
  }
  assert.deepEqual(m.hooks.TeammateIdle, x.hooks.TeammateIdle);
  assert.deepEqual(m.hooks.TaskCompleted, x.hooks.TaskCompleted);
  assert.deepEqual(m.env, x.env);
  assert.deepEqual(m.mcpServers, x.mcpServers);
  assert.deepEqual(x, load(), 'input not mutated');
});

test('merge twice equals merge once (deepEqual)', () => {
  const once = mergeHooks(load(), entries());
  assert.deepEqual(mergeHooks(once, entries()), once);
});

test('re-merge with a new port leaves exactly one HUD group per event with the new URL', () => {
  const m = mergeHooks(mergeHooks(load(), entries(1111, 'a')), entries(2222, 'b'));
  for (const ev of HUD_EVENTS) {
    const hud = m.hooks[ev].filter(isHud);
    assert.equal(hud.length, 1);
    assert.equal(hud[0].hooks[0].url, 'http://127.0.0.1:2222/agent-hud/hook');
    assert.equal(hud[0].hooks[0].headers['X-Agent-HUD'], 'b');
  }
});

test('unmerge(merge(x)) deepEquals x', () => {
  const x = load();
  assert.deepEqual(unmergeHooks(mergeHooks(x, entries())), x);
});

test('merge works when settings has no hooks key, and round-trips', () => {
  const x = { model: 'm', env: { A: '1' } };
  const m = mergeHooks(x, entries());
  assert.equal(Object.keys(m.hooks).length, HUD_EVENTS.length);
  assert.deepEqual(unmergeHooks(m), x);
  assert.ok(!('hooks' in unmergeHooks(m)));
});

test('installHooks on unparseable file returns ok:false and leaves the file byte-identical', () => {
  const t = tmp();
  try {
    const bytes = Buffer.from('{ "hooks": { oops', 'utf8');
    fs.writeFileSync(t.file, bytes);
    const r = installHooks(t.file, { port: 1, secret: 's' });
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, 'string');
    assert.ok(fs.readFileSync(t.file).equals(bytes));
    assert.ok(!fs.existsSync(t.file + '.agent-hud.bak'));
    assert.equal(uninstallHooks(t.file).ok, false);
    assert.ok(fs.readFileSync(t.file).equals(bytes));
  } finally { t.done(); }
});

test('installHooks writes a .agent-hud.bak identical to the original', () => {
  const t = tmp();
  try {
    fs.copyFileSync(FIXTURE, t.file);
    const orig = fs.readFileSync(t.file);
    const r = installHooks(t.file, { port: 4321, secret: 'k' });
    assert.equal(r.ok, true);
    assert.equal(r.backup, path.resolve(t.file + '.agent-hud.bak'));
    assert.ok(fs.readFileSync(r.backup).equals(orig));
    const after = JSON.parse(fs.readFileSync(t.file, 'utf8'));
    assert.deepEqual(after, mergeHooks(load(), entries(4321, 'k')));
    assert.deepEqual(fs.readdirSync(t.dir).sort(), ['settings.json', 'settings.json.agent-hud.bak']);
  } finally { t.done(); }
});

test('BOM-prefixed file installs; no BOM written back', () => {
  const t = tmp();
  try {
    fs.writeFileSync(t.file, '﻿' + fs.readFileSync(FIXTURE, 'utf8'));
    const r = installHooks(t.file, { port: 4321, secret: 'k' });
    assert.equal(r.ok, true);
    const buf = fs.readFileSync(t.file);
    assert.notEqual(buf[0], 0xEF);
    assert.deepEqual(JSON.parse(buf.toString('utf8')), mergeHooks(load(), entries(4321, 'k')));
  } finally { t.done(); }
});

test('preserves CRLF and trailing newline; preserves LF and no trailing newline', () => {
  const t = tmp();
  try {
    const crlf = JSON.stringify(load(), null, 2).replace(/\n/g, '\r\n') + '\r\n';
    fs.writeFileSync(t.file, crlf);
    assert.equal(installHooks(t.file, { port: 1, secret: 's' }).ok, true);
    const a = fs.readFileSync(t.file, 'utf8');
    assert.ok(a.endsWith('}\r\n'));
    assert.ok(!/[^\r]\n/.test(a));
    fs.writeFileSync(t.file, JSON.stringify(load(), null, 4));
    assert.equal(installHooks(t.file, { port: 1, secret: 's' }).ok, true);
    const b = fs.readFileSync(t.file, 'utf8');
    assert.ok(!b.includes('\r') && !b.endsWith('\n'));
    assert.ok(b.includes('\n  "env"'), '2-space indent');
  } finally { t.done(); }
});

test('missing file: install creates only hooks, backup null; uninstall then removes them', () => {
  const t = tmp();
  try {
    const r = installHooks(t.file, { port: 9, secret: 's' });
    assert.deepEqual(r, { ok: true, backup: null });
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(t.file, 'utf8'))), ['hooks']);
    assert.equal(uninstallHooks(t.file).ok, true);
    assert.deepEqual(JSON.parse(fs.readFileSync(t.file, 'utf8')), {});
  } finally { t.done(); }
});

test('uninstallHooks backs up and restores the original content', () => {
  const t = tmp();
  try {
    fs.copyFileSync(FIXTURE, t.file);
    installHooks(t.file, { port: 4321, secret: 'k' });
    const installed = fs.readFileSync(t.file);
    const r = uninstallHooks(t.file);
    assert.equal(r.ok, true);
    assert.ok(fs.readFileSync(r.backup).equals(installed));
    assert.deepEqual(JSON.parse(fs.readFileSync(t.file, 'utf8')), load());
  } finally { t.done(); }
});

test('uninstall on missing file is ok with no backup and creates nothing', () => {
  const t = tmp();
  try {
    assert.deepEqual(uninstallHooks(t.file), { ok: true, backup: null });
    assert.ok(!fs.existsSync(t.file));
  } finally { t.done(); }
});

const USER_CMD = { type: 'command', command: 'node "C:/example/user-hook.js"' };
const mixed = () => {
  const x = load();
  x.hooks.UserPromptSubmit = [{ matcher: '', hooks: [entries().UserPromptSubmit[0].hooks[0], structuredClone(USER_CMD)] }];
  return x;
};

test('unmerge keeps a mixed group with only the user hook', () => {
  const u = unmergeHooks(mixed());
  assert.deepEqual(u.hooks.UserPromptSubmit, [{ matcher: '', hooks: [USER_CMD] }]);
});

test('merge keeps the user hook in a mixed group and appends exactly one HUD group', () => {
  const m = mergeHooks(mixed(), entries());
  const g = m.hooks.UserPromptSubmit;
  assert.equal(g.length, 2);
  assert.deepEqual(g[0], { matcher: '', hooks: [USER_CMD] });
  assert.equal(g.filter(isHud).length, 1);
  assert.ok(isHud(g[1]));
});

test('installHooks twice on a mixed group never loses the user hook', () => {
  const t = tmp();
  try {
    fs.writeFileSync(t.file, JSON.stringify(mixed(), null, 2) + '\n');
    assert.equal(installHooks(t.file, { port: 1, secret: 'a' }).ok, true);
    assert.equal(installHooks(t.file, { port: 2, secret: 'b' }).ok, true);
    const g = JSON.parse(fs.readFileSync(t.file, 'utf8')).hooks.UserPromptSubmit;
    assert.deepEqual(g[0], { matcher: '', hooks: [USER_CMD] });
    assert.equal(g.filter(isHud).length, 1);
    assert.equal(g.length, 2);
  } finally { t.done(); }
});
