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
// Plain text for the panel: whitespace collapsed, at most 300 chars; empty -> null.
const capped = (s) => collapse(s).slice(0, 300) || null;

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

const DELEGATES = new Set(['Agent', 'Task']);

export function createStepLog({ cap = 20, supersedeMs = 10000 } = {}) {
  const sessions = new Map();
  const get = (id) => {
    let s = sessions.get(id);
    if (!s) { s = { task: null, taskAt: null, stepCount: 0, open: [], closed: [], helpers: new Map(), lastEventAt: null, lastMessage: null }; sessions.set(id, s); }
    return s;
  };

  const keep = (s, st) => {
    s.closed.push(st);
    if (s.closed.length > cap) s.closed = s.closed.slice(-cap);
  };

  // Closes the given open steps as interrupted (– in the panel; never a failure for "repeating").
  function interrupt(s, steps, at) {
    if (!steps.length) return;
    s.open = s.open.filter((x) => !steps.includes(x));
    for (const st of steps) { st.endedAt = at; st.ok = null; st.interrupted = true; keep(s, st); }
  }
  const closeInterrupted = (s, at) => interrupt(s, s.open.slice(), at);

  // A permission denied in the HUD may get no Post event (R8a): close the oldest open main-thread step
  // of that tool as failed. True when a step was closed.
  function closeDenied(sessionId, toolName, at) {
    const s = sessions.get(sessionId);
    const idx = s ? s.open.findIndex((x) => x.tool === toolName) : -1;
    if (idx < 0) return false;
    const [st] = s.open.splice(idx, 1);
    st.endedAt = at; st.ok = false; st.error = 'Denied';
    keep(s, st);
    return true;
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
      // A helper's own PreToolUse proves it is running, so one whose SubagentStart was missed (it started
      // before the HUD or its hooks) joins here. Only a Pre adds one: a late Post could follow its stop.
      if (e === 'PreToolUse') {
        const h = s.helpers.get(agentId) ?? { agentId, agentType: raw.agent_type ?? null, doing: null };
        h.doing = activityLine(ev);
        s.helpers.set(agentId, h);
      }
      return;
    }

    if (e === 'UserPromptSubmit') {
      const prompt = String(raw.prompt || '').trim();
      if (prompt.startsWith('<task-notification>')) return;
      s.task = collapse(prompt).slice(0, 300);
      s.taskAt = ev.at;
      s.stepCount = 0;
      s.lastMessage = null;
      closeInterrupted(s, ev.at);
    } else if (e === 'Stop' || e === 'SessionEnd') {
      if (e === 'Stop' && typeof raw.last_assistant_message === 'string') s.lastMessage = collapse(raw.last_assistant_message).slice(0, 600) || null;
      closeInterrupted(s, ev.at);
      // A helper can end without a SubagentStop reaching us: the main thread's Stop lists the helpers
      // still running (same rule as the class engine, classes.js).
      const bg = raw.background_tasks;
      if (e === 'Stop' && Array.isArray(bg)) {
        const running = new Set(bg.filter((t) => t && t.type === 'subagent' && t.status === 'running' && t.id).map((t) => t.id));
        for (const id of [...s.helpers.keys()]) if (!running.has(id)) s.helpers.delete(id);
      }
    } else if (e === 'PreToolUse') {
      const input = ev.toolInput || raw.tool_input || {};
      const tool = ev.toolName ?? raw.tool_name ?? null;
      // Superseded (R8b): Claude runs main-thread tools one after another (parallel calls start within
      // ms of each other), so a step still open >10 s before a new one will get no Post (denied, say).
      interrupt(s, s.open.filter((x) => !DELEGATES.has(x.tool) && ev.at - x.startedAt > supersedeMs), ev.at);
      s.stepCount += 1;
      const shell = tool === 'Bash' || tool === 'PowerShell';
      s.open.push({
        id: raw.tool_use_id ?? null, tool, label: stepLabel(tool, input), doing: activityLine(ev),
        command: shell && input.command != null ? capped(input.command) : null, // the panel's "Now:" (activityLine cuts at 40)
        why: typeof input.description === 'string' ? capped(input.description) : null,
        startedAt: ev.at, endedAt: null, ok: null, interrupted: false, error: null,
        agentId: null, agentType: null,
      });
    } else if (e === 'PostToolUse' || e === 'PostToolUseFailure') {
      const tool = ev.toolName ?? raw.tool_name ?? null;
      const useId = raw.tool_use_id ?? null;
      let idx = useId != null ? s.open.findIndex((x) => x.id === useId) : -1;
      // The Post of a step already closed (denied in the HUD, superseded) must not close another one.
      if (idx < 0 && useId != null && s.closed.some((x) => x.id === useId)) return;
      if (idx < 0) idx = s.open.findIndex((x) => x.tool === tool);
      if (idx < 0) return;
      const [st] = s.open.splice(idx, 1);
      st.endedAt = ev.at;
      if (e === 'PostToolUse') st.ok = true;
      else { st.ok = false; st.error = errorText(raw); }
      keep(s, st);
    }
  }

  function view(id) {
    const s = sessions.get(id);
    if (!s) return { task: null, taskAt: null, stepCount: 0, current: null, steps: [], open: [], helpers: [], lastEventAt: null, lastMessage: null };
    const open = s.open.slice();
    return {
      task: s.task, taskAt: s.taskAt, stepCount: s.stepCount,
      current: open.length ? open.reduce((a, b) => (b.startedAt >= a.startedAt ? b : a)) : null,
      steps: s.closed.slice().reverse(),
      open,
      helpers: [...s.helpers.values()].map((h) => ({ ...h })),
      lastEventAt: s.lastEventAt, lastMessage: s.lastMessage,
    };
  }

  return { push, closeDenied, forget: (id) => { sessions.delete(id); }, view };
}
