// Sandboxed preload (CommonJS: a sandboxed preload cannot be an ES module). Exposes window.panel.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('panel', {
  onDetail(fn) {
    if (typeof fn !== 'function') return undefined;
    const listener = (_e, detail) => fn(detail);
    ipcRenderer.on('detail', listener);
    return () => ipcRenderer.removeListener('detail', listener);
  },
  close: () => ipcRenderer.send('panel:close'),
  openWindow: () => ipcRenderer.send('panel:openWindow'),
  reportHeight: (px) => ipcRenderer.send('panel:reportHeight', Number(px)),
});
