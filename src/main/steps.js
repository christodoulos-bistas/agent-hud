import path from 'node:path';

export function activityLine(ev) {
  const t = ev.toolName; const i = ev.toolInput || {};
  if (ev.event === 'UserPromptSubmit') return 'thinking';
  switch (t) {
    case 'Read': return `reading ${path.win32.basename(String(i.file_path || ''))}`;
    case 'Edit': case 'Write': return `editing ${path.win32.basename(String(i.file_path || ''))}`;
    case 'Bash': case 'PowerShell': return `running ${String(i.command || '').slice(0, 40)}`;
    case 'Grep': case 'Glob': return 'searching code';
    case 'WebSearch': return 'searching the web';
    case 'WebFetch': {
      try { return `reading ${new URL(String(i.url)).hostname}`; } catch { return 'reading the web'; }
    }
    case 'Agent': case 'Task': return `sending a ${i.subagent_type || 'general'} helper`;
    default: return t || '';
  }
}

const collapse = (s) => String(s).replace(/\s+/g, ' ').trim();
const base = (p) => path.win32.basename(String(p || ''));

export function stepLabel(toolName, toolInput) {
  const i = toolInput || {};
  switch (toolName) {
    case 'Read': return `Read ${base(i.file_path)}`;
    case 'Edit': case 'Write': case 'NotebookEdit': return `Edited ${base(i.file_path || i.notebook_path)}`;
    case 'Bash': case 'PowerShell': return collapse(i.command || '').slice(0, 80);
    case 'Grep': return `Searched code for “${i.pattern ?? ''}”`;
    case 'Glob': return `Listed files ${i.pattern ?? ''}`;
    case 'WebSearch': return `Searched the web for “${i.query ?? ''}”`;
    case 'WebFetch': {
      try { return `Read ${new URL(String(i.url)).hostname}`; } catch { return 'Read the web'; }
    }
    case 'Agent': case 'Task': return `Sent a ${i.subagent_type || 'general'} helper`;
    default: return toolName || '';
  }
}

function errorText(raw) {
  const r = raw.tool_response;
  const cands = [raw.error, r && typeof r === 'object' ? r.stderr : null, r && typeof r === 'object' ? r.error : null,
    r && typeof r === 'object' ? r.message : null, typeof r === 'string' ? r : null];
  for (const c of cands) {
    if (typeof c !== 'string') continue;
    const t = collapse(c);
    if (t) return t.slice(0, 300);
  }
  return null;
}

export function createStepLog({ cap = 20 } = {}) {
  const sessions = new Map();
  const get = (id) => {
    let s = sessions.get(id);
    if (!s) { s = { task: null, taskAt: null, stepCount: 0, open: [], closed: [], helpers: new Map(), lastEventAt: null }; sessions.set(id, s); }
    return s;
  };

  function closeInterrupted(s, at) {
    for (const st of s.open) { st.endedAt = at; st.ok = null; st.interrupted = true; s.closed.push(st); }
    s.open = [];
    if (s.closed.length > cap) s.closed = s.closed.slice(-cap);
  }

  function push(ev) {
    const s = get(ev.sessionId);
    const raw = ev.raw || {};
    const e = ev.event;
    const agentId = raw.agent_id ?? null;
    s.lastEventAt = ev.at;

    if (e === 'SubagentStart') {
      if (agentId !== null) s.helpers.set(agentId, { agentId, agentType: raw.agent_type ?? null, doing: null });
      return;
    }
    if (e === 'SubagentStop') { if (agentId !== null) s.helpers.delete(agentId); return; }

    if (agentId !== null) {
      if (e === 'PreToolUse') {
        const h = s.helpers.get(agentId);
        if (h) h.doing = activityLine(ev);
      }
      return;
    }

    if (e === 'UserPromptSubmit') {
      const prompt = String(raw.prompt || '').trim();
      if (prompt.startsWith('<task-notification>')) return;
      s.task = collapse(prompt).slice(0, 300);
      s.taskAt = ev.at;
      s.stepCount = 0;
      closeInterrupted(s, ev.at);
    } else if (e === 'Stop' || e === 'SessionEnd') {
      closeInterrupted(s, ev.at);
    } else if (e === 'PreToolUse') {
      const input = ev.toolInput || raw.tool_input || {};
      const tool = ev.toolName ?? raw.tool_name ?? null;
      s.stepCount += 1;
      s.open.push({
        id: raw.tool_use_id ?? null, tool, label: stepLabel(tool, input), doing: activityLine(ev),
        why: typeof input.description === 'string' ? input.description : null,
        startedAt: ev.at, endedAt: null, ok: null, interrupted: false, error: null,
        agentId: null, agentType: null,
      });
    } else if (e === 'PostToolUse' || e === 'PostToolUseFailure') {
      const tool = ev.toolName ?? raw.tool_name ?? null;
      let idx = raw.tool_use_id != null ? s.open.findIndex((x) => x.id === raw.tool_use_id) : -1;
      if (idx < 0) idx = s.open.findIndex((x) => x.tool === tool);
      if (idx < 0) return;
      const [st] = s.open.splice(idx, 1);
      st.endedAt = ev.at;
      if (e === 'PostToolUse') st.ok = true;
      else { st.ok = false; st.error = errorText(raw); }
      s.closed.push(st);
      if (s.closed.length > cap) s.closed = s.closed.slice(-cap);
    }
  }

  function view(id) {
    const s = sessions.get(id);
    if (!s) return { task: null, taskAt: null, stepCount: 0, current: null, steps: [], open: [], helpers: [], lastEventAt: null };
    const open = s.open.slice();
    return {
      task: s.task, taskAt: s.taskAt, stepCount: s.stepCount,
      current: open.length ? open.reduce((a, b) => (b.startedAt >= a.startedAt ? b : a)) : null,
      steps: s.closed.slice().reverse(),
      open,
      helpers: [...s.helpers.values()].map((h) => ({ ...h })),
      lastEventAt: s.lastEventAt,
    };
  }

  return { push, forget: (id) => { sessions.delete(id); }, view };
}
