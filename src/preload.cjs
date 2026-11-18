// Sandboxed preload (CommonJS: a sandboxed preload cannot be an ES module). Exposes window.hud.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hud', {
  onSnapshot(fn) {
    if (typeof fn !== 'function') return undefined;
    const listener = (_e, snap) => fn(snap);
    ipcRenderer.on('snapshot', listener);
    return () => ipcRenderer.removeListener('snapshot', listener);
  },
  onSoundFile(fn) {
    if (typeof fn !== 'function') return undefined;
    const listener = (_e, cue, file) => fn(cue, file);
    ipcRenderer.on('sound-file', listener);
    return () => ipcRenderer.removeListener('sound-file', listener);
  },
  setReplyOptIn: (sessionId, on) => ipcRenderer.send('hud:setReplyOptIn', String(sessionId), !!on),
  openWindow: (sessionId) => ipcRenderer.send('hud:openWindow', String(sessionId)),
  selectAgent: (sessionId, rowY) => ipcRenderer.send('hud:selectAgent', String(sessionId), Number(rowY)),
  rowOffset: (sessionId, rowY) => ipcRenderer.send('hud:rowOffset', String(sessionId), Number(rowY)),
  setInteractive: (on) => ipcRenderer.send('hud:setInteractive', !!on),
  collapse: (on) => ipcRenderer.send('hud:collapse', !!on),
  hideAgent: (sessionId) => ipcRenderer.send('hud:hideAgent', String(sessionId)),
  showTucked: (on) => ipcRenderer.send('hud:showTucked', !!on),
  reportHeight: (px) => ipcRenderer.send('hud:reportHeight', Number(px)),
  showStack: () => ipcRenderer.send('hud:showStack'),
  setMuted: (on) => ipcRenderer.send('hud:setMuted', !!on),
});
