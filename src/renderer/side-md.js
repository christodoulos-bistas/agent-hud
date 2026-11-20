// Safe Markdown subset for side-question answers. DOM-free.
// Escapes everything first; only fences, paragraphs, lists, `code` and **bold** become markup.
import { esc } from './cards.js';

function inline(s) {
  // Split on code spans so bold never applies inside them.
  return s.split(/(`[^`\n]+`)/).map((part, i) => i % 2
    ? `<code>${part.slice(1, -1)}</code>`
    : part.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')).join('');
}

export function renderAnswer(text) {
  if (typeof text !== 'string') return '';
  const lines = esc(text.replace(/\r\n/g, '\n')).split('\n');
  const out = [];
  let para = [], list = null, code = null;
  const flushPara = () => { if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; };
  const flushList = () => { if (list) out.push(`<${list.tag}>${list.items.map((x) => `<li>${inline(x)}</li>`).join('')}</${list.tag}>`); list = null; };
  for (const line of lines) {
    if (code) {
      if (line.trim() === '```') { out.push(`<pre><code>${code.join('\n')}</code></pre>`); code = null; } else code.push(line);
      continue;
    }
    let m;
    if (line.trim().startsWith('```')) { flushPara(); flushList(); code = []; }
    else if ((m = /^[-*] (.*)$/.exec(line)) || (m = /^\d+\. (.*)$/.exec(line))) {
      flushPara();
      const tag = /^[-*]/.test(line) ? 'ul' : 'ol';
      if (list && list.tag !== tag) flushList();
      (list ||= { tag, items: [] }).items.push(m[1]);
    } else if (!line.trim()) { flushPara(); flushList(); }
    else { flushList(); para.push(line); }
  }
  if (code) out.push(`<pre><code>${code.join('\n')}</code></pre>`);
  flushPara(); flushList();
  return out.join('');
}
