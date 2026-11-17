import test from 'node:test'; import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { readConfig, timeoutFor, forward } = require('../resources/codex-bridge.cjs');

function listen(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}
const close = (srv) => new Promise((r) => { srv.closeAllConnections?.(); srv.close(r); });

test('forward passes a 200 body through and sends both headers and the body verbatim', async () => {
  let seen;
  const { srv, port } = await listen((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { seen = { headers: req.headers, body }; res.end('{"ok":true}'); });
  });
  try {
    const input = '{"hook_event_name":"PreToolUse"}';
    const reply = await forward(input, { port, secret: 's', timeoutMs: 2000 });
    assert.equal(reply, '{"ok":true}');
    assert.equal(seen.headers['x-agent-hud'], 's');
    assert.equal(seen.headers['x-agent-hud-source'], 'codex');
    assert.equal(seen.body, input);
  } finally { await close(srv); }
});

test('forward returns "" for non-200, empty 200, refused port (under 2.5 s) and a stalled server past timeoutMs', async () => {
  const s403 = await listen((req, res) => { req.resume(); res.statusCode = 403; res.end('nope'); });
  const s200 = await listen((req, res) => { req.resume(); res.end(''); });
  const stall = await listen((req) => { req.resume(); });
  const dead = await listen(() => {});
  const deadPort = dead.port;
  await close(dead.srv);
  try {
    assert.equal(await forward('{}', { port: s403.port, secret: 's', timeoutMs: 2000 }), '');
    assert.equal(await forward('{}', { port: s200.port, secret: 's', timeoutMs: 2000 }), '');
    const t0 = Date.now();
    assert.equal(await forward('{}', { port: deadPort, secret: 's', timeoutMs: 5000 }), '');
    assert.ok(Date.now() - t0 < 2500);
    assert.equal(await forward('{}', { port: stall.port, secret: 's', timeoutMs: 200 }), '');
  } finally { await close(s403.srv); await close(s200.srv); await close(stall.srv); }
});

test('Review Focus 1: the server dropping the socket mid-request gives "" promptly', async () => {
  const { srv, port } = await listen((req) => { req.resume(); setTimeout(() => req.socket.destroy(), 50); });
  try {
    const t0 = Date.now();
    assert.equal(await forward('{}', { port, secret: 's', timeoutMs: 5000 }), '');
    assert.ok(Date.now() - t0 < 1000);
  } finally { await close(srv); }
});

test('timeoutFor: 590000 for PermissionRequest, 5000 for others', () => {
  assert.equal(timeoutFor('PermissionRequest'), 590000);
  assert.equal(timeoutFor('PreToolUse'), 5000);
  assert.equal(timeoutFor(undefined), 5000);
});

test('readConfig: valid → {port, secret}; missing file, bad JSON, missing secret → null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-bridge-'));
  try {
    const f = path.join(dir, 'config.json');
    fs.writeFileSync(f, JSON.stringify({ port: 4321, secret: 'abc', other: 1 }));
    assert.deepEqual(readConfig(f), { port: 4321, secret: 'abc' });
    assert.equal(readConfig(path.join(dir, 'missing.json')), null);
    fs.writeFileSync(f, '{not json');
    assert.equal(readConfig(f), null);
    fs.writeFileSync(f, JSON.stringify({ port: 4321 }));
    assert.equal(readConfig(f), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('codex-hook.cmd runs the HUD exe as Node on the bridge', () => {
  const text = fs.readFileSync(path.join(root, 'resources', 'codex-hook.cmd'), 'utf8');
  assert.ok(text.includes('set ELECTRON_RUN_AS_NODE=1'));
  assert.ok(text.includes('"%~dp0..\\Agent HUD.exe" "%~dp0codex-bridge.cjs"'));
});

test('package.json ships both resources and never disables RunAsNode', () => {
  const text = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
  const pkg = JSON.parse(text);
  const filters = pkg.build.extraResources.flatMap((e) => e.filter || []);
  assert.ok(filters.includes('codex-bridge.cjs'));
  assert.ok(filters.includes('codex-hook.cmd'));
  assert.doesNotMatch(text, /runAsNode"?\s*:\s*false/i);
  assert.doesNotMatch(text, /electronFuses/);
});
