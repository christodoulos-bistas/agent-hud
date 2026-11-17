import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { rewrite } from './settings-hooks.js';

export const CODEX_EVENTS = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop', 'Interrupt', 'SubagentStart', 'SubagentStop'];

// The Codex app runs hook commands through PowerShell, which would only print a bare quoted path.
export const codexHookCommand = (resourcesDir) => `cmd /d /c "${path.win32.join(resourcesDir, 'codex-hook.cmd')}"`;

// The pre-fix bare quoted form of a `cmd /d /c "<p>"` command, or null.
export function legacyCodexCommand(command) {
  const m = /^cmd \/d \/c ("[^"]*")$/.exec(typeof command === 'string' ? command : '');
  return m ? m[1] : null;
}

const snake = (ev) => ev.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isOurs = (h, command) => {
  if (!h) return false;
  const legacy = legacyCodexCommand(command);
  return h.command === command || (legacy !== null && h.command === legacy);
};
const ourHook = (ev, command) => ({ type: 'command', command, timeout: ev === 'PermissionRequest' ? 600 : 10 });

function hooksOf(doc) {
  if (!('hooks' in doc)) return null;
  if (!isObj(doc.hooks)) throw new Error('"hooks" is not an object');
  return doc.hooks;
}
function groupsOf(hooks, ev) {
  const groups = hooks[ev];
  if (!Array.isArray(groups)) throw new Error(`"hooks.${ev}" is not an array`);
  return groups;
}

// Positions never move (Codex approves hooks by position): ours is updated in place, else appended last.
export function installCodexHooks(doc, command) {
  const out = structuredClone(doc);
  const hooks = hooksOf(out) ?? (out.hooks = {});
  for (const ev of CODEX_EVENTS) {
    const want = ourHook(ev, command);
    if (!(ev in hooks)) { hooks[ev] = [{ matcher: '', hooks: [want] }]; continue; }
    let found = false;
    for (const g of groupsOf(hooks, ev)) {
      if (!Array.isArray(g?.hooks)) continue;
      g.hooks = g.hooks.map((h) => { if (!isOurs(h, command)) return h; found = true; return { ...h, ...want }; });
    }
    if (!found) hooks[ev].push({ matcher: '', hooks: [want] });
  }
  return { doc: out, changed: !isDeepStrictEqual(out, doc) };
}

export function hasLegacyCodexHooks(doc, command) {
  const legacy = legacyCodexCommand(command);
  if (legacy === null || !isObj(doc?.hooks)) return false;
  return Object.values(doc.hooks).some((groups) => Array.isArray(groups) && groups.some((g) => Array.isArray(g?.hooks) && g.hooks.some((h) => h?.command === legacy)));
}

export function removeCodexHooks(doc, command) {
  const out = structuredClone(doc);
  const hooks = hooksOf(out);
  const shifted = [];
  if (!hooks) return { doc: out, changed: false, shifted };
  for (const ev of Object.keys(hooks)) {
    if (!Array.isArray(hooks[ev])) continue;
    const kept = []; let removed = false; let moved = false; let groupDeleted = false;
    for (const g of hooks[ev]) {
      if (!Array.isArray(g?.hooks) || !g.hooks.some((h) => isOurs(h, command))) { if (groupDeleted) moved = true; kept.push(g); continue; }
      removed = true;
      if (groupDeleted) moved = true;
      const rest = []; let hookRemoved = false;
      for (const h of g.hooks) {
        if (isOurs(h, command)) hookRemoved = true; else { if (hookRemoved) moved = true; rest.push(h); }
      }
      if (rest.length) kept.push({ ...g, hooks: rest }); else groupDeleted = true;
    }
    if (!removed) continue;
    if (moved) shifted.push(ev);
    if (kept.length) hooks[ev] = kept; else delete hooks[ev];
  }
  if (Object.keys(hooks).length === 0 && !isDeepStrictEqual(out, doc)) delete out.hooks;
  return { doc: out, changed: !isDeepStrictEqual(out, doc), shifted };
}

export function ourPositions(doc, command) {
  const out = [];
  const hooks = isObj(doc?.hooks) ? doc.hooks : {};
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    groups.forEach((g, group) => {
      if (!Array.isArray(g?.hooks)) return;
      g.hooks.forEach((h, hook) => { if (isOurs(h, command)) out.push({ event, group, hook }); });
    });
  }
  return out;
}

const normPath = (p) => p.replace(/\//g, '\\').toLowerCase();

// Best effort: a header at our position may belong to a foreign hook that used to sit there;
// Codex still asks for re-approval in /hooks.
// Events with at least one of our positions that has no `[hooks.state.'<path>:<event>:<group>:<hook>']` header.
export function approvalMissing(configToml, hooksPath, positions) {
  const approved = new Set();
  const re = /^[ \t]*\[hooks\.state\.(?:'([^'\r\n]*)'|"([^"\r\n]*)")\][ \t]*(?:#.*)?$/gm;
  const text = typeof configToml === 'string' ? configToml : '';
  for (const m of text.matchAll(re)) {
    const key = m[1] ?? m[2];
    const k = /^(.*):([a-z_]+):(\d+):(\d+)$/.exec(key);
    if (k) approved.add(`${normPath(k[1])}:${k[2]}:${k[3]}:${k[4]}`);
  }
  const base = normPath(hooksPath);
  const missing = new Set();
  for (const p of positions) {
    if (!approved.has(`${base}:${snake(p.event)}:${p.group}:${p.hook}`)) missing.add(p.event);
  }
  const order = (e) => { const i = CODEX_EVENTS.indexOf(e); return i < 0 ? CODEX_EVENTS.length : i; };
  return [...missing].sort((a, b) => order(a) - order(b));
}

// trusted_hash per `[hooks.state.'<path>:<event>:<group>:<hook>']` header, keyed like "<normPath>:<event>:<g>:<h>".
function trustedHashes(configToml) {
  const out = new Map();
  const text = typeof configToml === 'string' ? configToml : '';
  const header = /^[ \t]*\[hooks\.state\.(?:'([^'\r\n]*)'|"([^"\r\n]*)")\][ \t]*(?:#.*)?$/;
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const h = header.exec(line);
    if (h) {
      const k = /^(.*):([a-z_]+):(\d+):(\d+)$/.exec(h[1] ?? h[2]);
      cur = k ? `${normPath(k[1])}:${k[2]}:${k[3]}:${k[4]}` : null;
      if (cur && !out.has(cur)) out.set(cur, null);
      continue;
    }
    if (/^[ \t]*\[/.test(line)) { cur = null; continue; }
    const t = cur && /^[ \t]*trusted_hash[ \t]*=[ \t]*(?:"([^"\r\n]*)"|'([^'\r\n]*)')/.exec(line);
    if (t) out.set(cur, t[1] ?? t[2]);
  }
  return out;
}

// Approval with memory: a hash at a slot that changed under us means Codex has not approved our hook there yet.
// Pure: returns the events still needing approval and the updated per-event memory { pos, hash, pending }.
export function approvalState(configToml, hooksPath, positions, memory = {}) {
  const hashes = trustedHashes(configToml);
  const base = normPath(hooksPath);
  const next = { ...(memory || {}) };
  const missing = new Set();
  for (const p of positions) {
    const pos = `${p.group}:${p.hook}`;
    const H = hashes.get(`${base}:${snake(p.event)}:${p.group}:${p.hook}`) ?? null;
    const m = next[p.event];
    let ok;
    if (!m) { next[p.event] = { pos, hash: H, pending: false }; ok = H !== null; }
    else if (m.pos !== pos) { next[p.event] = { pos, hash: H, pending: true }; ok = false; }
    else if (m.pending) {
      if (H !== m.hash) { next[p.event] = { pos, hash: H, pending: false }; ok = H !== null; } else ok = false;
    } else { next[p.event] = { ...m, hash: H }; ok = H !== null; }
    if (!ok) missing.add(p.event);
  }
  const order = (e) => { const i = CODEX_EVENTS.indexOf(e); return i < 0 ? CODEX_EVENTS.length : i; };
  return { missing: [...missing].sort((a, b) => order(a) - order(b)), memory: next };
}

export function installCodexHooksFile(file, command) {
  const t = (doc) => installCodexHooks(doc, command).doc;
  t.keepIndent = true;
  return rewrite(file, t);
}

export function removeCodexHooksFile(file, command) {
  let shifted = [];
  const t = (doc) => { const r = removeCodexHooks(doc, command); shifted = r.shifted; return r.doc; };
  t.skipIfMissing = true;
  t.keepIndent = true;
  const res = rewrite(file, t);
  return res.ok ? { ...res, shifted } : res;
}
