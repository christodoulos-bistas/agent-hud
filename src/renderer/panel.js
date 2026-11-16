// Agent detail panel. renderPanel is pure (detail + clock in, HTML string out) and runs in Node for
// the tests; bootPanel wires it to the DOM and to window.panel from the preload. Every string that
// comes from the detail goes through esc() before it reaches markup.
import { spriteSvg } from './sprites.js';
import { esc, renderChip } from './hud.js';
import { fmtDuration } from './format.js';

const MAX_STEPS = 5;
const finite = (v) => v != null && Number.isFinite(Number(v));
const dur = (from, nowMs) => (finite(from) ? fmtDuration(Math.max(0, Number(nowMs) - Number(from))) : '');

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
      `<span class="el">${esc(dur(cur.startedAt, nowMs))}</span><b>Now:</b> ${esc(cur.doing)}` +
      (cur.why ? `<br><span class="why">${esc(cur.why)}</span>` : '') +
    '</div>';
  }
  const last = Array.isArray(d.steps) ? d.steps[0] : null;
  if (last && last.ok === false) {
    return '<div class="now fail">' +
      `<span class="el">${esc(dur(last.endedAt, nowMs))}</span><b>Last:</b> ${esc(last.label)} failed` +
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
      `<span class="ago">${esc(dur(s.endedAt, nowMs))}</span></li>`).join('') + '</ol>'
    : '';
  const help = helpers.length
    ? '<p class="lbl">Helpers</p><ul class="help">' +
      helpers.map((h) => `<li><b>${esc(h.agentType)}</b> · ${esc(h.doing)}</li>`).join('') + '</ul>'
    : '';
  const count = Number.isFinite(Number(d.stepCount)) ? Math.trunc(Number(d.stepCount)) : 0;
  return '<div class="fly">' +
    '<div class="fly-top">' +
      `<span class="spr">${spriteSvg(d.cls, 1.5)}</span>` +
      `<div class="who"><div class="who-n">${esc(d.display)}</div><div class="who-d"><span class="cls">${esc(d.cls)}</span></div></div>` +
      renderChip(d, nowMs) +
      '<button type="button" class="x" data-act="close" aria-label="Close">✕</button>' +
    '</div>' +
    '<div class="det">' +
      stuckLine(d, nowMs) +
      (d.stage === 'needs' ? '<div class="needs-note">Waiting for your answer in the HUD</div>' : '') +
      '<p class="lbl">Task</p>' + task +
      nowBlock(d, nowMs) +
      list + help +
      `<div class="foot"><span>started ${esc(dur(d.startedAt, nowMs))} ago · ${count} steps</span>` +
      '<button type="button" class="open" data-act="open">open window ↗</button></div>' +
    '</div>' +
  '</div>';
}

export function bootPanel(api = globalThis.panel, doc = globalThis.document) {
  const root = doc.getElementById('panel-root');
  let detail = null;
  let timer = null;

  const render = () => { root.innerHTML = detail ? renderPanel(detail, Date.now()) : ''; };

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
    if (detail && !timer) timer = setInterval(render, 1000);
    else if (!detail && timer) { clearInterval(timer); timer = null; }
  });
}

if (typeof document !== 'undefined' && globalThis.panel) bootPanel();
