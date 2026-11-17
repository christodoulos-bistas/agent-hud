// Agent HUD renderer. The render* functions are pure (snapshot in, HTML string out) and run in Node
// for the tests; boot() wires them to the DOM and to window.hud from the preload. Every string that
// comes from the snapshot goes through esc() before it reaches markup.
import { GR, CLASSES, MOODS_BADGE, MOODS_PENNANT, FAMILIAR, CODEX_FAMILIAR, spriteSvg } from './sprites.js';
import { fmtDuration } from './format.js';
import { esc, className, int, sessionOf, renderCard, replyLeftMs, picksFrom, actionsArmed, clickAllowed } from './cards.js';

// The answer cards live in the detail panel now (cards.js, panel.js); the HUD shows only the asking
// row and the "Next:" line. These are re-exported so existing imports keep working.
export { esc, className, renderCard, replyLeftMs, picksFrom, actionsArmed, clickAllowed };

const MOODS = new Set(['needs', 'done', 'working', 'idle']);
const NAMES = new Map(CLASSES.map((c) => [c.id, c.name]));

// Sprites are rasterised once per class; the HUD re-renders on every snapshot.
const svgCache = new Map();
const cached = (key, make) => {
  if (!svgCache.has(key)) svgCache.set(key, make());
  return svgCache.get(key);
};
const classOf = (id) => (NAMES.has(id) ? id : 'pathfinder');
// Anything that is not 'codex' is a Claude chat. The cache key carries the source: one class has two bodies.
export const sourceOf = (a) => (a?.source === 'codex' ? 'codex' : 'claude');
const sprite = (cls, source = 'claude') => cached(`class:${source}:${classOf(cls)}`, () => spriteSvg(classOf(cls), 2, { source }));
const sealSvg = () => cached('seal', () => GR.svg(MOODS_BADGE, 2));
// The pennant class lets its sparkle twinkle (hud.css .pennant .g-tw; static with reduced motion).
const pennantSvg = () => cached('pennant', () => GR.svg(MOODS_PENNANT, 1, 'pennant'));
const famSvg = (source = 'claude') => cached(`fam:${source}`, () => GR.svg(source === 'codex' ? CODEX_FAMILIAR : FAMILIAR, 2));
// The small "Codex" tag that starts a Codex chat's class line (nothing for Claude).
export const srcTag = (source) => (source === 'codex' ? '<span class="src">Codex</span> · ' : '');

const moodOf = (a) => (MOODS.has(a?.mood) ? a.mood : 'idle');

// A stable per-agent offset so the party never bobs in lockstep.
function bobDelay(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return `-${(h % 16) / 10}s`;
}

function doing(a, mood, ask) {
  if (mood === 'needs') {
    if (ask === 'permission') return 'asks permission';
    if (ask === 'choice') return 'asks a question';
    if (ask === 'reply') return 'wants your reply';
    return 'needs you';
  }
  if (mood === 'done') return 'finished';
  if (mood === 'idle') return 'idle';
  return a.activity || 'working';
}

const SEAL = () => `<span class="seal" role="img" aria-label="Needs you">${sealSvg()}</span>`;

const STAGES = new Set(['needs', 'turn', 'thinking', 'working', 'idle']);
const STAGE_OF_MOOD = { needs: 'needs', done: 'turn', working: 'working', idle: 'idle' };
const CHIP_LABEL = { stuck: '⚠ Stuck?', needs: 'Needs you', turn: 'Your turn', think: 'Thinking', work: 'Working', idle: 'Idle' };
const finite = (v) => v != null && Number.isFinite(Number(v));

// The stage chip's kind and, for a timed chip (Working, Idle with a time), the ms timestamp its clock
// counts from (null otherwise).
function chipState(agent) {
  const a = agent || {};
  if (a.stuck) return { cls: 'stuck', since: null };
  const stage = STAGES.has(a.stage) ? a.stage : STAGE_OF_MOOD[moodOf(a)];
  switch (stage) {
    case 'needs': return { cls: 'needs', since: null };
    case 'turn': return { cls: 'turn', since: null };
    case 'thinking': return { cls: 'think', since: null };
    case 'working': {
      const from = finite(a.currentStepStartedAt) ? a.currentStepStartedAt : a.stageSince;
      return { cls: 'work', since: finite(from) ? Number(from) : null };
    }
    default: return { cls: 'idle', since: finite(a.lastActivityAt) ? Number(a.lastActivityAt) : null };
  }
}

// A chip's text: its label, plus the time since `from` when it has one. `from` may be the string a
// data-since attribute holds.
export function chipText(cls, from, nowMs = Date.now()) {
  const label = CHIP_LABEL[cls] ?? '';
  return finite(from) ? `${label} · ${fmtDuration(Number(nowMs) - Number(from))}` : label;
}

// The stage chip's class and text. `timed` chips show a clock, which the renderers' 1 s ticks rewrite
// in place without re-rendering the row.
export function chipOf(agent, nowMs = Date.now()) {
  const s = chipState(agent);
  return { cls: s.cls, text: chipText(s.cls, s.since, nowMs), timed: s.since != null };
}

// The stage chip: a coloured pill with the agent's stage and how long it has been that way.
export function renderChip(agent, nowMs = Date.now()) {
  const c = chipOf(agent, nowMs);
  return `<span class="st ${c.cls}">${esc(c.text)}</span>`;
}

// A row's chip holds no clock text, so the row's HTML does not change as time passes and the keyed
// patch keeps the row (and the button under the pointer). A timed chip carries its kind and start;
// the HUD's tick (tickChips) writes the clock after every patch and every second.
function rowChip(agent) {
  const s = chipState(agent);
  const live = s.since != null ? ` data-kind="${s.cls}" data-since="${s.since}"` : '';
  // "Your turn" carries the done pennant (a static sprite, so the row's HTML stays the same between snapshots).
  const flag = s.cls === 'turn' ? `<span class="flag" aria-hidden="true">${pennantSvg()}</span>` : '';
  return `<span class="st ${s.cls}"${live}>${flag}${esc(CHIP_LABEL[s.cls])}</span>`;
}

// Renders wait while a pointer is down inside a window, so the button being pressed is not replaced
// before its click lands (I1). offer() hands in the newest snapshot or detail; down() on pointerdown;
// up() on pointerup or pointercancel lets it through on a 0 ms timer, after the click has been
// dispatched, and only the latest offer is applied. A hold never outlasts maxHoldMs (a lost pointerup
// must not freeze the view).
export function createRenderGate(apply, { setTimer = setTimeout, clearTimer = clearTimeout, maxHoldMs = 5000 } = {}) {
  let held = false;
  let gen = 0;
  let safety = null;
  let pending = false;
  let latest;
  const open = () => {
    held = false;
    clearTimer(safety);
    safety = null;
    if (!pending) return;
    const v = latest;
    pending = false;
    latest = undefined;
    apply(v);
  };
  return {
    offer(v) { latest = v; pending = true; if (!held) open(); },
    down() {
      held = true;
      const g = ++gen;
      clearTimer(safety);
      safety = setTimer(() => { if (g === gen) open(); }, maxHoldMs);
    },
    up() {
      if (!held) return;
      const g = gen;
      setTimer(() => { if (g === gen && held) open(); }, 0);
    },
  };
}

// A row's vertical centre in CSS px from the top of the HUD window (its bounding rect is viewport-
// relative), so a scrolled list reports where the row is on screen: main adds it to the window's y.
export const rowCentreY = (rect) => Math.round((rect.top + rect.height / 2) * 10) / 10;

// Which agents satisfy `pred` now, and which of those did not before (they get the arrival animation).
export function newlyIn(agents, prev = new Set(), pred = () => false) {
  const now = new Set((Array.isArray(agents) ? agents : []).filter((a) => a && pred(a)).map((a) => String(a.id)));
  return { now, fresh: new Set([...now].filter((id) => !prev.has(id))) };
}

export function newlyNeeding(agents, prev = new Set()) {
  const { now, fresh } = newlyIn(agents, prev, (a) => a.mood === 'needs');
  return { needs: now, fresh };
}

// A row in "Your turn": stage turn, or (no stage yet) mood done; a stuck flag does not change that.
const inTurn = (a) => (STAGES.has(a.stage) ? a.stage : STAGE_OF_MOOD[moodOf(a)]) === 'turn';

// Rows that just reached "Your turn" (they glow green-gold once). `prev` is the set from the last
// snapshot, null before the first: rows already in "Your turn" when the HUD starts or reloads
// finished a while ago, so the first snapshot only seeds the set and nothing glows (M8).
export function newlyFinished(agents, prev = null) {
  const r = newlyIn(agents, prev ?? new Set(), inTurn);
  return prev == null ? { now: r.now, fresh: new Set() } : r;
}

// `tucked` (v1.3): a row in the unfolded "tucked away" list, dimmed and without the ✕.
export function renderRow(agent, { ask, selected = false, tucked = false } = {}) {
  const a = agent || {};
  const mood = moodOf(a);
  const id = esc(a.id);
  const handed = mood === 'needs' && !!a.handedBack;
  const source = sourceOf(a);
  const fams = Math.max(0, Math.min(3, int(a.familiars, 0)));
  let fam = '';
  for (let i = 1; i <= fams; i++) fam += `<span class="fam f${i}">${famSvg(source)}</span>`;
  const line = handed
    ? (a.canOpen === false
      ? '<span class="link">Waiting in its window</span>'
      : `<button type="button" class="link" data-act="open" data-session="${id}">Waiting in its window — open ↗</button>`)
    : `${srcTag(source)}<span class="cls">${esc(className(a.cls))}</span> · ${esc(doing(a, mood, ask))}${mood === 'working' ? '<span class="dots"></span>' : ''}`;
  // ✕ takes the chat off the HUD until it asks or starts a new turn; never on a row that is asking.
  const hide = mood === 'needs' || tucked ? ''
    : `<button type="button" class="hide" data-act="hide" data-session="${id}" title="Hide from the HUD" aria-label="Hide ${esc(a.display)} from the HUD">✕</button>`;
  return `<div class="row ${mood}${mood === 'needs' ? ' glow-ask' : ''}${handed ? ' handed' : ''}${selected ? ' selected' : ''}${tucked ? ' tucked' : ''}" data-key="row:${id}" style="--d:${bobDelay(a.id)}">` +
    `<div class="sprite-box" data-act="select" data-session="${id}">${sprite(a.cls, source)}${fam}</div>` +
    '<div class="who">' +
      `<button type="button" class="who-n" data-act="select" data-session="${id}" aria-pressed="${selected ? 'true' : 'false'}" title="Show details">${esc(a.display)}</button>` +
      `<div class="who-d${handed ? ' handed' : ''}">${line}</div>` +
      (source === 'codex' ? '' : `<button type="button" class="wait" data-act="wait" data-session="${id}" aria-pressed="${a.replyOptIn ? 'true' : 'false'}"><i></i>wait for my reply</button>`) +
    '</div>' +
    `<span class="mark">${rowChip(a)}</span>` + hide +
  '</div>';
}


function nextLine(next) {
  const m = /^Next: (.+) (asks permission|asks a question|wants a reply)$/.exec(String(next));
  return m ? `Next: <b>${esc(m[1])}</b> ${m[2]} · after this one` : esc(next);
}

function face(a) {
  const mood = moodOf(a);
  return `<button type="button" class="face ${mood}" data-key="face:${esc(a.id)}" data-act="expand" style="--d:${bobDelay(a.id)}" ` +
    `title="${esc(a.display)}" aria-label="${esc(a.display)}, ${mood}">` +
    `<span class="sprite-box">${sprite(a.cls, sourceOf(a))}${mood === 'needs' ? SEAL() : ''}</span></button>`;
}

// The party: rows (or, collapsed, a column of faces), the header and the "Next:" line. No answer card:
// a question opens the detail panel on its agent, and the asking row only says what it asks.
export function renderParty(snapshot, { collapsed = false } = {}) {
  const selectedId = snapshot?.selected != null ? String(snapshot.selected) : null;
  const agents = Array.isArray(snapshot?.agents) ? snapshot.agents : [];
  if (collapsed) {
    return '<div class="party collapsed" data-key="party" data-deep>' +
      '<div class="party-top" data-key="top"><button type="button" class="min" data-act="collapse" title="Expand" aria-label="Expand the HUD">+</button></div>' +
      `<div class="party-body" data-key="body" data-deep>${agents.map(face).join('')}</div>` +
    '</div>';
  }
  const card = snapshot?.card || null;
  const owner = card ? sessionOf(card) : null;
  const parts = [];
  let asked = false;
  for (const a of agents) {
    const mine = !!card && !asked && String(a.id) === owner;
    parts.push(renderRow(a, { ...(mine ? { ask: card.kind } : {}), selected: selectedId != null && String(a.id) === selectedId }));
    if (mine) asked = true;
  }
  // v1.3: chats tucked away (quiet an hour, or hidden with ✕) sit under one line; unfolded, they list dimmed.
  const tucked = Array.isArray(snapshot?.tucked) ? snapshot.tucked : [];
  const tuckOpen = !!snapshot?.tuckOpen;
  if (!agents.length) {
    parts.push(`<p class="empty" data-key="empty">${tucked.length ? 'All quiet — every chat is tucked away.' : 'No agents are running.'}</p>`);
  }
  if (tucked.length) {
    parts.push(`<button type="button" class="tuck-line" data-key="tuck" data-act="tucked" aria-expanded="${tuckOpen}">── ${tucked.length} tucked away · ${tuckOpen ? 'hide' : 'show'} ──</button>`);
    if (tuckOpen) {
      parts.push('<div class="tucked-rows" data-key="tucked" data-deep>' +
        tucked.map((a) => renderRow(a, { tucked: true, selected: selectedId != null && String(a.id) === selectedId })).join('') + '</div>');
    }
  }

  const total = int(snapshot?.counts?.total, agents.length);
  const needs = int(snapshot?.counts?.needs, agents.filter((a) => moodOf(a) === 'needs').length);
  const need = needs ? ` · <b>${needs} ${needs === 1 ? 'needs' : 'need'} you</b>` : '';
  return '<div class="party" data-key="party" data-deep>' +
    `<div class="party-top" data-key="top"><span class="t">The Guild</span><span class="n">${total} at work${need}</span>` +
    '<button type="button" class="min" data-act="collapse" title="Collapse" aria-label="Collapse the HUD">–</button></div>' +
    `<div class="party-body" data-key="body" data-deep>${parts.join('')}</div>` +
    (snapshot?.next ? `<div class="queue" data-key="queue">◆ ${nextLine(snapshot.next)}</div>` : '') +
  '</div>';
}

// ---------------------------------------------------------------- DOM

// Keyed patch: children carry data-key. A reused child is kept when its rendered HTML is unchanged
// (data-deep children are patched recursively, data-sticky ones are never replaced), so a row keeps
// its animations and the button under the pointer, and the panel's open card keeps its typed text,
// picks and focus while the rest updates around it. `rendered` (a WeakMap) remembers each node's HTML.
export function patch(parent, fresh, rendered) {
  const old = new Map();
  for (const el of [...parent.children]) {
    if (el.dataset.key) old.set(el.dataset.key, el); else el.remove();
  }
  const nodes = [];
  for (const n of [...fresh.children]) {
    const key = n.dataset.key;
    const cur = key != null ? old.get(key) : undefined;
    if (cur && cur.tagName === n.tagName) {
      if ('sticky' in n.dataset) { old.delete(key); nodes.push(cur); continue; }
      if ('deep' in n.dataset) {
        for (const { name } of [...cur.attributes]) if (!n.hasAttribute(name)) cur.removeAttribute(name);
        for (const { name, value } of [...n.attributes]) if (cur.getAttribute(name) !== value) cur.setAttribute(name, value);
        patch(cur, n, rendered);
        old.delete(key); nodes.push(cur); continue;
      }
      if (rendered.get(cur) === n.outerHTML) { old.delete(key); nodes.push(cur); continue; }
    }
    rendered.set(n, n.outerHTML);
    for (const d of n.querySelectorAll('[data-key]')) rendered.set(d, d.outerHTML);
    nodes.push(n);
  }
  for (const el of old.values()) el.remove();
  let at = parent.firstElementChild;
  for (const n of nodes) {
    if (n === at) { at = at.nextElementSibling; continue; }
    parent.insertBefore(n, at);
  }
}

export function boot(api = globalThis.hud, doc = globalThis.document) {
  const root = doc.getElementById('hud-root');
  const call = (name, ...args) => (typeof api?.[name] === 'function' ? api[name](...args) : undefined);
  const rendered = new WeakMap();
  // The HUD has no text boxes (the answer cards are in the detail panel), so it never takes the focus.
  // `turn` stays null until the first snapshot seeds it (newlyFinished).
  const st = { snap: null, collapsed: false, needs: new Set(), turn: null };

  // The selected agent's row, or its face while collapsed (a question opens the panel beside the column).
  const rowEl = (id) => root.querySelector(`[data-key="${st.collapsed ? 'face' : 'row'}:${String(id).replace(/["\\]/g, '\\$&')}"]`);

  // Row clocks: a timed chip carries its kind and start (rowChip) and its text is written here, in
  // place, so the row (its bob and dots animations, its buttons) is never replaced because time passed.
  function tickChips(now) {
    for (const el of root.querySelectorAll('.row .mark .st[data-since]')) {
      const text = chipText(el.dataset.kind, el.dataset.since, now);
      if (el.textContent !== text) el.textContent = text;
    }
  }

  const tick = () => tickChips(Date.now());

  // Where the selected row (or face) is, for the panel's placement and arrow. Reported when it moves,
  // and always when the selection changes: main selects an asking agent by itself and doesn't know
  // where its row is until this says.
  const rowCentre = (el) => rowCentreY(el.getBoundingClientRect());
  let lastOffset = null;
  let lastOffsetId = null;
  function syncRowOffset(snap) {
    const id = snap?.selected != null ? String(snap.selected) : null;
    if (id == null) { lastOffset = null; lastOffsetId = null; return; }
    const el = rowEl(id);
    if (!el) return;
    const y = rowCentre(el);
    if (id !== lastOffsetId || lastOffset == null || Math.abs(y - lastOffset) >= 1) {
      lastOffset = y; lastOffsetId = id;
      call('rowOffset', id, y);
    }
  }

  function render() {
    const snap = st.snap || { agents: [], card: null, next: null, counts: { total: 0, needs: 0 } };
    const tpl = doc.createElement('template');
    tpl.innerHTML = renderParty(snap, { collapsed: st.collapsed });
    patch(root, tpl.content, rendered);

    // The needs chip pulses three times when an agent starts waiting, then glows steady.
    const { needs, fresh } = newlyNeeding(snap.agents, st.needs);
    for (const el of root.querySelectorAll('.face .seal, .row .st.needs, .row.needs')) {
      const key = el.closest('[data-key]')?.dataset.key || '';
      if (fresh.has(key.slice(key.indexOf(':') + 1))) el.classList.add('call');
    }
    st.needs = needs;
    // A row that just got to "Your turn" glows twice, then the class goes (animationend; with reduced
    // motion nothing animates, so a timer removes it). The render before any snapshot counts nothing.
    if (st.snap) {
      const done = newlyFinished(snap.agents, st.turn);
      for (const id of done.fresh) {
        const el = rowEl(id);
        if (!el) continue;
        el.classList.add('glow-done');
        if (globalThis.getComputedStyle?.(el).animationName === 'none') setTimeout(() => el.classList.remove('glow-done'), 3000);
      }
      st.turn = done.now;
    }
    syncRowOffset(snap);
    tick();
  }

  root.addEventListener('animationend', (e) => {
    if (e.animationName === 'done-pulse') e.target.classList.remove('glow-done');
  });

  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || !root.contains(el) || el.disabled) return;
    switch (el.dataset.act) {
      case 'collapse':
        st.collapsed = !st.collapsed; call('collapse', st.collapsed); render(); break;
      case 'expand':
        st.collapsed = false; call('collapse', false); render(); break;
      case 'select': {
        const row = el.closest('.row');
        if (row) {
          lastOffset = rowCentre(row); lastOffsetId = String(el.dataset.session);
          call('selectAgent', el.dataset.session, lastOffset);
        }
        break;
      }
      case 'open':
        call('openWindow', el.dataset.session); break;
      case 'hide':
        call('hideAgent', el.dataset.session); break;
      case 'tucked':
        call('showTucked', el.getAttribute('aria-expanded') !== 'true'); break;
      case 'wait': {
        const on = el.getAttribute('aria-pressed') !== 'true';
        el.setAttribute('aria-pressed', String(on));
        call('setReplyOptIn', el.dataset.session, on);
        break;
      }
      default:
    }
  });

  // R4: the main process sizes and docks the window from the content height.
  let lastHeight = -1;
  new ResizeObserver(() => {
    const h = Math.ceil(root.getBoundingClientRect().height);
    if (h !== lastHeight) { lastHeight = h; call('reportHeight', h); }
  }).observe(root);
  // Scrolling the list moves the selected row on screen: the panel's arrow follows it.
  doc.getElementById('hud')?.addEventListener('scroll', () => syncRowOffset(st.snap), { passive: true });

  // Snapshots wait while a pointer is down in the HUD (createRenderGate), so a busy agent's pushes
  // can't replace the button being clicked.
  const gate = createRenderGate((snap) => {
    st.snap = snap;
    if (typeof snap?.collapsed === 'boolean') st.collapsed = snap.collapsed; // the tray can collapse too
    render();
  });
  root.addEventListener('pointerdown', () => gate.down());
  doc.addEventListener('pointerup', () => gate.up());
  doc.addEventListener('pointercancel', () => gate.up());

  setInterval(tick, 1000);
  render();
  call('onSnapshot', (snap) => gate.offer(snap));
}

if (typeof document !== 'undefined' && globalThis.hud) boot();
