// The parts of the Electron shell that don't need Electron: answer encoding, docking maths,
// the snapshot throttle, the interactive-session check and the config file.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { permissionAllow, permissionDeny, choiceAnswer, stopReply } from './answers.js';

export const DEFAULT_PORT = 47821;

// "Always allow" forwards only the addRules entries of permission_suggestions (spec 6.2, R22).
const addRulesOf = (suggestions) => (Array.isArray(suggestions) ? suggestions.filter((s) => s?.type === 'addRules') : []);

// Renderer answer object -> hook response for that queue item, or null when it doesn't fit.
export function encodeAnswer(item, response) {
  if (!item || !response || typeof response !== 'object') return null;
  const p = item.payload || {};
  switch (item.kind) {
    case 'permission':
      if (response.kind === 'allow') {
        const rules = response.always ? addRulesOf(p.permission_suggestions) : [];
        return rules.length ? permissionAllow(rules) : permissionAllow();
      }
      if (response.kind === 'deny') return permissionDeny();
      return null;
    case 'choice': {
      const picks = response.picks;
      if (response.kind !== 'choice' || !picks || typeof picks !== 'object' || Array.isArray(picks)) return null;
      return choiceAnswer(p.tool_input || {}, picks);
    }
    case 'reply': {
      const text = typeof response.text === 'string' ? response.text.trim() : '';
      return response.kind === 'reply' && text ? stopReply(text) : null;
    }
    default: return null;
  }
}

// Bottom-right of the work area, `margin` px in; height capped at `maxFrac` of the work area.
export function dockBounds(workArea, width, height, { margin = 16, maxFrac = 0.6 } = {}) {
  const cap = Math.floor(workArea.height * maxFrac);
  const h = Math.max(1, Math.min(cap, Math.ceil(Number(height) || 0)));
  return {
    x: Math.round(workArea.x + workArea.width - width - margin),
    y: Math.round(workArea.y + workArea.height - h - margin),
    width, height: h,
  };
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
const isAnchor = (a) => !!a && (a.h === 'left' || a.h === 'right') && (a.v === 'top' || a.v === 'bottom')
  && Number.isFinite(a.x) && Number.isFinite(a.y);

// Where the user dragged the HUD to. The edges nearest the window's centre stay put when the HUD
// grows, shrinks or collapses: bottom half -> bottom edge (it grows upward), right half -> right edge.
export function anchorFrom(bounds, workArea) {
  const right = bounds.x + bounds.width / 2 > workArea.x + workArea.width / 2;
  const bottom = bounds.y + bounds.height / 2 > workArea.y + workArea.height / 2;
  return {
    h: right ? 'right' : 'left', v: bottom ? 'bottom' : 'top',
    x: Math.round(right ? bounds.x + bounds.width : bounds.x),
    y: Math.round(bottom ? bounds.y + bounds.height : bounds.y),
  };
}

// Light snapping on drop: within `threshold` px of an edge (or past it) the HUD lines up `margin` px in
// from that edge, the same gap as the default corner; near two edges it lands in that corner.
// Anywhere else the drop position is kept as is.
export function snapBounds(bounds, workArea, { threshold = 24, margin = 16 } = {}) {
  let { x, y } = bounds;
  const { width, height } = bounds;
  const right = workArea.x + workArea.width, bottom = workArea.y + workArea.height;
  if (x - workArea.x <= threshold) x = workArea.x + margin;
  else if (right - (x + width) <= threshold) x = right - width - margin;
  if (y - workArea.y <= threshold) y = workArea.y + margin;
  else if (bottom - (y + height) <= threshold) y = bottom - height - margin;
  return { x, y, width, height };
}

// A point just inside the anchored corner, for finding the display the HUD belongs to (a right or
// bottom edge sits on the first pixel of a neighbouring monitor).
export function anchorPoint(a) {
  return { x: Math.round(a.h === 'right' ? a.x - 1 : a.x), y: Math.round(a.v === 'bottom' ? a.y - 1 : a.y) };
}

// The HUD's bounds: docked bottom-right by default, or held at the user's anchor; always fully inside
// the work area, height capped at `maxFrac` of it.
export function placeBounds(workArea, width, height, anchor, { margin = 16, maxFrac = 0.6 } = {}) {
  if (!isAnchor(anchor)) return dockBounds(workArea, width, height, { margin, maxFrac });
  const cap = Math.floor(workArea.height * maxFrac);
  const h = Math.max(1, Math.min(cap, Math.ceil(Number(height) || 0)));
  const x = clamp(anchor.h === 'right' ? anchor.x - width : anchor.x, workArea.x, workArea.x + workArea.width - width);
  const y = clamp(anchor.v === 'bottom' ? anchor.y - h : anchor.y, workArea.y, workArea.y + workArea.height - h);
  return { x: Math.round(x), y: Math.round(y), width, height: h };
}
export { isAnchor };

// The detail panel beside the HUD: on its left, or on its right when the HUD's centre is in the left
// half of the work area; the other side if that one doesn't fit; if neither fits, the side with more
// room, clamped inside the work area (overlapping the HUD only then). Height capped at `maxFrac` of
// the work area. Vertically the clicked row (`rowY`, px from the HUD's top) sits 40 px down the panel
// where it can, and `arrowY` (px from the panel's top, 16 px clear of each end) points at it.
export function panelBounds(hud, workArea, { width = 340, height, rowY, gap = 8, maxFrac = 0.6 } = {}) {
  const wa = workArea;
  const cap = Math.floor(wa.height * maxFrac);
  const h = Math.max(1, Math.min(cap, Math.ceil(Number(height) || 0)));
  const room = { left: hud.x - wa.x, right: wa.x + wa.width - (hud.x + hud.width) };
  const fits = (s) => room[s] >= width + gap;
  const preferred = hud.x + hud.width / 2 < wa.x + wa.width / 2 ? 'right' : 'left';
  const other = preferred === 'left' ? 'right' : 'left';
  const side = fits(preferred) ? preferred : fits(other) ? other : room.left >= room.right ? 'left' : 'right';
  const x = clamp(side === 'left' ? hud.x - gap - width : hud.x + hud.width + gap, wa.x, wa.x + wa.width - width);
  const row = hud.y + (rowY != null && Number.isFinite(Number(rowY)) ? Number(rowY) : 40); // no row yet: level with the HUD's top
  const y = Math.round(clamp(row - 40, wa.y, wa.y + wa.height - h));
  return { x: Math.round(x), y, width, height: h, side, arrowY: Math.round(clamp(row - y, 16, h - 16)) };
}

// Which agent the panel shows: the selected one, only while the HUD is visible and the agent is still
// in the snapshot; otherwise none (the panel closes). A collapsed HUD has a panel only for the agent
// that owns the active question (`hasCard`): it opens beside the collapsed column.
export function panelTarget(selectedId, snapshot, { collapsed, visible, hasCard } = {}) {
  if (selectedId == null || !visible || (collapsed && !hasCard)) return null;
  const agents = Array.isArray(snapshot?.agents) ? snapshot.agents : [];
  return agents.some((a) => a && String(a.id) === String(selectedId)) ? selectedId : null;
}

// The panel's selection as a question comes and goes. state = { selected: {id,rowY}|null, auto, before,
// cardId }; `card` is the snapshot's active card or null.
// - A new card id opens the panel on its agent (auto). The selection to come back to (`before`) is the
//   one the user had; a card replacing an auto-opened one keeps that original `before`.
// - The card going away (answered here or in its own window, released, timed out) while the
//   selection is still auto puts `before` back (null: the panel closes).
// - The same card id changes nothing, so a choice the user made during the question (userSelect) stands.
// rowY is unknown for a newly opened agent (null) until the HUD reports where its row is.
export function autoSelect(state, card) {
  const s = { selected: state?.selected ?? null, auto: !!state?.auto, before: state?.before ?? null, cardId: state?.cardId ?? null };
  if (card && card.id != null) {
    const cardId = String(card.id);
    if (cardId === s.cardId) return s;
    const id = String(card.sessionId);
    const rowY = s.selected && String(s.selected.id) === id ? s.selected.rowY ?? null : null;
    return { selected: { id, rowY }, auto: true, before: s.auto ? s.before : s.selected, cardId };
  }
  if (s.auto) return { selected: s.before, auto: false, before: null, cardId: null };
  return { ...s, cardId: null };
}

// The user picked an agent (or closed the panel: sel null). Their choice stands: not auto, nothing to
// go back to, and the current card id is kept so this question doesn't re-open the panel.
export function userSelect(state, sel) {
  return { selected: sel ?? null, auto: false, before: null, cardId: state?.cardId ?? null };
}

// The HUD's view of the active card: only what the asking row ("asks a question") and the "Next:" line
// need. The whole card (payload, command, options) goes to the panel with the detail (M7).
export function hudCard(card) {
  return card ? { id: card.id, kind: card.kind, sessionId: card.sessionId } : null;
}

// The panel's ✕ names the agent it was showing; it closes the panel only if that agent is still the
// selected one. A question can switch the panel to its own agent while the pointer is down on ✕, and
// that close must not dismiss the new question (M2).
export function closeApplies(id, selectedId) {
  return id != null && selectedId != null && String(id) === String(selectedId);
}

// At most one call per `ms`; a call inside the window schedules one trailing call, so the last
// change is always delivered. Monotonic clock by default; the wait is clamped to `ms` anyway, so a
// clock that steps backwards can never freeze the trailing call.
export function createThrottle(fn, ms, { now = () => performance.now(), setTimer = setTimeout } = {}) {
  let last = -Infinity;
  let pending = false;
  const run = () => { pending = false; last = now(); fn(); };
  return () => {
    if (pending) return;
    const wait = Math.min(ms, last + ms - now());
    if (wait <= 0) return run();
    pending = true;
    setTimer(run, wait);
  };
}

// A main-process tick that can never throw (I4): an exception would reach Electron's default error box,
// which blocks the main process, and with it every hooked session waiting on its hooks. The error is
// handed to `onError(label, err)` instead; a throwing onError is swallowed too.
export function guarded(label, fn, onError) {
  return (...args) => {
    try { return fn(...args); } catch (err) {
      try { onError(label, err); } catch { /* never throw from a guard */ }
      return undefined;
    }
  };
}

// A window (HUD or panel) made non-focusable again after the user typed into it; if it held the focus,
// it gives it back (blur activates the window underneath). A window that is not focusable (it never
// took the focus: the panel hidden after an Allow, Deny or ✕) is left alone: on Windows SetFocusable
// ends with a deactivate that can hand the foreground to the next window in z-order (I1).
// That deactivate picks the next visible window in z-order, which for an always-on-top window is
// another always-on-top one (the taskbar, the HUD), not the window the user typed from; so a window
// giving the focus back leaves the always-on-top band for the hand-back (spike 7, hands-on check 3).
export function releaseFocusOf(w) {
  if (!w || w.isDestroyed() || !w.isFocusable()) return;
  const had = w.isFocused();
  const onTop = had && w.isAlwaysOnTop();
  if (onTop) w.setAlwaysOnTop(false);
  w.setFocusable(false);
  if (had) w.blur();
  if (onTop) w.setAlwaysOnTop(true);
}

// True when the latest session list says the id is interactive. An id that isn't listed yet
// (a session newer than the last poll) re-reads the session files once; still unknown -> false.
export function createInteractiveCheck({ current, reread }) {
  const kindIn = (list, id) => (Array.isArray(list) ? list.find((s) => s && s.sessionId === id)?.kind : undefined);
  return (id) => {
    let kind = kindIn(current(), id);
    if (kind === undefined) {
      try { kind = kindIn(reread(), id); } catch { kind = undefined; }
    }
    return kind === 'interactive';
  };
}

// Which settings file install/uninstall may touch. AGENT_HUD_SETTINGS_PATH wins; without it only the
// packaged app targets ~/.claude/settings.json, and a dev build is blocked (path null).
export function settingsTarget({ isPackaged, envPath, home }) {
  if (envPath) return { path: envPath, blocked: false };
  if (!isPackaged) return { path: null, blocked: true };
  return { path: path.join(home, '.claude', 'settings.json'), blocked: false };
}

// `--remove-hooks` (run by the uninstaller): take the HUD's hooks out of the target settings file.
// Never throws; a blocked dev build touches nothing. Returns { ok, message } for the log.
export function removeHooksCli({ target, uninstall }) {
  if (!target || target.blocked || !target.path) return { ok: false, message: 'dev build without AGENT_HUD_SETTINGS_PATH: hooks not changed' };
  let r;
  try { r = uninstall(target.path); } catch (err) { r = { ok: false, error: err?.message ?? String(err) }; }
  if (!r?.ok) return { ok: false, message: `could not remove hooks from ${target.path}: ${r?.error}` };
  return { ok: true, message: r.changed === false ? `no hooks to remove in ${target.path}` : `hooks removed from ${target.path}` };
}

// config.json: { port, secret, ...flags }. Missing or broken values are repaired and written back.
export function loadConfig(file) {
  let cfg = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) cfg = parsed;
  } catch { /* missing or corrupt: start fresh */ }
  let dirty = false;
  if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) { cfg.port = DEFAULT_PORT; dirty = true; }
  if (typeof cfg.secret !== 'string' || !/^[0-9a-f]{32}$/.test(cfg.secret)) { cfg.secret = crypto.randomBytes(16).toString('hex'); dirty = true; }
  if (dirty) saveConfig(file, cfg);
  return cfg;
}

export function saveConfig(file, cfg) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}
