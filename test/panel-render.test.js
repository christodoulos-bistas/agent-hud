import test from 'node:test'; import assert from 'node:assert/strict';
import { renderPanel, renderStack, timeText, arrowOf, panelAction, createStackArming } from '../src/renderer/panel.js';
import { ARM_MS } from '../src/renderer/cards.js';
import { sideWhen } from '../src/renderer/side-tab.js';

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

// 2026-11-17: a chat whose folder has no HUD hooks sent nothing at all; "Started before the HUD" misled.
test('a chat that never sent the HUD a hook event → "Not connected" with what to do, not "Started before the HUD"', () => {
  const h = renderPanel(detail({ task: null, connected: false, current: null, steps: [], stepCount: 0 }), NOW);
  assert.match(h, /Not connected/);
  assert.match(h, /Install hooks from the tray, then restart the chat/);
  assert.doesNotMatch(h, /Started before the HUD/);
  assert.match(renderPanel(detail({ task: null, connected: true }), NOW), /Started before the HUD/, 'connected but its first prompt was missed');
});

test('needs with a question in the stack has no queued-behind text', () => {
  assert.doesNotMatch(renderPanel(detail({ stage: 'needs', hasCard: true }), NOW), /opens here after/);
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
  assert.doesNotMatch(at({ hasCard: true, handedBack: true }), /needs-note/, 'the stack shows the question, no note');
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
  payload: { session_id: 's1', last_assistant_message: 'Done. Ship it?' }, expiresAt: NOW + 125000, holdMs: 540000, ...o,
});
const permCard = (o = {}) => ({
  id: 'c8', kind: 'permission', sessionId: 's1', display: 'arsenal · e0', cls: 'runesmith', canOpen: true, expiresAt: NOW + 60000, holdMs: 60000,
  payload: { session_id: 's1', tool_name: 'Bash', tool_input: { command: 'rm -rf build && npm run build -- --verbose' }, permission_suggestions: [] }, ...o,
});

const summ = (c) => ({ id: c.id, kind: c.kind, sessionId: c.sessionId, display: c.display, cls: c.cls, line: 'q', expiresAt: c.expiresAt, holdMs: c.holdMs, source: 'claude' });
const stackOf = (card, extra = []) => ({ visible: true, cards: [summ(card), ...extra], expanded: card });
const cardHtml = (card, o = {}) => renderStack(stackOf(card), NOW, o);

test('the stack renders the expanded card after its bubble, with the countdown', () => {
  const h = cardHtml(replyCard());
  const at = h.indexOf('class="ans');
  assert.ok(at > 0, h);
  assert.ok(h.indexOf('class="bub"') < h.indexOf('class="ans'), 'the card follows its bubble');
  assert.match(h, /<span data-left>2:05<\/span>/, 'the reply countdown runs to the main process deadline (expiresAt)');
  assert.match(h, /data-key="card:c9" data-sticky/, 'the card slot is keyed and sticky, so a new detail does not replace it');
  assert.match(cardHtml(replyCard(), { leftMs: 61000 }), /<span data-left>1:01<\/span>/, "the mounted card's own clock wins");

  const p = cardHtml(permCard());
  assert.ok(p.includes('rm -rf build &amp;&amp; npm run build -- --verbose'), 'the full command');
  assert.match(p, /data-act="allow"/); assert.match(p, /data-act="deny"/);
  assert.match(p, /data-act="open-card"/);
  assert.match(cardHtml(permCard(), { arming: true }), /<div class="ans arming"/, `inert for ${ARM_MS} ms after it appears`);
  assert.doesNotMatch(p, /arming/);
  assert.doesNotMatch(cardHtml(permCard({ display: XSS, payload: { tool_name: 'Bash', tool_input: { command: XSS } } })), /<img/);
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


test('v1.2 M1/M2: the header ✕ and the footer "open window ↗" name the agent on show, not whatever main has selected by then', () => {
  const d = detail({ id: 's7' });
  assert.deepEqual(panelAction('close', d), { call: 'close', id: 's7' });
  assert.deepEqual(panelAction('open', d), { call: 'openWindow', id: 's7' });
  assert.deepEqual(panelAction('open', null), { call: 'openWindow', id: null });
  assert.equal(panelAction('allow', d), null, "the card's own buttons are handled by cards.js");
});

test('v1.2 M6: permission and choice cards show the countdown to the 60 s hand-back, from expiresAt', () => {
  const p = cardHtml(permCard({ expiresAt: NOW + 42000 }));
  assert.match(p, /Back to its window in <span data-left>0:42<\/span>/);
  assert.match(p, /<i data-bar style="width:70\.0%"><\/i>/, '42 s of the 60 s hold');
  assert.match(cardHtml(permCard()), /<span data-left>1:00<\/span>/);
  assert.match(cardHtml(permCard({ expiresAt: NOW - 5000 })), /<span data-left>0:00<\/span>/, 'never below zero');
  assert.match(cardHtml(permCard(), { leftMs: 9000 }), /<span data-left>0:09<\/span>/, "the mounted card's own clock wins");
  const choiceCard = { id: 'c7', kind: 'choice', sessionId: 's1', display: 'a', cls: 'runesmith', canOpen: true, expiresAt: NOW + 30000,
    payload: { session_id: 's1', tool_input: { questions: [{ question: 'Which?', options: [{ label: 'A' }, { label: 'B' }] }] } } };
  assert.match(cardHtml(choiceCard), /Back to its window in <span data-left>0:30<\/span>/);
  assert.match(cardHtml(replyCard()), /Reply open <span data-left>2:05<\/span>/,'the reply card keeps its own words');
});

test('Codex detail: class line starts with the Codex tag and the Codex sprite; Claude has neither', () => {
  const cx = renderPanel(detail({ source: 'codex' }), NOW);
  assert.ok(cx.includes('<div class="who-d"><span class="src">Codex</span> · <span class="cls">'));
  assert.ok(cx.includes('#8ef5c6'));
  const cl = renderPanel(detail(), NOW);
  assert.ok(!cl.includes('class="src"'));
  assert.ok(!cl.includes('#8ef5c6'));
});

const sum = (i, o = {}) => ({ id: 'c' + i, kind: 'permission', sessionId: 's' + i, display: 'a' + i, cls: 'runesmith', line: 'Run npm test', expiresAt: NOW + 30000, source: 'claude', ...o });

test('Task 11: 9 summaries render 9 bubbles; only the expanded one has a card slot, right after its bubble', () => {
  const cards = Array.from({ length: 9 }, (_, i) => sum(i));
  const h = renderStack({ visible: true, cards, expanded: permCard({ id: 'c3' }) }, NOW);
  assert.equal((h.match(/<button[^>]*class="bub"/g) || []).length, 9);
  assert.match(h, /<span>9 waiting<\/span><button[^>]*data-act="hide-stack" aria-label="Hide the questions"[^>]*>✕<\/button>/);
  assert.match(h, /^<div class="stack" data-key="stack" data-deep>/);
  assert.equal((h.match(/class="card-slot"/g) || []).length, 1);
  assert.match(h, /data-key="bub:c3" data-deep>/);
  assert.match(h, /<\/button><div class="card-slot" data-key="card:c3" data-sticky>/);
  assert.match(h, /data-card="c3"[^>]*aria-expanded="true"/);
  assert.match(h, /data-card="c2"[^>]*aria-expanded="false"/);
});

test('Task 11: an invisible or missing stack renders nothing', () => {
  assert.equal(renderStack({ visible: false, cards: [sum(1)], expanded: null }, NOW), '');
  assert.equal(renderStack(null, NOW), '');
});

test('Task 11: renderPanel with hasCard has no needs note and no card slot; other notes stay', () => {
  const h = renderPanel(detail({ stage: 'needs', hasCard: true }), NOW);
  assert.doesNotMatch(h, /needs-note|card-slot|opens here/);
  assert.match(renderPanel(detail({ stage: 'needs', handedBack: true }), NOW), /Waiting in its window/);
  assert.match(renderPanel(detail({ stage: 'needs' }), NOW), /Waiting for you in its window/);
});

test('Task 11: panelAction expand and hide-stack', () => {
  assert.deepEqual(panelAction('expand', null, { card: 'c4' }), { call: 'expandCard', id: 'c4' });
  assert.deepEqual(panelAction('hide-stack', null, {}), { call: 'hideStack' });
  assert.deepEqual(panelAction('close', { id: 's1' }, {}), { call: 'close', id: 's1' });
});

test('Task 11: recap shows under Finished, before the last message, escaped; alone when there is no message', () => {
  const h = renderPanel(detail({ stage: 'turn', current: null, lastMessage: 'All done', recap: 'Done in 8s · 1 file edited' }), NOW);
  assert.match(h, /<p class="lbl">Finished<\/p><p class="recap">Done in 8s · 1 file edited<\/p><p class="finished">All done<\/p>/);
  const x = renderPanel(detail({ stage: 'turn', current: null, lastMessage: '', recap: XSS }), NOW);
  assert.match(x, /<p class="lbl">Finished<\/p><p class="recap">&lt;img/);
  assert.doesNotMatch(x, /<img|class="finished"/);
});

test('Task 11: root markup is the stack alone when there is no detail', () => {
  const stack = { visible: true, cards: [sum(1)], expanded: null };
  assert.equal(renderStack(stack, NOW) + (null ? 'x' : ''), renderStack(stack, NOW));
  assert.doesNotMatch(renderStack(stack, NOW), /class="fly"/);
});

test('I4: a bubble takes no "expand" for ARM_MS after it first renders; the stack ✕ none after the stack shows', () => {
  const arm = createStackArming();
  const T = 5_000_000;
  const stack = (ids, visible = true) => ({ visible, cards: ids.map((id) => ({ id, sessionId: 's1' })) });
  const ok = (act, card, now) => arm.allowed(act, card == null ? {} : { card }, now);
  arm.seen(stack(['a']), T);
  assert.equal(ok('expand', 'a', T + ARM_MS - 1), false, 'a bubble that appeared under the pointer');
  assert.equal(ok('hide-stack', null, T + ARM_MS - 1), false, 'the stack ✕ that appeared under the pointer');
  assert.equal(ok('expand', 'a', T + ARM_MS), true);
  assert.equal(ok('hide-stack', null, T + ARM_MS), true);
  // A new bubble arms on its own; the old one and the ✕ stay armed.
  arm.seen(stack(['a', 'b']), T + 2000);
  assert.equal(ok('expand', 'b', T + 2100), false);
  assert.equal(ok('expand', 'a', T + 2100), true);
  assert.equal(ok('hide-stack', null, T + 2100), true);
  // A re-render does not restart a bubble's clock.
  arm.seen(stack(['a', 'b']), T + 2400);
  assert.equal(ok('expand', 'b', T + 2000 + ARM_MS), true);
  // Hidden, then shown again: the stack and every bubble arm afresh.
  arm.seen(stack(['a', 'b'], false), T + 3000);
  arm.seen(null, T + 3100);
  arm.seen(stack(['a', 'b']), T + 4000);
  assert.equal(ok('hide-stack', null, T + 4100), false);
  assert.equal(ok('expand', 'a', T + 4100), false);
  assert.equal(ok('expand', 'a', T + 4000 + ARM_MS), true);
  // A bubble that went and came back arms again.
  arm.seen(stack(['b']), T + 5000);
  arm.seen(stack(['a', 'b']), T + 5100);
  assert.equal(ok('expand', 'a', T + 5200), false);
  // Other panel actions are never held back.
  for (const act of ['close', 'open']) assert.equal(arm.allowed(act, {}, T + 5101), true, act);
});

test('a plan notice in the stack: read-only card, no ring, no countdown, no answer buttons', () => {
  const plan = {
    id: 'plan:s1:1', kind: 'plan', sessionId: 's1', display: 'arsenal · e0', cls: 'runesmith', source: 'claude', line: 'Plan ready · 2 steps',
    expiresAt: null, holdMs: null, canOpen: true, payload: { tool_input: { plan: '# Plan <b>\n## One\n## Two', planFilePath: 'x' } },
  };
  const h = renderStack({ visible: true, cards: [{ ...summ(plan), line: plan.line }], expanded: plan }, NOW);
  assert.match(h, /Plan ready · 2 steps/);
  assert.doesNotMatch(h, /data-ring|class="ring"|data-left|data-bar/);
  assert.match(h, /data-act="read-plan"/);
  assert.match(h, /data-act="open-card"/);
  assert.doesNotMatch(h, /data-act="(answer|approve|keep)"|<input/);
  assert.ok(h.includes('Plan &lt;b&gt;') && !h.includes('Plan <b>'), 'escaped');
});

const side = (o = {}) => ({ tab: 'side', count: 2, dot: false, asking: null, healthy: true, focusAsk: null, entries: [
  { id: 'v1', at: NOW - 3 * 3600000, source: 'vscode', question: 'what file?', response: '**agent-hud**' },
  { id: 'h1', at: NOW - 120000, source: 'hud', question: XSS, response: null, error: 'Claude gave no answer' },
], ...o });

test('no side (Codex or none): no tabs, details as today', () => {
  assert.ok(!renderPanel(detail(), NOW).includes('class="tabs"'));
  assert.equal(renderPanel(detail({ side: null }), NOW), renderPanel(detail(), NOW));
});
test('Now tab: tabs with the count, details body', () => {
  const h = renderPanel(detail({ side: side({ tab: 'now' }) }), NOW);
  assert.match(h, /data-tab="side"[^>]*>Side questions <span class="n">2<\/span>/);
  assert.match(h, /Recent steps/);
});
test('Side tab: thread, tags, markdown, error with retry, escaped question, ask box', () => {
  const h = renderPanel(detail({ side: side() }), NOW);
  assert.ok(!h.includes('Recent steps'));
  assert.match(h, /<span class="tag vsc">VS Code<\/span> 3h ago/);
  assert.match(h, /<b>agent-hud<\/b>/);
  assert.match(h, /class="qa-a err">Claude gave no answer/);
  assert.match(h, /data-act="side-retry" data-entry="h1"/);
  assert.ok(h.includes('&lt;img') && !h.includes('<img'));
  assert.match(h, /placeholder="Ask a follow-up…"/);
  assert.match(h, /data-act="open"/); // footer stays
});
test('asking: thinking row, disabled box', () => {
  const h = renderPanel(detail({ side: side({ asking: { question: 'is it safe?', at: NOW } }) }), NOW);
  assert.match(h, /is it safe\?[^]*class="qa-a wait">thinking/);
  assert.match(h, /<input[^>]*data-side-ask[^>]*disabled[^>]*placeholder="Waiting for the answer…"/);
});
test('empty and unhealthy lines', () => {
  const h = renderPanel(detail({ display: 'arsenal', side: side({ count: 0, entries: [], healthy: false }) }), NOW);
  assert.match(h, /None yet\. Ask one, or use \/btw in VS Code: those show up here too\./);
  assert.match(h, /Can't read VS Code side questions right now\./);
  assert.match(h, /placeholder="Ask arsenal on the side…"/);
});
test('sideWhen', () => {
  assert.equal(sideWhen(NOW - 5000, NOW), 'now');
  assert.equal(sideWhen(NOW - 120000, NOW), '2m ago');
  assert.equal(sideWhen(Date.UTC(2026, 10, 19, 12), Date.UTC(2026, 10, 21, 12)), '19 Nov');
});
test('side tab keys: tabs, side body, ask box, entries, pending', () => {
  const h = renderPanel(detail({ side: side({ asking: { question: 'q?', at: NOW } }) }), NOW);
  for (const k of ['tabs', 'side', 'side-ask', 'qa:v1', 'qa:h1', 'qa:pending']) assert.ok(h.includes('data-key="' + k + '"'), k);
});
