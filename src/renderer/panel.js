// Agent detail panel. renderPanel is pure (detail + clock in, HTML string out) and runs in Node for
// the tests; bootPanel wires it to the DOM and to window.panel from the preload. Every string that
// comes from the detail goes through esc() before it reaches markup.
import { spriteSvg } from './sprites.js';
import { esc, renderChip, chipOf, className, createRenderGate } from './hud.js';
import { fmtDuration } from './format.js';

const MAX_STEPS = 5;
const finite = (v) => v != null && Number.isFinite(Number(v));
const dur = (from, nowMs) => (finite(from) ? fmtDuration(Math.max(0, Number(nowMs) - Number(from))) : '');

// A live time text: the words around the time elapsed since `since` (ms). The span showing it keeps
// them in data attributes (data-since, data-pre, data-post), so the 1 s tick reads them back as
// strings and rewrites only that text, never the buttons.
export function timeText({ since, pre = '', post = '' } = {}, nowMs = Date.now()) {
  return finite(since) ? `${pre}${dur(since, nowMs)}${post}` : '';
}

function timeSpan(from, nowMs, { cls = '', pre = '', post = '' } = {}) {
  const live = finite(from)
    ? ` data-since="${Number(from)}"${pre ? ` data-pre="${esc(pre)}"` : ''}${post ? ` data-post="${esc(post)}"` : ''}`
    : '';
  const text = finite(from) ? timeText({ since: from, pre, post }, nowMs) : pre + post;
  return `<span${cls ? ` class="${cls}"` : ''}${live}>${esc(text)}</span>`;
}

const STUCK = { repeating: 'Repeating:', long: 'Long step:', silent: 'Silent:' };

function stuckLine(d, nowMs) {
  const s = d.stuck;
  if (!s) return '';
  const head = STUCK[s.reason] || 'Stuck:';
  let text = esc(s.detail);
  // The flagged step itself (stuck.label, stuck.startedAt), never d.current: another step may be newer.
  if (s.reason === 'long' && finite(s.startedAt)) {
    const mins = Math.floor(Math.max(0, Number(nowMs) - Number(s.startedAt)) / 60000);
    text = `${esc(s.label || 'The step')} has been running for ${mins} min`;
  }
  return `<div class="warn"><b>${head}</b> ${text}</div>`;
}

// Where the answer is waiting (M3): a card in the HUD; handed back to its window (the footer's
// "open window ↗" opens it); or a native prompt the HUD never held.
function needsNote(d) {
  if (d.hasCard) return 'Waiting for your answer in the HUD';
  if (d.handedBack) return 'Waiting in its window — open ↗';
  return 'Waiting for you in its window';
}

function markOf(s) {
  if (s.interrupted) return '<span class="skip">–</span>';
  if (s.ok === true) return '<span class="ok">✓</span>';
  if (s.ok === false) return '<span class="bad">✗</span>';
  return '<span class="skip">–</span>';
}

function nowBlock(d, nowMs) {
  const cur = d.current;
  if (cur) {
    // A shell step shows its whole command (up to 300 chars, wrapped), not the HUD's 40-char line.
    const what = typeof cur.command === 'string' && cur.command ? `running ${cur.command}` : cur.doing;
    return '<div class="now">' +
      `${timeSpan(cur.startedAt, nowMs, { cls: 'el' })}<b>Now:</b> ${esc(what)}` +
      (cur.why ? `<br><span class="why">${esc(cur.why)}</span>` : '') +
    '</div>';
  }
  const last = Array.isArray(d.steps) ? d.steps[0] : null;
  if (last && last.ok === false) {
    return '<div class="now fail">' +
      `${timeSpan(last.endedAt, nowMs, { cls: 'el' })}<b>Last:</b> ${esc(last.label)} failed` +
      (last.error ? `<br><span class="why">${esc(last.error)}</span>` : '') +
    '</div>';
  }
  return '';
}

export function renderPanel(detail, nowMs = Date.now()) {
  const d = detail || {};
  const steps = (Array.isArray(d.steps) ? d.steps : []).slice(0, MAX_STEPS);
  const helpers = Array.isArray(d.helpers) ? d.helpers : [];
  const task = d.task ? `<p class="task">“${esc(d.task)}”</p>` : '<p class="task none">Started before the HUD</p>';
  const list = steps.length
    ? '<p class="lbl">Recent steps</p><ol>' + steps.map((s) =>
      `<li>${markOf(s)}<span>${esc(s.label)}${s.ok === false && s.error ? `<span class="err">${esc(s.error)}</span>` : ''}</span>` +
      `${timeSpan(s.endedAt, nowMs, { cls: 'ago' })}</li>`).join('') + '</ol>'
    : '';
  const help = helpers.length
    ? '<p class="lbl">Helpers</p><ul class="help">' +
      helpers.map((h) => `<li><b>${esc(h.agentType)}</b> · ${esc(h.doing)}</li>`).join('') + '</ul>'
    : '';
  const count = Number.isFinite(Number(d.stepCount)) ? Math.trunc(Number(d.stepCount)) : 0;
  // No known start (M9): just the step count, no "started … ago".
  const foot = finite(d.startedAt)
    ? timeSpan(d.startedAt, nowMs, { pre: 'started ', post: ` ago · ${count} steps` })
    : `<span>${count} steps</span>`;
  return '<div class="fly">' +
    '<div class="fly-top">' +
      `<span class="spr">${spriteSvg(d.cls, 1.5)}</span>` +
      `<div class="who"><div class="who-n">${esc(d.display)}</div><div class="who-d"><span class="cls">${esc(className(d.cls))}</span></div></div>` +
      renderChip(d, nowMs) +
      '<button type="button" class="x" data-act="close" aria-label="Close">✕</button>' +
    '</div>' +
    '<div class="det">' +
      stuckLine(d, nowMs) +
      (d.stage === 'needs' ? `<div class="needs-note">${needsNote(d)}</div>` : '') +
      '<p class="lbl">Task</p>' + task +
      nowBlock(d, nowMs) +
      list + help +
      `<div class="foot">${foot}` +
      '<button type="button" class="open" data-act="open">open window ↗</button></div>' +
    '</div>' +
  '</div>';
}

// The arrow pointing at the clicked HUD row. Main places the panel (side: where it sits relative to the
// HUD; arrowY: px from the panel's top); the arrow goes on the edge facing the HUD, its 16 px
// triangle centred on arrowY. Anything malformed: no arrow.
export function arrowOf(place) {
  const side = place?.side;
  const y = place?.arrowY;
  if ((side !== 'left' && side !== 'right') || !finite(y)) return { edge: null, top: null };
  return { edge: side === 'left' ? 'right' : 'left', top: Math.max(0, Math.round(Number(y)) - 8) };
}

export function bootPanel(api = globalThis.panel, doc = globalThis.document) {
  const root = doc.getElementById('panel-root');
  let detail = null;
  let timer = null;

  // A full render only when a new detail arrives; between details the 1 s tick rewrites the time
  // texts and the chip's clock in place (and swaps the stuck line, which holds no buttons), so a
  // click that straddles a tick still lands and a focused button keeps its focus.
  const render = () => { root.innerHTML = detail ? renderPanel(detail, Date.now()) : ''; };
  const swap = (el, html) => { if (el && html && el.outerHTML !== html) el.outerHTML = html; };
  const tick = () => {
    if (!detail) return;
    const now = Date.now();
    for (const el of root.querySelectorAll('[data-since]')) {
      const text = timeText(el.dataset, now);
      if (el.textContent !== text) el.textContent = text;
    }
    const chip = root.querySelector('.fly-top > .st');
    const c = chipOf(detail, now);
    if (chip && chip.classList.contains(c.cls)) { if (chip.textContent !== c.text) chip.textContent = c.text; } else swap(chip, renderChip(detail, now));
    swap(root.querySelector('.det > .warn'), stuckLine(detail, now));
  };

  // The arrow lives on <body> (a CSS triangle in an 8 px gutter, panel.css), outside the scrolling list.
  api.onPlace?.((place) => {
    const { edge, top } = arrowOf(place);
    if (edge) {
      doc.body.dataset.arrow = edge;
      doc.body.style.setProperty('--arrow-top', `${top}px`);
    } else delete doc.body.dataset.arrow;
  });

  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || !root.contains(el)) return;
    if (el.dataset.act === 'close') api.close?.();
    else if (el.dataset.act === 'open') api.openWindow?.();
  });

  let lastHeight = -1;
  new ResizeObserver(() => {
    const h = Math.ceil(root.getBoundingClientRect().height);
    if (h !== lastHeight) { lastHeight = h; api.reportHeight?.(h); }
  }).observe(root);

  // A new detail arrives on nearly every event of a busy agent: it waits while a pointer is down in the
  // panel (createRenderGate), so ✕ and "open window ↗" are not replaced while being clicked.
  const gate = createRenderGate((next) => {
    detail = next || null;
    render();
    if (detail && !timer) timer = setInterval(tick, 1000);
    else if (!detail && timer) { clearInterval(timer); timer = null; }
  });
  root.addEventListener('pointerdown', () => gate.down());
  doc.addEventListener('pointerup', () => gate.up());
  doc.addEventListener('pointercancel', () => gate.up());

  api.onDetail?.((next) => gate.offer(next));
}

if (typeof document !== 'undefined' && globalThis.panel) bootPanel();
