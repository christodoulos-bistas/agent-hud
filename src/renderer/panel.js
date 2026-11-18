// Agent detail panel. renderPanel is pure (detail + clock in, HTML string out) and runs in Node for
// the tests; bootPanel wires it to the DOM and to window.panel from the preload. Every string that
// comes from the detail goes through esc() before it reaches markup.
import { spriteSvg } from './sprites.js';
import { esc, renderChip, chipOf, className, createRenderGate, patch, sourceOf, srcTag } from './hud.js';
import { renderBubble, renderCard, cardLeftMs, mountCards, actionsArmed } from './cards.js';
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

// Where the answer is waiting (M3) when the agent has no card in the stack (d.hasCard: the stack holds
// it, so no note): handed back to its window (the footer's "open window ↗" opens it), or a native
// prompt the HUD never held.
function needsNote(d) {
  if (d.hasCard) return '';
  if (d.handedBack) return d.canOpen === false ? 'Waiting in its window' : 'Waiting in its window — open ↗';
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

// The bubble stack above the details: one compact bubble per waiting question, the expanded one followed
// by its full card. Keyed and sticky: the keyed patch keeps the live card (typed text, picks, focus) while
// the bubbles around it update. `leftMs` and `arming` come from the mounted card (bootPanel); without
// them the countdown runs to the main process deadline.
export function renderStack(stack, nowMs = Date.now(), cardOpts = {}) {
  if (!stack?.visible) return '';
  const cards = Array.isArray(stack.cards) ? stack.cards : [];
  const open = stack.expanded && typeof stack.expanded === 'object' ? stack.expanded : null;
  const wraps = cards.map((c) => {
    const isOpen = !!open && String(open.id) === String(c.id);
    const bub = renderBubble(c, { nowMs, expanded: isOpen }).replace('<button ', '<button data-key="bub" ');
    const slot = isOpen
      ? `<div class="card-slot" data-key="card:${esc(open.id)}" data-sticky>${renderCard(open, { leftMs: cardOpts.leftMs ?? cardLeftMs(open, nowMs, nowMs), arming: !!cardOpts.arming })}</div>` : '';
    return `<div class="bub-wrap" data-key="bub:${esc(c.id)}" data-deep>${bub}${slot}</div>`;
  }).join('');
  return '<div class="stack" data-key="stack" data-deep>' +
    `<div class="stack-h" data-key="stack-h"><span>${cards.length} waiting</span>` +
    '<button type="button" class="x" data-act="hide-stack" aria-label="Hide the questions">✕</button></div>' +
    wraps + '</div>';
}

// Claude's last message, while it is the user's turn (main sends lastMessage only then), under the
// recap of the turn (main sends recap with it).
function finishedBlock(d) {
  const m = typeof d.lastMessage === 'string' ? d.lastMessage : '';
  const r = typeof d.recap === 'string' ? d.recap : '';
  if (d.stage !== 'turn' || (!m && !r)) return '';
  return '<p class="lbl">Finished</p>' + (r ? `<p class="recap">${esc(r)}</p>` : '') + (m ? `<p class="finished">${esc(m)}</p>` : '');
}

export function renderPanel(detail, nowMs = Date.now()) {
  const d = detail || {};
  const steps = (Array.isArray(d.steps) ? d.steps : []).slice(0, MAX_STEPS);
  const helpers = Array.isArray(d.helpers) ? d.helpers : [];
  // No task: either the chat's first prompt came before the HUD, or the chat never reached the HUD at all
  // (no hooks for its folder, or hooks added after it started).
  const task = d.task ? `<p class="task">“${esc(d.task)}”</p>`
    : d.connected === false ? '<p class="task none">Not connected: this chat sends the HUD nothing. Install hooks from the tray, then restart the chat.</p>'
    : '<p class="task none">Started before the HUD</p>';
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
  // data-key / data-deep: bootPanel patches this in place (hud.js patch), never replacing the card slot.
  return '<div class="fly" data-key="fly" data-deep>' +
    '<div class="fly-top" data-key="top">' +
      `<span class="spr">${spriteSvg(d.cls, 1.5, { source: sourceOf(d) })}</span>` +
      `<div class="who"><div class="who-n">${esc(d.display)}</div><div class="who-d">${srcTag(sourceOf(d))}<span class="cls">${esc(className(d.cls))}</span></div></div>` +
      renderChip(d, nowMs) +
      '<button type="button" class="x" data-act="close" aria-label="Close">✕</button>' +
    '</div>' +
    '<div class="det" data-key="det">' +
      stuckLine(d, nowMs) +
      finishedBlock(d) +
      (d.stage === 'needs' && needsNote(d) ?`<div class="needs-note">${needsNote(d)}</div>` : '') +
      '<p class="lbl">Task</p>' + task +
      nowBlock(d, nowMs) +
      list + help +
      `<div class="foot">${foot}` +
      (d.canOpen === false ? '' : '<button type="button" class="open" data-act="open">open window ↗</button>') + '</div>' +
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

// The header's ✕ and the footer's "open window ↗" act on the agent on show (the detail rendered), never
// on whatever main has selected by the time the click lands: a question can switch the panel while the
// pointer is down (M1, M2). The card's own buttons are cards.js's.
// A bubble names its own card (data-card); the stack's ✕ names nothing.
export function panelAction(act, detail, ds = {}) {
  const id = detail?.id != null ? String(detail.id) : null;
  if (act === 'expand') return { call: 'expandCard', id: ds?.card != null ? String(ds.card) : null };
  if (act === 'hide-stack') return { call: 'hideStack' };
  if (act === 'close') return { call: 'close', id };
  if (act === 'open') return { call: 'openWindow', id };
  return null;
}

// The 500 ms arming, for the stack (spec: a bubble appearing under the cursor must not take a click). A
// bubble takes no "expand" until ARM_MS after it first rendered, the stack's ✕ no "hide-stack" until
// ARM_MS after the stack became visible. seen() runs on every render with the stack drawn (null or
// invisible: nothing on screen, so everything arms afresh next time).
export function createStackArming() {
  let stackSince = null;
  const bubbleSince = new Map(); // card id -> when its bubble first rendered
  return {
    seen(stack, now) {
      if (!stack?.visible) { stackSince = null; bubbleSince.clear(); return; }
      stackSince ??= now;
      const ids = new Set((Array.isArray(stack.cards) ? stack.cards : []).map((c) => String(c?.id)));
      for (const id of [...bubbleSince.keys()]) if (!ids.has(id)) bubbleSince.delete(id);
      for (const id of ids) if (!bubbleSince.has(id)) bubbleSince.set(id, now);
    },
    allowed(act, ds = {}, now = Date.now()) {
      if (act === 'expand') {
        const since = ds?.card != null ? bubbleSince.get(String(ds.card)) : undefined;
        return since === undefined || actionsArmed(since, now);
      }
      if (act === 'hide-stack') return stackSince === null || actionsArmed(stackSince, now);
      return true;
    },
  };
}

export function bootPanel(api = globalThis.panel, doc = globalThis.document) {
  const root = doc.getElementById('panel-root');
  const call = (name, ...args) => (typeof api?.[name] === 'function' ? api[name](...args) : undefined);
  const rendered = new WeakMap();
  let detail = null;
  let stack = null;
  let latest = { detail: null, stack: null }; // newest of each message, applied through the gate
  let timer = null;
  let lastExpanded = null;
  let hovered = null;
  const arm = createStackArming(); // bubbles and the stack's ✕ arm like a card's buttons (I4)

  // The panel takes the keyboard focus only while the user types into a card's text box, and gives it
  // back as soon as the answer is sent or released, or the card goes (main: panel:setInteractive).
  let interactive = false;
  const setInteractive = (on) => {
    if (interactive === on) return;
    interactive = on;
    call('setInteractive', on);
  };
  // The open question: answer buttons, the 500 ms arming, the countdown and typed-text drafts live
  // in cards.js; its markup comes from renderPanel (adopt), kept by the keyed patch. "open window ↗" on
  // the card hands it back (release) and opens its session's window: the session id goes along, since
  // the release can already have moved the panel's selection back to what was open before.
  const cards = mountCards(root, {
    doc, adopt: true, onInteractive: setInteractive,
    api: {
      answer: (id, response) => call('answer', id, response),
      release: (id) => call('release', id),
      openWindow: (sessionId) => call('openWindow', sessionId),
      openPlan: (id) => call('openPlan', id), // a plan notice's "Read plan": main opens Claude's plan file
      dismissPlan: (id) => call('dismissPlan', id), // a plan notice's "Dismiss": the notice goes
    },
  });

  // A render when a new detail arrives: the keyed patch replaces the header and the details, never the
  // card being answered. Between details the 1 s tick rewrites the time texts, the chip's clock and the
  // card's countdown in place (and swaps the stuck line, which holds no buttons), so a click that
  // straddles a tick still lands and a focused button keeps its focus.
  const stackOn = () => !!stack?.visible;
  // Hover on a bubble previews its card in main (hoverCard); if the OS never routes it, nothing happens.
  const setHover = (id) => { if (hovered !== id) { hovered = id; call('hoverCard', id); } };
  const render = () => {
    const now = Date.now();
    if (!stackOn()) setHover(null);
    const open = stackOn() ? stack.expanded ?? null : null;
    const { arming } = cards.show(open, now);
    if (!stackOn() && !detail) { root.innerHTML = ''; lastExpanded = null; arm.seen(null, now); return; }
    const tpl = doc.createElement('template');
    tpl.innerHTML = renderStack(stackOn() ? stack : null, now, { leftMs: cards.leftMs(now), arming }) +
      (detail ? renderPanel(detail, now) : '');
    patch(root, tpl.content, rendered);
    arm.seen(stackOn() ? stack : null, now);
    cards.refresh();
    cards.tick(now);
    const id = open ? String(open.id) : null;
    if (id && id !== lastExpanded) {
      [...root.querySelectorAll('.bub')].find((el) => el.dataset.card === id)?.closest('.bub-wrap')?.scrollIntoView?.({ block: 'nearest' });
    }
    lastExpanded = id;
  };
  const swap = (el, html) => { if (el && html && el.outerHTML !== html) el.outerHTML = html; };
  const tick = () => {
    if (!detail && !stackOn()) return;
    const now = Date.now();
    for (const el of root.querySelectorAll('[data-ring]')) {
      const hold = Number(el.dataset.hold);
      const exp = Number(el.dataset.expires);
      if (!(hold > 0) || !Number.isFinite(exp)) continue; // a ring without a hold (none is drawn for a plan notice) is skipped
      el.style.setProperty('--p', String(Math.max(0, Math.min(100, Math.round(((exp - now) / hold) * 100)))));
    }
    if (detail) {
      for (const el of root.querySelectorAll('[data-since]')) {
        const text = timeText(el.dataset, now);
        if (el.textContent !== text) el.textContent = text;
      }
      const chip = root.querySelector('.fly-top > .st');
      const c = chipOf(detail, now);
      if (chip && chip.classList.contains(c.cls)) { if (chip.textContent !== c.text) chip.textContent = c.text; } else swap(chip, renderChip(detail, now));
      swap(root.querySelector('.det > .warn'), stuckLine(detail, now));
    }
    cards.tick(now);
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
    const a = panelAction(el.dataset.act, detail, el.dataset);
    if (a && arm.allowed(el.dataset.act, el.dataset, Date.now())) call(a.call, a.id);
  });

  let lastHeight = -1;
  new ResizeObserver(() => {
    const h = Math.ceil(root.getBoundingClientRect().height);
    if (h !== lastHeight) { lastHeight = h; api.reportHeight?.(h); }
  }).observe(root);

  root.addEventListener('pointerenter', (e) => { const b = e.target.closest?.('.bub'); if (b && root.contains(b)) setHover(b.dataset.card); }, true);
  root.addEventListener('pointerleave', (e) => { if (e.target.closest?.('.bub')) setHover(null); }, true);

  // A new stack or detail arrives on nearly every event of a busy agent: it waits while a pointer is down
  // in the panel (createRenderGate), so ✕, "open window ↗", the bubbles and the card's buttons are not
  // replaced while being clicked. The gate keeps one value, so both messages offer the newest pair.
  const gate = createRenderGate((next) => {
    detail = next.detail;
    stack = next.stack;
    render();
    if ((detail || stackOn()) && !timer) timer = setInterval(tick, 1000);
    else if (!detail && !stackOn() && timer) { clearInterval(timer); timer = null; }
  });
  root.addEventListener('pointerdown', () => gate.down());
  doc.addEventListener('pointerup', () => gate.up());
  doc.addEventListener('pointercancel', () => gate.up());

  api.onDetail?.((next) => { latest = { ...latest, detail: next || null }; gate.offer(latest); });
  api.onStack?.((next) => { latest = { ...latest, stack: next || null }; gate.offer(latest); });
}

if (typeof document !== 'undefined' && globalThis.panel) bootPanel();
