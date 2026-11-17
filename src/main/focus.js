// How to bring a session's own window forward. Pure: main.js runs the result. There is no folder
// fallback: a session we can't focus has no "open window" button at all.
import path from 'node:path';

const APP_ACTIVATE_CLAUDE = "(New-Object -ComObject WScript.Shell).AppActivate('Claude')";

// VS Code's `code.cmd` finds Code.exe through `%~dp0`, which only works when the script is started by
// its full path; started as a bare `code` through cmd.exe it looks next to the current directory,
// fails with 9009, and the old fallback opened an Explorer folder instead. So resolve the full path.
export function resolveCodeCmd({ pathEnv, localAppData, exists }) {
  for (const dir of String(pathEnv || '').split(';')) {
    if (!dir.trim()) continue;
    const p = path.win32.join(dir.trim(), 'code.cmd');
    if (exists(p)) return p;
  }
  if (localAppData) {
    const p = path.win32.join(localAppData, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd');
    if (exists(p)) return p;
  }
  return null;
}

// The Codex desktop app is a Store package: explorer.exe activates it by AppUserModelID, restoring it when
// hidden. (explorer.exe exits 1 even on success.)
export const CODEX_ACTIVATE = { cmd: 'explorer.exe', args: ['shell:AppsFolder\\OpenAI.Codex_2p2nqsd0c76g0!App'] };

export function openCommandFor(session, { codeCmd, codexActivate } = {}) {
  const cwd = String(session?.cwd || '');
  if (session?.entrypoint === 'codex') {
    if (session.host === 'desktop') return codexActivate || null;
    if (session.host === 'vscode') return codeCmd && cwd ? { cmd: codeCmd, args: [cwd] } : null;
    return null;
  }
  if (session?.entrypoint === 'claude-vscode') return codeCmd && cwd ? { cmd: codeCmd, args: [cwd] } : null;
  if (session?.entrypoint === 'claude-desktop') return { cmd: 'powershell', args: ['-NoProfile', '-Command', APP_ACTIVATE_CLAUDE] };
  return null;
}

export const canOpen = (session, opts = {}) => !!session && openCommandFor(session, opts) !== null;

// The chat itself, not just its app: each app's own chat link (tested 17 Nov for the Claude and Codex apps).
// A VS Code link goes to the window used last, and a window that doesn't hold the chat opens a second copy
// of it, so the chat's own window comes forward first (code.cmd <cwd>) and the link follows after a wait.
// Only a real session id (a UUID) goes into a link; anything else gets null and today's behaviour.
export const VSCODE_LINK_WAIT_MS = 1500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function chatLinkFor(session, { codeCmd } = {}) {
  const id = String(session?.sessionId ?? '');
  if (!UUID.test(id)) return null;
  const sid = encodeURIComponent(id);
  if (session.entrypoint === 'claude-desktop') return { url: `claude://code/continue?session=${sid}` };
  if (session.entrypoint === 'codex') return session.host === 'desktop' ? { url: `codex://threads/${sid}` } : null;
  if (session.entrypoint === 'claude-vscode') {
    const cwd = String(session.cwd || '');
    if (!codeCmd || !cwd) return null;
    return { first: { cmd: codeCmd, args: [cwd] }, waitMs: VSCODE_LINK_WAIT_MS, url: `vscode://anthropic.claude-code/open?session=${sid}` };
  }
  return null;
}
