// Sandboxed preload (CommonJS: a sandboxed preload cannot be an ES module). Exposes window.hud.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hud', {
  onSnapshot(fn) {
    if (typeof fn !== 'function') return undefined;
    const listener = (_e, snap) => fn(snap);
    ipcRenderer.on('snapshot', listener);
    return () => ipcRenderer.removeListener('snapshot', listener);
  },
  answer: (id, response) => ipcRenderer.send('hud:answer', String(id), response),
  release: (id) => ipcRenderer.send('hud:release', String(id)),
  setReplyOptIn: (sessionId, on) => ipcRenderer.send('hud:setReplyOptIn', String(sessionId), !!on),
  openWindow: (sessionId) => ipcRenderer.send('hud:openWindow', String(sessionId)),
  setInteractive: (on) => ipcRenderer.send('hud:setInteractive', !!on),
  collapse: (on) => ipcRenderer.send('hud:collapse', !!on),
  reportHeight: (px) => ipcRenderer.send('hud:reportHeight', Number(px)),
});
