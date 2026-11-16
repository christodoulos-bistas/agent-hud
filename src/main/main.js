// Agent HUD main process: the hook server, the session poll and the store, wired to an
// always-on-top window docked bottom-right and a tray menu.
import { app, BrowserWindow, Tray, Menu, ipcMain, screen, dialog, shell, nativeImage } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RELEASE } from './answers.js';
import { createClassEngine } from './classes.js';
import { createQueue } from './queue.js';
import { installHooks, uninstallHooks } from './settings-hooks.js';
import { createHookServer } from './hook-server.js';
import { readSessionFiles, listSessions } from './sessions.js';
import { createStore } from './store.js';
import { openCommandFor } from './focus.js';
import { encodeAnswer, placeBounds, anchorFrom, anchorPoint, snapBounds, isAnchor, panelBounds, panelTarget, createThrottle, createInteractiveCheck, loadConfig, saveConfig, settingsTarget, removeHooksCli } from './wiring.js';

const SRC = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const INDEX = path.join(SRC, 'renderer', 'index.html');
const PANEL = path.join(SRC, 'renderer', 'panel.html');
const PANEL_WIDTH = 340;
const STAGE_TICK_MS = 1000;
const HOLD_MS = 60000;
const REPLY_MS = 540000;
const POLL_MS = 3000;
const PUSH_MS = 100;
const WIDTH = 272;
const COLLAPSED_WIDTH = 72;
const QUIT_GRACE_MS = 3000;
const RELOAD_MS = 1000;
const SESSIONS_DIR = path.join(os.homedir(), '.claude', 'sessions');
// Dev override (R20): AGENT_HUD_SETTINGS_PATH points install/uninstall at a scratch file. A dev build
// without it never touches the user's settings (I1): no first-run offer, install/remove refuse.
const TARGET = settingsTarget({ isPackaged: app.isPackaged, envPath: process.env.AGENT_HUD_SETTINGS_PATH, home: os.homedir() });
const SETTINGS_PATH = TARGET.path;
const SKIP_FIRST_RUN = process.argv.includes('--no-first-run') || process.env.AGENT_HUD_NO_FIRST_RUN === '1';
const DEBUG = process.env.AGENT_HUD_DEBUG === '1';

const log = (...a) => console.error('[agent-hud]', ...a);
const debug = (...a) => { if (DEBUG) console.log('[agent-hud]', ...a); };

let win = null;
let tray = null;
let server = null;
let cfg = null;
let configFile = null;
let sessions = [];
let collapsed = false;
let contentHeight = 120;
let quitting = null;
// The detail panel: main owns which agent is selected ({ id, rowY }: rowY is the row's centre in px
// from the HUD's top), and creates the panel window the first time one is.
let selected = null;
let panelWin = null;
let panelHeight = 200; // until the panel reports its content height
let sentDetail; // JSON of the last detail sent, so an unchanged one doesn't re-render the panel
let place = null; // { side, arrowY } of the last placement, for the panel's arrow
let sentPlace; // JSON of the last place sent

const queue = createQueue({ holdMs: HOLD_MS, replyMs: REPLY_MS, onError: log });
const engine = createClassEngine();
const store = createStore({ engine, queue, holdMs: HOLD_MS, replyMs: REPLY_MS });

// ---------------------------------------------------------------- snapshot

const hudState = () => ({ collapsed, visible: !!win && !win.isDestroyed() && win.isVisible() });

// Every snapshot push also re-places the panel and refreshes its detail (spec 6.3: the same throttle).
function pushNow() {
  if (!win || win.isDestroyed()) return;
  const snap = store.snapshot();
  // Its agent left the list, or the HUD was hidden or collapsed: the panel closes.
  if (selected && !panelTarget(selected.id, snap, hudState())) selected = null;
  try { win.webContents.send('snapshot', { ...snap, collapsed, selected: selected?.id ?? null }); } catch (err) { log('push', err); }
  placePanel(snap);
  pushDetail();
}
const push = createThrottle(pushNow, PUSH_MS);
queue.onChange(push);

function pushDetailNow() {
  if (!panelWin || panelWin.isDestroyed()) return;
  const d = selected ? store.detail(selected.id) : null; // null empties a hidden panel
  const json = JSON.stringify(d);
  if (json === sentDetail) return;
  try { panelWin.webContents.send('detail', d); sentDetail = json; } catch (err) { log('detail', err); }
}
const pushDetail = createThrottle(pushDetailNow, PUSH_MS);

// Where the panel's arrow goes: sent on `place` whenever the side or the row's height changes.
function sendPlace() {
  if (!panelWin || panelWin.isDestroyed() || !place) return;
  const json = JSON.stringify(place);
  if (json === sentPlace) return;
  try { panelWin.webContents.send('place', place); sentPlace = json; } catch (err) { log('place', err); }
}

// The 1 s stage tick: stages and stuck hints move on with the clock alone (thinking -> silent, a long
// step), so push when any agent's stage or stuck flag changed. The renderers tick their own clocks.
let lastStageKey = null;
function stageTick() {
  const k = store.stageKey();
  if (k === lastStageKey) return;
  lastStageKey = k;
  push();
  pushDetail();
}

// ---------------------------------------------------------------- sessions

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}
const isInteractive = createInteractiveCheck({ current: () => sessions, reread: () => readSessionFiles(SESSIONS_DIR) });

let polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  try {
    sessions = await listSessions({ dir: SESSIONS_DIR, isAlive });
    store.setSessions(sessions);
    push();
  } catch (err) { log('poll', err); } finally { polling = false; }
}

function sessionById(id) {
  return sessions.find((s) => s.sessionId === id) ?? readSessionFiles(SESSIONS_DIR).find((s) => s.sessionId === id) ?? null;
}

// ---------------------------------------------------------------- window

// The HUD sits where the user dragged it (cfg.position, an anchor saved on 'moved'), or bottom-right
// of the primary display until they do. Every size change re-docks against that anchor.
function workArea() {
  const a = cfg?.position;
  return isAnchor(a) ? screen.getDisplayNearestPoint(anchorPoint(a)).workArea : screen.getPrimaryDisplay().workArea;
}

let docking = false;
function dock() {
  if (!win || win.isDestroyed()) return;
  const b = placeBounds(workArea(), collapsed ? COLLAPSED_WIDTH : WIDTH, contentHeight, cfg?.position);
  docking = true;
  try { win.setBounds(b); } finally { docking = false; }
  debug('dock', JSON.stringify(b));
  placePanel();
}

// 'moved' fires once when the user lets go of a drag (by the header bar, -webkit-app-region: drag).
function rememberPosition() {
  if (docking || !win || win.isDestroyed()) return;
  const dropped = win.getBounds();
  const wa = screen.getDisplayMatching(dropped).workArea;
  cfg.position = anchorFrom(snapBounds(dropped, wa), wa); // near an edge or corner: snap into line
  try { saveConfig(configFile, cfg); } catch (err) { log('config', err); }
  dock(); // pulls it back inside the work area if it was dropped partly off-screen
  refreshMenu();
}

function resetPosition() {
  delete cfg.position;
  try { saveConfig(configFile, cfg); } catch (err) { log('config', err); }
  dock();
  refreshMenu();
}

function showWindow() {
  if (!win || win.isDestroyed()) return;
  dock();
  win.showInactive();
  placePanel();
  refreshMenu();
}
// A hidden HUD can't be answered: let every held question go back to its own window (a release, not a
// hand-back), and hold nothing new until it is shown again (canHold). Its panel closes with it.
function hideWindow() {
  if (!win || win.isDestroyed()) return;
  win.hide();
  queue.releaseAll();
  placePanel();
  push();
  refreshMenu();
}
function toggleWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isVisible()) hideWindow(); else showWindow();
}

// The hook server holds a question only while someone can answer it (I5).
let rendererAlive = false;
const canHold = () => !!win && !win.isDestroyed() && win.isVisible() && rendererAlive && !win.webContents.isCrashed();

// Non-focusable again, and if the HUD held the focus give it back (blur activates the window
// underneath); a HUD that never had the focus is not blurred, so nothing else gets activated.
function releaseFocus() {
  if (!win || win.isDestroyed()) return;
  const had = win.isFocused();
  win.setFocusable(false);
  if (had) win.blur();
}

function setInteractive(on) {
  if (!win || win.isDestroyed()) return;
  if (on) { win.setFocusable(true); win.focus(); } else releaseFocus();
}

function setCollapsed(on) {
  collapsed = !!on;
  releaseFocus();
  dock();
  push();
  refreshMenu();
}

function createWindow() {
  win = new BrowserWindow({
    width: WIDTH, height: contentHeight, frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
    focusable: false, resizable: false, show: false,
    webPreferences: { preload: path.join(SRC, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const wc = win.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e) => e.preventDefault());
  wc.on('did-finish-load', () => { rendererAlive = true; pushNow(); });
  wc.on('console-message', consoleLog('renderer:'));
  wc.on('render-process-gone', (_e, details) => {
    log('renderer gone', details?.reason);
    rendererAlive = false;
    queue.releaseAll(); // nothing can answer them now
    if (quitting) return;
    setTimeout(() => {
      if (quitting || !win || win.isDestroyed()) return;
      win.loadFile(INDEX).catch((err) => log('reload', err));
    }, RELOAD_MS);
  });
  win.once('ready-to-show', showWindow);
  win.on('moved', rememberPosition);
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); hideWindow(); } });
  dock();
  win.loadFile(INDEX);
}

function consoleLog(tag) {
  return (e, lvl, msg) => {
    const level = e?.level ?? lvl;
    const message = e?.message ?? msg;
    if (DEBUG || level === 'error' || level === 3) log(tag, level, message);
  };
}

// ---------------------------------------------------------------- detail panel

// The panel: the HUD's window options (frameless, transparent, always on top, no taskbar button,
// never focusable: SPIKES.md spike 6, PANEL_CLICK_MODE = plain), and not movable, since it follows
// the HUD. Created the first time an agent is selected, then shown and hidden.
function panelWindow() {
  if (panelWin && !panelWin.isDestroyed()) return panelWin;
  sentDetail = undefined;
  sentPlace = undefined;
  panelWin = new BrowserWindow({
    width: PANEL_WIDTH, height: panelHeight, frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
    focusable: false, resizable: false, movable: false, show: false,
    webPreferences: { preload: path.join(SRC, 'preload-panel.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const pw = panelWin;
  const wc = pw.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e) => e.preventDefault());
  wc.on('did-finish-load', () => { // anything sent while loading was lost
    sentDetail = undefined;
    sentPlace = undefined;
    pushDetailNow();
    sendPlace();
  });
  wc.on('console-message', consoleLog('panel:'));
  wc.on('render-process-gone', (_e, details) => {
    log('panel renderer gone', details?.reason);
    if (quitting) return;
    setTimeout(() => {
      if (quitting || pw.isDestroyed()) return;
      pw.loadFile(PANEL).catch((err) => log('panel reload', err));
    }, RELOAD_MS);
  });
  pw.on('close', (e) => { if (!quitting) { e.preventDefault(); select(null); } });
  pw.on('closed', () => { if (panelWin === pw) panelWin = null; });
  pw.loadFile(PANEL).catch((err) => log('panel load', err));
  return pw;
}

// Beside the HUD at the selected row while there is something to show (panelTarget), hidden otherwise.
function placePanel(snap) {
  const id = selected && !quitting ? panelTarget(selected.id, snap ?? store.snapshot(), hudState()) : null;
  if (!id) {
    if (panelWin && !panelWin.isDestroyed() && panelWin.isVisible()) panelWin.hide();
    return;
  }
  const pw = panelWindow();
  const b = panelBounds(win.getBounds(), workArea(), { width: PANEL_WIDTH, height: panelHeight, rowY: selected.rowY });
  pw.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
  place = { side: b.side, arrowY: b.arrowY };
  sendPlace();
  if (!pw.isVisible()) pw.showInactive();
}

// A new selection (or none): the HUD highlights the row, the panel moves and gets the agent's detail.
function select(next) {
  selected = next;
  placePanel();
  pushNow();
  pushDetail();
}

// ---------------------------------------------------------------- opening a session's window

function spawnQuiet(cmd, args, fallback) {
  let fellBack = false;
  const fall = (why) => { if (fellBack) return; fellBack = true; debug('open fallback', cmd, why); fallback?.(); };
  let child;
  try {
    if (process.platform === 'win32' && cmd === 'code') {
      // `code` is a .cmd shim: run it through cmd.exe, every argument quoted.
      const line = [cmd, ...args].map((a) => `"${String(a).replace(/"/g, '')}"`).join(' ');
      child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], { windowsVerbatimArguments: true, windowsHide: true, stdio: 'ignore' });
    } else {
      child = spawn(cmd, args, { windowsHide: true, stdio: 'ignore' });
    }
  } catch (err) { log('open', err); return fall('spawn threw'); }
  child.on('error', (err) => { log('open', err.message); fall('error'); });
  child.on('exit', (code) => { if (code) fall(`exit ${code}`); });
}

function openWindow(sessionId) {
  const s = sessionById(sessionId);
  if (!s) return;
  const c = openCommandFor(s);
  const openFolder = () => { if (s.cwd) shell.openPath(s.cwd).then((err) => err && log('openPath', err)); };
  if (c.openPath !== undefined) return openFolder();
  spawnQuiet(c.cmd, c.args, openFolder);
}

// ---------------------------------------------------------------- IPC from the renderer

function fromHud(channel, handler) {
  ipcMain.on(channel, (e, ...args) => {
    if (!win || win.isDestroyed() || e.sender !== win.webContents) return;
    if (channel !== 'hud:reportHeight') debug('ipc', channel, JSON.stringify(args).slice(0, 200));
    try { handler(...args); } catch (err) { log('ipc', err); }
  });
}

fromHud('hud:answer', (id, response) => {
  const item = queue.list().find((i) => i.id === id);
  if (!item) return;
  // An answer that doesn't fit its card is handed back to the session's own window.
  const encoded = encodeAnswer(item, response);
  if (encoded && item.kind === 'reply') store.replySent(item.sessionId); // Claude carries on: not "finished"
  if (encoded && item.kind === 'permission' && response.kind === 'deny') store.permissionDenied(item); // R8a
  queue.answer(id, encoded ?? RELEASE);
});
fromHud('hud:release', (id) => queue.answer(id, RELEASE));
fromHud('hud:setReplyOptIn', (sessionId, on) => { store.setReplyOptIn(sessionId, !!on); push(); });
fromHud('hud:openWindow', (sessionId) => openWindow(sessionId));
fromHud('hud:setInteractive', (on) => setInteractive(!!on));
fromHud('hud:collapse', (on) => setCollapsed(on));
fromHud('hud:reportHeight', (px) => {
  const h = Number(px);
  if (!Number.isFinite(h) || h === contentHeight) return;
  contentHeight = h;
  dock();
});
// A click on a sprite or name toggles: the selected agent again closes the panel, another switches it.
fromHud('hud:selectAgent', (id, rowY) => {
  const sid = String(id);
  select(selected?.id === sid ? null : { id: sid, rowY: Number(rowY) });
});
// The selected row moved inside the HUD (rows above it came or went): the panel's arrow follows it.
fromHud('hud:rowOffset', (id, rowY) => {
  const y = Number(rowY);
  if (!selected || selected.id !== String(id) || !Number.isFinite(y)) return;
  selected.rowY = y;
  placePanel();
});

function fromPanel(channel, handler) {
  ipcMain.on(channel, (e, ...args) => {
    if (!panelWin || panelWin.isDestroyed() || e.sender !== panelWin.webContents) return;
    if (channel !== 'panel:reportHeight') debug('ipc', channel, JSON.stringify(args).slice(0, 200));
    try { handler(...args); } catch (err) { log('ipc', err); }
  });
}

fromPanel('panel:close', () => select(null));
fromPanel('panel:openWindow', () => { if (selected) openWindow(selected.id); });
fromPanel('panel:reportHeight', (px) => {
  const h = Number(px);
  // An emptied panel (no detail) reports 0: keep the last height for the next one.
  if (!Number.isFinite(h) || h <= 0 || h === panelHeight) return;
  panelHeight = h;
  placePanel();
});

// ---------------------------------------------------------------- tray

// A 16 px gold diamond on transparent, drawn in code (BGRA, premultiplied; opaque pixels only).
function trayIcon() {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.abs(x - c) + Math.abs(y - c);
      const rgb = d <= 5.5 ? [0xe0, 0xb4, 0x5c] : d <= 7 ? [0x18, 0x22, 0x1f] : null;
      if (!rgb) continue;
      const i = (y * size + x) * 4;
      buf[i] = rgb[2]; buf[i + 1] = rgb[1]; buf[i + 2] = rgb[0]; buf[i + 3] = 255;
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

function notify(title, content, error = false) {
  log(title, '-', content);
  try { tray?.displayBalloon({ title, content, iconType: error ? 'error' : 'info' }); } catch (err) { log('balloon', err); }
}

const loginOptions = () => (app.isPackaged ? {} : { path: process.execPath, args: [path.resolve(app.getAppPath())] });

function devBlocked() {
  if (!TARGET.blocked) return false;
  notify('Dev build: set AGENT_HUD_SETTINGS_PATH', 'Hooks were not changed. Start the dev build with "npm run dev", which points it at the spike settings file.', true);
  return true;
}

// The same question on first run and from the tray; the tray's default button is Cancel.
async function confirmInstall({ firstRun }) {
  const { response } = await dialog.showMessageBox({
    type: 'question', buttons: [firstRun ? 'Yes, add the hooks' : 'Add the hooks', firstRun ? 'No' : 'Cancel'],
    defaultId: firstRun ? 0 : 1, cancelId: 1, noLink: true,
    title: 'Agent HUD',
    message: 'Connect Agent HUD to Claude Code?',
    detail: `Agent HUD will add its hooks to this file:\n\n${SETTINGS_PATH}\n\n` +
      `The file is backed up first (to ${path.resolve(SETTINGS_PATH)}.agent-hud.bak; the very first original is also kept, once, as ` +
      `${path.resolve(SETTINGS_PATH)}.agent-hud.orig). Your other settings and hooks are left as they are. ` +
      'You can remove the hooks at any time from the tray menu.',
  });
  return response === 0;
}

function doInstall() {
  if (devBlocked()) return;
  const r = installHooks(SETTINGS_PATH, { port: cfg.port, secret: cfg.secret });
  if (!r.ok) notify('Could not install the hooks', `${SETTINGS_PATH}: ${r.error}`, true);
  else if (!r.changed) notify('Agent HUD hooks already installed', `${SETTINGS_PATH} was left as it is.`);
  else notify('Agent HUD hooks installed', `Added to ${SETTINGS_PATH}${r.backup ? `\nBackup: ${r.backup}` : ''}`);
}
async function installFromTray() {
  if (devBlocked()) return;
  try { if (await confirmInstall({ firstRun: false })) doInstall(); } catch (err) { log('install', err); }
}
function doUninstall() {
  if (devBlocked()) return;
  const r = uninstallHooks(SETTINGS_PATH);
  if (!r.ok) notify('Could not remove the hooks', `${SETTINGS_PATH}: ${r.error}`, true);
  else if (!r.changed) notify('No Agent HUD hooks to remove', `${SETTINGS_PATH} was left as it is.`);
  else notify('Agent HUD hooks removed', `Removed from ${SETTINGS_PATH}`);
}

function refreshMenu() {
  if (!tray || tray.isDestroyed()) return;
  const visible = !!win && !win.isDestroyed() && win.isVisible();
  let atLogin = false;
  try { atLogin = app.getLoginItemSettings(loginOptions()).openAtLogin; } catch (err) { log('login item', err); }
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: visible ? 'Hide' : 'Show', click: toggleWindow },
    { label: 'Collapse', type: 'checkbox', checked: collapsed, click: (mi) => setCollapsed(mi.checked) },
    { label: 'Move back to the corner', enabled: isAnchor(cfg?.position), click: resetPosition },
    { type: 'separator' },
    { label: 'Install hooks', click: installFromTray },
    { label: 'Remove hooks', click: doUninstall },
    { type: 'separator' },
    { label: 'Start with Windows', type: 'checkbox', checked: atLogin, click: (mi) => { app.setLoginItemSettings({ openAtLogin: mi.checked, ...loginOptions() }); refreshMenu(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => quit() },
  ]));
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('Agent HUD');
  tray.on('click', toggleWindow);
  refreshMenu();
}

// ---------------------------------------------------------------- server, first run, quit

async function startServer() {
  const srv = createHookServer({
    port: cfg.port, secret: cfg.secret, queue, isInteractive, shouldHold: canHold,
    replyOptIn: (id) => !!store.snapshot().agents.find((a) => a.id === id)?.replyOptIn,
    onEvent: (ev) => { store.onEvent(ev); push(); },
    onError: (err) => log('hook server', err?.message ?? err),
  });
  try {
    await srv.listen();
    server = srv;
    debug('listening on 127.0.0.1:' + cfg.port);
  } catch (err) {
    server = null;
    notify('Agent HUD is not listening', `127.0.0.1:${cfg.port}: ${err.code || err.message}. Hooks pass straight through until the HUD is restarted.`, true);
  }
}

async function firstRun() {
  if (cfg.offeredHooks || SKIP_FIRST_RUN || TARGET.blocked) return;
  const yes = await confirmInstall({ firstRun: true });
  cfg.offeredHooks = true;
  try { saveConfig(configFile, cfg); } catch (err) { log('config', err); }
  if (yes) doInstall();
}

function quit() {
  if (!quitting) {
    selected = null;
    try { if (panelWin && !panelWin.isDestroyed()) panelWin.destroy(); } catch (err) { log('panel', err); }
    panelWin = null;
    // close() releases every held question, so each waiting agent carries on in its own window.
    const closing = server ? server.close() : Promise.resolve();
    server = null;
    quitting = Promise.race([closing, new Promise((r) => setTimeout(r, QUIT_GRACE_MS))])
      .catch((err) => log('quit', err))
      .finally(() => {
        try { tray?.destroy(); } catch { /* exiting anyway */ }
        app.exit(0);
      });
  }
  return quitting;
}

async function start() {
  Menu.setApplicationMenu(null);
  configFile = path.join(app.getPath('userData'), 'config.json');
  cfg = loadConfig(configFile);
  debug('config', configFile, 'settings', SETTINGS_PATH);
  createTray();
  createWindow();
  for (const ev of ['display-metrics-changed', 'display-added', 'display-removed']) screen.on(ev, dock);
  await poll();
  setInterval(poll, POLL_MS);
  setInterval(stageTick, STAGE_TICK_MS);
  await startServer();
  await firstRun();
}

// A second launch shows the running HUD; `--quit` asks it to quit the normal way (holds released).
// `--remove-hooks` (run by the uninstaller, build/installer.nsh) takes the hooks out of the settings
// file and exits 0: no window, no server, no single-instance handshake.
const WANT_QUIT = process.argv.includes('--quit');
if (process.argv.includes('--remove-hooks')) {
  log('--remove-hooks:', removeHooksCli({ target: TARGET, uninstall: uninstallHooks }).message);
  app.exit(0);
} else if (!app.requestSingleInstanceLock({ quit: WANT_QUIT })) {
  app.quit();
} else if (WANT_QUIT) {
  app.quit(); // nothing running to quit; don't start one
} else {
  app.on('second-instance', (_e, argv, _cwd, data) => {
    if (data?.quit || argv.includes('--quit')) quit(); else showWindow();
  });
  app.on('window-all-closed', () => { /* the HUD lives in the tray */ });
  app.on('before-quit', (e) => { e.preventDefault(); quit(); });
  app.whenReady().then(start).catch((err) => { log('start', err); quit(); });
}
