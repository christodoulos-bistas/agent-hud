// Spike 6: do clicks register in a focusable:false frameless always-on-top window,
// and does the foreground window stay unchanged?  Run: npx electron spikes/panel-focus.mjs
import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const W = 340, H = 200, X = 200, Y = 200 // DIP
const dir = mkdtempSync(join(tmpdir(), 'panel-focus-'))
const preload = join(dir, 'preload.cjs')
writeFileSync(preload, `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('spike',{click:()=>ipcRenderer.send('clicked')})`)
const html = `<body style="margin:0"><button id=b style="position:fixed;inset:0;font:24px sans-serif" onclick="spike.click()">Click</button></body>`

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: W, height: H, x: X, y: Y, frame: false, alwaysOnTop: true, focusable: false, skipTaskbar: true, show: false,
    webPreferences: { sandbox: true, contextIsolation: true, preload }
  })
  ipcMain.on('clicked', () => console.log(`CLICKED ${Date.now()}`))
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).then(() => {
    win.showInactive()
    const b = win.getBounds()
    const c = screen.dipToScreenPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 })
    console.log(`READY scale=${screen.getPrimaryDisplay().scaleFactor} bounds=${JSON.stringify(b)} centerPhysical=${Math.round(c.x)},${Math.round(c.y)}`)
  })
  setInterval(() => { if (BrowserWindow.getFocusedWindow() === win) console.log('FOCUSED') }, 200)
  setTimeout(() => app.quit(), 20000)
})
