// The details panel's Side questions tab: tabs, thread, ask box. Pure (side view + clock in, HTML out).
// Every string from a log, a chat or VS Code goes through esc(); answers through renderAnswer.
import { esc } from './cards.js';
import { fmtDuration } from './format.js';
import { renderAnswer } from './side-md.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 24 * 3600000;

export function sideWhen(at, nowMs) {
  const age = Number(nowMs) - Number(at);
  if (!Number.isFinite(age) || age < 60000) return 'now';
  if (age < DAY) return `${fmtDuration(age)} ago`;
  const d = new Date(Number(at));
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function renderTabs(side) {
  const on = side?.tab === 'side';
  const n = Number(side?.count) > 0 ? ` <span class="n">${Math.trunc(Number(side.count))}</span>` : '';
  const tab = (id, label) =>
    `<button type="button" class="tab" role="tab" data-act="tab" data-tab="${id}" aria-selected="${(id === 'side') === on}">${label}</button>`;
  return '<div class="tabs" data-key="tabs" role="tablist">' + tab('now', 'Now') + tab('side', `Side questions${n}`) + '</div>';
}

const tag = (src) => (src === 'vscode' ? '<span class="tag vsc">VS Code</span>' : '<span class="tag hud">HUD</span>');

function qaHead(question, source, when) {
  return `<div class="qa-q"><span class="q">“${esc(question)}”</span><span class="meta">${tag(source)} ${esc(when)}</span></div>`;
}

function entryHtml(e, nowMs, canOpen) {
  const id = esc(e.id);
  const head = qaHead(e.question, e.source, sideWhen(e.at, nowMs));
  let body;
  if (typeof e.response === 'string') {
    body = `<div class="qa-a">${renderAnswer(e.response)}</div>` +
      `<div class="qa-acts"><button type="button" data-act="side-copy" data-entry="${id}">copy</button></div>`;
  } else {
    body = `<div class="qa-a err">${esc(e.error || 'Claude gave no answer')}</div>` +
      '<div class="qa-acts">' +
        `<button type="button" data-act="side-retry" data-entry="${id}">try again</button>` +
        (canOpen ? '<button type="button" data-act="open">open window ↗</button>' : '') +
      '</div>';
  }
  return `<div class="qa" data-key="qa:${id}">${head}${body}</div>`;
}

// canOpen false (the chat's window can't be focused): no "open window" on an error entry either.
export function renderSideTab(side, display, nowMs, foot = '', { canOpen = true } = {}) {
  const entries = Array.isArray(side?.entries) ? side.entries : [];
  const asking = side?.asking || null;
  const rows = entries.map((e) => entryHtml(e, nowMs, canOpen));
  if (asking) {
    rows.push(`<div class="qa" data-key="qa:pending">${qaHead(asking.question, 'hud', sideWhen(asking.at, nowMs))}` +
      '<div class="qa-a wait">thinking<span class="dots"></span></div></div>');
  }
  const thread = rows.length ? `<div class="thread" data-key="thread" data-deep>${rows.join('')}</div>` : '';
  const empty = !rows.length
    ? '<p class="task none" data-key="side-empty">None yet. Ask one, or use /btw in VS Code: those show up here too.</p>' : '';
  const sick = side?.healthy === false
    ? '<p class="task none" data-key="side-sick">Can\'t read VS Code side questions right now.</p>' : '';
  const ph = asking ? 'Waiting for the answer…' : entries.length ? 'Ask a follow-up…' : `Ask ${display ?? ''} on the side…`;
  const box = '<div class="ask" data-key="side-ask">' +
    `<input type="text" data-side-ask${asking ? ' disabled' : ''} placeholder="${esc(ph)}" autocomplete="off" spellcheck="false">` +
    `<button type="button" class="btn gold" data-act="side-ask"${asking ? ' disabled' : ''}>Ask</button></div>`;
  return `<div class="det" data-key="side" data-deep>${thread}${empty}${sick}${box}${foot}</div>`;
}
