// Agent HUD renderer. The render* functions are pure (snapshot in, HTML string out) and run in Node
// for the tests; boot() wires them to the DOM and to window.hud from the preload. Every string that
// comes from the snapshot goes through esc() before it reaches markup.
import { GR, CLASSES, MOODS_BADGE, FAMILIAR, spriteSvg } from './sprites.js';
import { fmtDuration } from './format.js';

const REPLY_MS = 540000; // the reply hold in the main process (queue replyMs)
const ARM_MS = 500; // a new card's answer buttons stay inert this long (I7)
const ARMED_ACTS = new Set(['allow', 'deny', 'answer', 'send', 'noreply']);
const MOODS = new Set(['needs', 'done', 'working', 'idle']);
const NAMES = new Map(CLASSES.map((c) => [c.id, c.name]));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

// Sprites are rasterised once per class; the HUD re-renders on every snapshot.
const svgCache = new Map();
const cached = (key, make) => {
  if (!svgCache.has(key)) svgCache.set(key, make());
  return svgCache.get(key);
};
const classOf = (id) => (NAMES.has(id) ? id : 'pathfinder');
const sprite = (cls) => cached(`class:${classOf(cls)}`, () => spriteSvg(classOf(cls), 2));
const sealSvg = () => cached('seal', () => GR.svg(MOODS_BADGE, 2));
const famSvg = () => cached('fam', () => GR.svg(FAMILIAR, 2));

export const className = (cls) => NAMES.get(classOf(cls));
const moodOf = (a) => (MOODS.has(a?.mood) ? a.mood : 'idle');
const int = (v, d) => (v != null && Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : d);
const sessionOf = (card) => String(card?.sessionId ?? card?.payload?.session_id ?? '');
const questionsOf = (card) => {
  const qs = card?.payload?.tool_input?.questions;
  return Array.isArray(qs) ? qs.filter((q) => q && typeof q === 'object') : [];
};
const optionsOf = (q) => (Array.isArray(q.options) ? q.options : []);

// A stable per-agent offset so the party never bobs in lockstep.
function bobDelay(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return `-${(h % 16) / 10}s`;
}

function clock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
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
  return `<span class="st ${s.cls}"${live}>${esc(CHIP_LABEL[s.cls])}</span>`;
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

// Which agents need you now, and which of those did not before (they get the arrival pulse).
export function newlyNeeding(agents, prev = new Set()) {
  const needs = new Set((Array.isArray(agents) ? agents : []).filter((a) => a?.mood === 'needs').map((a) => String(a.id)));
  return { needs, fresh: new Set([...needs].filter((id) => !prev.has(id))) };
}

export function renderRow(agent, { ask, selected = false } = {}) {
  const a = agent || {};
  const mood = moodOf(a);
  const id = esc(a.id);
  const handed = mood === 'needs' && !!a.handedBack;
  const fams = Math.max(0, Math.min(3, int(a.familiars, 0)));
  let fam = '';
  for (let i = 1; i <= fams; i++) fam += `<span class="fam f${i}">${famSvg()}</span>`;
  const line = handed
    ? `<button type="button" class="link" data-act="open" data-session="${id}">Waiting in its window — open ↗</button>`
    : `<span class="cls">${esc(className(a.cls))}</span> · ${esc(doing(a, mood, ask))}${mood === 'working' ? '<span class="dots"></span>' : ''}`;
  return `<div class="row ${mood}${handed ? ' handed' : ''}${selected ? ' selected' : ''}" data-key="row:${id}" style="--d:${bobDelay(a.id)}">` +
    `<div class="sprite-box" data-act="select" data-session="${id}">${sprite(a.cls)}${fam}</div>` +
    '<div class="who">' +
      `<button type="button" class="who-n" data-act="select" data-session="${id}" aria-pressed="${selected ? 'true' : 'false'}" title="Show details">${esc(a.display)}</button>` +
      `<div class="who-d${handed ? ' handed' : ''}">${line}</div>` +
      `<button type="button" class="wait" data-act="wait" data-session="${id}" aria-pressed="${a.replyOptIn ? 'true' : 'false'}"><i></i>wait for my reply</button>` +
    '</div>' +
    `<span class="mark">${rowChip(a)}</span>` +
  '</div>';
}

function cardTop(card, mark) {
  return `<div class="ans-top">${mark}<span class="who-n">${esc(card.display)}</span>` +
    '<button type="button" class="open" data-act="open-card">open window ↗</button></div>';
}

// A click or Enter meant for the card that was just replaced must not answer the new one: answer
// actions count only once the card has been on screen for ARM_MS.
export const actionsArmed = (cardSince, now) => now - cardSince >= ARM_MS;
export const clickAllowed = (act, cardSince, now) => !ARMED_ACTS.has(act) || actionsArmed(cardSince, now);

function cardOpen(card, kind, { parch = false, arming = false } = {}) {
  return `<div class="ans${parch ? ' parch' : ''}${arming ? ' arming' : ''}" data-card="${esc(card.id)}" data-kind="${kind}" data-session="${esc(sessionOf(card))}">`;
}

const WANTS = {
  Bash: 'wants to run a command', PowerShell: 'wants to run a command', Edit: 'wants to edit a file', Write: 'wants to edit a file', MultiEdit: 'wants to edit a file',
  NotebookEdit: 'wants to edit a notebook', Read: 'wants to read a file', WebFetch: 'wants to open a web page', WebSearch: 'wants to search the web',
};

function permissionTarget(input) {
  for (const k of ['command', 'file_path', 'notebook_path', 'url', 'query', 'pattern', 'path']) {
    if (typeof input[k] === 'string' && input[k]) return input[k];
  }
  try { return JSON.stringify(input).slice(0, 2000); } catch { return ''; }
}

function permissionCard(card, arming) {
  const p = card.payload || {};
  const tool = String(p.tool_name || '');
  const input = p.tool_input && typeof p.tool_input === 'object' ? p.tool_input : {};
  const wants = Object.hasOwn(WANTS, tool) ? WANTS[tool] : `wants to use ${tool || 'a tool'}`;
  const via = p.agent_type ? ` · via ${esc(p.agent_type)} helper` : '';
  // Only addRules suggestions are forwarded (wiring.js encodeAnswer), so only they earn the box.
  const canAlways = Array.isArray(p.permission_suggestions) && p.permission_suggestions.some((s) => s?.type === 'addRules');
  const always = canAlways
    ? `<label class="chk"><input type="checkbox" data-always><i></i>${tool === 'Bash' || tool === 'PowerShell' ? 'Always allow this exact command here' : 'Always allow this here'}</label>`
    : '';
  return cardOpen(card, 'permission', { arming }) +
    cardTop(card, '<span class="ans-seal" aria-hidden="true">!</span>') +
    `<p class="ans-sub">${esc(className(card.cls))} ${esc(wants)}${via}</p>` +
    `<div class="cmd">${esc(permissionTarget(input))}</div>` +
    '<div class="btns"><button type="button" class="btn gold" data-act="allow">Allow</button>' +
    '<button type="button" class="btn ghost" data-act="deny">Deny</button></div>' +
    always +
  '</div>';
}

function choiceCard(card, arming) {
  const body = questionsOf(card).map((q, qi) => {
    const multi = !!q.multiSelect;
    const opts = optionsOf(q).map((o, oi) =>
      `<button type="button" class="opt${multi ? ' multi' : ''}" role="${multi ? 'checkbox' : 'radio'}" aria-checked="false" data-act="pick" data-q="${qi}" data-o="${oi}">` +
        '<span class="dot"></span>' +
        `<span class="opt-t"><b>${esc(o?.label)}</b>${o?.description ? `<span class="opt-d">${esc(o.description)}</span>` : ''}</span>` +
      '</button>').join('');
    return `<div class="qn" data-q="${qi}">` +
      (q.header ? `<span class="chip">${esc(q.header)}</span>` : '') +
      `<p class="ans-q">${esc(q.question)}</p>${opts}` +
      `<input class="other" data-q="${qi}" placeholder="Something else…" aria-label="Something else">` +
    '</div>';
  }).join('');
  return cardOpen(card, 'choice', { arming }) +
    cardTop(card, '<span class="ans-seal q" aria-hidden="true">?</span>') +
    body +
    '<div class="btns"><button type="button" class="btn gold" data-act="answer" disabled>Answer</button></div>' +
  '</div>';
}

function replyCard(card, leftMs, arming) {
  const chars = Array.from(String(card.payload?.last_assistant_message ?? ''));
  const said = chars.length > 200 ? `${chars.slice(0, 200).join('').trimEnd()}…` : chars.join('');
  const left = Math.max(0, Math.min(REPLY_MS, int(leftMs, REPLY_MS)));
  return cardOpen(card, 'reply', { parch: true, arming }) +
    cardTop(card, '<span class="tick" aria-hidden="true">✓</span>') +
    (said ? `<p class="said">“${esc(said)}”</p>` : '') +
    '<div class="reply"><input data-reply placeholder="Reply…" aria-label="Reply">' +
    '<button type="button" class="btn gold" data-act="send" disabled>Send</button></div>' +
    `<div class="timer"><span>Reply open <span data-left>${clock(left)}</span></span>` +
    `<span class="bar"><i data-bar style="width:${((left / REPLY_MS) * 100).toFixed(1)}%"></i></span>` +
    '<button type="button" class="open" data-act="noreply">No reply</button></div>' +
  '</div>';
}

export function renderCard(card, { leftMs, arming = false } = {}) {
  if (!card) return '';
  if (card.kind === 'permission') return permissionCard(card, arming);
  if (card.kind === 'choice') return choiceCard(card, arming);
  if (card.kind === 'reply') return replyCard(card, leftMs, arming);
  return '';
}

// Time left on a reply card: the main process stamps the deadline (expiresAt, R19); without it,
// fall back to counting from when the card appeared here.
export function replyLeftMs(card, nowMs, sinceMs) {
  if (card?.kind !== 'reply') return undefined;
  return Number.isFinite(card.expiresAt) ? card.expiresAt - nowMs : REPLY_MS - (nowMs - sinceMs);
}

function nextLine(next) {
  const m = /^Next: (.+) (asks permission|asks a question|wants a reply)$/.exec(String(next));
  return m ? `Next: <b>${esc(m[1])}</b> ${m[2]} · after this one` : esc(next);
}

function face(a) {
  const mood = moodOf(a);
  return `<button type="button" class="face ${mood}" data-key="face:${esc(a.id)}" data-act="expand" style="--d:${bobDelay(a.id)}" ` +
    `title="${esc(a.display)}" aria-label="${esc(a.display)}, ${mood}">` +
    `<span class="sprite-box">${sprite(a.cls)}${mood === 'needs' ? SEAL() : ''}</span></button>`;
}

export function renderParty(snapshot, { collapsed = false, leftMs, arming = false } = {}) {
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
  const slot = () => `<div class="card-slot" data-key="card:${esc(card.id)}" data-sticky>${renderCard(card, { leftMs, arming })}</div>`;
  const parts = [];
  let placed = false;
  for (const a of agents) {
    const mine = !!card && !placed && String(a.id) === owner;
    parts.push(renderRow(a, { ...(mine ? { ask: card.kind } : {}), selected: selectedId != null && String(a.id) === selectedId }));
    if (mine) { parts.push(slot()); placed = true; }
  }
  if (card && !placed) parts.unshift(slot());
  if (!agents.length) parts.push('<p class="empty" data-key="empty">No agents are running.</p>');

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

// Picks for a choice card: question text -> label (array of labels for multiSelect), or the free
// text when filled. `sel` is { [questionIndex]: { opts: [optionIndex], other } }. Null until every
// question has an answer.
export function picksFrom(questions, sel = {}) {
  const qs = Array.isArray(questions) ? questions : [];
  if (!qs.length) return null;
  const picks = {};
  for (const [qi, q] of qs.entries()) {
    const s = sel[qi] || {};
    const other = String(s.other ?? '').trim();
    const labels = (s.opts || []).map((oi) => optionsOf(q)[oi]?.label).filter((l) => typeof l === 'string');
    const pick = other || (q.multiSelect ? (labels.length ? labels : null) : (labels[0] ?? null));
    if (pick == null) return null;
    picks[q.question] = pick;
  }
  return picks;
}

// ---------------------------------------------------------------- DOM

// Keyed patch: children carry data-key. A reused child is kept when its rendered HTML is unchanged
// (data-deep children are patched recursively, data-sticky ones are never replaced), so an open
// card keeps its typed text, picks and focus while the rest of the party updates around it.
function patch(parent, fresh, rendered) {
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
  const st = { snap: null, collapsed: false, interactive: false, card: null, cardSince: 0, needs: new Set() };

  const setInteractive = (on) => {
    if (st.interactive === on) return;
    st.interactive = on;
    call('setInteractive', on);
  };
  const leftMs = () => replyLeftMs(st.card, Date.now(), st.cardSince);

  const rowEl = (id) => root.querySelector(`[data-key="row:${String(id).replace(/["\\]/g, '\\$&')}"]`);

  // Row clocks: a timed chip carries its kind and start (rowChip) and its text is written here, in
  // place, so the row (its bob and dots animations, its buttons) is never replaced because time passed.
  function tickChips(now) {
    for (const el of root.querySelectorAll('.row .mark .st[data-since]')) {
      const text = chipText(el.dataset.kind, el.dataset.since, now);
      if (el.textContent !== text) el.textContent = text;
    }
  }

  function tick() {
    tickChips(Date.now());
    const el = root.querySelector('[data-left]');
    const left = leftMs();
    if (!el || left === undefined) return;
    const ms = Math.max(0, left);
    el.textContent = clock(ms);
    const bar = root.querySelector('[data-bar]');
    if (bar) bar.style.width = `${((ms / REPLY_MS) * 100).toFixed(1)}%`;
  }

  // The card slot is sticky (never re-rendered), so the arming class comes off the live element.
  let armTimer = null;
  function armLater() {
    clearTimeout(armTimer);
    armTimer = setTimeout(() => {
      if (!actionsArmed(st.cardSince, Date.now())) return armLater();
      for (const el of root.querySelectorAll('.ans.arming')) el.classList.remove('arming');
    }, Math.max(0, st.cardSince + ARM_MS - Date.now()));
  }

  const rowCentre = (el) => rowCentreY(el.getBoundingClientRect());
  let lastOffset = null;
  function syncRowOffset(snap) {
    const id = snap?.selected != null ? String(snap.selected) : null;
    if (id == null) { lastOffset = null; return; }
    const el = rowEl(id);
    if (!el) return;
    const y = rowCentre(el);
    if (lastOffset == null || Math.abs(y - lastOffset) >= 1) { lastOffset = y; call('rowOffset', id, y); }
  }

  function render() {
    const snap = st.snap || { agents: [], card: null, next: null, counts: { total: 0, needs: 0 } };
    const card = snap.card || null;
    if (card?.id !== st.card?.id) {
      st.cardSince = Date.now();
      setInteractive(false); // the card we were answering is gone (answered, handed back, or answered natively)
    }
    st.card = card;
    const arming = !!card && !actionsArmed(st.cardSince, Date.now());
    const tpl = doc.createElement('template');
    tpl.innerHTML = renderParty(snap, { collapsed: st.collapsed, leftMs: leftMs(), arming });
    patch(root, tpl.content, rendered);
    if (arming) armLater();

    // The needs chip pulses three times when an agent starts waiting, then glows steady.
    const { needs, fresh } = newlyNeeding(snap.agents, st.needs);
    for (const el of root.querySelectorAll('.face .seal, .row .st.needs')) {
      const key = el.closest('[data-key]')?.dataset.key || '';
      if (fresh.has(key.slice(key.indexOf(':') + 1))) el.classList.add('call');
    }
    st.needs = needs;
    syncRowOffset(snap);
    tick();
  }

  const cardOf = (el) => el?.closest('.ans');
  function settle(cardEl, send) {
    if (!cardEl || cardEl.dataset.done) return;
    cardEl.dataset.done = '1';
    for (const c of cardEl.querySelectorAll('button, input')) c.disabled = true;
    send(cardEl.dataset.card);
    setInteractive(false);
  }
  const answer = (cardEl, response) => settle(cardEl, (id) => call('answer', id, response));
  const release = (cardEl, open) => settle(cardEl, (id) => {
    call('release', id);
    if (open && cardEl.dataset.session) call('openWindow', cardEl.dataset.session);
  });

  function picksOf(cardEl) {
    if (!st.card || String(st.card.id) !== cardEl.dataset.card) return null;
    const sel = {};
    for (const qn of cardEl.querySelectorAll('.qn')) {
      sel[qn.dataset.q] = {
        opts: [...qn.querySelectorAll('.opt[aria-checked="true"]')].map((o) => Number(o.dataset.o)),
        other: qn.querySelector('.other')?.value || '',
      };
    }
    return picksFrom(questionsOf(st.card), sel);
  }
  const syncAnswer = (cardEl) => {
    const btn = cardEl.querySelector('[data-act="answer"]');
    if (btn && !cardEl.dataset.done) btn.disabled = !picksOf(cardEl);
  };

  root.addEventListener('pointerdown', (e) => { if (cardOf(e.target)) setInteractive(true); });

  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || !root.contains(el) || el.disabled) return;
    if (!clickAllowed(el.dataset.act, st.cardSince, Date.now())) return; // a click meant for the card this one replaced
    const cardEl = cardOf(el);
    switch (el.dataset.act) {
      case 'collapse':
        st.collapsed = !st.collapsed;
        if (st.collapsed) setInteractive(false); // the main process makes the collapsed window non-focusable
        call('collapse', st.collapsed); render(); break;
      case 'expand':
        st.collapsed = false; call('collapse', false); render(); break;
      case 'select': {
        const row = el.closest('.row');
        if (row) { lastOffset = rowCentre(row); call('selectAgent', el.dataset.session, lastOffset); }
        break;
      }
      case 'open':
        call('openWindow', el.dataset.session); break;
      case 'wait': {
        const on = el.getAttribute('aria-pressed') !== 'true';
        el.setAttribute('aria-pressed', String(on));
        call('setReplyOptIn', el.dataset.session, on);
        break;
      }
      case 'allow':
        answer(cardEl, { kind: 'allow', always: !!cardEl.querySelector('[data-always]')?.checked }); break;
      case 'deny':
        answer(cardEl, { kind: 'deny' }); break;
      case 'pick': {
        const qn = el.closest('.qn');
        if (el.classList.contains('multi')) {
          el.setAttribute('aria-checked', String(el.getAttribute('aria-checked') !== 'true'));
        } else {
          for (const o of qn.querySelectorAll('.opt')) o.setAttribute('aria-checked', String(o === el));
        }
        const other = qn.querySelector('.other');
        if (other) other.value = '';
        syncAnswer(cardEl);
        break;
      }
      case 'answer': {
        const picks = picksOf(cardEl);
        if (picks) answer(cardEl, { kind: 'choice', picks });
        break;
      }
      case 'send': {
        const text = cardEl.querySelector('[data-reply]')?.value.trim();
        if (text) answer(cardEl, { kind: 'reply', text });
        break;
      }
      case 'noreply':
        release(cardEl, false); break;
      case 'open-card':
        release(cardEl, true); break;
      default:
    }
  });

  root.addEventListener('input', (e) => {
    const cardEl = cardOf(e.target);
    if (!cardEl) return;
    if (e.target.matches('.other')) {
      if (e.target.value.trim()) {
        for (const o of e.target.closest('.qn').querySelectorAll('.opt')) o.setAttribute('aria-checked', 'false');
      }
      syncAnswer(cardEl);
    } else if (e.target.matches('[data-reply]')) {
      const send = cardEl.querySelector('[data-act="send"]');
      if (send && !cardEl.dataset.done) send.disabled = !e.target.value.trim();
    }
  });

  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    const cardEl = cardOf(e.target);
    if (!cardEl) return;
    const act = e.target.matches('[data-reply]') ? 'send' : e.target.matches('.other') ? 'answer' : null;
    const btn = act && cardEl.querySelector(`[data-act="${act}"]`);
    if (btn && !btn.disabled && clickAllowed(act, st.cardSince, Date.now())) { e.preventDefault(); btn.click(); }
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
    if (typeof snap?.collapsed === 'boolean') { // the tray can collapse too
      if (snap.collapsed && !st.collapsed) setInteractive(false);
      st.collapsed = snap.collapsed;
    }
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
