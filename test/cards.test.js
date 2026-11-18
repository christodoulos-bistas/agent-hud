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
const BUB = { id: 'b1', kind: 'permission', sessionId: 's1', display: '<img src=x onerror=alert(1)>', cls: 'pathfinder', source: 'claude', line: '<img onerror=x> runs "a"', expiresAt: 1_000_000 + 30000, holdMs: 60000, canOpen: true };
const PLAN = (text, extra = {}) => ({ id: 'pl1', kind: 'plan', sessionId: 's1', display: 'Ann', cls: 'pathfinder', source: 'claude', payload: { tool_input: { plan: text } }, ...extra });

test('renderBubble escapes display and line and carries the data attributes', () => {
  const h = cards.renderBubble(BUB, { nowMs: 1_000_000 });
  assert.ok(!h.includes('<img src=x') && !h.includes('<img onerror'));
  assert.match(h, /<button type="button" class="bub" data-act="expand" data-card="b1" data-session="s1" aria-expanded="false">/);
  assert.match(h, /data-ring data-expires="1030000" data-hold="60000" style="--p:50"/);
  assert.match(cards.renderBubble({ ...BUB, expiresAt: 0 }, { nowMs: 1_000_000, expanded: true }), /aria-expanded="true"[^>]*>[\s\S]*--p:0/);
  assert.match(cards.renderBubble({ ...BUB, kind: 'plan', holdMs: 540000 }, { nowMs: 1_000_000 }), /data-hold="540000"/);
  assert.match(cards.renderBubble({ ...BUB, kind: 'reply', holdMs: 540000 }, { nowMs: 1_000_000 }), /data-hold="540000"/);
});

const PLAN_MD = '# Ship the thing\n\nIntro text\n## Step one\nbody\n### Step two\n#### too deep\n## Step three\n';

test('plan card: the line count covers the whole plan, past PLAN_MAX; indented headings are steps too', () => {
  const long = 'x\n'.repeat(cards.PLAN_MAX); // twice PLAN_MAX characters
  assert.match(cards.renderCard(PLAN(long, { holdMs: null }), {}), new RegExp(`<p class="plan-n">${cards.PLAN_MAX} lines</p>`));
  const h = cards.renderCard(PLAN('# T\n  ## A\n## B', { holdMs: null }), {});
  assert.match(h, /<li>A<\/li><li>B<\/li>/);
});

test('plan card: title, step headings as a list, line count, Read plan and Open chat', () => {
  const h = cards.renderCard(PLAN(PLAN_MD, { holdMs: null, expiresAt: null, canOpen: true }), {});
  assert.match(h, /data-kind="plan"/);
  assert.match(h, /<p class="plan-t">Ship the thing<\/p>/);
  assert.match(h, /<ol class="plan-o"><li>Step one<\/li><li>Step two<\/li><li>Step three<\/li><\/ol>/, '#-### after the title; not ####');
  assert.match(h, /<p class="plan-n">7 lines<\/p>/, 'non-empty lines, as the bubble counts them');
  assert.ok(h.includes('<button type="button" class="btn gold" data-act="read-plan">Read plan ↗</button>'));
  assert.match(h, /data-act="open-card"[^>]*>Open chat ↗</);
  assert.ok(!cards.renderCard(PLAN(PLAN_MD, { canOpen: false }), {}).includes('open-card'), 'no Open chat without a window');
  assert.ok(cards.renderCard(PLAN(PLAN_MD, { canOpen: false }), {}).includes('read-plan'));
  assert.ok(h.includes('<button type="button" class="btn ghost" data-act="dismiss-plan">Dismiss</button>'), 'Dismiss: Esc in the chat sends the HUD nothing');
  assert.ok(cards.renderCard(PLAN(PLAN_MD, { canOpen: false }), {}).includes('dismiss-plan'), 'Dismiss even without a window');
});

test('plan card: no headings falls back to "Plan" and the first lines', () => {
  const h = cards.renderCard(PLAN('\nfirst\n\nsecond\nthird\nfourth\nfifth\nsixth'), {});
  assert.match(h, /<p class="plan-t">Plan<\/p>/);
  assert.match(h, /<ol class="plan-o"><li>first<\/li><li>second<\/li><li>third<\/li><li>fourth<\/li><\/ol>/);
});

test('plan card escapes a hostile plan, caps the input at 20000, and has no answer controls', () => {
  const h = cards.renderCard(PLAN('# <script>alert(1)</script>\n## <img src=x onerror=alert(1)>\n"q" & \'s\''), {});
  assert.ok(!h.includes('<script>') && !h.includes('<img'));
  assert.ok(h.includes('&lt;script&gt;alert(1)&lt;/script&gt;') && h.includes('&lt;img src=x'));
  assert.doesNotMatch(h, /data-act="(answer|approve|approve-auto|approve-ask|keep|allow|deny|send)"/);
  assert.doesNotMatch(h, /<input|data-feedback|Keep planning|Edit mode stays/);
  const long = cards.renderCard(PLAN(`# T\n## ${'a'.repeat(30000)}`), {});
  assert.ok(!long.includes('a'.repeat(20001)));
});

test('plan card: no timer or countdown without a hold; a hold still draws one', () => {
  const none = cards.renderCard(PLAN('# T', { holdMs: null }), {});
  assert.doesNotMatch(none, /class="timer"|data-left|data-bar|Back to its window/);
  assert.doesNotMatch(cards.renderCard(PLAN('# T'), {}), /data-left/, 'holdMs undefined is not a hold either');
  assert.match(cards.renderCard(PLAN('# T', { holdMs: 120000 }), { leftMs: 60000 }), /<i data-bar style="width:50\.0%">/);
});

test('a bubble has no ring without a hold', () => {
  const b = cards.renderBubble({ ...BUB, kind: 'plan', holdMs: null, expiresAt: null }, { nowMs: 1_000_000 });
  assert.doesNotMatch(b, /class="ring"|data-ring|data-hold/);
  assert.match(b, /class="bub"/);
});

test('mounted plan card: read-plan calls openPlan with its own id and never answers; Open chat only opens the chat', () => {
  const L = {};
  const cardEl = { dataset: { card: 'plan:s1:1', session: 's1', kind: 'plan' }, querySelector: () => null, querySelectorAll: () => [], classList: { remove() {} } };
  const host = { addEventListener: (t, f) => { L[t] = f; }, contains: () => true, querySelector: () => null, querySelectorAll: () => [] };
  const calls = [];
  const api = { answer: (...a) => calls.push(['answer', ...a]), openPlan: (id) => calls.push(['openPlan', id]), dismissPlan: (id) => calls.push(['dismissPlan', id]), release: (id) => calls.push(['release', id]), openWindow: (s) => calls.push(['openWindow', s]) };
  const m = cards.mountCards(host, { api, adopt: true });
  m.show({ id: 'plan:s1:1', kind: 'plan', sessionId: 's1', holdMs: null, expiresAt: null }, Date.now() - 10_000);
  const clickOn = (act) => { const el = { dataset: { act }, disabled: false, closest: (s) => (s === '[data-act]' ? el : cardEl) }; L.click({ target: el }); };
  clickOn('read-plan');
  clickOn('read-plan');
  assert.deepEqual(calls, [['openPlan', 'plan:s1:1'], ['openPlan', 'plan:s1:1']], 'read-plan leaves the card in place and never answers');
  assert.ok(!cardEl.dataset.done);
  calls.length = 0;
  clickOn('open-card');
  // Nothing is held for a plan, so nothing is released: the notice stays (Claude still waits) and the
  // card keeps working, so Read plan still opens the file after a trip to the chat.
  assert.deepEqual(calls, [['openWindow', 's1']]);
  assert.ok(!cardEl.dataset.done, 'the card is not settled');
  calls.length = 0;
  clickOn('read-plan');
  assert.deepEqual(calls, [['openPlan', 'plan:s1:1']]);
  calls.length = 0;
  clickOn('dismiss-plan');
  clickOn('dismiss-plan');
  assert.deepEqual(calls, [['dismissPlan', 'plan:s1:1']], 'Dismiss clears the notice once; never an answer or a release');
  assert.equal(cardEl.dataset.done, '1');
  m.clear();
});

test('R1: the hold travels with the card (holdMs): the ring, the countdown bar and cardLeftMs read it', () => {
  const T = 1_000_000;
  const b = cards.renderBubble({ ...BUB, kind: 'permission', holdMs: 120000, expiresAt: T + 60000 }, { nowMs: T });
  assert.match(b, /data-hold="120000" style="--p:50"/, "half of the card's own hold, not of a renderer constant");
  assert.equal(cards.cardLeftMs({ kind: 'reply', holdMs: 120000 }, 5000, 2000), 117000, "no deadline: count down the card's hold");
  assert.equal(cards.cardLeftMs({ kind: 'reply' }, 5000, 2000), cards.FALLBACK_HOLD_MS - 3000, 'a card without holdMs falls back');
  for (const k of ['HOLD_MS', 'REPLY_MS', 'PLAN_MS']) assert.equal(k in cards, false, `no renderer copy of main's ${k}`);
  const bar = { style: { width: '' } };
  const left = { textContent: '' };
  const host = { addEventListener() {}, querySelector: (sel) => (sel === '[data-left]' ? left : sel === '[data-bar]' ? bar : null), querySelectorAll: () => [] };
  const m = cards.mountCards(host, { api: {}, adopt: true });
  m.show({ id: 'r9', kind: 'reply', sessionId: 's1', holdMs: 120000, expiresAt: T + 30000, payload: {} }, T);
  assert.equal(left.textContent, '0:30');
  assert.equal(bar.style.width, '25.0%');
  m.clear();
});
