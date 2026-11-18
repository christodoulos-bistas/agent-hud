// Plan notices: a Claude chat's main thread waiting on "Accept this plan?". Nothing is held and nothing
// is answered (Spike 12: VS Code ignores every hook answer for ExitPlanMode); the HUD only says so, one
// notice per session, until Claude moves on. Pure: the store feeds it events and reads it back.

const isSynthetic = (raw) => String(raw.prompt ?? '').trim().startsWith('<task-notification>');

export function createPlanNotices() {
  let n = 0;
  const notices = new Map(); // sessionId -> { id, sessionId, plan, planFilePath, at }
  const copy = (x) => (x ? { ...x } : null);

  function onEvent(ev) {
    if (!ev || typeof ev !== 'object' || ev.source === 'codex') return; // Codex has no plan dialog
    const raw = ev.raw && typeof ev.raw === 'object' ? ev.raw : {};
    const sessionId = ev.sessionId;
    const e = ev.event;
    const tool = ev.toolName ?? raw.tool_name ?? null;
    const main = (raw.agent_id ?? null) === null; // subagents share the session id and carry agent_id

    if ((e === 'PreToolUse' || e === 'PermissionRequest') && tool === 'ExitPlanMode') {
      if (!main || sessionId == null) return;
      const input = (ev.toolInput && typeof ev.toolInput === 'object' ? ev.toolInput : raw.tool_input) || {};
      const old = notices.get(sessionId);
      notices.set(sessionId, {
        id: old ? old.id : `plan:${sessionId}:${++n}`, sessionId,
        plan: typeof input.plan === 'string' ? input.plan : '',
        planFilePath: typeof input.planFilePath === 'string' && input.planFilePath ? input.planFilePath : null,
        at: ev.at,
      });
      return;
    }
    if (!notices.has(sessionId)) return;
    // Claude moved on: the plan was accepted or rejected in the chat, or the turn or chat ended.
    const moved =
      ((e === 'PostToolUse' || e === 'PostToolUseFailure') && tool === 'ExitPlanMode' && main) ||
      (e === 'UserPromptSubmit' && !isSynthetic(raw)) ||
      e === 'Stop' || e === 'SessionEnd' ||
      (e === 'PreToolUse' && main);
    if (moved) notices.delete(sessionId);
  }

  return {
    onEvent,
    list: () => [...notices.values()].map(copy),
    get: (sessionId) => copy(notices.get(sessionId)),
    forget: (sessionId) => { notices.delete(sessionId); },
  };
}
