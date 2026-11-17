// v1.3: which chats step off the HUD. A chat quiet for an hour tucks away by itself; a ✕ hides one at
// once until it wakes (a new turn after the hide). A chat asking the user something is never out of sight.

export const TUCK_AFTER_MS = 3_600_000;

const known = (t) => typeof t === 'number' && Number.isFinite(t) && t > 0;

// When a chat last did anything we know of: its last hook activity, its last Stop, its session file's
// status change, or its start. Null when none is known.
export function quietSince({ lastActivityAt, stoppedAt, statusSince, startedAt } = {}) {
  const times = [lastActivityAt, stoppedAt, statusSince, startedAt].filter(known);
  return times.length ? Math.max(...times) : null;
}

// null (visible), 'hidden' (✕, not woken since) or 'idle' (quiet for afterMs in stage idle or turn,
// with a session file that doesn't say busy).
export function tuckOf({ stage, status, quietSince: since, hiddenAt, wakeAt }, now, { afterMs = TUCK_AFTER_MS } = {}) {
  if (stage === 'needs') return null;
  if (hiddenAt != null && !(wakeAt != null && wakeAt > hiddenAt)) return 'hidden';
  if ((stage === 'idle' || stage === 'turn') && status !== 'busy' && since != null && now - since >= afterMs) return 'idle';
  return null;
}
