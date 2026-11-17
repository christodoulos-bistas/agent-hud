// Spike 7: after a non-focusable always-on-top window takes the focus for typing, which release
// hands the foreground back to the window the user came from?  Run: npx electron spikes/focus-giveback.mjs <variant>
//   blur  : setFocusable(false); blur()                      (v1.2's releaseFocusOf)
//   ontop : setAlwaysOnTop(false); setFocusable(false); blur(); setAlwaysOnTop(true)
//   hide  : hide(); setFocusable(false); showInactive()
// Prints the foreground window before, while focused, and after release (scripts/fg.ps1-style probe).
import { app, BrowserWindow } from 'electron'
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

//   idle-blur / idle-ontop : the same releases for a window made focusable that never took the focus
//                            (the user clicked back into their editor before the release)
//   ontop-hide : ontop, then hide() at once (the panel closing after the answer)
const variant = process.argv.find((a) => ['blur', 'ontop', 'hide', 'idle-blur', 'idle-ontop', 'ontop-hide'].includes(a)) || 'blur'
const idle = variant.startsWith('idle-')
const dir = mkdtempSync(join(tmpdir(), 'focus-giveback-'))
const probe = join(dir, 'fg.ps1')
writeFileSync(probe, `Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class Fg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
}
"@
$h = [Fg]::GetForegroundWindow(); $c = New-Object Text.StringBuilder 256; $t = New-Object Text.StringBuilder 256
[void][Fg]::GetClassName($h, $c, 256); [void][Fg]::GetWindowText($h, $t, 256)
"$h class=$($c.ToString()) title=$($t.ToString())"`)
const fg = () => execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', probe], { encoding: 'utf8' }).trim()
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  const before = fg()
  const win = new BrowserWindow({
    width: 300, height: 160, x: 240, y: 240, frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
    focusable: false, resizable: false, show: false, webPreferences: { sandbox: true, contextIsolation: true },
  })
  await win.loadURL('data:text/html,' + encodeURIComponent('<body style="margin:0;background:#1e1e2e;color:#fff;font:16px sans-serif">focus spike</body>'))
  win.showInactive()
  await wait(300)
  win.setFocusable(true); if (!idle) win.focus()
  await wait(500)
  const during = fg()
  if (variant === 'blur' || variant === 'idle-blur') { win.setFocusable(false); if (!idle) win.blur() }
  if (variant === 'ontop' || variant === 'idle-ontop') { win.setAlwaysOnTop(false); win.setFocusable(false); if (!idle) win.blur(); win.setAlwaysOnTop(true) }
  if (variant === 'hide') { win.hide(); win.setFocusable(false); win.showInactive() }
  if (variant === 'ontop-hide') { win.setAlwaysOnTop(false); win.setFocusable(false); win.blur(); win.setAlwaysOnTop(true); win.hide() }
  await wait(500)
  const after = fg()
  console.log(JSON.stringify({ variant, before, during, after, back: before.split(' ')[0] === after.split(' ')[0], onTop: win.isAlwaysOnTop(), visible: win.isVisible() }))
  app.quit()
})
