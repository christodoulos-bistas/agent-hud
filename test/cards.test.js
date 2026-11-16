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
