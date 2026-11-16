// Sandboxed preload (CommonJS: a sandboxed preload cannot be an ES module). Exposes window.panel.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('panel', {
  onDetail(fn) {
    if (typeof fn !== 'function') return undefined;
    const listener = (_e, detail) => fn(detail);
    ipcRenderer.on('detail', listener);
    return () => ipcRenderer.removeListener('detail', listener);
  },
  onPlace(fn) {
    if (typeof fn !== 'function') return undefined;
    const listener = (_e, place) => fn(place);
    ipcRenderer.on('place', listener);
    return () => ipcRenderer.removeListener('place', listener);
  },
  close: () => ipcRenderer.send('panel:close'),
  // No id: the selected agent's window. The answer card passes its own session (the release that goes
  // with it may already have moved the selection back).
  openWindow: (sessionId) => ipcRenderer.send('panel:openWindow', sessionId == null ? null : String(sessionId)),
  reportHeight: (px) => ipcRenderer.send('panel:reportHeight', Number(px)),
  // The answer card (cards.js): the same answers and releases as the HUD's v1 card.
  answer: (id, response) => ipcRenderer.send('panel:answer', String(id), response),
  release: (id) => ipcRenderer.send('panel:release', String(id)),
  setInteractive: (on) => ipcRenderer.send('panel:setInteractive', !!on),
});
