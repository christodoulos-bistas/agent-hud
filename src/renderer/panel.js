// Agent detail panel. renderPanel is pure (detail + clock in, HTML string out) and runs in Node for
// the tests; bootPanel wires it to the DOM and to window.panel from the preload. Every string that
// comes from the detail goes through esc() before it reaches markup.
import { spriteSvg } from './sprites.js';
import { esc, renderChip, className } from './hud.js';
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
  if (s.reason === 'long') {
    const from = d.current?.startedAt ?? d.currentStepStartedAt;
    if (finite(from)) {
      const mins = Math.floor(Math.max(0, Number(nowMs) - Number(from)) / 60000);
      text = `${esc(d.current?.label ?? 'The step')} has been running for ${mins} min`;
    }
  }
  return `<div class="warn"><b>${head}</b> ${text}</div>`;
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
    return '<div class="now">' +
      `${timeSpan(cur.startedAt, nowMs, { cls: 'el' })}<b>Now:</b> ${esc(cur.doing)}` +
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
  return '<div class="fly">' +
    '<div class="fly-top">' +
      `<span class="spr">${spriteSvg(d.cls, 1.5)}</span>` +
      `<div class="who"><div class="who-n">${esc(d.display)}</div><div class="who-d"><span class="cls">${esc(className(d.cls))}</span></div></div>` +
      renderChip(d, nowMs) +
      '<button type="button" class="x" data-act="close" aria-label="Close">✕</button>' +
    '</div>' +
    '<div class="det">' +
      stuckLine(d, nowMs) +
      (d.stage === 'needs' ? '<div class="needs-note">Waiting for your answer in the HUD</div>' : '') +
      '<p class="lbl">Task</p>' + task +
      nowBlock(d, nowMs) +
      list + help +
      `<div class="foot">${timeSpan(d.startedAt, nowMs, { pre: 'started ', post: ` ago · ${count} steps` })}` +
      '<button type="button" class="open" data-act="open">open window ↗</button></div>' +
    '</div>' +
  '</div>';
}

export function bootPanel(api = globalThis.panel, doc = globalThis.document) {
  const root = doc.getElementById('panel-root');
  let detail = null;
  let timer = null;

  // A full render only when a new detail arrives; between details the 1 s tick rewrites the time
  // texts in place (and swaps the chip and the stuck line, which hold no buttons), so a click that
  // straddles a tick still lands and a focused button keeps its focus.
  const render = () => { root.innerHTML = detail ? renderPanel(detail, Date.now()) : ''; };
  const swap = (el, html) => { if (el && html && el.outerHTML !== html) el.outerHTML = html; };
  const tick = () => {
    if (!detail) return;
    const now = Date.now();
    for (const el of root.querySelectorAll('[data-since]')) {
      const text = timeText(el.dataset, now);
      if (el.textContent !== text) el.textContent = text;
    }
    swap(root.querySelector('.fly-top > .st'), renderChip(detail, now));
    swap(root.querySelector('.det > .warn'), stuckLine(detail, now));
  };

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

  api.onDetail?.((next) => {
    detail = next || null;
    render();
    if (detail && !timer) timer = setInterval(tick, 1000);
    else if (!detail && timer) { clearInterval(timer); timer = null; }
  });
}

if (typeof document !== 'undefined' && globalThis.panel) bootPanel();
