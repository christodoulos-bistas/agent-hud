import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { encodeAnswer, dockBounds, createThrottle, createInteractiveCheck, loadConfig, settingsTarget } from '../src/main/wiring.js';
import { permissionAllow, permissionDeny, choiceAnswer, stopReply } from '../src/main/answers.js';

const SUGG = [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test' }], behavior: 'allow', destination: 'localSettings' }];
const perm = { id: 'p', sessionId: 's1', kind: 'permission', payload: { tool_name: 'Bash', permission_suggestions: SUGG } };
const TI = { questions: [{ question: 'Which?', options: [{ label: 'A' }, { label: 'B' }] }] };
const choice = { id: 'c', sessionId: 's1', kind: 'choice', payload: { tool_input: TI } };
const reply = { id: 'r', sessionId: 's1', kind: 'reply', payload: {} };

test('encodeAnswer: allow without always -> plain allow', () => {
  assert.deepEqual(encodeAnswer(perm, { kind: 'allow', always: false }), permissionAllow());
});
test('encodeAnswer: allow with always forwards permission_suggestions unchanged (R20)', () => {
  assert.deepEqual(encodeAnswer(perm, { kind: 'allow', always: true }), permissionAllow(SUGG));
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
