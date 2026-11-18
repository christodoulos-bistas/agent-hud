import test from 'node:test'; import assert from 'node:assert/strict';
import * as hud from '../src/renderer/hud.js';
import * as cards from '../src/renderer/cards.js';

const XSS = '<img src=x onerror=alert(1)>';

test('createDrafts keeps text per card id; drop clears it', () => {
  const d = cards.createDrafts();
  assert.equal(d.get('c1'), '');
  d.set('c1', 'half a reply');
  d.set('c2', 'other');
  d.set('c2#0', 'something else');
  assert.equal(d.get('c1'), 'half a reply');
  assert.equal(d.get('c2'), 'other');
  d.drop('c2');
  assert.equal(d.get('c2'), '');
  assert.equal(d.get('c2#0'), '');
  assert.equal(d.get('c1'), 'half a reply');
  d.set('c1', '');
  assert.equal(d.get('c1'), '');
});

test('hud.js re-exports the card functions from cards.js (same functions)', () => {
  for (const name of ['renderCard', 'replyLeftMs', 'picksFrom', 'actionsArmed', 'clickAllowed']) {
    assert.equal(typeof cards[name], 'function', name);
    assert.ok(hud[name] === cards[name], `${name} is the same function`);
  }
  assert.equal(cards.ARM_MS, 500);
  assert.equal(typeof cards.mountCards, 'function');
});

test('renderCard escapes HTML in command and question text (Review Focus 5)', () => {
  const perm = cards.renderCard({ id: 'c1', kind: 'permission', display: XSS, payload: { session_id: 's1', tool_name: 'Bash', tool_input: { command: XSS } } });
  const choice = cards.renderCard({ id: 'c2', kind: 'choice', display: 'a', payload: { session_id: 's2', tool_input: { questions: [{ question: XSS, header: XSS, options: [{ label: XSS, description: XSS }] }] } } });
  const reply = cards.renderCard({ id: 'c3', kind: 'reply', display: 'a', payload: { session_id: 's3', last_assistant_message: XSS } });
  for (const html of [perm, choice, reply]) {
    assert.ok(!html.includes('<img'), html);
    assert.ok(html.includes('&lt;img'), html);
  }
});

test('pointerdown makes the window interactive only for a text input inside a card', () => {
  const handlers = {};
  const host = { addEventListener: (type, fn) => { handlers[type] = fn; } };
  const calls = [];
  cards.mountCards(host, { api: {}, onInteractive: (on) => calls.push(on), adopt: true });
  const target = (tag, type) => ({ closest: (sel) => (sel === '.ans' ? {} : matches({ tag, type }, sel) ? {} : null) });
  handlers.pointerdown({ target: target('button') });
  assert.deepEqual(calls, []);
  handlers.pointerdown({ target: target('input') }); // "Something else…" and the reply box carry no type
  handlers.pointerdown({ target: target('input', 'text') });
  handlers.pointerdown({ target: target('textarea') });
  assert.deepEqual(calls, [true, true, true]);
  handlers.pointerdown({ target: { closest: () => null } }); // outside any card
  assert.deepEqual(calls, [true, true, true]);
});

// Just enough of CSS selector matching for the focus trigger: comma lists of `tag` with
// `:not([type=x])` filters, the shape the selector has (R3).
function matches(el, selector) {
  return selector.split(',').some((part) => {
    const m = /^\s*([a-z]+)((?::not\(\[type=[a-z]+\]\))*)\s*$/.exec(part);
    if (!m) throw new Error(`selector part the test does not understand: ${part}`);
    const excluded = [...m[2].matchAll(/\[type=([a-z]+)\]/g)].map((x) => x[1]);
    return m[1] === el.tag && !excluded.includes(el.type);
  });
}

test('R3: pointerdown on the "always allow" checkbox (or a radio) does not make the window interactive', () => {
  const handlers = {};
  const host = { addEventListener: (type, fn) => { handlers[type] = fn; } };
  const calls = [];
  cards.mountCards(host, { api: {}, onInteractive: (on) => calls.push(on), adopt: true });
  const target = (tag, type) => ({ closest: (sel) => (sel === '.ans' ? {} : matches({ tag, type }, sel) ? {} : null) });
  handlers.pointerdown({ target: target('input', 'checkbox') });
  handlers.pointerdown({ target: target('input', 'radio') });
  assert.deepEqual(calls, [], 'clicking a box is a plain click: no focus taken');
  handlers.pointerdown({ target: target('input') });
  assert.deepEqual(calls, [true]);
  const perm = cards.renderCard({ id: 'c1', kind: 'permission', display: 'a', payload: { session_id: 's1', tool_name: 'Bash', tool_input: { command: 'ls' }, permission_suggestions: [{ type: 'addRules' }] } });
  assert.match(perm, /<input type="checkbox" data-always>/, 'the always control is the checkbox the trigger skips');
});

test('v1.2 M6: a mounted permission card ticks its countdown like the reply card', () => {
  const left = { textContent: '' };
  const bar = { style: { width: '' } };
  const host = { addEventListener() {}, querySelector: (sel) => (sel === '[data-left]' ? left : sel === '[data-bar]' ? bar : null), querySelectorAll: () => [] };
  const m = cards.mountCards(host, { api: {}, adopt: true });
  const T = 1_000_000;
  m.show({ id: 'p1', kind: 'permission', sessionId: 's1', expiresAt: T + 60000, payload: {} }, T);
  assert.equal(left.textContent, '1:00');
  m.tick(T + 15000);
  assert.equal(left.textContent, '0:45');
  assert.equal(bar.style.width, '75.0%', 'the bar is a share of the 60 s hold, not of the 9 min reply');
  m.show({ id: 'p2', kind: 'choice', sessionId: 's1', payload: {} }, T);
  assert.equal(m.leftMs(T + 1000), 59000, 'no deadline stamped: count from when the card appeared');
  m.clear();
});

// ---- Task 10: bubbles and the plan card ----
const BUB = { id: 'b1', kind: 'permission', sessionId: 's1', display: '<img src=x onerror=alert(1)>', cls: 'pathfinder', source: 'claude', line: '<img onerror=x> runs "a"', expiresAt: 1_000_000 + 30000, canOpen: true };
const PLAN = (text, extra = {}) => ({ id: 'pl1', kind: 'plan', sessionId: 's1', display: 'Ann', cls: 'pathfinder', source: 'claude', payload: { tool_input: { plan: text } }, ...extra });

test('renderBubble escapes display and line and carries the data attributes', () => {
  const h = cards.renderBubble(BUB, { nowMs: 1_000_000 });
  assert.ok(!h.includes('<img src=x') && !h.includes('<img onerror'));
  assert.match(h, /<button type="button" class="bub" data-act="expand" data-card="b1" data-session="s1" aria-expanded="false">/);
  assert.match(h, /data-ring data-expires="1030000" data-hold="60000" style="--p:50"/);
  assert.match(cards.renderBubble({ ...BUB, expiresAt: 0 }, { nowMs: 1_000_000, expanded: true }), /aria-expanded="true"[^>]*>[\s\S]*--p:0/);
  assert.match(cards.renderBubble({ ...BUB, kind: 'plan' }, { nowMs: 1_000_000 }), /data-hold="540000"/);
  assert.match(cards.renderBubble({ ...BUB, kind: 'reply' }, { nowMs: 1_000_000 }), /data-hold="540000"/);
});

test('plan card escapes, bolds headings, cuts at 20000 with the hint, and varies its approve buttons', () => {
  const h = cards.renderCard(PLAN('# Heading\n<script>alert(1)</script>\nbody'), {});
  assert.ok(!h.includes('<script>'));
  assert.match(h, /<b>#? ?Heading<\/b>|<b># Heading<\/b>/);
  assert.ok(!h.includes('plan-more'));
  assert.match(h, /data-act="approve"[^>]*>Approve</);
  assert.ok(!h.includes('approve-auto'));
  assert.match(h, /<input data-feedback placeholder="What should change\?"/);
  assert.match(h, /data-act="keep"[^>]*>Keep planning</);
  assert.match(h, /Back to its window in/);
  const two = cards.renderCard(PLAN('x', { planModes: ['acceptEdits', 'default'] }), {});
  assert.match(two, /data-act="approve-auto"[^>]*>Approve · auto-accept edits</);
  assert.match(two, /data-act="approve-ask"[^>]*>Approve · ask before edits</);
  const long = cards.renderCard(PLAN('a'.repeat(20001)), {});
  assert.ok(long.includes('<p class="plan-more">Open the window to read the rest.</p>'));
  assert.ok(!long.includes('a'.repeat(20001)) && long.includes('a'.repeat(20000)));
  assert.ok(!cards.renderCard(PLAN('a'.repeat(20000)), {}).includes('plan-more'));
});

test('plan: arming, hold and cardLeftMs', () => {
  assert.equal(cards.clickAllowed('keep', 1000, 1100), false);
  assert.equal(cards.clickAllowed('keep', 1000, 1500), true);
  for (const a of ['approve', 'approve-auto', 'approve-ask']) assert.equal(cards.clickAllowed(a, 1000, 1100), false);
  assert.equal(cards.cardLeftMs({ kind: 'plan' }, 5000, 2000), cards.PLAN_MS - 3000);
  assert.equal(cards.PLAN_MS, 540000);
});

test('mounted plan card answers approve / keep and drives onInteractive from the feedback box', () => {
  const L = {};
  const input = { value: '', dataset: {}, matches: (s) => s === '[data-feedback]' };
  const cardEl = { dataset: { card: 'pl1', session: 's1' }, querySelector: (s) => (s === '[data-feedback]' ? input : null), querySelectorAll: () => [], classList: { remove() {} } };
  const mk = (act) => ({ dataset: { act }, disabled: false, closest: (s) => (s === '[data-act]' ? mk.self : cardEl), });
  const host = { addEventListener: (t, f) => { L[t] = f; }, contains: () => true, querySelector: () => null, querySelectorAll: () => [], };
  input.closest = (s) => (s === '.ans' ? cardEl : s.includes('input') ? input : null);
  const got = []; const inter = [];
  const m = cards.mountCards(host, { api: { answer: (id, r) => got.push([id, r]) }, adopt: true, onInteractive: (v) => inter.push(v) });
  const T = Date.now() - 10_000;
  const clickOn = (act) => { const el = { dataset: { act }, disabled: false, closest: (s) => (s === '[data-act]' ? el : cardEl) }; cardEl.dataset.done = ''; delete cardEl.dataset.done; L.click({ target: el }); };
  for (const [act, want] of [['approve-auto', { kind: 'plan', approve: 'acceptEdits' }], ['approve-ask', { kind: 'plan', approve: 'default' }], ['approve', { kind: 'plan', approve: 'default' }]]) {
    m.show({ id: 'pl1', kind: 'plan', sessionId: 's1' }, T); got.length = 0;
    clickOn(act); assert.deepEqual(got[0], ['pl1', want]);
    m.clear();
  }
  m.show({ id: 'pl1', kind: 'plan', sessionId: 's1' }, T); got.length = 0; inter.length = 0;
  L.pointerdown({ target: input });
  assert.deepEqual(inter, [true]);
  input.value = '  tighten it  ';
  L.input({ target: input });
  assert.equal(m.drafts.get('pl1'), '  tighten it  ');
  clickOn('keep');
  assert.deepEqual(got[0], ['pl1', { kind: 'plan', keep: true, feedback: 'tighten it' }]);
  assert.equal(inter.at(-1), false);
});
