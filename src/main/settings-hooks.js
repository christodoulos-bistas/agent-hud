import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const HUD_EVENTS = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'Notification', 'Stop', 'SubagentStart', 'SubagentStop'];

export function buildHookEntries({ port, secret }) {
  const out = {};
  for (const ev of HUD_EVENTS) {
    out[ev] = [{ matcher: '', hooks: [{ type: 'http', url: `http://127.0.0.1:${port}/agent-hud/hook`, headers: { 'X-Agent-HUD': secret }, timeout: 600 }] }];
  }
  return out;
}

const isHudHook = (h) => !!h && h.type === 'http' && typeof h.url === 'string' && h.url.includes('/agent-hud/');

// Removes HUD hooks at hook level. A group is dropped only if it held a HUD hook and is now empty.
function stripHud(groups) {
  const kept = []; let removed = false;
  for (const g of groups) {
    if (!Array.isArray(g?.hooks) || !g.hooks.some(isHudHook)) { kept.push(g); continue; }
    removed = true;
    const rest = g.hooks.filter((h) => !isHudHook(h));
    if (rest.length) kept.push({ ...g, hooks: rest });
  }
  return { kept, removed };
}
const clone = (v) => structuredClone(v);

export function mergeHooks(settings, entries) {
  const out = clone(settings);
  const hooks = out.hooks && typeof out.hooks === 'object' && !Array.isArray(out.hooks) ? out.hooks : {};
  for (const [ev, groups] of Object.entries(entries)) {
    const existing = Array.isArray(hooks[ev]) ? stripHud(hooks[ev]).kept : [];
    hooks[ev] = [...existing, ...clone(groups)];
  }
  out.hooks = hooks;
  return out;
}

export function unmergeHooks(settings) {
  const out = clone(settings);
  const hooks = out.hooks;
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return out;
  let removed = false;
  for (const ev of Object.keys(hooks)) {
    if (!Array.isArray(hooks[ev])) continue;
    const r = stripHud(hooks[ev]);
    if (!r.removed) continue;
    const kept = r.kept;
    removed = true;
    if (kept.length === 0) delete hooks[ev]; else hooks[ev] = kept;
  }
  if (removed && Object.keys(hooks).length === 0) delete out.hooks;
  return out;
}

function readSettings(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (err) {
    if (err.code === 'ENOENT') return { exists: false, settings: {}, eol: '\n', trailing: true };
    throw err;
  }
  const text = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
  const settings = JSON.parse(text);
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('settings file is not a JSON object');
  if ('hooks' in settings && (settings.hooks === null || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks))) throw new Error('"hooks" is not an object');
  return { exists: true, settings, eol: text.includes('\r\n') ? '\r\n' : '\n', trailing: /\n$/.test(text) };
}

function writeAtomic(file, content) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.agent-hud.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
    throw err;
  }
}

// The file as it was before Agent HUD ever wrote it: copied once, never overwritten.
function keepOriginal(target) {
  try { fs.copyFileSync(target, target + '.agent-hud.orig', fs.constants.COPYFILE_EXCL); } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

// Unchanged settings are neither backed up nor rewritten, so the .bak keeps the last real change.
export function rewrite(file, transform) {
  try {
    const target = path.resolve(file);
    const { exists, settings, eol, trailing } = readSettings(target);
    if (!exists && transform.skipIfMissing) return { ok: true, backup: null, changed: false };
    const next = transform(settings);
    if (exists && isDeepStrictEqual(next, settings)) return { ok: true, backup: null, changed: false };
    let backup = null;
    if (exists) {
      keepOriginal(target);
      backup = target + '.agent-hud.bak';
      fs.copyFileSync(target, backup);
    }
    let text = JSON.stringify(next, null, 2);
    if (eol === '\r\n') text = text.replace(/\n/g, '\r\n');
    if (trailing) text += eol;
    writeAtomic(target, text);
    return { ok: true, backup, changed: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function installHooks(file, { port, secret }) {
  const entries = buildHookEntries({ port, secret });
  const t = (s) => mergeHooks(s, entries);
  return rewrite(file, t);
}

export function uninstallHooks(file) {
  const t = (s) => unmergeHooks(s);
  t.skipIfMissing = true;
  return rewrite(file, t);
}
