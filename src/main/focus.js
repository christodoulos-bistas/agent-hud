// How to bring a session's own window forward. Pure: main.js runs the result.

export function openCommandFor(session) {
  const cwd = String(session?.cwd || '');
  if (session?.entrypoint === 'claude-vscode') return { cmd: 'code', args: [cwd] };
  if (session?.entrypoint === 'claude-desktop') {
    return { cmd: 'powershell', args: ['-NoProfile', '-Command', "(New-Object -ComObject WScript.Shell).AppActivate('Claude')"] };
  }
  return { openPath: cwd };
}
