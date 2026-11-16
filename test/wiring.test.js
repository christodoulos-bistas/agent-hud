import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { encodeAnswer, dockBounds, placeBounds, anchorFrom, anchorPoint, createThrottle, createInteractiveCheck, loadConfig, settingsTarget, removeHooksCli } from '../src/main/wiring.js';
import { installHooks, uninstallHooks } from '../src/main/settings-hooks.js';
import { permissionAllow, permissionDeny, choiceAnswer, stopReply } from '../src/main/answers.js';

const SUGG = [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test' }], behavior: 'allow', destination: 'localSettings' }];
const perm = { id: 'p', sessionId: 's1', kind: 'permission', payload: { tool_name: 'Bash', permission_suggestions: SUGG } };
const TI = { questions: [{ question: 'Which?', options: [{ label: 'A' }, { label: 'B' }] }] };
const choice = { id: 'c', sessionId: 's1', kind: 'choice', payload: { tool_input: TI } };
const reply = { id: 'r', sessionId: 's1', kind: 'reply', payload: {} };

test('encodeAnswer: allow without always -> plain allow', () => {
  assert.deepEqual(encodeAnswer(perm, { kind: 'allow', always: false }), permissionAllow());
});
test('encodeAnswer: allow with always forwards the addRules suggestions (R22)', () => {
  assert.deepEqual(encodeAnswer(perm, { kind: 'allow', always: true }), permissionAllow(SUGG));
});
test('I6: allow with always forwards only addRules suggestions; none -> plain allow (spec 6.2, R22)', () => {
  const MODE = { type: 'setMode', mode: 'acceptEdits', destination: 'session' };
  const DIRS = { type: 'addDirectories', directories: ['C:/x'], destination: 'session' };
  const mixed = { ...perm, payload: { ...perm.payload, permission_suggestions: [MODE, ...SUGG, DIRS] } };
  assert.deepEqual(encodeAnswer(mixed, { kind: 'allow', always: true }), permissionAllow(SUGG));
  const none = { ...perm, payload: { ...perm.payload, permission_suggestions: [MODE, DIRS] } };
  assert.deepEqual(encodeAnswer(none, { kind: 'allow', always: true }), permissionAllow());
  const missing = { ...perm, payload: { tool_name: 'Bash' } };
  assert.deepEqual(encodeAnswer(missing, { kind: 'allow', always: true }), permissionAllow());
});
test('encodeAnswer: deny, choice and reply map to their encoders', () => {
  assert.deepEqual(encodeAnswer(perm, { kind: 'deny' }), permissionDeny());
  assert.deepEqual(encodeAnswer(choice, { kind: 'choice', picks: { 'Which?': 'B' } }), choiceAnswer(TI, { 'Which?': 'B' }));
  assert.deepEqual(encodeAnswer(reply, { kind: 'reply', text: 'carry on' }), stopReply('carry on'));
});
test('encodeAnswer: answers that do not fit the item kind, or are malformed, are refused (null)', () => {
  assert.equal(encodeAnswer(choice, { kind: 'allow', always: false }), null);
  assert.equal(encodeAnswer(perm, { kind: 'reply', text: 'x' }), null);
  assert.equal(encodeAnswer(reply, { kind: 'reply', text: '   ' }), null);
  assert.equal(encodeAnswer(choice, { kind: 'choice', picks: null }), null);
  assert.equal(encodeAnswer(perm, null), null);
  assert.equal(encodeAnswer(null, { kind: 'deny' }), null);
});

test('dockBounds: bottom-right of the work area with a 16 px margin', () => {
  const wa = { x: 0, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(dockBounds(wa, 272, 300), { x: 1920 - 272 - 16, y: 1040 - 300 - 16, width: 272, height: 300 });
});
test('dockBounds: height capped at 60% of the work-area height; offset work areas respected', () => {
  const wa = { x: 100, y: 50, width: 1000, height: 1000 };
  assert.deepEqual(dockBounds(wa, 72, 5000), { x: 100 + 1000 - 72 - 16, y: 50 + 1000 - 600 - 16, width: 72, height: 600 });
  assert.equal(dockBounds(wa, 272, 0).height, 1);
  assert.equal(dockBounds(wa, 272, 120.4).height, 121);
});

function fakeClock() {
  let t = 0; const timers = [];
  return {
    now: () => t,
    setTimer: (fn, ms) => { timers.push({ fn, at: t + ms }); return timers.length; },
    advance(ms) {
      t += ms;
      for (const x of timers) if (!x.done && x.at <= t) { x.done = true; x.fn(); }
    },
  };
}
test('move: anchorFrom keeps the edges nearest the window centre', () => {
  const wa = { x: 0, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(anchorFrom({ x: 1500, y: 700, width: 272, height: 300 }, wa), { h: 'right', v: 'bottom', x: 1772, y: 1000 });
  assert.deepEqual(anchorFrom({ x: 40, y: 30, width: 272, height: 300 }, wa), { h: 'left', v: 'top', x: 40, y: 30 });
  assert.deepEqual(anchorFrom({ x: 1600, y: 20, width: 272, height: 200 }, wa), { h: 'right', v: 'top', x: 1872, y: 20 });
});
test('move: placeBounds without an anchor is the default bottom-right dock', () => {
  const wa = { x: 0, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(placeBounds(wa, 272, 300, undefined), dockBounds(wa, 272, 300));
  assert.deepEqual(placeBounds(wa, 272, 300, { h: 'sideways', v: 'top', x: 1, y: 1 }), dockBounds(wa, 272, 300));
});
test('move: a bottom-right anchor grows upward and collapses toward the right edge', () => {
  const wa = { x: 0, y: 0, width: 1920, height: 1040 };
  const a = { h: 'right', v: 'bottom', x: 1772, y: 1000 };
  assert.deepEqual(placeBounds(wa, 272, 300, a), { x: 1500, y: 700, width: 272, height: 300 });
  assert.deepEqual(placeBounds(wa, 272, 500, a), { x: 1500, y: 500, width: 272, height: 500 });
  assert.deepEqual(placeBounds(wa, 72, 300, a), { x: 1700, y: 700, width: 72, height: 300 });
});
test('move: a top-left anchor grows downward; height still capped at 60% of the work area', () => {
  const wa = { x: 0, y: 0, width: 1920, height: 1000 };
  const a = { h: 'left', v: 'top', x: 40, y: 30 };
  assert.deepEqual(placeBounds(wa, 272, 300, a), { x: 40, y: 30, width: 272, height: 300 });
  assert.deepEqual(placeBounds(wa, 272, 5000, a), { x: 40, y: 30, width: 272, height: 600 });
});
test('move: the HUD is kept fully inside the work area (dragged off-screen or display shrank)', () => {
  const wa = { x: 1920, y: 0, width: 1280, height: 1000 };
  assert.deepEqual(placeBounds(wa, 272, 300, { h: 'left', v: 'top', x: 3300, y: -50 }), { x: 1920 + 1280 - 272, y: 0, width: 272, height: 300 });
  assert.deepEqual(placeBounds(wa, 272, 300, { h: 'right', v: 'bottom', x: 100, y: 5000 }), { x: 1920, y: 700, width: 272, height: 300 });
});
test('move: anchorPoint lies just inside the anchored corner, so a shared monitor edge picks the right display', () => {
  assert.deepEqual(anchorPoint({ h: 'right', v: 'bottom', x: 1920, y: 1040 }), { x: 1919, y: 1039 });
  assert.deepEqual(anchorPoint({ h: 'left', v: 'top', x: 1920, y: 0 }), { x: 1920, y: 0 });
});

test('createThrottle: first call runs at once, a burst collapses into one trailing call', () => {
  const c = fakeClock(); let n = 0;
  const push = createThrottle(() => { n++; }, 100, c);
  push(); assert.equal(n, 1);
  c.advance(10); push(); push(); push(); assert.equal(n, 1);
  c.advance(89); assert.equal(n, 1);
  c.advance(1); assert.equal(n, 2);
  c.advance(500); assert.equal(n, 2);
  push(); assert.equal(n, 3);
});
test('createThrottle: a call during the window is never lost', () => {
  const c = fakeClock(); let n = 0;
  const push = createThrottle(() => { n++; }, 100, c);
  push(); c.advance(99); push(); c.advance(1); assert.equal(n, 2);
});

test('I10: removeHooksCli removes the HUD hooks from the target file and never throws', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-rm-'));
  try {
    const file = path.join(dir, 'settings.json');
    const user = { model: 'm', hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'echo hi' }] }] } };
    fs.writeFileSync(file, JSON.stringify(user, null, 2) + '\n');
    assert.equal(installHooks(file, { port: 47821, secret: 'k' }).ok, true);
    const r = removeHooksCli({ target: { path: file, blocked: false }, uninstall: uninstallHooks });
    assert.equal(r.ok, true);
    assert.match(r.message, /removed/);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), user);
    assert.match(removeHooksCli({ target: { path: file, blocked: false }, uninstall: uninstallHooks }).message, /no hooks to remove/);
    const bad = removeHooksCli({ target: { path: file, blocked: false }, uninstall: () => { throw new Error('locked'); } });
    assert.equal(bad.ok, false); assert.match(bad.message, /locked/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('I10: removeHooksCli on a blocked dev build touches nothing', () => {
  let calls = 0;
  const r = removeHooksCli({ target: { path: null, blocked: true }, uninstall: () => { calls++; return { ok: true }; } });
  assert.equal(calls, 0); assert.equal(r.ok, false); assert.match(r.message, /AGENT_HUD_SETTINGS_PATH/);
});

test('I9b: createThrottle does not freeze when the clock steps backwards', () => {
  let t = 1_000_000; const timers = [];
  const clock = {
    now: () => t,
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
  };
  let n = 0;
  const push = createThrottle(() => { n++; }, 100, clock);
  push(); assert.equal(n, 1);
  t = 1000; // the wall clock jumps back ~16 minutes
  push(); assert.equal(n, 1);
  assert.equal(timers.length, 1);
  assert.ok(timers[0].ms <= 100, `trailing call waits at most one window, not ${timers[0].ms} ms`);
  timers[0].fn(); assert.equal(n, 2);
  t += 100; push(); assert.equal(n, 3, 'and runs normally afterwards');
});

test('isInteractive: known sessions decide from kind without re-reading', () => {
  let reads = 0;
  const check = createInteractiveCheck({
    current: () => [{ sessionId: 'a', kind: 'interactive' }, { sessionId: 'b', kind: 'sdk-cli' }],
    reread: () => { reads++; return []; },
  });
  assert.equal(check('a'), true); assert.equal(check('b'), false); assert.equal(reads, 0);
});
test('isInteractive: a missing id re-reads the session files once, then decides; still unknown -> false', () => {
  let reads = 0;
  const check = createInteractiveCheck({
    current: () => [],
    reread: () => { reads++; return [{ sessionId: 'n', kind: 'interactive' }]; },
  });
  assert.equal(check('n'), true); assert.equal(reads, 1);
  assert.equal(check('ghost'), false); assert.equal(reads, 2);
});
test('isInteractive: a throwing re-read counts as unknown (false)', () => {
  const check = createInteractiveCheck({ current: () => [], reread: () => { throw new Error('io'); } });
  assert.equal(check('x'), false);
});

test('loadConfig: creates config.json with port 47821 and a 32-hex secret, then keeps it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-cfg-'));
  try {
    const file = path.join(dir, 'sub', 'config.json');
    const a = loadConfig(file);
    assert.equal(a.port, 47821);
    assert.match(a.secret, /^[0-9a-f]{32}$/);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), a);
    const b = loadConfig(file);
    assert.deepEqual(b, a);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('loadConfig: keeps a custom port and extra keys; repairs a missing secret; survives a corrupt file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-cfg-'));
  try {
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(file, JSON.stringify({ port: 50000, offeredHooks: true }));
    const a = loadConfig(file);
    assert.equal(a.port, 50000); assert.equal(a.offeredHooks, true); assert.match(a.secret, /^[0-9a-f]{32}$/);
    fs.writeFileSync(file, '{not json');
    const b = loadConfig(file);
    assert.equal(b.port, 47821); assert.match(b.secret, /^[0-9a-f]{32}$/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('I1: settingsTarget: a dev build without AGENT_HUD_SETTINGS_PATH is blocked and never names the global file', () => {
  const home = 'C:/Users/u';
  assert.deepEqual(settingsTarget({ isPackaged: false, envPath: undefined, home }), { path: null, blocked: true });
  assert.deepEqual(settingsTarget({ isPackaged: false, envPath: '', home }), { path: null, blocked: true });
  assert.deepEqual(settingsTarget({ isPackaged: false, envPath: 'C:/spike/s.json', home }), { path: 'C:/spike/s.json', blocked: false });
});
test('I1: settingsTarget: the packaged app uses ~/.claude/settings.json unless the env override is set', () => {
  const home = 'C:/Users/u';
  assert.deepEqual(settingsTarget({ isPackaged: true, envPath: undefined, home }), { path: path.join(home, '.claude', 'settings.json'), blocked: false });
  assert.deepEqual(settingsTarget({ isPackaged: true, envPath: 'C:/x.json', home }), { path: 'C:/x.json', blocked: false });
});
