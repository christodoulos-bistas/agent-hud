import test from 'node:test'; import assert from 'node:assert/strict';
import { renderAnswer } from '../src/renderer/side-md.js';

test('bold, code, lists, paragraphs, fences', () => {
  assert.equal(renderAnswer('**Yes**: run `npm test`.'), '<p><b>Yes</b>: run <code>npm test</code>.</p>');
  assert.equal(renderAnswer('a\n\nb'), '<p>a</p><p>b</p>');
  assert.equal(renderAnswer('- one\n- two'), '<ul><li>one</li><li>two</li></ul>');
  assert.equal(renderAnswer('1. one\n2. two'), '<ol><li>one</li><li>two</li></ol>');
  assert.equal(renderAnswer('```\n<b>x</b>\n```'), '<pre><code>&lt;b&gt;x&lt;/b&gt;</code></pre>');
});
test('HTML, links and images stay text', () => {
  const h = renderAnswer('<img src=x onerror=alert(1)> [a](javascript:x) ![i](y)');
  assert.ok(!h.includes('<img') && !h.includes('<a') && h.includes('&lt;img'));
});
test('numbered lists keep their first number', () => {
  assert.equal(renderAnswer('3. c\n4. d'), '<ol start="3"><li>c</li><li>d</li></ol>');
  assert.equal(renderAnswer('1. a\n2. b'), '<ol><li>a</li><li>b</li></ol>');
  assert.equal(renderAnswer('1. a\n\ntext\n\n2. b'), '<ol><li>a</li></ol><p>text</p><ol start="2"><li>b</li></ol>');
});
test('a blank line between items of the same list type keeps the list open', () => {
  assert.equal(renderAnswer('1. a\n\n2. b'), '<ol><li>a</li><li>b</li></ol>');
  assert.equal(renderAnswer('- a\n\n- b'), '<ul><li>a</li><li>b</li></ul>');
  assert.equal(renderAnswer('- a\n\n1. b'), '<ul><li>a</li></ul><ol><li>b</li></ol>');
});
test('indented items under an item nest inside it; indented text continues it', () => {
  assert.equal(renderAnswer('1. Setup\n   - install\n   - run `npm test`\n2. Ship'),
    '<ol><li>Setup<ul><li>install</li><li>run <code>npm test</code></li></ul></li><li>Ship</li></ol>');
  assert.equal(renderAnswer('- a\n  1. x\n  2. y'), '<ul><li>a<ol><li>x</li><li>y</li></ol></li></ul>');
  assert.equal(renderAnswer('- a\n  more of a\n- b'), '<ul><li>a<br>more of a</li><li>b</li></ul>');
  assert.equal(renderAnswer('  - lone'), '<ul><li>lone</li></ul>', 'an indented item with no list open starts one');
  assert.equal(renderAnswer('- <b>x</b>\n  - <i>y</i>'), '<ul><li>&lt;b&gt;x&lt;/b&gt;<ul><li>&lt;i&gt;y&lt;/i&gt;</li></ul></li></ul>');
});
test('non-strings render nothing', () => { assert.equal(renderAnswer(null), ''); assert.equal(renderAnswer(42), ''); });
test('CRLF, br, unterminated fence, no inline inside code', () => {
  assert.equal(renderAnswer('a\r\nb'), '<p>a<br>b</p>');
  assert.equal(renderAnswer('```\n**x** `y`\nz'), '<pre><code>**x** `y`\nz</code></pre>');
  assert.equal(renderAnswer('`**x**`'), '<p><code>**x**</code></p>');
  assert.equal(renderAnswer('* a\n\ntext'), '<ul><li>a</li></ul><p>text</p>');
});
