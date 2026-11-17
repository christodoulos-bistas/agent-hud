// Codex chats, built from hook events: Codex has no per-chat session files (one long-lived app-server
// hosts many chats), so a chat exists from its first event until SessionEnd or 24 h of silence.
import fs from 'node:fs';

// By the rollout's session_meta payload.originator; anything else is 'unknown'.
export const CODEX_HOSTS = { 'Codex Desktop': 'desktop', 'codex-tui': 'cli', codex_exec: 'cli' };

export const hostOf = (meta) => CODEX_HOSTS[meta?.originator] ?? 'unknown';

// The rollout file's first line is `{ type: 'session_meta', payload: { originator, source, ... } }`.
// Only a bounded chunk is read (never past the first line); any failure gives null.
export function readRolloutMeta(file, { maxBytes = 65536 } = {}) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(maxBytes);
    const n = fs.readSync(fd, buf, 0, maxBytes, 0);
    const text = buf.toString('utf8', 0, n);
    const nl = text.indexOf('\n');
    const first = JSON.parse(nl < 0 ? text : text.slice(0, nl));
    const p = first?.payload;
    if (first?.type !== 'session_meta' || !p) return null;
    return { originator: p.originator, source: p.source };
  } catch { return null; } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* nothing to do */ } }
  }
}

export function createCodexSessions({ now = Date.now, idleAfterMs = 900000, expireAfterMs = 86400000, readMeta = () => null } = {}) {
  const chats = new Map(); // id -> { cwd, host, startedAt, statusSince, busy, lastEventAt, open: Set of tool_use_id }

  function onEvent(ev) {
    const id = ev?.sessionId;
    if (!id) return;
    if (ev.event === 'SessionEnd') { chats.delete(id); return; }
    const at = Number.isFinite(ev.at) ? ev.at : now();
    let c = chats.get(id);
    if (c && at - c.lastEventAt >= expireAfterMs) c = null; // expired before this event: a new chat
    if (!c) {
      let meta = null;
      try { meta = readMeta(ev.raw?.transcript_path); } catch { meta = null; }
      c = { cwd: ev.cwd ?? null, host: hostOf(meta), startedAt: at, statusSince: at, busy: false, lastEventAt: at, open: new Set() };
      chats.set(id, c);
    }
    c.lastEventAt = at;
    if (ev.cwd) c.cwd = ev.cwd;
    const setBusy = (b) => { if (c.busy !== b) { c.busy = b; c.statusSince = at; } };
    const e = ev.event;
    const useId = ev.raw?.tool_use_id ?? null;
    if (e === 'UserPromptSubmit' || e === 'PermissionRequest') setBusy(true);
    else if (e === 'PreToolUse') { setBusy(true); if (useId !== null) c.open.add(useId); }
    else if (typeof e === 'string' && e.startsWith('PostToolUse')) { if (useId !== null) c.open.delete(useId); }
    else if (e === 'Stop' || e === 'Interrupt') { c.open.clear(); setBusy(false); }
  }

  // The idle and expiry rules are evaluated here, lazily, against now(); nothing is mutated but expiry.
  function list() {
    const t = now();
    const out = [];
    for (const [id, c] of [...chats]) {
      if (t - c.lastEventAt >= expireAfterMs) { chats.delete(id); continue; }
      const timedOut = c.busy && c.open.size === 0 && t - c.lastEventAt >= idleAfterMs;
      out.push({
        sessionId: id, pid: null, cwd: c.cwd, kind: 'interactive', entrypoint: 'codex', source: 'codex', host: c.host,
        name: `codex-${id.replace(/-/g, '').slice(-2)}`, nameSource: 'derived',
        status: c.busy && !timedOut ? 'busy' : 'idle',
        startedAt: c.startedAt, statusSince: timedOut ? c.lastEventAt + idleAfterMs : c.statusSince,
      });
    }
    return out;
  }

  const has = (id) => list().some((s) => s.sessionId === id);

  return { onEvent, list, has };
}
