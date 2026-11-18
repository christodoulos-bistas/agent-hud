// Spike 10/11: audio from an inactive window, hover in a non-focusable window.
// Run: env -u ELECTRON_RUN_AS_NODE npx electron spikes/audio-hover.mjs
import { app, BrowserWindow } from 'electron'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'hud-spike-'))
const CSP = "default-src 'self'; media-src blob:"
const page = (js) =>
  `<!doctype html><meta http-equiv="Content-Security-Policy" content="${CSP}"><link rel="stylesheet" href="s.css"><body><div id="box"></div><script src="${js}"></script>`

writeFileSync(join(dir, 'a.js'), `
const log = (m) => console.log('[A] ' + m)
setTimeout(async () => {
  try {
    const ctx = new AudioContext()
    log('AudioContext.state initial=' + ctx.state)
    await ctx.resume()
    log('AudioContext.state after resume=' + ctx.state)
    const t0 = ctx.currentTime
    ;[[660, 0], [880, 0.12]].forEach(([f, d]) => {
      const o = ctx.createOscillator(), g = ctx.createGain()
      o.frequency.value = f; g.gain.value = 0.15
      o.connect(g).connect(ctx.destination)
      o.start(t0 + d); o.stop(t0 + d + 0.12)
    })
    log('chime scheduled without error, state=' + ctx.state)
  } catch (e) { log('chime ERROR ' + e) }
  try {
    const sr = 8000, n = Math.floor(sr * 0.3), buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf)
    const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true)
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true)
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true)
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(2 * Math.PI * 600 * i / sr) * 8000, true)
    const url = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }))
    const a = new Audio(url)
    a.addEventListener('ended', () => log('audio ended event'))
    await a.play()
    log('audio.play() promise RESOLVED, paused=' + a.paused)
  } catch (e) { log('audio.play() REJECTED ' + e) }
}, 3000)
`)
writeFileSync(join(dir, 'b.js'), `
const box = document.getElementById('box')
box.addEventListener('pointerenter', () => console.log('[B] pointerenter'))
box.addEventListener('pointerleave', () => console.log('[B] pointerleave'))
box.addEventListener('mouseenter', () => console.log('[B] mouseenter'))
console.log('[B] ready')
`)
writeFileSync(join(dir, 's.css'), 'body{margin:0;background:#222}#box{width:200px;height:100px;background:#468}')
writeFileSync(join(dir, 'a.html'), page('a.js'))
writeFileSync(join(dir, 'b.html'), page('b.js'))

function mk(file, x, extra = {}) {
  const w = new BrowserWindow({
    width: 220, height: 120, x, y: 200, show: false, frame: false, transparent: true,
    alwaysOnTop: true, skipTaskbar: true, ...extra,
    webPreferences: { sandbox: true, autoplayPolicy: 'no-user-gesture-required' },
  })
  w.webContents.on('console-message', (e, level, message) => {
    console.log('console:', typeof level === 'object' ? e.message ?? message : message)
  })
  w.loadFile(join(dir, file))
  return w
}

app.whenReady().then(async () => {
  const a = mk('a.html', 100)
  const b = mk('b.html', 400, { focusable: false })
  await Promise.all([
    new Promise((r) => a.webContents.once('did-finish-load', r)),
    new Promise((r) => b.webContents.once('did-finish-load', r)),
  ])
  a.showInactive(); b.showInactive()
  console.log('main: focusable A=%s B=%s; focused A=%s B=%s', a.isFocusable(), b.isFocusable(), a.isFocused(), b.isFocused())
  setTimeout(() => {
    console.log('main: sending synthetic mouseMove into B')
    b.webContents.sendInputEvent({ type: 'mouseMove', x: 10, y: 10 })
    b.webContents.sendInputEvent({ type: 'mouseMove', x: 50, y: 50 })
    setTimeout(() => b.webContents.sendInputEvent({ type: 'mouseMove', x: 215, y: 115 }), 300)
  }, 1000)
  setTimeout(() => {
    console.log('main: after run focused A=%s B=%s', a.isFocused(), b.isFocused())
    app.quit()
  }, 8000)
})
setTimeout(() => app.quit(), 14000)
