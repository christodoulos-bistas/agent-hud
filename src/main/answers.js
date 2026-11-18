// Encoders that turn HUD answers into the exact JSON a Claude Code hook response must contain.

export const RELEASE = null; // send 200 with an empty body

export function permissionAllow(updatedPermissions) {
  const decision = { behavior: 'allow' };
  if (updatedPermissions) decision.updatedPermissions = updatedPermissions;
  return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } };
}

export function permissionDeny(message = 'Denied from Agent HUD') {
  return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message } } };
}

// Multi-select answers are sent as a ", "-joined string (default format).
export function choiceAnswer(toolInput, picks) {
  const answers = {};
  for (const q of toolInput.questions ?? []) {
    if (!(q.question in picks)) continue;
    const pick = picks[q.question];
    answers[q.question] = Array.isArray(pick) ? pick.join(', ') : pick;
  }
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      updatedInput: { ...toolInput, answers },
    },
  };
}

export function stopReply(text) {
  return { decision: 'block', reason: text };
}

// PROVISIONAL (Task 2): flipped by the user after the hands-on check; see spikes/SPIKES.md "Decisions" (Spikes 12-13).
export const PLAN_EVENT = 'PermissionRequest'; // which hook event carries ExitPlanMode
export const PLAN_MODES = false; // whether an approve can set the session's permission mode
export const RECORD_HOSTS = new Set(); // hosts that show a hook's systemMessage in the chat

// A copy of `response` with a top-level systemMessage (a chat record); `response` itself when there is no text.
export function withRecord(response, text) {
  return typeof text === 'string' && text ? { ...response, systemMessage: text } : response;
}

const keepMessage = (feedback) => {
  const f = typeof feedback === 'string' ? feedback.trim() : '';
  return f ? `Keep planning: ${f}` : 'Keep planning';
};

export function planApprove(mode, { event = PLAN_EVENT, modes = PLAN_MODES } = {}) {
  if (event === 'PreToolUse') return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } };
  return permissionAllow(modes ? [{ type: 'setMode', mode, destination: 'session' }] : undefined);
}

export function planKeepPlanning(feedback, { event = PLAN_EVENT } = {}) {
  const message = keepMessage(feedback);
  if (event === 'PreToolUse') {
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: message } };
  }
  return permissionDeny(message);
}
