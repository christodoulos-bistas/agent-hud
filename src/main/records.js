// The one-line chat records Agent HUD adds to a hook answer (systemMessage), and which sessions show them.
import { RECORD_HOSTS, PLAN_MODES } from './answers.js';

const MAX_RECORD = 160;
const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const cap = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
const capAll = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s); // total length stays <= n
const base = (p) => String(p ?? '').split(/[\\/]/).filter(Boolean).pop() ?? '';

function permissionWhat(payload) {
  const tool = squash(payload?.tool_name);
  const input = payload?.tool_input || {};
  if (tool === 'Bash' || tool === 'PowerShell') return squash(input.command) || tool;
  if (['Edit', 'Write', 'NotebookEdit', 'Read'].includes(tool)) {
    const name = base(input.file_path ?? input.notebook_path);
    return name ? `${tool} ${name}` : tool;
  }
  return tool || 'a tool';
}

const pickText = (v) => (Array.isArray(v) ? v.join(', ') : String(v));

// `modes`: whether a plan approve really sets the permission mode; without it the record names no mode.
export function recordText(item, response, { modes = PLAN_MODES } = {}) {
  const p = item?.payload || {};
  let body = null;
  switch (item?.kind) {
    case 'permission':
      if (response?.kind === 'allow') body = `${response.always ? 'Always allowed here' : 'Allowed'}: ${permissionWhat(p)}`;
      else if (response?.kind === 'deny') body = `Denied: ${permissionWhat(p)}`;
      break;
    case 'choice': {
      const picks = response?.picks;
      if (!picks || typeof picks !== 'object') break;
      const parts = (Array.isArray(p.tool_input?.questions) ? p.tool_input.questions : []).filter((q) => q?.question != null && q.question in picks).map((q) => `${squash(q.question)} → ${squash(pickText(picks[q.question]))}`);
      if (parts.length) body = `Answered: ${parts.join('; ')}`;
      break;
    }
    case 'plan':
      if (response?.approve === 'acceptEdits' || response?.approve === 'default') {
        if (!modes) body = 'Plan approved';
        else body = response.approve === 'acceptEdits' ? 'Plan approved (auto-accept edits)' : 'Plan approved (ask before edits)';
      }
      else if (response?.keep) {
        const f = cap(squash(response.feedback), 120);
        body = f ? `Keep planning: ${f}` : 'Keep planning';
      }
      break;
    case 'reply': {
      const t = cap(squash(response?.text), 80);
      if (t) body = `You replied: ${t}`;
      break;
    }
    default: break;
  }
  return body ? capAll(`Agent HUD · ${body}`, MAX_RECORD) : null;
}

export function recordAllowed(session, hosts = RECORD_HOSTS) {
  if (!session || typeof session !== 'object') return false;
  if (session.source === 'codex') return hosts.has('codex');
  return session.entrypoint ? hosts.has(session.entrypoint) : false;
}
