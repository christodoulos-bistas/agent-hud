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

// True when a VS Code window's title shows `folder` as its root name ("… - arsenal - Visual Studio Code", or
// "arsenal - Visual Studio Code" with no editor open). A worktree or subfolder of an open folder doesn't count:
// its link would land in a window that doesn't hold the chat and open a second copy of it.
export function vscodeHoldsFolder(titles, folder) {
  const base = path.win32.basename(String(folder || '').replace(/[\\/]+$/, '')).toLowerCase();
  if (!base) return false;
  const tail = ` - ${base} - visual studio code`;
  return (titles || []).some((t) => { const s = ` - ${String(t).toLowerCase()}`; return s.endsWith(tail); });
}

// PowerShell that prints the title of every visible top-level window owned by a Code.exe process.
// (The window list is gathered inside C#: output written from a PowerShell callback never reaches stdout.)
export const VSCODE_TITLES_PS = [
  'Add-Type @"',
  'using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;',
  'public static class W { delegate bool P(IntPtr h, IntPtr l);',
  '[DllImport("user32.dll")] static extern bool EnumWindows(P f, IntPtr l);',
  '[DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);',
  '[DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);',
  '[DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);',
  'public static List<string> Titles(int[] pids) { var ids = new HashSet<int>(pids); var r = new List<string>();',
  '  EnumWindows((h, l) => { if (IsWindowVisible(h)) { uint p; GetWindowThreadProcessId(h, out p);',
  '    if (ids.Contains((int)p)) { var s = new StringBuilder(512); GetWindowText(h, s, 512); if (s.Length > 0) r.Add(s.ToString()); } } return true; }, IntPtr.Zero);',
  '  return r; } }',
  '"@',
  '$ids = [int[]]@(Get-Process -Name Code -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })',
  '[W]::Titles($ids)',
].join('\n');

// Runs "open window" for one chat with injected effects (main passes the real ones; tests pass fakes).
// Only one open is pending at a time: a new click cancels the previous one before its link goes out.
// Results: 'none' | 'app' | 'window-only' | 'window-failed' | 'cancelled' | 'link' | 'fallback'.
export function createChatOpener({ commandFor, linkFor, spawnQuiet, windowTitles, openExternal, setTimer = setTimeout, clearTimer = clearTimeout, log = () => {} }) {
  let pending = null;
  return async function open(session, opts) {
    if (pending) { pending.cancel(); pending = null; }
    const c = session ? commandFor(session, opts) : null;
    if (!c) return 'none';
    const link = linkFor(session, opts);
    if (!link) { spawnQuiet(c.cmd, c.args); return 'app'; }
    let cancelled = false; let timer = null; let wake = () => {};
    const me = { cancel() { cancelled = true; if (timer) clearTimer(timer); wake(); } };
    pending = me;
    const finish = (result) => { if (pending === me) pending = null; return result; };
    if (link.first) {
      let held = false;
      try { held = vscodeHoldsFolder(await windowTitles(), session.cwd); } catch (err) { log('open titles', err?.message ?? err); }
      if (cancelled) return 'cancelled';
      if (!held) { spawnQuiet(c.cmd, c.args); return finish('window-only'); }
      const ok = await spawnQuiet(link.first.cmd, link.first.args);
      if (cancelled) return 'cancelled';
      if (!ok) { log('open', 'window step failed; chat link not sent'); return finish('window-failed'); }
    }
    await new Promise((resolve) => { wake = resolve; timer = setTimer(resolve, link.waitMs ?? 0); });
    if (cancelled) return 'cancelled';
    finish();
    try { await openExternal(link.url); return 'link'; } catch (err) {
      log('open link', err?.message ?? err);
      if (!link.first) spawnQuiet(c.cmd, c.args);
      return 'fallback';
    }
  };
}

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
