// The panel's bubble stack: renderBubble (one compact bubble per held question) and the answer cards
// (permission / multiple choice / reply / plan) shown in full under the expanded bubble: the pure
// renderCard (card in, HTML string out) and mountCards, which wires a rendered card to the panel's api.
// Nothing here touches the DOM at import, so it loads in Node for the tests.
import { CLASSES, spriteSvg } from './sprites.js';

// The hold comes with each card from main (holdMs, stamped by the queue: R1). The fallback is only for a
// card without one; main's HOLD_MS / REPLY_MS / PLAN_MS stay the one place a hold is set.
export const FALLBACK_HOLD_MS = 60000;
const holdOf = (card) => (Number.isFinite(card?.holdMs) && card.holdMs > 0 ? card.holdMs : FALLBACK_HOLD_MS);
export const ARM_MS = 500; // a new card's answer buttons stay inert this long (I7)
const ARMED_ACTS = new Set(['answer', 'allow', 'deny', 'send', 'noreply', 'approve-auto', 'approve-ask', 'approve', 'keep']);
const NAMES = new Map(CLASSES.map((c) => [c.id, c.name]));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

const classOf = (id) => (NAMES.has(id) ? id : 'pathfinder');
export const className = (cls) => NAMES.get(classOf(cls));
export const int = (v, d) => (v != null && Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : d);
export const sessionOf = (card) => String(card?.sessionId ?? card?.payload?.session_id ?? '');
const questionsOf = (card) => {
  const qs = card?.payload?.tool_input?.questions;
  return Array.isArray(qs) ? qs.filter((q) => q && typeof q === 'object') : [];
};
const optionsOf = (q) => (Array.isArray(q.options) ? q.options : []);

function clock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// The countdown to the end of the card's own hold (holdMs from main: a question's, a reply's or a
// plan's): a clock and a bar, which mountCards' tick rewrites in place every second.
function timer(card, leftMs, label, extra = '') {
  const hold = holdOf(card);
  const left = Math.max(0, Math.min(hold, int(leftMs, hold)));
  return `<div class="timer"><span>${label} <span data-left>${clock(left)}</span></span>` +
    `<span class="bar"><i data-bar style="width:${((left / hold) * 100).toFixed(1)}%"></i></span>${extra}</div>`;
}

function cardTop(card, mark) {
  return `<div class="ans-top">${mark}<span class="who-n">${esc(card.display)}</span>` +
    (card.canOpen === false ? '' : '<button type="button" class="open" data-act="open-card">open window ↗</button>') + '</div>';
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

function permissionCard(card, leftMs, arming) {
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
    timer(card, leftMs, 'Back to its window in') +
  '</div>';
}

function choiceCard(card, leftMs, arming) {
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
    timer(card, leftMs, 'Back to its window in') +
  '</div>';
}

function replyCard(card, leftMs, arming) {
  const chars = Array.from(String(card.payload?.last_assistant_message ?? ''));
  const said = chars.length > 200 ? `${chars.slice(0, 200).join('').trimEnd()}…` : chars.join('');
  return cardOpen(card, 'reply', { parch: true, arming }) +
    cardTop(card, '<span class="tick" aria-hidden="true">✓</span>') +
    (said ? `<p class="said">“${esc(said)}”</p>` : '') +
    '<div class="reply"><input data-reply placeholder="Reply…" aria-label="Reply">' +
    '<button type="button" class="btn gold" data-act="send" disabled>Send</button></div>' +
    timer(card, leftMs, 'Reply open', '<button type="button" class="open" data-act="noreply">No reply</button>') +
  '</div>';
}

export const PLAN_MAX = 20000;
const KIND_ICON = { permission: '!', choice: '?', plan: '▤', reply: '↩' };

function planCard(card, leftMs, arming) {
  const raw = String(card.payload?.tool_input?.plan ?? card.payload?.plan ?? '');
  const chars = Array.from(raw);
  const cut = chars.length > PLAN_MAX;
  const text = cut ? chars.slice(0, PLAN_MAX).join('') : raw;
  // escape first, then bold: the escape can't be bypassed by the markup added after it
  const body = text.split('\n').map((l) => (l.startsWith('#') ? `<b>${esc(l)}</b>` : esc(l))).join('\n');
  const approve = card.planModes
    ? '<button type="button" class="btn gold" data-act="approve-auto">Approve · auto-accept edits</button>' +
      '<button type="button" class="btn gold" data-act="approve-ask">Approve · ask before edits</button>'
    : '<button type="button" class="btn gold" data-act="approve">Approve</button>';
  // Without mode switching (PLAN_MODES false) the one Approve leaves the chat's own edit mode (spec, M3).
  const modeNote = card.planModes ? '' : '<p class="plan-mode">Edit mode stays as set in the chat.</p>';
  return cardOpen(card, 'plan', { arming }) +
    cardTop(card, '<span class="ans-seal" aria-hidden="true">▤</span>') +
    `<div class="plan">${body}</div>` +
    (cut ? '<p class="plan-more">Open the window to read the rest.</p>' : '') +
    `<div class="btns">${approve}</div>${modeNote}` +
    '<div class="reply"><input data-feedback placeholder="What should change?" aria-label="What should change?">' +
    '<button type="button" class="btn ghost" data-act="keep">Keep planning</button></div>' +
    timer(card, leftMs, 'Back to its window in') +
  '</div>';
}

// A compact bubble for one waiting question; pure (the caller decides `expanded`).
export function renderBubble(summary, { nowMs, expanded = false } = {}) {
  const c = summary || {};
  const hold = holdOf(c);
  const p = Number.isFinite(c.expiresAt) && Number.isFinite(nowMs)
    ? Math.max(0, Math.min(100, Math.round(((c.expiresAt - nowMs) / hold) * 100))) : 100;
  const source = c.source === 'codex' ? 'codex' : 'claude';
  return `<button type="button" class="bub" data-act="expand" data-card="${esc(c.id)}" data-session="${esc(c.sessionId)}" aria-expanded="${expanded ? 'true' : 'false'}">` +
    `<span class="spr">${spriteSvg(classOf(c.cls), 1, { source })}</span>` +
    `<span class="bub-n">${esc(c.display)}</span>` +
    `<span class="bub-k" aria-hidden="true">${KIND_ICON[c.kind] ?? ''}</span>` +
    `<span class="bub-l">${esc(c.line)}</span>` +
    `<i class="ring" data-ring data-expires="${esc(c.expiresAt)}" data-hold="${hold}" style="--p:${p}"></i>` +
  '</button>';
}

// `leftMs`: the time left on the card's hold (cardLeftMs); without it the countdown shows the whole hold.
export function renderCard(card, { leftMs, arming = false } = {}) {
  if (!card) return '';
  if (card.kind === 'permission') return permissionCard(card, leftMs, arming);
  if (card.kind === 'choice') return choiceCard(card, leftMs, arming);
  if (card.kind === 'reply') return replyCard(card, leftMs, arming);
  if (card.kind === 'plan') return planCard(card, leftMs, arming);
  return '';
}

// Time left on a card's hold: the main process stamps the deadline (expiresAt, R19); without it, count
// the card's hold (holdMs) down from when the card appeared here. Undefined for no card or an unknown kind.
export function cardLeftMs(card, nowMs, sinceMs) {
  if (!['permission', 'choice', 'reply', 'plan'].includes(card?.kind)) return undefined;
  return Number.isFinite(card.expiresAt) ? card.expiresAt - nowMs : holdOf(card) - (nowMs - sinceMs);
}
// The same for a reply card only (v1's name, kept for its callers).
export const replyLeftMs = (card, nowMs, sinceMs) => (card?.kind === 'reply' ? cardLeftMs(card, nowMs, sinceMs) : undefined);

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

// Text typed into a card (the reply, or a "Something else..." box) is kept per card id, so it comes back
// if the card re-appears after a higher-priority one pre-empted it. A choice card's boxes are stored
// under `${cardId}#${questionIndex}`; drop(cardId) clears all of them.
export function createDrafts() {
  const m = new Map();
  return {
    get: (id) => m.get(String(id)) ?? '',
    set(id, text) { if (text) m.set(String(id), String(text)); else m.delete(String(id)); },
    drop(id) {
      const k = String(id);
      for (const key of [...m.keys()]) if (key === k || key.startsWith(`${k}#`)) m.delete(key);
    },
  };
}

// Wires cards to an api with answer(id, response), release(id) and openWindow(sessionId) (the detail
// panel's window.panel). Listeners are delegated on `host`. By default show() renders the card
// into host; with { adopt: true } the caller renders the card markup itself (the panel's keyed patch
// does) and show() only tracks it, then refresh() restores drafts once the markup is in place.
export function mountCards(host, { api, doc, onInteractive, adopt = false, drafts = createDrafts() } = {}) {
  const call = (name, ...args) => (typeof api?.[name] === 'function' ? api[name](...args) : undefined);
  const interactive = (on) => { if (typeof onInteractive === 'function') onInteractive(on); };
  const st = { card: null, cardSince: 0 };
  let armTimer = null;

  const arming = (now) => !!st.card && !actionsArmed(st.cardSince, now);
  const leftMs = (now) => cardLeftMs(st.card, now, st.cardSince);
  const cardOf = (el) => el?.closest('.ans');

  // The card element is sticky (never re-rendered by the keyed patch), so the arming class comes off the live element.
  function armLater() {
    clearTimeout(armTimer);
    armTimer = setTimeout(() => {
      if (!actionsArmed(st.cardSince, Date.now())) return armLater();
      for (const el of host.querySelectorAll('.ans.arming')) el.classList.remove('arming');
    }, Math.max(0, st.cardSince + ARM_MS - Date.now()));
  }

  function tick(now = Date.now()) {
    const el = host.querySelector('[data-left]');
    const left = leftMs(now);
    if (!el || left === undefined) return;
    const hold = holdOf(st.card);
    const ms = Math.max(0, Math.min(hold, left));
    el.textContent = clock(ms);
    const bar = host.querySelector('[data-bar]');
    if (bar) bar.style.width = `${((ms / hold) * 100).toFixed(1)}%`;
  }

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

  // Put a re-appeared card's saved text back (once per element).
  function refresh() {
    if (!st.card) return;
    const cardEl = [...host.querySelectorAll('.ans')].find((e) => e.dataset.card === String(st.card.id));
    if (!cardEl || cardEl.dataset.restored) return;
    cardEl.dataset.restored = '1';
    const id = String(st.card.id);
    const reply = cardEl.querySelector('[data-reply]');
    const text = drafts.get(id);
    if (reply && text) {
      reply.value = text;
      const send = cardEl.querySelector('[data-act="send"]');
      if (send && !cardEl.dataset.done) send.disabled = !text.trim();
    }
    let any = false;
    for (const o of cardEl.querySelectorAll('.other')) {
      const v = drafts.get(`${id}#${o.dataset.q}`);
      if (v) { o.value = v; any = true; }
    }
    if (any) syncAnswer(cardEl);
    const fb = cardEl.querySelector('[data-feedback]');
    if (fb && text) fb.value = text;
  }

  function settle(cardEl, send) {
    if (!cardEl || cardEl.dataset.done) return;
    cardEl.dataset.done = '1';
    for (const c of cardEl.querySelectorAll('button, input')) c.disabled = true;
    send(cardEl.dataset.card);
    drafts.drop(cardEl.dataset.card);
    interactive(false);
  }
  const answer = (cardEl, response) => settle(cardEl, (id) => call('answer', id, response));
  const release = (cardEl, open) => settle(cardEl, (id) => {
    call('release', id);
    if (open && cardEl.dataset.session) call('openWindow', cardEl.dataset.session);
  });

  // Focusable only while typing: a pointerdown in a text box inside a card. Buttons and the "always
  // allow" checkbox work in a non-focusable window, so clicking them takes no focus (R3).
  host.addEventListener('pointerdown', (e) => {
    if (cardOf(e.target) && e.target.closest('textarea, input:not([type=checkbox]):not([type=radio])')) interactive(true);
  });

  host.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || !host.contains(el) || el.disabled) return;
    const cardEl = cardOf(el);
    if (!cardEl) return; // not a card action (the page's own buttons are handled by its own listener)
    if (!clickAllowed(el.dataset.act, st.cardSince, Date.now())) return; // a click meant for the card this one replaced
    switch (el.dataset.act) {
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
        if (other) { other.value = ''; drafts.set(`${cardEl.dataset.card}#${qn.dataset.q}`, ''); }
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
      case 'approve-auto':
        answer(cardEl, { kind: 'plan', approve: 'acceptEdits' }); break;
      case 'approve-ask':
      case 'approve':
        answer(cardEl, { kind: 'plan', approve: 'default' }); break;
      case 'keep': {
        const feedback = (cardEl.querySelector('[data-feedback]')?.value ?? '').trim();
        answer(cardEl, { kind: 'plan', keep: true, feedback }); break;
      }
      case 'noreply':
        release(cardEl, false); break;
      case 'open-card':
        release(cardEl, true); break;
      default:
    }
  });

  host.addEventListener('input', (e) => {
    const cardEl = cardOf(e.target);
    if (!cardEl) return;
    if (e.target.matches('.other')) {
      if (e.target.value.trim()) {
        for (const o of e.target.closest('.qn').querySelectorAll('.opt')) o.setAttribute('aria-checked', 'false');
      }
      drafts.set(`${cardEl.dataset.card}#${e.target.dataset.q}`, e.target.value);
      syncAnswer(cardEl);
    } else if (e.target.matches('[data-feedback]')) {
      drafts.set(cardEl.dataset.card, e.target.value);
    } else if (e.target.matches('[data-reply]')) {
      drafts.set(cardEl.dataset.card, e.target.value);
      const send = cardEl.querySelector('[data-act="send"]');
      if (send && !cardEl.dataset.done) send.disabled = !e.target.value.trim();
    }
  });

  host.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    const cardEl = cardOf(e.target);
    if (!cardEl) return;
    const act = e.target.matches('[data-reply]') ? 'send' : e.target.matches('[data-feedback]') ? 'keep' : e.target.matches('.other') ? 'answer' : null;
    // Enter in an empty feedback box is not "Keep planning" (M5); the button still sends it empty.
    if (act === 'keep' && !String(e.target.value ?? '').trim()) return;
    const btn = act && cardEl.querySelector(`[data-act="${act}"]`);
    if (btn && !btn.disabled && clickAllowed(act, st.cardSince, Date.now())) { e.preventDefault(); btn.click(); }
  });

  function clear() {
    clearTimeout(armTimer);
    st.card = null;
    if (!adopt) host.innerHTML = '';
    interactive(false);
  }

  // Shows `card` (a snapshot card, or null for none) and returns whether its answer buttons are still
  // arming. A different card id restarts the 500 ms arming and drops interactivity: the card we were
  // answering is gone (answered, handed back, or answered natively).
  function show(card, nowMs = Date.now()) {
    if (!card) { if (st.card) clear(); return { arming: false }; }
    const fresh = String(card.id) !== String(st.card?.id);
    if (fresh) {
      st.cardSince = nowMs;
      interactive(false);
    }
    st.card = card;
    const arm = arming(nowMs);
    if (!adopt && (fresh || !host.querySelector('.ans'))) {
      host.innerHTML = renderCard(card, { leftMs: leftMs(nowMs), arming: arm });
      refresh();
    }
    if (arm) armLater();
    tick(nowMs);
    return { arming: arm };
  }

  return { show, clear, refresh, tick, leftMs, drafts, arming };
}
