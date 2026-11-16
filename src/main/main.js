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
import { encodeAnswer, dockBounds, createThrottle, createInteractiveCheck, loadConfig, saveConfig } from './wiring.js';

const SRC = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HOLD_MS = 60000;
const REPLY_MS = 540000;
const POLL_MS = 3000;
const PUSH_MS = 100;
const WIDTH = 272;
const COLLAPSED_WIDTH = 72;
const QUIT_GRACE_MS = 3000;
const SESSIONS_DIR = path.join(os.homedir(), '.claude', 'sessions');
// Dev override (R20): point install/uninstall at a scratch file instead of the user's settings.
const SETTINGS_PATH = process.env.AGENT_HUD_SETTINGS_PATH || path.join(os.homedir(), '.claude', 'settings.json');
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

const queue = createQueue({ holdMs: HOLD_MS, replyMs: REPLY_MS, onError: log });
const engine = createClassEngine();
const store = createStore({ engine, queue, holdMs: HOLD_MS, replyMs: REPLY_MS });

// ---------------------------------------------------------------- snapshot

function pushNow() {
  if (!win || win.isDestroyed()) return;
  try { win.webContents.send('snapshot', { ...store.snapshot(), collapsed }); } catch (err) { log('push', err); }
}
const push = createThrottle(pushNow, PUSH_MS);
queue.onChange(push);

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

function dock() {
  if (!win || win.isDestroyed()) return;
  const b = dockBounds(screen.getPrimaryDisplay().workArea, collapsed ? COLLAPSED_WIDTH : WIDTH, contentHeight);
  win.setBounds(b);
  debug('dock', JSON.stringify(b));
}

function showWindow() {
  if (!win || win.isDestroyed()) return;
  dock();
  win.showInactive();
  refreshMenu();
}
function toggleWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isVisible()) { win.hide(); refreshMenu(); } else showWindow();
}

function setInteractive(on) {
  if (!win || win.isDestroyed()) return;
  if (on) { win.setFocusable(true); win.focus(); } else win.setFocusable(false);
}

function setCollapsed(on) {
  collapsed = !!on;
  if (win && !win.isDestroyed()) win.setFocusable(false);
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
  wc.on('did-finish-load', pushNow);
  wc.on('console-message', (e, lvl, msg) => {
    const level = e?.level ?? lvl;
    const message = e?.message ?? msg;
    if (DEBUG || level === 'error' || level === 3) log('renderer:', level, message);
  });
  wc.on('render-process-gone', (_e, details) => log('renderer gone', details?.reason));
  win.once('ready-to-show', showWindow);
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); refreshMenu(); } });
  dock();
  win.loadFile(path.join(SRC, 'renderer', 'index.html'));
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
  queue.answer(id, encodeAnswer(item, response) ?? RELEASE);
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

function doInstall() {
  const r = installHooks(SETTINGS_PATH, { port: cfg.port, secret: cfg.secret });
  if (r.ok) notify('Agent HUD hooks installed', `Added to ${SETTINGS_PATH}${r.backup ? `\nBackup: ${r.backup}` : ''}`);
  else notify('Could not install the hooks', `${SETTINGS_PATH}: ${r.error}`, true);
}
function doUninstall() {
  const r = uninstallHooks(SETTINGS_PATH);
  if (r.ok) notify('Agent HUD hooks removed', `Removed from ${SETTINGS_PATH}`);
  else notify('Could not remove the hooks', `${SETTINGS_PATH}: ${r.error}`, true);
}

function refreshMenu() {
  if (!tray || tray.isDestroyed()) return;
  const visible = !!win && !win.isDestroyed() && win.isVisible();
  let atLogin = false;
  try { atLogin = app.getLoginItemSettings(loginOptions()).openAtLogin; } catch (err) { log('login item', err); }
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: visible ? 'Hide' : 'Show', click: toggleWindow },
    { label: 'Collapse', type: 'checkbox', checked: collapsed, click: (mi) => setCollapsed(mi.checked) },
    { type: 'separator' },
    { label: 'Install hooks', click: doInstall },
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
    port: cfg.port, secret: cfg.secret, queue, isInteractive,
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
  if (cfg.offeredHooks || SKIP_FIRST_RUN) return;
  const { response } = await dialog.showMessageBox({
    type: 'question', buttons: ['Yes, add the hooks', 'No'], defaultId: 0, cancelId: 1, noLink: true,
    title: 'Agent HUD',
    message: 'Connect Agent HUD to Claude Code?',
    detail: `Agent HUD will add its hooks to this file:\n\n${SETTINGS_PATH}\n\n` +
      `The file is backed up first (to ${path.resolve(SETTINGS_PATH)}.agent-hud.bak). Your other settings and hooks are left as they are. ` +
      'You can remove the hooks at any time from the tray menu.',
  });
  cfg.offeredHooks = true;
  try { saveConfig(configFile, cfg); } catch (err) { log('config', err); }
  if (response === 0) doInstall();
}

function quit() {
  if (!quitting) {
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
  await startServer();
  await firstRun();
}

// A second launch shows the running HUD; `--quit` asks it to quit the normal way (holds released).
const WANT_QUIT = process.argv.includes('--quit');
if (!app.requestSingleInstanceLock({ quit: WANT_QUIT })) {
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
