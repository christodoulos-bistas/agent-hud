import path from 'node:path';

// Codex edits files with apply_patch; the patch text is in tool_input.command (Task 1 spike, APPLY_PATCH_FIELD).
const APPLY_PATCH_FIELD = 'command';
const PATCH_FILE = /^\*\*\* (?:Add|Update|Delete) File: (.+?)\s*$/;

// Paths a patch touches, in order, deduplicated. "*** Move to:" lines are ignored.
export function patchPaths(patchText) {
  const out = [];
  for (const line of String(patchText || '').split(/\r?\n/)) {
    const m = PATCH_FILE.exec(line);
    if (m && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

export function activityLine(ev) {
  const t = ev.toolName; const i = ev.toolInput || {};
  if (ev.event === 'UserPromptSubmit') return 'thinking';
  switch (t) {
    case 'Read': return `reading ${path.win32.basename(String(i.file_path || ''))}`;
    case 'Edit': case 'Write': return `editing ${path.win32.basename(String(i.file_path || ''))}`;
    case 'apply_patch': return `editing ${path.win32.basename(patchPaths(i[APPLY_PATCH_FIELD])[0] || '')}`;
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
    case 'apply_patch': {
      const files = patchPaths(i[APPLY_PATCH_FIELD]);
      return `Edited ${base(files[0])}${files.length > 1 ? ` +${files.length - 1}` : ''}`;
    }
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

const newCounts = () => ({ files: new Set(), commands: 0, failed: 0, helpers: 0, endedAt: null });

function duration(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

// One line for the "turn" stage: how long the task took and what it did. null without counters.
export function recapOf(recap, taskAt) {
  if (!recap) return null;
  const parts = [];
  if (recap.files) parts.push(`${recap.files} ${recap.files === 1 ? 'file' : 'files'} edited`);
  if (recap.commands) parts.push(`${recap.commands} ${recap.commands === 1 ? 'command' : 'commands'}${recap.failed > 0 ? ` (${recap.failed} failed)` : ''}`);
  if (recap.helpers) parts.push(`${recap.helpers} ${recap.helpers === 1 ? 'helper' : 'helpers'}`);
  const body = parts.length ? parts.join(' · ') : 'no tool steps';
  if (taskAt == null) return `Since the HUD started: ${body}`;
  if (recap.endedAt == null) return body;
  return `Done in ${duration(recap.endedAt - taskAt)} · ${body}`;
}

const DELEGATES = new Set(['Agent', 'Task']);

export function createStepLog({ cap = 20, supersedeMs = 10000 } = {}) {
  const sessions = new Map();
  const get = (id) => {
    let s = sessions.get(id);
    if (!s) { s = { task: null, taskAt: null, stepCount: 0, open: [], closed: [], helpers: new Map(), lastEventAt: null, lastMessage: null, counts: newCounts() }; sessions.set(id, s); }
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

    // Recap counters: counted for helpers too, before their early return.
    const cTool = ev.toolName ?? raw.tool_name ?? null;
    const cIn = ev.toolInput || raw.tool_input || {};
    if (e === 'PreToolUse') {
      if (cTool === 'Edit' || cTool === 'Write' || cTool === 'NotebookEdit') {
        const f = cIn.file_path || cIn.notebook_path;
        if (f) s.counts.files.add(f);
      } else if (cTool === 'apply_patch') {
        for (const f of patchPaths(cIn[APPLY_PATCH_FIELD])) s.counts.files.add(f);
      } else if (cTool === 'Bash' || cTool === 'PowerShell') s.counts.commands += 1;
    } else if (e === 'PostToolUseFailure' && (cTool === 'Bash' || cTool === 'PowerShell')) s.counts.failed += 1;
    else if (e === 'SubagentStart') s.counts.helpers += 1;
    else if (e === 'Stop' && agentId === null) s.counts.endedAt = ev.at;

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
      s.counts = newCounts();
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
    if (!s) return { task: null, taskAt: null, stepCount: 0, current: null, steps: [], open: [], helpers: [], lastEventAt: null, lastMessage: null, recap: { files: 0, commands: 0, failed: 0, helpers: 0, endedAt: null } };
    const open = s.open.slice();
    return {
      task: s.task, taskAt: s.taskAt, stepCount: s.stepCount,
      current: open.length ? open.reduce((a, b) => (b.startedAt >= a.startedAt ? b : a)) : null,
      steps: s.closed.slice().reverse(),
      open,
      helpers: [...s.helpers.values()].map((h) => ({ ...h })),
      lastEventAt: s.lastEventAt, lastMessage: s.lastMessage,
      recap: { ...s.counts, files: s.counts.files.size },
    };
  }

  return { push, closeDenied, forget: (id) => { sessions.delete(id); }, view };
}
