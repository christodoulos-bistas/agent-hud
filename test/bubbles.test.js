import test from 'node:test'; import assert from 'node:assert/strict';
import { bubbleLine } from '../src/main/bubbles.js';

const perm = (tool_name, tool_input) => ({ kind: 'permission', payload: { tool_name, tool_input } });
const opts = (n) => Array.from({ length: n }, (_, k) => ({ label: 'o' + k }));
const choice = (questions) => ({ kind: 'choice', payload: { tool_input: { questions } } });

test('permission lines', () => {
  assert.equal(bubbleLine(perm('Bash', { command: 'npm  publish --tag next' })), 'Bash: npm publish --tag next');
  assert.equal(bubbleLine(perm('Edit', { file_path: 'C:/x/src/a.ts' })), 'Edit: a.ts');
  assert.equal(bubbleLine(perm('Edit', { file_path: String.raw`C:\x\src\b.ts` })), 'Edit: b.ts');
  assert.equal(bubbleLine(perm('WebFetch', { url: 'https://docs.x.com/a' })), 'WebFetch: docs.x.com');
  const long = 'y'.repeat(200);
  assert.equal(bubbleLine(perm('Bash', { command: long })), 'Bash: ' + 'y'.repeat(60) + '…');
});

test('choice lines', () => {
  assert.equal(bubbleLine(choice([{ header: 'DB', question: 'Which DB?', options: opts(3) }])), 'DB · 3 options');
  const q = { header: 'DB', question: 'Which DB?', options: opts(3) };
  assert.equal(bubbleLine(choice([q, q, q])), 'DB · 3 options · +2 more');
  assert.equal(bubbleLine(choice([{ question: 'Which DB?', options: opts(2) }])), 'Which DB?');
});

test('plan and reply lines', () => {
  assert.equal(bubbleLine({ kind: 'plan', payload: { tool_input: { plan: 'a\nb\n\nc' } } }), 'Plan ready · 3 lines');
  assert.equal(bubbleLine({ kind: 'reply', payload: { last_assistant_message: 'All done here' } }), 'All done here');
  assert.equal(bubbleLine({ kind: 'reply', payload: { last_assistant_message: '' } }), 'wants a reply');
});

test('never throws on odd payloads', () => {
  for (const item of [
    null, {}, { kind: 'permission' }, { kind: 'permission', payload: null }, perm('Bash', undefined), perm('WebFetch', { url: 'not a url' }),
    choice('nope'), choice([null, undefined]), { kind: 'choice', payload: {} }, { kind: 'plan', payload: {} }, { kind: 'reply' }, { kind: 'weird', payload: {} },
  ]) assert.equal(typeof bubbleLine(item), 'string');
});

test('plan line also reads a top-level plan', () => {
  assert.equal(bubbleLine({ kind: 'plan', payload: { plan: 'a\nb' } }), 'Plan ready · 2 lines');
});
