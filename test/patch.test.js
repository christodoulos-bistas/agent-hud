import test from 'node:test'; import assert from 'node:assert/strict';
import { patch } from '../src/renderer/hud.js';

// The smallest DOM the keyed patch touches: children, dataset.key, tagName, outerHTML, attributes,
// remove, insertBefore, firstElementChild / nextElementSibling, querySelectorAll('[data-key]').
class El {
  constructor(key, html = key) { this.tagName = 'DIV'; this.dataset = key == null ? {} : { key }; this.html = html; this.parent = null; this.kids = []; this.attributes = []; }
  get children() { return this.kids; }
  get outerHTML() { return this.html; }
  get firstElementChild() { return this.kids[0] ?? null; }
  get nextElementSibling() { const s = this.parent?.kids; return s ? s[s.indexOf(this) + 1] ?? null : null; }
  hasAttribute() { return false; } getAttribute() { return null; } setAttribute() {} removeAttribute() {}
  querySelectorAll() { return []; }
  remove() { if (this.parent) { this.parent.kids.splice(this.parent.kids.indexOf(this), 1); this.parent = null; } }
  insertBefore(n, at) {
    n.remove();
    const i = at ? this.kids.indexOf(at) : -1;
    if (i < 0) this.kids.push(n); else this.kids.splice(i, 0, n);
    n.parent = this;
  }
}
const tree = (...kids) => { const p = new El(null); for (const k of kids) p.insertBefore(k, null); return p; };
const keys = (p) => p.children.map((c) => c.dataset.key);

test('patch never leaks children that share a key: repeated renders keep the count the fresh tree has', () => {
  const parent = tree();
  const rendered = new WeakMap();
  for (let i = 0; i < 5; i++) {
    // Two rows with the same key whose HTML changes every render (a clock, a status).
    patch(parent, tree(new El('row:a', `a1-${i}`), new El('row:a', `a2-${i}`), new El('row:b', 'b')), rendered);
  }
  assert.deepEqual(keys(parent), ['row:a', 'row:a', 'row:b']);
});

test('patch with unique keys still reuses an unchanged child and replaces a changed one', () => {
  const parent = tree();
  const rendered = new WeakMap();
  patch(parent, tree(new El('row:a', 'A'), new El('row:b', 'B')), rendered);
  const [a] = parent.children;
  patch(parent, tree(new El('row:a', 'A'), new El('row:b', 'B2')), rendered);
  assert.equal(parent.children[0], a, 'unchanged row kept');
  assert.equal(parent.children[1].outerHTML, 'B2');
  assert.deepEqual(keys(parent), ['row:a', 'row:b']);
});

// An element with real attributes, for the data-deep attribute patching.
class AEl extends El {
  constructor(key, attrs = {}, deep = false) {
    super(key);
    if (deep) this.dataset.deep = '';
    this.attributes = Object.entries(attrs).map(([name, value]) => ({ name, value }));
  }
  hasAttribute(n) { return this.attributes.some((a) => a.name === n); }
  getAttribute(n) { return this.attributes.find((a) => a.name === n)?.value ?? null; }
  setAttribute(n, v) { const a = this.attributes.find((x) => x.name === n); if (a) a.value = v; else this.attributes.push({ name: n, value: v }); }
  removeAttribute(n) { this.attributes = this.attributes.filter((a) => a.name !== n); }
}
const askBox = (inputAttrs) => {
  const box = new AEl('side-ask', { class: 'ask' }, true);
  box.insertBefore(new AEl('side-ask-input', inputAttrs, true), null);
  box.insertBefore(new El('side-ask-btn', `btn-${inputAttrs.disabled ?? ''}`), null);
  return box;
};

test('patch: a data-deep input inside a data-deep box is kept, its attributes updated in place (M6)', () => {
  const parent = tree();
  const rendered = new WeakMap();
  patch(parent, tree(askBox({ placeholder: 'Ask arsenal on the side…' })), rendered);
  const input = parent.children[0].children[0];
  patch(parent, tree(askBox({ placeholder: 'Ask a follow-up…' })), rendered);
  assert.equal(parent.children[0].children[0], input, 'same input element (focus and typed text survive)');
  assert.equal(input.getAttribute('placeholder'), 'Ask a follow-up…');
  patch(parent, tree(askBox({ placeholder: 'Waiting for the answer…', disabled: '' })), rendered);
  assert.equal(parent.children[0].children[0], input);
  assert.equal(input.hasAttribute('disabled'), true);
  patch(parent, tree(askBox({ placeholder: 'Ask a follow-up…' })), rendered);
  assert.equal(input.hasAttribute('disabled'), false);
});
