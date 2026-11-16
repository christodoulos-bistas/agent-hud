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
