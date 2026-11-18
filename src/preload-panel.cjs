// Sandboxed preload (CommonJS: a sandboxed preload cannot be an ES module). Exposes window.panel.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('panel', {
  onDetail(fn) {
    if (typeof fn !== 'function') return undefined;
    const listener = (_e, detail) => fn(detail);
    ipcRenderer.on('detail', listener);
    return () => ipcRenderer.removeListener('detail', listener);
  },
  // The bubble stack: { cards, expanded, visible }.
  onStack(fn) {
    if (typeof fn !== 'function') return undefined;
    const listener = (_e, stack) => fn(stack);
    ipcRenderer.on('stack', listener);
    return () => ipcRenderer.removeListener('stack', listener);
  },
  onPlace(fn) {
    if (typeof fn !== 'function') return undefined;
    const listener = (_e, place) => fn(place);
    ipcRenderer.on('place', listener);
    return () => ipcRenderer.removeListener('place', listener);
  },
  // ✕ and "open window ↗" name the agent on show (the footer) or the card's own session (the card: the
  // release that goes with it may already have moved the selection back). No id: the selected agent's
  // window; a close without one is ignored.
  close: (id) => ipcRenderer.send('panel:close', id == null ? null : String(id)),
  openWindow: (sessionId) => ipcRenderer.send('panel:openWindow', sessionId == null ? null : String(sessionId)),
  // A plan card's "Read plan ↗" (by card id): main opens the plan file, or the chat if it can't.
  openPlan: (id) => ipcRenderer.send('panel:openPlan', String(id)),
  reportHeight: (px) => ipcRenderer.send('panel:reportHeight', Number(px)),
  // The answer card (cards.js): the same answers and releases as the HUD's v1 card.
  answer: (id, response) => ipcRenderer.send('panel:answer', String(id), response),
  release: (id) => ipcRenderer.send('panel:release', String(id)),
  setInteractive: (on) => ipcRenderer.send('panel:setInteractive', !!on),
  // The bubble stack: expand (or fold) a bubble, the pointer over one (null: off every bubble), hide it.
  expandCard: (id) => ipcRenderer.send('panel:expandCard', String(id)),
  hoverCard: (id) => ipcRenderer.send('panel:hoverCard', id == null ? null : String(id)),
  hideStack: () => ipcRenderer.send('panel:hideStack'),
});
