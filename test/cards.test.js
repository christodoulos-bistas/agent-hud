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
  const target = (selfSel) => ({ closest: (sel) => (sel === '.ans' ? {} : sel.split(',').map((s) => s.trim()).includes(selfSel) ? {} : null) });
  handlers.pointerdown({ target: target('button') });
  assert.deepEqual(calls, []);
  handlers.pointerdown({ target: target('input') });
  handlers.pointerdown({ target: target('textarea') });
  assert.deepEqual(calls, [true, true]);
  handlers.pointerdown({ target: { closest: () => null } }); // outside any card
  assert.deepEqual(calls, [true, true]);
});
