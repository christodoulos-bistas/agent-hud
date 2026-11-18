import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { encodeAnswer, dockBounds, placeBounds, anchorFrom, anchorPoint, snapBounds, panelBounds, panelTarget, autoSelect, userSelect, createThrottle, createInteractiveCheck, loadConfig, settingsTarget, codexTarget, codexOfferDue, codexTrustDue, codexStatus, codexStatusLabel, removeHooksCli, guarded, releaseFocusOf, closeApplies, hudCard } from '../src/main/wiring.js';
import { installHooks, uninstallHooks } from '../src/main/settings-hooks.js';
import { installCodexHooksFile, removeCodexHooksFile, codexHookCommand } from '../src/main/codex-hooks.js';
import { permissionAllow, permissionDeny, choiceAnswer, stopReply, planApprove, planKeepPlanning, PLAN_MODES } from '../src/main/answers.js';
import { recordText, recordAllowed } from '../src/main/records.js';

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

test('panelBounds: HUD in the right half → panel on the left, 8 px gap, arrow at the row', () => {
  const wa = { x: 0, y: 0, width: 1920, height: 1040 };
  const hud = { x: 1632, y: 600, width: 272, height: 400 };
  assert.deepEqual(panelBounds(hud, wa, { height: 300, rowY: 100 }),
    { x: 1632 - 8 - 340, y: 660, width: 340, height: 300, side: 'left', arrowY: 40 });
});
test('panelBounds: HUD in the left half → panel on the right', () => {
  const wa = { x: 0, y: 0, width: 1920, height: 1040 };
  const hud = { x: 16, y: 100, width: 272, height: 400 };
  assert.deepEqual(panelBounds(hud, wa, { height: 200, rowY: 60 }),
    { x: 16 + 272 + 8, y: 120, width: 340, height: 200, side: 'right', arrowY: 40 });
});
test("panelBounds: preferred side doesn't fit → other side; neither fits → side with more room, clamped inside the work area", () => {
  // The preferred side always has at least as much room as the other (room left − room right is twice
  // the HUD centre's offset from the work area's middle), so when it doesn't fit, the other doesn't
  // either and the "more room" rule decides: the panel may then overlap the HUD, clamped inside.
  const wa = { x: 0, y: 0, width: 800, height: 1000 };
  assert.deepEqual(panelBounds({ x: 400, y: 300, width: 272, height: 300 }, wa, { height: 200, rowY: 40 }),
    { x: 52, y: 300, width: 340, height: 200, side: 'left', arrowY: 40 }, 'fits on the preferred side');
  const left = panelBounds({ x: 300, y: 300, width: 272, height: 300 }, wa, { height: 200, rowY: 40 });
  assert.equal(left.side, 'left'); assert.equal(left.x, 0, '300 px of room on the left, 228 on the right');
  const right = panelBounds({ x: 220, y: 300, width: 272, height: 300 }, wa, { height: 200, rowY: 40 });
  assert.equal(right.side, 'right'); assert.equal(right.x, 800 - 340, '308 px of room on the right, 220 on the left');
  const second = panelBounds({ x: 2150, y: 300, width: 272, height: 300 }, { x: 1920, y: 0, width: 700, height: 1000 }, { height: 200, rowY: 40 });
  assert.equal(second.side, 'left'); assert.equal(second.x, 1920, 'an offset work area clamps to its own left edge');
});
test('panelBounds: height capped at 60% of the work area; y clamped inside it; arrowY between 16 and height-16', () => {
  const wa = { x: 0, y: 40, width: 1920, height: 1000 };
  const low = panelBounds({ x: 1632, y: 640, width: 272, height: 384 }, wa, { height: 5000, rowY: 350 });
  assert.equal(low.height, 600);
  assert.equal(low.y, 40 + 1000 - 600, 'pushed up so the bottom stays inside');
  assert.equal(low.arrowY, 640 + 350 - low.y);
  const top = panelBounds({ x: 1632, y: 40, width: 272, height: 384 }, wa, { height: 300, rowY: 10 });
  assert.equal(top.y, 40, 'never above the work area');
  assert.equal(top.arrowY, 16, 'row above the panel top: arrow pinned 16 px down');
  const bottom = panelBounds({ x: 1632, y: 640, width: 272, height: 384 }, wa, { height: 200, rowY: 390 });
  assert.equal(bottom.y, 40 + 1000 - 200);
  assert.equal(bottom.arrowY, 200 - 16, 'row below the panel bottom: arrow pinned 16 px up');
});
test('panelTarget: null when collapsed, hidden, or the agent is not in the snapshot (Review Focus 4); the id otherwise', () => {
  const snap = { agents: [{ id: 's1' }, { id: 's2' }] };
  assert.equal(panelTarget('s1', snap, { collapsed: false, visible: true }), 's1');
  assert.equal(panelTarget('s1', snap, { collapsed: true, visible: true }), null);
  assert.equal(panelTarget('s1', snap, { collapsed: false, visible: false }), null);
  assert.equal(panelTarget('gone', snap, { collapsed: false, visible: true }), null);
  assert.equal(panelTarget(null, snap, { collapsed: false, visible: true }), null);
  assert.equal(panelTarget('s1', null, { collapsed: false, visible: true }), null);
});

test('panelTarget: collapsed + hasCard → id; collapsed without card → null; hidden → null (Review Focus 4)', () => {
  const snap = { agents: [{ id: 's1' }, { id: 's2' }] };
  assert.equal(panelTarget('s1', snap, { collapsed: true, visible: true, hasCard: true }), 's1', 'the asking agent opens beside the collapsed face');
  assert.equal(panelTarget('s1', snap, { collapsed: true, visible: true, hasCard: false }), null);
  assert.equal(panelTarget('s1', snap, { collapsed: true, visible: false, hasCard: true }), null, 'a hidden HUD never has a panel');
  assert.equal(panelTarget('s1', snap, { collapsed: false, visible: false, hasCard: true }), null);
  assert.equal(panelTarget('gone', snap, { collapsed: true, visible: true, hasCard: true }), null, 'still only agents in the snapshot');
  assert.equal(panelTarget('s1', snap, { collapsed: false, visible: true, hasCard: true }), 's1');
});

test('panelBounds: a selection without a known row (rowY null) sits level with the HUD top, like no rowY', () => {
  const wa = { x: 0, y: 0, width: 1920, height: 1040 };
  const hud = { x: 1632, y: 600, width: 272, height: 400 };
  assert.deepEqual(panelBounds(hud, wa, { height: 300, rowY: null }), panelBounds(hud, wa, { height: 300 }));
  assert.equal(panelBounds(hud, wa, { height: 300, rowY: null }).y, 600);
});

const NONE = { selected: null, auto: false, before: null, cardId: null };
const qcard = (id, sessionId) => ({ id, sessionId, kind: 'permission' });

test('autoSelect: new card opens its agent (auto), remembers the previous manual selection, restores it when the card goes; restores null when nothing was open', () => {
  const manual = { id: 's2', rowY: 120 };
  let s = autoSelect({ ...NONE, selected: manual }, qcard('c1', 's1'));
  assert.deepEqual(s, { selected: { id: 's1', rowY: null }, auto: true, before: manual, cardId: 'c1' });
  assert.deepEqual(autoSelect(s, qcard('c1', 's1')), s, 'the same card id changes nothing');
  s = autoSelect(s, null);
  assert.deepEqual(s, { selected: manual, auto: false, before: null, cardId: null }, 'back to what was open');

  let t = autoSelect(NONE, qcard('c1', 's1'));
  assert.deepEqual(t, { selected: { id: 's1', rowY: null }, auto: true, before: null, cardId: 'c1' });
  t = autoSelect(t, null);
  assert.deepEqual(t, NONE, 'opened by itself: closes again');

  // The asking agent was already the one open: it stays, row position kept, and stays open afterwards.
  const same = { id: 's1', rowY: 88 };
  let u = autoSelect({ ...NONE, selected: same }, qcard('c1', 's1'));
  assert.deepEqual(u, { selected: { id: 's1', rowY: 88 }, auto: true, before: same, cardId: 'c1' });
  u = autoSelect(u, null);
  assert.deepEqual(u.selected, same);
  assert.equal(u.auto, false);

  assert.deepEqual(autoSelect(NONE, null), NONE, 'no card, nothing open: nothing changes');
});

test('autoSelect: a second card while auto keeps the original before', () => {
  const manual = { id: 's2', rowY: 120 };
  let s = autoSelect({ ...NONE, selected: manual }, qcard('c1', 's1'));
  s = autoSelect(s, qcard('c2', 's3'));
  assert.deepEqual(s, { selected: { id: 's3', rowY: null }, auto: true, before: manual, cardId: 'c2' });
  s = autoSelect(s, qcard('c1', 's1')); // c1 comes back after c2 pre-empted it
  assert.deepEqual(s, { selected: { id: 's1', rowY: null }, auto: true, before: manual, cardId: 'c1' });
  s = autoSelect(s, null);
  assert.deepEqual(s.selected, manual);
  assert.equal(s.auto, false);
});

test('userSelect during a question: the manual choice stands until a different card id arrives (Review Focus 2)', () => {
  let s = autoSelect(NONE, qcard('c1', 's1'));
  s = userSelect(s, { id: 's2', rowY: 80 });
  assert.deepEqual(s, { selected: { id: 's2', rowY: 80 }, auto: false, before: null, cardId: 'c1' });
  assert.deepEqual(autoSelect(s, qcard('c1', 's1')), s, 'the current question does not re-open');
  assert.deepEqual(autoSelect(s, null).selected, { id: 's2', rowY: 80 }, 'the question goes: the manual choice stays');
  const closed = userSelect(s, null);
  assert.deepEqual(closed, { selected: null, auto: false, before: null, cardId: 'c1' }, '✕ during a question');
  assert.deepEqual(autoSelect(closed, qcard('c1', 's1')), closed, 'closing keeps it closed for this question');
  const next = autoSelect(s, qcard('c2', 's3'));
  assert.deepEqual(next, { selected: { id: 's3', rowY: null }, auto: true, before: { id: 's2', rowY: 80 }, cardId: 'c2' }, 'a different card id opens again');
});

test('card answered natively (card null) → back to before (Review Focus 3)', () => {
  const manual = { id: 's2', rowY: 64 };
  let s = autoSelect({ ...NONE, selected: manual }, qcard('c1', 's1'));
  // answered in the agent's own window: the hook request ends, the queue drops c1, and the next snapshot has no card
  s = autoSelect(s, null);
  assert.deepEqual(s, { selected: manual, auto: false, before: null, cardId: null });
  // a queued question behind it becomes the active card instead: it opens, still returning to the manual choice
  let q = autoSelect({ ...NONE, selected: manual }, qcard('c1', 's1'));
  q = autoSelect(q, qcard('c2', 's1'));
  assert.deepEqual(q, { selected: { id: 's1', rowY: null }, auto: true, before: manual, cardId: 'c2' });
  assert.deepEqual(autoSelect(q, null).selected, manual);
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

test('snap: dropped within 24 px of an edge -> lined up 16 px in from it', () => {
  const wa = { x: 0, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(snapBounds({ x: 10, y: 400, width: 272, height: 300 }, wa), { x: 16, y: 400, width: 272, height: 300 });
  assert.deepEqual(snapBounds({ x: 30, y: 400, width: 272, height: 300 }, wa), { x: 30, y: 400, width: 272, height: 300 }, '30 px away: left alone');
  assert.deepEqual(snapBounds({ x: 1920 - 272 - 5, y: 400, width: 272, height: 300 }, wa), { x: 1920 - 272 - 16, y: 400, width: 272, height: 300 });
  assert.deepEqual(snapBounds({ x: 800, y: 1040 - 300 - 20, width: 272, height: 300 }, wa), { x: 800, y: 1040 - 300 - 16, width: 272, height: 300 });
});
test('snap: near two edges -> into that corner; past the edge counts as near', () => {
  const wa = { x: 0, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(snapBounds({ x: 3, y: -40, width: 272, height: 300 }, wa), { x: 16, y: 16, width: 272, height: 300 });
  assert.deepEqual(snapBounds({ x: 1920 - 272 + 50, y: 1040 - 300 - 2, width: 272, height: 300 }, wa), { x: 1920 - 272 - 16, y: 1040 - 300 - 16, width: 272, height: 300 });
});
test('snap: works on a second monitor with an offset work area', () => {
  const wa = { x: 1920, y: 0, width: 1280, height: 1000 };
  assert.deepEqual(snapBounds({ x: 1925, y: 990 - 300, width: 272, height: 300 }, wa), { x: 1936, y: 1000 - 300 - 16, width: 272, height: 300 });
  assert.deepEqual(snapBounds({ x: 2400, y: 500, width: 272, height: 300 }, wa), { x: 2400, y: 500, width: 272, height: 300 });
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

test('I4: guarded runs the function, and a throw is logged with its label instead of escaping', () => {
  const logged = [];
  const log = (label, err) => logged.push([label, err.message]);
  assert.equal(guarded('add', (a, b) => a + b, log)(2, 3), 5);
  const boom = guarded('stage tick', () => { throw new Error('bad view'); }, log);
  assert.doesNotThrow(() => boom());
  assert.equal(boom(), undefined);
  assert.deepEqual(logged[0], ['stage tick', 'bad view']);
  const worse = guarded('push', () => { throw new Error('x'); }, () => { throw new Error('log broke'); });
  assert.doesNotThrow(() => worse(), 'a throwing logger never escapes either');
});

// A fake BrowserWindow for releaseFocusOf: records the calls that can move the foreground.
const fakeWin = ({ focusable = false, focused = false, destroyed = false, onTop = false } = {}) => {
  const calls = [];
  return {
    calls,
    isDestroyed: () => destroyed,
    isFocusable: () => focusable,
    isFocused: () => focused,
    isAlwaysOnTop: () => onTop,
    setAlwaysOnTop: (on) => { calls.push(['setAlwaysOnTop', on]); onTop = !!on; },
    setFocusable: (on) => { calls.push(['setFocusable', on]); focusable = !!on; },
    blur: () => { calls.push(['blur']); focused = false; },
  };
};

// Hands-on check 3 (2026-11-17): after typing an answer, the foreground went to the taskbar. Windows
// deactivates to the next visible window in z-order, and for an always-on-top window that is another
// always-on-top one (taskbar, HUD). Spike 7 (spikes/focus-giveback.mjs): leaving the topmost band for
// the hand-back gives the focus to the window the user typed from, every run.
test('hands-on 3: releaseFocusOf leaves the always-on-top band while giving the focus back, then returns to it', () => {
  const panel = fakeWin({ focusable: true, focused: true, onTop: true });
  releaseFocusOf(panel);
  assert.deepEqual(panel.calls, [['setAlwaysOnTop', false], ['setFocusable', false], ['blur'], ['setAlwaysOnTop', true]]);
  assert.equal(panel.isAlwaysOnTop(), true, 'still on top afterwards');
  const clickedAway = fakeWin({ focusable: true, focused: false, onTop: true });
  releaseFocusOf(clickedAway);
  assert.deepEqual(clickedAway.calls, [['setFocusable', false]], 'no focus to give back: the z-order is left alone');
});

test('v1.2 I1: releaseFocusOf leaves a window that never became focusable alone (no SetFocusable deactivate)', () => {
  const never = fakeWin();
  releaseFocusOf(never);
  assert.deepEqual(never.calls, [], 'the panel hidden after Allow/Deny/✕ never had the focus: nothing to give back');
  const typed = fakeWin({ focusable: true, focused: true });
  releaseFocusOf(typed);
  assert.deepEqual(typed.calls, [['setFocusable', false], ['blur']], 'typing then sending: non-focusable again, focus given back');
  const clickedAway = fakeWin({ focusable: true, focused: false });
  releaseFocusOf(clickedAway);
  assert.deepEqual(clickedAway.calls, [['setFocusable', false]], 'focusable but no longer focused: no blur');
  const gone = fakeWin({ focusable: true, focused: true, destroyed: true });
  releaseFocusOf(gone);
  assert.deepEqual(gone.calls, []);
  assert.doesNotThrow(() => releaseFocusOf(null));
});

test('v1.2 M2: a ✕ closes the panel only when it names the agent still selected (an auto-switch can land mid-click)', () => {
  assert.equal(closeApplies('s1', 's1'), true);
  assert.equal(closeApplies('s1', 's2'), false, 'a question switched the panel to s2: the ✕ meant for s1 does not close it');
  assert.equal(closeApplies(null, 's2'), false);
  assert.equal(closeApplies(undefined, 's2'), false);
  assert.equal(closeApplies('s1', null), false, 'nothing selected: nothing to close');
  assert.equal(closeApplies(7, '7'), true);
});

test('v1.2 M7: the HUD gets only the id, kind and session of the active card (the panel gets the rest)', () => {
  const card = { id: 'c1', kind: 'permission', sessionId: 's1', display: 'arsenal', cls: 'runesmith', canOpen: true, expiresAt: 5,
    payload: { tool_name: 'Bash', tool_input: { command: 'npm test' } } };
  assert.deepEqual(hudCard(card), { id: 'c1', kind: 'permission', sessionId: 's1' });
  assert.equal(hudCard(null), null);
  assert.equal(hudCard(undefined), null);
});

test('v1.3: a tucked chat is a panel target only while the tucked list is open', () => {
  const snap = { agents: [{ id: 'a' }], tucked: [{ id: 't' }] };
  const hud = { collapsed: false, visible: true, hasCard: false };
  assert.equal(panelTarget('t', snap, { ...hud, tuckOpen: true }), 't');
  assert.equal(panelTarget('t', snap, { ...hud, tuckOpen: false }), null, 'folding the list closes its panel');
  assert.equal(panelTarget('a', snap, { ...hud, tuckOpen: false }), 'a');
  assert.equal(panelTarget('gone', snap, { ...hud, tuckOpen: true }), null, 'a ✕-hidden chat with the list folded, or one that left');
});

test('Task 10: codexTarget: the env path wins; packaged needs ~/.codex; a dev build is blocked', () => {
  const home = 'C://Users//x';
  const yes = () => true, no = () => false;
  assert.deepEqual(codexTarget({ isPackaged: false, envPath: 'C:/t/hooks.json', home, exists: no }), { path: 'C:/t/hooks.json', blocked: false });
  assert.deepEqual(codexTarget({ isPackaged: true, envPath: 'C:/t/hooks.json', home, exists: no }), { path: 'C:/t/hooks.json', blocked: false });
  assert.deepEqual(codexTarget({ isPackaged: true, envPath: undefined, home, exists: yes }), { path: path.join(home, '.codex', 'hooks.json'), blocked: false });
  assert.deepEqual(codexTarget({ isPackaged: true, envPath: '', home, exists: no }), { path: null, blocked: true });
  assert.deepEqual(codexTarget({ isPackaged: false, envPath: undefined, home, exists: yes }), { path: null, blocked: true });
  const seen = [];
  codexTarget({ isPackaged: true, home, exists: (p) => { seen.push(p); return true; } });
  assert.deepEqual(seen, [path.join(home, '.codex')]);
});
test('Task 10: codexOfferDue is true only when never offered, not blocked and not installed', () => {
  const ok = { path: 'C:/h.json', blocked: false };
  assert.equal(codexOfferDue({ cfg: {}, target: ok, installed: false }), true);
  assert.equal(codexOfferDue({ cfg: { offeredCodexHooks: true }, target: ok, installed: false }), false);
  assert.equal(codexOfferDue({ cfg: {}, target: { path: null, blocked: true }, installed: false }), false);
  assert.equal(codexOfferDue({ cfg: {}, target: ok, installed: true }), false);
});
test('Task 10: removeHooksCli with a Codex target removes from both and reports both', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-rm2-'));
  try {
    const claude = path.join(dir, 'settings.json'), codex = path.join(dir, 'hooks.json');
    fs.writeFileSync(claude, '{}\n');
    assert.equal(installHooks(claude, { port: 47821, secret: 'k' }).ok, true);
    const command = codexHookCommand('C://x//resources');
    assert.equal(installCodexHooksFile(codex, command).ok, true);
    const r = removeHooksCli({
      target: { path: claude, blocked: false }, uninstall: uninstallHooks,
      codex: { target: { path: codex, blocked: false }, uninstall: (f) => removeCodexHooksFile(f, command) },
    });
    assert.equal(r.ok, true);
    assert.equal(r.messages.length, 2);
    assert.match(r.messages[0], /hooks removed from .*settings\.json/);
    assert.match(r.messages[1], /Codex.*removed from .*hooks\.json/);
    assert.match(r.message, /settings\.json[\s\S]*hooks\.json/);
    assert.equal(JSON.parse(fs.readFileSync(codex, 'utf8')).hooks, undefined);
    const blocked = removeHooksCli({ target: { path: claude, blocked: false }, uninstall: uninstallHooks, codex: { target: { path: null, blocked: true }, uninstall: () => { throw new Error('no'); } } });
    assert.match(blocked.messages[1], /Codex hooks not changed/);
    assert.equal(removeHooksCli({ target: { path: claude, blocked: false }, uninstall: uninstallHooks }).messages.length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Task 10 fix: codexStatus: missing config.toml -> approve; unreadable -> no approval line; approved -> installed', () => {
  const hooksPath = 'C:/h/.codex/hooks.json';
  const positions = [{ event: 'Stop', group: 0, hook: 0 }];
  const label = (o) => codexStatusLabel(codexStatus({ positions, hooksPath, ...o }));
  assert.equal(label({ configCode: 'ENOENT' }), 'Codex hooks: approve in Codex Settings → Hooks');
  assert.equal(label({ configCode: 'EACCES' }), 'Codex hooks: installed');
  assert.equal(label({ configText: '' }), 'Codex hooks: approve in Codex Settings → Hooks');
  assert.equal(label({ configText: "[hooks.state.'C:/h/.codex/hooks.json:stop:0:0']\ntrusted_hash = 'x'\n" }), 'Codex hooks: installed');
  assert.equal(codexStatusLabel(codexStatus({ positions: [], hooksPath, configCode: 'ENOENT' })), 'Codex hooks: not installed');
});

test('codexStatus returns the approval memory and keeps it across calls', () => {
  const hooksPath = 'C:/h/.codex/hooks.json';
  const positions = [{ event: 'Stop', group: 0, hook: 0 }];
  const text = "[hooks.state.'C:/h/.codex/hooks.json:stop:0:0']\ntrusted_hash = 'x'\n";
  const a = codexStatus({ positions, hooksPath, configText: text, memory: {} });
  assert.deepEqual(a.missing, []);
  assert.deepEqual(a.memory, { Stop: { pos: '0:0', hash: 'x', pending: false } });
  const moved = codexStatus({ positions: [{ event: 'Stop', group: 1, hook: 0 }], hooksPath, configText: "[hooks.state.'C:/h/.codex/hooks.json:stop:1:0']\ntrusted_hash = 'old'\n", memory: a.memory });
  assert.deepEqual(moved.missing, ['Stop']);
  assert.equal(codexStatus({ positions, hooksPath, configCode: 'EACCES', memory: a.memory }).memory, a.memory);
});

test('codexTrustDue is true only with consent, a usable target and unapproved hooks', () => {
  const ok = { path: 'C:/h.json', blocked: false };
  assert.equal(codexTrustDue({ cfg: {}, target: ok, missing: ['Stop'] }), false);
  assert.equal(codexTrustDue({ cfg: { codexAutoTrust: true }, target: { path: null, blocked: true }, missing: ['Stop'] }), false);
  assert.equal(codexTrustDue({ cfg: { codexAutoTrust: true }, target: ok, missing: [] }), false);
  assert.equal(codexTrustDue({ cfg: { codexAutoTrust: true }, target: ok, missing: ['Stop'] }), true);
  assert.equal(codexTrustDue({ cfg: null, target: ok, missing: ['Stop'] }), false);
});

test('recordText per kind', () => {
  const bash = { kind: 'permission', payload: { tool_name: 'Bash', tool_input: { command: 'npm test' } } };
  assert.equal(recordText(bash, { kind: 'allow' }), 'Agent HUD · Allowed: npm test');
  assert.equal(recordText(bash, { kind: 'allow', always: true }), 'Agent HUD · Always allowed here: npm test');
  assert.equal(recordText(bash, { kind: 'deny' }), 'Agent HUD · Denied: npm test');
  const edit = { kind: 'permission', payload: { tool_name: 'Edit', tool_input: { file_path: 'C:/p/src/a.ts' } } };
  assert.equal(recordText(edit, { kind: 'allow' }), 'Agent HUD · Allowed: Edit a.ts');
  const ch = { kind: 'choice', payload: { tool_input: { questions: [{ question: 'Which DB?' }, { question: 'Port?' }] } } };
  assert.equal(recordText(ch, { kind: 'choice', picks: { 'Which DB?': 'Postgres', 'Port?': ['5432', '5433'] } }), 'Agent HUD · Answered: Which DB? → Postgres; Port? → 5432, 5433');
  const plan = { kind: 'plan', payload: {} };
  assert.equal(recordText(plan, { kind: 'plan', approve: 'acceptEdits' }), 'Agent HUD · Plan approved (auto-accept edits)');
  assert.equal(recordText(plan, { kind: 'plan', approve: 'default' }), 'Agent HUD · Plan approved (ask before edits)');
  assert.equal(recordText(plan, { kind: 'plan', keep: true, feedback: 'add\nrollback' }), 'Agent HUD · Keep planning: add rollback');
  assert.equal(recordText({ kind: 'reply', payload: {} }, { kind: 'reply', text: 'x'.repeat(200) }), `Agent HUD · You replied: ${'x'.repeat(80)}…`);
  assert.ok(recordText(bash, { kind: 'allow', always: true }).length <= 160);
  const long = { kind: 'permission', payload: { tool_name: 'Bash', tool_input: { command: 'y'.repeat(400) } } };
  assert.ok(recordText(long, { kind: 'allow' }).length <= 160);
  assert.equal(recordText({ kind: 'permission', payload: { tool_name: 'WebFetch', tool_input: {} } }, { kind: 'allow' }), 'Agent HUD · Allowed: WebFetch');
});

test('encodeAnswer: record flag adds systemMessage, never changes the decision', () => {
  assert.deepEqual(encodeAnswer(perm, { kind: 'deny' }), permissionDeny());
  assert.deepEqual(encodeAnswer(perm, { kind: 'deny' }, { record: false }), permissionDeny());
  const rec = encodeAnswer(perm, { kind: 'deny' }, { record: true });
  assert.equal(rec.systemMessage, 'Agent HUD · Denied: Bash');
  assert.deepEqual(rec.hookSpecificOutput, permissionDeny().hookSpecificOutput);
  assert.equal(encodeAnswer(perm, { kind: 'bogus' }, { record: true }), null);
  assert.equal(encodeAnswer(reply, { kind: 'reply', text: ' ' }, { record: true }), null);
});

test('encodeAnswer: plan case', () => {
  const plan = { id: 'pl', sessionId: 's1', kind: 'plan', payload: {} };
  assert.deepEqual(encodeAnswer(plan, { kind: 'plan', approve: 'acceptEdits' }), planApprove('acceptEdits', { modes: PLAN_MODES }));
  assert.deepEqual(encodeAnswer(plan, { kind: 'plan', approve: 'default' }), planApprove('default', { modes: PLAN_MODES }));
  assert.deepEqual(encodeAnswer(plan, { kind: 'plan', keep: true, feedback: 'more' }), planKeepPlanning('more'));
  assert.deepEqual(encodeAnswer(plan, { kind: 'plan', keep: true }), planKeepPlanning(''));
  assert.equal(encodeAnswer(plan, { kind: 'plan', approve: 'bypass' }), null);
  assert.equal(encodeAnswer(plan, { kind: 'plan' }), null);
  assert.equal(encodeAnswer(plan, { kind: 'plan', keep: true, feedback: 5 }), null);
  assert.equal(encodeAnswer(plan, { kind: 'allow' }), null);
  assert.equal(encodeAnswer(plan, { kind: 'plan', approve: 'default' }, { record: true }).systemMessage, 'Agent HUD · Plan approved (ask before edits)');
  if (!PLAN_MODES) assert.deepEqual(encodeAnswer(plan, { kind: 'plan', approve: 'acceptEdits' }), encodeAnswer(plan, { kind: 'plan', approve: 'default' }));
});

test('recordAllowed follows RECORD_HOSTS by entrypoint, Codex by source', () => {
  const hosts = new Set(['claude-vscode', 'codex']);
  assert.equal(recordAllowed({ entrypoint: 'claude-vscode' }, hosts), true);
  assert.equal(recordAllowed({ entrypoint: 'claude-desktop' }, hosts), false);
  assert.equal(recordAllowed({ source: 'codex', entrypoint: 'codex' }, hosts), true);
  assert.equal(recordAllowed({ source: 'codex' }, new Set(['claude-vscode'])), false);
  assert.equal(recordAllowed({}, hosts), false);
  assert.equal(recordAllowed(undefined, hosts), false);
  assert.equal(recordAllowed(null, hosts), false);
  assert.equal(recordAllowed({ entrypoint: 'claude-vscode' }, new Set()), false);
  assert.equal(recordAllowed({ entrypoint: 'x' }), false); // default RECORD_HOSTS
});
