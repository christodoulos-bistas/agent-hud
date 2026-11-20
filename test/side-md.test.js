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
test('non-strings render nothing', () => { assert.equal(renderAnswer(null), ''); assert.equal(renderAnswer(42), ''); });
test('CRLF, br, unterminated fence, no inline inside code', () => {
  assert.equal(renderAnswer('a\r\nb'), '<p>a<br>b</p>');
  assert.equal(renderAnswer('```\n**x** `y`\nz'), '<pre><code>**x** `y`\nz</code></pre>');
  assert.equal(renderAnswer('`**x**`'), '<p><code>**x**</code></p>');
  assert.equal(renderAnswer('* a\n\ntext'), '<ul><li>a</li></ul><p>text</p>');
});
