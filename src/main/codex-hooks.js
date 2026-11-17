import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { rewrite } from './settings-hooks.js';

export const CODEX_EVENTS = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop', 'Interrupt', 'SubagentStart', 'SubagentStop'];

export const codexHookCommand = (resourcesDir) => `"${path.win32.join(resourcesDir, 'codex-hook.cmd')}"`;

const snake = (ev) => ev.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isOurs = (h, command) => !!h && h.command === command;
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

export function removeCodexHooks(doc, command) {
  const out = structuredClone(doc);
  const hooks = hooksOf(out);
  const shifted = [];
  if (!hooks) return { doc: out, changed: false, shifted };
  for (const ev of Object.keys(hooks)) {
    if (!Array.isArray(hooks[ev])) continue;
    const kept = []; let removed = false; let moved = false;
    for (const g of hooks[ev]) {
      if (!Array.isArray(g?.hooks) || !g.hooks.some((h) => isOurs(h, command))) { if (removed) moved = true; kept.push(g); continue; }
      removed = true;
      const rest = []; let hookRemoved = false;
      for (const h of g.hooks) {
        if (isOurs(h, command)) hookRemoved = true; else { if (hookRemoved) moved = true; rest.push(h); }
      }
      if (rest.length) kept.push({ ...g, hooks: rest });
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

export function installCodexHooksFile(file, command) {
  return rewrite(file, (doc) => installCodexHooks(doc, command).doc);
}

export function removeCodexHooksFile(file, command) {
  let shifted = [];
  const t = (doc) => { const r = removeCodexHooks(doc, command); shifted = r.shifted; return r.doc; };
  t.skipIfMissing = true;
  const res = rewrite(file, t);
  return res.ok ? { ...res, shifted } : res;
}
