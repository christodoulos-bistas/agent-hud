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

export function openCommandFor(session, { codeCmd } = {}) {
  const cwd = String(session?.cwd || '');
  if (session?.entrypoint === 'claude-vscode') return codeCmd && cwd ? { cmd: codeCmd, args: [cwd] } : null;
  if (session?.entrypoint === 'claude-desktop') return { cmd: 'powershell', args: ['-NoProfile', '-Command', APP_ACTIVATE_CLAUDE] };
  return null;
}

export const canOpen = (session, opts = {}) => !!session && openCommandFor(session, opts) !== null;
