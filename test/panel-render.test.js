import test from 'node:test'; import assert from 'node:assert/strict';
import { renderPanel, timeText, arrowOf, shouldScrollTop, panelAction } from '../src/renderer/panel.js';
import { ARM_MS } from '../src/renderer/cards.js';

const NOW = 1_000_000_000;
const XSS = '<img src=x onerror=alert(1)>';
const step = (o = {}) => ({
  id: 'x', tool: 'Bash', label: 'npm test', doing: 'running npm test', why: 'Run the tests',
  startedAt: NOW - 20000, endedAt: NOW - 12000, ok: true, interrupted: false, error: null, agentId: null, agentType: null, ...o,
});
const detail = (o = {}) => ({
  id: 's1', display: 'arsenal · e0', cls: 'runesmith', stage: 'working', stuck: null, task: 'Make the updater keep 3 builds',
  startedAt: NOW - 9 * 60000, stepCount: 23, current: step({ endedAt: null, ok: null, startedAt: NOW - 100000 }),
  steps: [
    step({ label: 'Edited updater.js', endedAt: NOW - 12000 }),
    step({ label: 'npm test', ok: false, error: 'exit 1', endedAt: NOW - 60000 }),
    step({ label: 'Read a.js', interrupted: true, ok: null, endedAt: NOW - 120000 }),
    step({ label: 'Read b.js', endedAt: NOW - 180000 }),
    step({ label: 'Searched code', endedAt: NOW - 240000 }),
  ],
  helpers: [{ agentId: 'h1', agentType: 'Explore', doing: 'reading 4 files' }],
  stageSince: NOW - 100000, currentStepStartedAt: NOW - 100000, lastActivityAt: NOW - 1000, ...o,
});

test('full detail renders task, Now with why, 5 steps with ✓/✗/– marks, helpers, footer with step count', () => {
  const h = renderPanel(detail(), NOW);
  assert.match(h, /Make the updater keep 3 builds/);
  assert.match(h, /Now:<\/b>[^]*running npm test/);
  assert.match(h, /Run the tests/);
  assert.match(h, /1m/);
  assert.equal((h.match(/<ol>[^]*<\/ol>/)[0].match(/<li>/g) || []).length, 5);
  assert.match(h, /✓/); assert.match(h, /✗/); assert.match(h, /–/);
  assert.match(h, /Explore/); assert.match(h, /reading 4 files/);
  assert.match(h, /started 9m ago · 23 steps/);
  assert.match(h, /data-act="close"/); assert.match(h, /data-act="open"/);
});

test('stuck renders the amber reason line', () => {
  const h = renderPanel(detail({ stuck: { reason: 'repeating', detail: 'the same command failed 3 times in a row.' } }), NOW);
  assert.match(h, /class="warn"><b>Repeating:<\/b> the same command failed 3 times/);
  const l = renderPanel(detail({ stuck: { reason: 'long', detail: 'frozen', label: 'npm test', startedAt: NOW - 100000 } }), NOW);
  assert.match(l, /<b>Long step:<\/b> npm test has been running for 1 min/);
  assert.doesNotMatch(l, /frozen/);
  assert.match(renderPanel(detail({ stuck: { reason: 'silent', detail: 'quiet' } }), NOW), /<b>Silent:<\/b> quiet/);
});

test('no current step and newest closed step failed → "Last:" with the error text', () => {
  const h = renderPanel(detail({ current: null, steps: [step({ label: 'npm run build', ok: false, error: 'TS2345 bad', endedAt: NOW - 5000 })] }), NOW);
  assert.match(h, /Last:<\/b>[^]*npm run build/);
  assert.match(h, /TS2345 bad/);
  assert.doesNotMatch(h, /Now:/);
});

test('task null → "Started before the HUD" (Review Focus 1)', () => {
  assert.match(renderPanel(detail({ task: null }), NOW), /Started before the HUD/);
});

test('needs with a question queued behind the current one → "Its question opens here after the current one"', () => {
  assert.match(renderPanel(detail({ stage: 'needs', hasCard: true }), NOW), /Its question opens here after the current one/);
  assert.doesNotMatch(renderPanel(detail(), NOW), /Its question opens/);
  assert.doesNotMatch(renderPanel(detail({ stage: 'needs', hasCard: true }), NOW), /in the HUD/, 'the HUD holds no cards any more');
});

test('HTML in task, command label and error is escaped (Review Focus 5)', () => {
  const h = renderPanel(detail({
    task: XSS, display: XSS, helpers: [{ agentId: 'h', agentType: XSS, doing: XSS }],
    current: step({ label: XSS, doing: XSS, why: XSS, endedAt: null, ok: null }),
    steps: [step({ label: XSS, ok: false, error: XSS })],
    stuck: { reason: 'repeating', detail: XSS },
  }), NOW);
  assert.doesNotMatch(h, /<img/);
  assert.match(h, /&lt;img/);
});

test('time texts carry their start (data-since) so the 1 s tick can refresh them; timeText formats them (R5a)', () => {
  const h = renderPanel(detail(), NOW);
  assert.match(h, new RegExp(`<span class="el" data-since="${NOW - 100000}">1m</span>`));
  assert.match(h, new RegExp(`<span class="ago" data-since="${NOW - 12000}">12s</span>`));
  assert.match(h, new RegExp(`<span data-since="${NOW - 9 * 60000}" data-pre="started " data-post=" ago · 23 steps">started 9m ago · 23 steps</span>`));
  assert.match(renderPanel(detail({ current: null, steps: [step({ ok: false, endedAt: NOW - 5000 })] }), NOW), new RegExp(`<span class="el" data-since="${NOW - 5000}">5s</span>`));
  assert.doesNotMatch(renderPanel(detail({ startedAt: null }), NOW), /data-pre="started "/, 'no start, nothing to tick');
  // what the tick reads back from the DOM: strings
  assert.equal(timeText({ since: String(NOW - 100000) }, NOW + 60000), '2m');
  assert.equal(timeText({ since: String(NOW - 9 * 60000), pre: 'started ', post: ' ago · 23 steps' }, NOW + 60000), 'started 10m ago · 23 steps');
  assert.equal(timeText({ since: 'nope' }, NOW), '');
});

test('the header shows the class display name, not the raw class id (R5b)', () => {
  assert.match(renderPanel(detail({ cls: 'star-reader' }), NOW), /<span class="cls">Star-Reader<\/span>/);
  assert.match(renderPanel(detail({ cls: 'no-such-class' }), NOW), /<span class="cls">Pathfinder<\/span>/);
});

test('arrowOf: the arrow sits on the edge facing the HUD, its 16 px triangle centred on arrowY (R6)', () => {
  assert.deepEqual(arrowOf({ side: 'left', arrowY: 40 }), { edge: 'right', top: 32 }, 'panel left of the HUD: arrow on its right edge');
  assert.deepEqual(arrowOf({ side: 'right', arrowY: 100.4 }), { edge: 'left', top: 92 });
  assert.deepEqual(arrowOf({ side: 'right', arrowY: 3 }), { edge: 'left', top: 0 }, 'never above the window');
  assert.deepEqual(arrowOf({ side: 'up', arrowY: 40 }), { edge: null, top: null });
  assert.deepEqual(arrowOf({ side: 'left', arrowY: 'x' }), { edge: null, top: null });
  assert.deepEqual(arrowOf(null), { edge: null, top: null });
});

test('importing panel.js in Node does not throw', async () => {
  await assert.doesNotReject(import('../src/renderer/panel.js?again'));
});

test('M2: the long-step line names the flagged step from stuck, not the current one', () => {
  const h = renderPanel(detail({
    current: step({ label: 'Read a.js', endedAt: null, ok: null, startedAt: NOW - 2000 }),
    stuck: { reason: 'long', detail: 'npm run build has been running for 7 min', label: 'npm run build', startedAt: NOW - 7 * 60000 },
  }), NOW);
  assert.match(h, /<b>Long step:<\/b> npm run build has been running for 7 min/);
  assert.match(renderPanel(detail({ current: null, stuck: { reason: 'long', detail: 'x has been running for 6 min' } }), NOW), /<b>Long step:<\/b> x has been running for 6 min/, 'no startedAt: the store\'s detail text');
  assert.doesNotMatch(renderPanel(detail({ stuck: { reason: 'long', detail: 'd', label: XSS, startedAt: NOW - 400000 } }), NOW), /<img/);
});

test('M3: the needs line says where the answer is waiting', () => {
  const at = (o) => renderPanel(detail({ stage: 'needs', ...o }), NOW);
  assert.match(at({ hasCard: true, handedBack: true }), /class="needs-note">Its question opens here after the current one</);
  assert.match(at({ hasCard: false, handedBack: true }), /class="needs-note">Waiting in its window — open ↗</);
  assert.match(at({ hasCard: false, handedBack: false }), /class="needs-note">Waiting for you in its window</);
  assert.doesNotMatch(renderPanel(detail({ hasCard: true }), NOW), /needs-note/, 'only while it needs you');
});

test('M5: "Now:" shows the whole Bash/PowerShell command, not the 40-char activity line', () => {
  const cmd = 'npm run test -- --run test/forge-room.test.ts --reporter verbose';
  const h = renderPanel(detail({ current: step({ endedAt: null, ok: null, doing: `running ${cmd.slice(0, 40)}`, command: cmd }) }), NOW);
  assert.ok(h.includes(`<b>Now:</b> running ${cmd}`), h);
  assert.match(renderPanel(detail({ current: step({ tool: 'Read', label: 'Read a.js', doing: 'reading a.js', command: null, endedAt: null, ok: null }) }), NOW), /<b>Now:<\/b> reading a\.js/);
  assert.doesNotMatch(renderPanel(detail({ current: step({ command: XSS, endedAt: null, ok: null }) }), NOW), /<img/);
});

test('M9: with no known start the footer omits "started … ago"', () => {
  const h = renderPanel(detail({ startedAt: null, stepCount: 4 }), NOW);
  assert.match(h, /class="foot"><span>4 steps<\/span>/);
  assert.doesNotMatch(h, /started/);
});

test('panel hides "open window" when the session cannot be focused', () => {
  assert.doesNotMatch(renderPanel(detail({ canOpen: false }), NOW), /data-act="open"/);
  assert.match(renderPanel(detail({ canOpen: true }), NOW), /data-act="open"/);
  const handed = renderPanel(detail({ stage: 'needs', handedBack: true, canOpen: false }), NOW);
  assert.match(handed, /Waiting in its window/);
  assert.doesNotMatch(handed, /open ↗/);
});

const replyCard = (o = {}) => ({
  id: 'c9', kind: 'reply', sessionId: 's1', display: 'arsenal · e0', cls: 'runesmith', canOpen: true,
  payload: { session_id: 's1', last_assistant_message: 'Done. Ship it?' }, expiresAt: NOW + 125000, ...o,
});
const permCard = (o = {}) => ({
  id: 'c8', kind: 'permission', sessionId: 's1', display: 'arsenal · e0', cls: 'runesmith', canOpen: true, expiresAt: NOW + 60000,
  payload: { session_id: 's1', tool_name: 'Bash', tool_input: { command: 'rm -rf build && npm run build -- --verbose' }, permission_suggestions: [] }, ...o,
});

test('renderPanel with detail.card renders the card above the task, with the countdown', () => {
  const h = renderPanel(detail({ stage: 'needs', hasCard: true, card: replyCard() }), NOW);
  const at = h.indexOf('class="ans');
  assert.ok(at > 0, h);
  assert.ok(at < h.indexOf('>Task<'), 'the card sits above the task');
  assert.ok(h.indexOf('class="fly-top"') < at, 'below the agent header (sprite, name, chip, close)');
  assert.match(h, /<span data-left>2:05<\/span>/, 'the reply countdown runs to the main process deadline (expiresAt)');
  assert.match(h, /data-key="card:c9" data-sticky/, 'the card slot is keyed and sticky, so a new detail does not replace it');
  assert.doesNotMatch(h, /needs-note/, 'the card is the note');
  assert.match(renderPanel(detail({ card: replyCard() }), NOW, { leftMs: 61000 }), /<span data-left>1:01<\/span>/, "the mounted card's own clock wins");

  const p = renderPanel(detail({ stage: 'needs', hasCard: true, card: permCard() }), NOW);
  assert.ok(p.includes('rm -rf build &amp;&amp; npm run build -- --verbose'), 'the full command');
  assert.match(p, /data-act="allow"/); assert.match(p, /data-act="deny"/);
  assert.match(p, /data-act="open-card"/);
  assert.match(renderPanel(detail({ card: permCard() }), NOW, { arming: true }), /<div class="ans arming"/, `inert for ${ARM_MS} ms after it appears`);
  assert.doesNotMatch(p, /arming/);
  assert.doesNotMatch(renderPanel(detail({ card: permCard({ display: XSS, payload: { tool_name: 'Bash', tool_input: { command: XSS } } }) }), NOW), /<img/);
});

test('renderPanel without card unchanged', () => {
  const h = renderPanel(detail(), NOW);
  assert.equal(h, renderPanel(detail({ card: null }), NOW));
  assert.doesNotMatch(h, /class="ans|card-slot|data-sticky/);
  assert.ok(h.startsWith('<div class="fly"'), h.slice(0, 60));
  assert.match(h, /Make the updater keep 3 builds/);
});

test('renderPanel shows Finished with the escaped last message only for stage turn (Review Focus 5)', () => {
  const on = renderPanel(detail({ stage: 'turn', current: null, lastMessage: XSS }), NOW);
  assert.match(on, /<p class="lbl">Finished<\/p>/);
  assert.ok(on.includes('&lt;img') && !on.includes('<img'));
  assert.ok(!renderPanel(detail({ stage: 'turn', current: null, lastMessage: '' }), NOW).includes('Finished'));
  assert.ok(!renderPanel(detail({ stage: 'turn', current: null, lastMessage: null }), NOW).includes('Finished'));
  assert.ok(!renderPanel(detail({ stage: 'working', lastMessage: 'hello' }), NOW).includes('Finished'));
});

test('R5: a fresh card id scrolls the panel to the top, the same card does not', () => {
  assert.equal(shouldScrollTop(null, { id: 'c1' }), true);
  assert.equal(shouldScrollTop('c1', { id: 'c2' }), true);
  assert.equal(shouldScrollTop('c1', { id: 'c1' }), false);
  assert.equal(shouldScrollTop('c1', null), false);
});

test('v1.2 M1/M2: the header ✕ and the footer "open window ↗" name the agent on show, not whatever main has selected by then', () => {
  const d = detail({ id: 's7' });
  assert.deepEqual(panelAction('close', d), { call: 'close', id: 's7' });
  assert.deepEqual(panelAction('open', d), { call: 'openWindow', id: 's7' });
  assert.deepEqual(panelAction('open', null), { call: 'openWindow', id: null });
  assert.equal(panelAction('allow', d), null, "the card's own buttons are handled by cards.js");
});
