import { fmtDuration } from '../renderer/format.js';

export { fmtDuration };

export function stageOf({ mood, view }) {
  if (mood === 'needs') return 'needs';
  if (mood === 'done') return 'turn';
  const open = view.open || [];
  const all = [...(view.steps || []), ...open];
  if (view.taskAt != null && open.length === 0 && !all.some((s) => s.startedAt >= view.taskAt)) return 'thinking';
  if (mood === 'working' || open.length > 0) return 'working';
  return 'idle';
}

const isDelegating = (s) => s.tool === 'Agent' || s.tool === 'Task';

export function stuckOf({ stage, view, status, now }, { repeatN = 3, longMs = 300000, silentMs = 180000 } = {}) {
  if (stage !== 'thinking' && stage !== 'working') return null;
  const open = view.open || [];
  const helpers = view.helpers || [];

  const recent = (view.steps || []).filter((s) => !s.interrupted).slice(0, repeatN);
  if (recent.length === repeatN && recent.every((s) => s.ok === false && s.label === recent[0].label)) {
    return { reason: 'repeating', detail: `the same step failed ${repeatN} times in a row: ${recent[0].label}` };
  }

  for (const s of open) {
    if (isDelegating(s) && helpers.length > 0) continue;
    const age = now - s.startedAt;
    if (age > longMs) return { reason: 'long', detail: `${s.label} has been running for ${Math.floor(age / 60000)} min` };
  }

  if (status === 'busy' && open.length === 0 && helpers.length === 0 && view.lastEventAt != null) {
    const quiet = now - view.lastEventAt;
    if (quiet > silentMs) return { reason: 'silent', detail: `no activity for ${Math.floor(quiet / 60000)} min` };
  }
  return null;
}
