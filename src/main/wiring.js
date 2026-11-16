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
