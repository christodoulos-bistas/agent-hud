// Safe Markdown subset for side-question answers. DOM-free.
// Escapes everything first; only fences, paragraphs, lists, `code` and **bold** become markup.
import { esc } from './cards.js';

function inline(s) {
  // Split on code spans so bold never applies inside them.
  return s.split(/(`[^`\n]+`)/).map((part, i) => i % 2
    ? `<code>${part.slice(1, -1)}</code>`
    : part.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')).join('');
}

// A list item: indent, bullet or number (group 3), text.
const ITEM = /^([ \t]*)([-*]|(\d+)\.) (.*)$/;

// A list: { tag, start, items }; an item: { lines, subs } (subs: lists nested under it, one level).
const listHtml = (l) => `<${l.tag}${l.tag === 'ol' && l.start !== 1 ? ` start="${l.start}"` : ''}>` +
  l.items.map((it) => `<li>${it.lines.map(inline).join('<br>')}${it.subs.map(listHtml).join('')}</li>`).join('') +
  `</${l.tag}>`;

export function renderAnswer(text) {
  if (typeof text !== 'string') return '';
  const lines = esc(text.replace(/\r\n/g, '\n')).split('\n');
  const out = [];
  let para = [], list = null, code = null, gap = false;
  const flushPara = () => { if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; };
  const flushList = () => { if (list) out.push(listHtml(list)); list = null; };
  // The item text goes on: the last item, or the last nested item under it.
  const lastItem = () => {
    const it = list.items[list.items.length - 1];
    const sub = it.subs[it.subs.length - 1];
    return sub ? sub.items[sub.items.length - 1] : it;
  };
  for (const line of lines) {
    if (code) {
      if (line.trim() === '```') { out.push(`<pre><code>${code.join('\n')}</code></pre>`); code = null; } else code.push(line);
      continue;
    }
    let m;
    if (line.trim().startsWith('```')) { flushPara(); flushList(); code = []; }
    else if ((m = ITEM.exec(line))) {
      flushPara();
      const tag = m[3] === undefined ? 'ul' : 'ol';
      const start = m[3] === undefined ? 1 : parseInt(m[3], 10);
      const item = { lines: [m[4]], subs: [] };
      if (m[1] && list) { // indented under an item: a nested list in that item
        const it = list.items[list.items.length - 1];
        let sub = it.subs[it.subs.length - 1];
        if (!sub || sub.tag !== tag) it.subs.push(sub = { tag, start, items: [] });
        sub.items.push(item);
      } else {
        if (list && list.tag !== tag) flushList(); // a blank line between items of one type keeps the list open
        (list ||= { tag, start, items: [] }).items.push(item);
      }
    } else if (!line.trim()) { flushPara(); gap = true; continue; }
    else if (list && !gap && /^[ \t]/.test(line)) lastItem().lines.push(line.trim()); // an indented continuation line
    else { flushList(); para.push(line); }
    gap = false;
  }
  if (code) out.push(`<pre><code>${code.join('\n')}</code></pre>`);
  flushPara(); flushList();
  return out.join('');
}
