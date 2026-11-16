export const CLASS_IDS = ['pathfinder', 'star-reader', 'runesmith', 'alchemist', 'hexbreaker', 'arbiter',
  'illuminator', 'loremaster', 'herald', 'cartographer', 'vaultkeeper', 'summoner'];

const SUBAGENT_CLASS = {
  Explore: 'pathfinder', Plan: 'star-reader',
  'change-reviewer': 'arbiter', 'review-lead': 'arbiter', 'code-reviewer': 'arbiter',
  artist: 'illuminator', brush: 'illuminator', paint: 'illuminator',
  'test-writer': 'alchemist', 'topcon-deliverables': 'cartographer',
};
const GEO = /\.(shp|geojson|gpkg|tif|dxf|kml)$/i;

function toolClass(name, input) {
  input = input || {};
  if (name === 'Read' || name === 'Grep' || name === 'Glob') return 'pathfinder';
  if (name === 'Edit' || name === 'Write' || name === 'NotebookEdit') {
    const p = String(input.file_path || input.notebook_path || '');
    if (/\.md$/i.test(p)) return 'loremaster';
    if (GEO.test(p)) return 'cartographer';
    return 'runesmith';
  }
  if (name === 'WebSearch' || name === 'WebFetch') return 'loremaster';
  if (name === 'ExitPlanMode') return 'star-reader';
  if (typeof name === 'string' && name.startsWith('mcp__azure-devops__')) return 'herald';
  if (name === 'Bash') {
    const c = String(input.command || '').replace(/"[^"]*"|'[^']*'/g, '');
    if (/\bgit (push|commit|merge|tag)\b|\bgh\b|\baz (repos|pipelines)\b/.test(c)) return 'herald';
    if (/\bpsql\b|\bmigrat/.test(c) || /\.sql\b/.test(c)) return 'vaultkeeper';
    if (/\b(test|vitest|jest|pytest|build|lint|tsc)\b/.test(c)) return 'alchemist';
  }
  return null;
}

export function signalsFromEvent(ev) {
  if (ev.event === 'PostToolUseFailure') return [{ cls: 'hexbreaker', weight: 1 }];
  if (ev.event !== 'PreToolUse') return [];
  if (ev.toolName === 'Agent' || ev.toolName === 'Task') {
    const c = SUBAGENT_CLASS[(ev.toolInput || {}).subagent_type];
    return c ? [{ cls: c, weight: 3 }] : [];
  }
  const sub = SUBAGENT_CLASS[(ev.raw || {}).agent_type];
  if (sub) return [{ cls: sub, weight: 1 }];
  const c = toolClass(ev.toolName, ev.toolInput);
  return c ? [{ cls: c, weight: 1 }] : [];
}

export function createClassEngine({ windowMs = 120000, leadRatio = 1.5, holdMs = 10000 } = {}) {
  const sessions = new Map();
  const get = (id) => {
    let s = sessions.get(id);
    if (!s) { s = { sig: [], current: 'pathfinder', challenger: null, since: 0, ids: new Set(), anon: 0 }; sessions.set(id, s); }
    return s;
  };

  function evaluate(s, now) {
    s.sig = s.sig.filter((x) => x.at >= now - windowMs);
    const score = {};
    for (const x of s.sig) score[x.cls] = (score[x.cls] || 0) + x.weight;
    let top = null;
    for (const [c, v] of Object.entries(score)) if (top === null || v > score[top]) top = c;
    if (top === null || top === s.current || (score[top] || 0) <= (score[s.current] || 0)) { s.challenger = null; return; }
    if (s.challenger !== top) { s.challenger = top; s.since = now; }
    const cur = score[s.current] || 0;
    if ((cur === 0 || score[top] >= leadRatio * cur) && now - s.since >= holdMs) {
      s.current = top; s.challenger = null;
    }
  }

  const count = (s) => s.ids.size + s.anon;

  return {
    forget(sessionId) { sessions.delete(sessionId); },
    push(ev) {
      if (ev.event === 'SessionEnd') { sessions.delete(ev.sessionId); return; }
      const s = get(ev.sessionId);
      const raw = ev.raw || {};
      if (ev.event === 'Stop' && Array.isArray(raw.background_tasks)) {
        s.ids = new Set(raw.background_tasks.filter((t) => t && t.type === 'subagent' && t.status === 'running' && t.id).map((t) => t.id));
        s.anon = 0;
      }
      if (ev.event === 'SubagentStart') {
        if (raw.agent_id) s.ids.add(raw.agent_id); else s.anon++;
      } else if (ev.event === 'SubagentStop') {
        if (raw.agent_id) s.ids.delete(raw.agent_id); else s.anon = Math.max(0, s.anon - 1);
      }
      for (const sg of signalsFromEvent(ev)) s.sig.push({ ...sg, at: ev.at });
      evaluate(s, ev.at);
    },
    classOf(sessionId, now) {
      const s = get(sessionId);
      if (count(s) >= 2) return 'summoner';
      evaluate(s, now);
      return s.current;
    },
    activeSubagents(sessionId) { return count(get(sessionId)); },
  };
}

export function moodOf({ pending, stoppedAt, lastActivityAt, status }, now) {
  if (pending) return 'needs';
  if (stoppedAt != null && stoppedAt > (lastActivityAt ?? 0)) return 'done';
  if ((lastActivityAt != null && now - lastActivityAt <= 20000) || status === 'busy') return 'working';
  return 'idle';
}
