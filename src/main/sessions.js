import fs from 'node:fs';
import path from 'node:path';

export function baseOf(p) {
  const s = String(p || '').replace(/[\\/]+$/, '');
  return path.win32.basename(s);
}

// The entrypoint of the claude.exe the HUD spawns to ask side questions. It is the HUD's own process,
// so no session reader may list it.
export const SIDE_ENTRYPOINT = 'agent-hud-side';

// A start time that is missing, zero, negative or not a number is unknown (null), never "56 years ago".
export const knownTime = (t) => (typeof t === 'number' && Number.isFinite(t) && t > 0 ? t : null);

function toSession(o) {
  if (!o || typeof o !== 'object' || !o.sessionId || !Number.isInteger(o.pid)) return null;
  return {
    sessionId: o.sessionId, pid: o.pid, cwd: o.cwd || '', kind: o.kind, entrypoint: o.entrypoint,
    name: o.name || '', nameSource: o.nameSource, status: o.status, startedAt: knownTime(o.startedAt),
    procStart: knownTime(o.procStart), // the process's own start (tie-break between two files of one chat)
    statusSince: knownTime(o.statusUpdatedAt), // when status last changed: the idle clock for chats without hooks (v1.3)
  };
}

export function readSessionFiles(dir) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    try {
      const s = toSession(JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')));
      if (s && s.entrypoint !== SIDE_ENTRYPOINT) out.push(s);
    } catch { /* half-written or unreadable: skip */ }
  }
  return out;
}

// One chat can leave two files: Claude restarts it in a new process and the old process's file stays
// behind. Its pid is then often reused by an unrelated process, so isAlive can't tell it is stale.
// Keep one entry per sessionId: the newest start (then the newest process start) wins.
const newer = (a, b) => (a.startedAt ?? -1) - (b.startedAt ?? -1) || (a.procStart ?? -1) - (b.procStart ?? -1);
function oneEach(list) {
  const best = new Map();
  for (const s of list) {
    const cur = best.get(s.sessionId);
    if (!cur || newer(s, cur) > 0) best.set(s.sessionId, s);
  }
  return list.filter((s) => best.get(s.sessionId) === s);
}

export async function listSessions({ dir, isAlive }) {
  return oneEach(readSessionFiles(dir).filter((s) => isAlive(s.pid)));
}

export function displayName(s) {
  const base = baseOf(s.cwd) || 'unknown';
  const name = String(s.name || '');
  // A chat with its own title shows just the title; a derived name ("arsenal-e0") keeps the folder.
  if (name && s.nameSource !== 'derived') return name;
  const short = name.slice(name.lastIndexOf('-') + 1);
  return short ? `${base} · ${short}` : base;
}
