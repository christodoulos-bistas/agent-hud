import fs from 'node:fs';
import path from 'node:path';

export function baseOf(p) {
  const s = String(p || '').replace(/[\\/]+$/, '');
  return path.win32.basename(s);
}

// A start time that is missing, zero, negative or not a number is unknown (null), never "56 years ago".
export const knownTime = (t) => (typeof t === 'number' && Number.isFinite(t) && t > 0 ? t : null);

function toSession(o) {
  if (!o || typeof o !== 'object' || !o.sessionId || !Number.isInteger(o.pid)) return null;
  return {
    sessionId: o.sessionId, pid: o.pid, cwd: o.cwd || '', kind: o.kind, entrypoint: o.entrypoint,
    name: o.name || '', nameSource: o.nameSource, status: o.status, startedAt: knownTime(o.startedAt),
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
      if (s) out.push(s);
    } catch { /* half-written or unreadable: skip */ }
  }
  return out;
}

export async function listSessions({ dir, isAlive }) {
  return readSessionFiles(dir).filter((s) => isAlive(s.pid));
}

export function displayName(s) {
  const base = baseOf(s.cwd) || 'unknown';
  const name = String(s.name || '');
  const short = s.nameSource === 'derived' ? name.slice(name.lastIndexOf('-') + 1) : name;
  return short ? `${base} · ${short}` : base;
}
