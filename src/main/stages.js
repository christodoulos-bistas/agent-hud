// An open step only counts while the session is not idle: an Esc-interrupted tool sends no Post/Stop,
// so its step stays open on a session that is really idle. Unknown status counts as live.
const liveOpen = (view, status) => (status === 'idle' ? [] : (view.open || []));

// The current step (the panel's "Now:", the chip's clock): the most recently started live open
// main-thread step, or null. Same stale-step rule as the stages, so "Idle" never sits beside a "Now:".
export function currentOf(view, status) {
  let cur = null;
  for (const s of liveOpen(view || {}, status)) {
    if (s.agentId != null) continue;
    if (!cur || s.startedAt >= cur.startedAt) cur = s;
  }
  return cur;
}

export function stageOf({ mood, view, status }) {
  if (mood === 'needs') return 'needs';
  if (mood === 'done') return 'turn';
  const open = liveOpen(view, status);
  const all = [...(view.steps || []), ...(view.open || [])];
  if (mood === 'working' && view.taskAt != null && open.length === 0 && !all.some((s) => s.startedAt >= view.taskAt)) return 'thinking';
  if (mood === 'working' || open.length > 0) return 'working';
  return 'idle';
}

const isDelegating = (s) => s.tool === 'Agent' || s.tool === 'Task';
// Tools that wait on the user, not on work: never "long".
const USER_WAITS = new Set(['AskUserQuestion', 'ExitPlanMode']);

export function stuckOf({ stage, view, status, now }, { repeatN = 3, longMs = 300000, silentMs = 180000 } = {}) {
  if (stage !== 'thinking' && stage !== 'working') return null;
  const open = liveOpen(view, status);
  const helpers = view.helpers || [];

  const recent = (view.steps || []).filter((s) => !s.interrupted && (view.taskAt == null || s.startedAt >= view.taskAt)).slice(0, repeatN);
  if (recent.length === repeatN && recent.every((s) => s.ok === false && s.label === recent[0].label)) {
    return { reason: 'repeating', detail: `the same step failed ${repeatN} times in a row: ${recent[0].label}` };
  }

  for (const s of open) {
    if (isDelegating(s) && helpers.length > 0) continue;
    if (USER_WAITS.has(s.tool)) continue;
    const age = now - s.startedAt;
    // label and startedAt name the flagged step, so the panel's line can't pick another one (M2).
    if (age > longMs) return { reason: 'long', detail: `${s.label} has been running for ${Math.floor(age / 60000)} min`, label: s.label, startedAt: s.startedAt };
  }

  // Silent is busy-only: after the thinking fix, thinking implies recent activity or busy, so no extra arm.
  if (status === 'busy' && (view.open || []).length === 0 && helpers.length === 0 && view.lastEventAt != null) {
    const quiet = now - view.lastEventAt;
    if (quiet > silentMs) return { reason: 'silent', detail: `no activity for ${Math.floor(quiet / 60000)} min` };
  }
  return null;
}
