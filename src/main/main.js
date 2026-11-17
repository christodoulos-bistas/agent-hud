// Agent HUD main process: the hook server, the session poll and the store, wired to an
// always-on-top window docked bottom-right and a tray menu.
import { app, BrowserWindow, Tray, Menu, ipcMain, screen, dialog, nativeImage, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RELEASE } from './answers.js';
import { createClassEngine } from './classes.js';
import { createQueue } from './queue.js';
import { isDeepStrictEqual } from 'node:util';
import { installHooks, uninstallHooks, unmergeHooks } from './settings-hooks.js';
import { codexHookCommand, installCodexHooksFile, removeCodexHooksFile, ourPositions } from './codex-hooks.js';
import { findCodexExe, trustCodexHooks } from './codex-trust.js';
import { createHookServer } from './hook-server.js';
import { readSessionFiles, listSessions } from './sessions.js';
import { createCodexSessions, readRolloutMeta } from './codex-sessions.js';
import { createStore } from './store.js';
import { openCommandFor, resolveCodeCmd, canOpen, CODEX_ACTIVATE, chatLinkFor, createChatOpener, VSCODE_TITLES_PS } from './focus.js';
import { encodeAnswer, placeBounds, anchorFrom, anchorPoint, snapBounds, isAnchor, panelBounds, panelTarget, autoSelect, userSelect, createThrottle, createInteractiveCheck, loadConfig, saveConfig, settingsTarget, codexTarget, codexOfferDue, codexTrustDue, codexStatus, codexStatusLabel, removeHooksCli, guarded, releaseFocusOf, closeApplies, hudCard } from './wiring.js';

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
// Codex (design 7.2): packaged -> ~/.codex/hooks.json when ~/.codex exists. A dev build never targets it
// (spike 9: Codex does not load project-layer hooks in an untrusted folder), so `npm run dev` installs
// nothing into Codex; AGENT_HUD_CODEX_HOOKS_PATH exists for tests and manual use only.
const CODEX = codexTarget({ isPackaged: app.isPackaged, envPath: process.env.AGENT_HUD_CODEX_HOOKS_PATH, home: os.homedir(), exists: fs.existsSync });
const CODEX_PATH = CODEX.path;
// Dev (only reachable with AGENT_HUD_CODEX_HOOKS_PATH set): node runs the repo's bridge directly; SRC is <repo>/src.
const CODEX_COMMAND = app.isPackaged ? codexHookCommand(process.resourcesPath) : `node "${path.join(path.dirname(SRC), 'resources', 'codex-bridge.cjs')}"`;
const CODEX_APPROVE_BALLOON = 'Codex: open Settings → Hooks and click Trust on the Agent HUD hooks (in the Codex terminal: /hooks).';
const CODEX_TRUSTED_BODY = 'Start a new Codex chat to use them.'; // provisional until a live test
const SKIP_FIRST_RUN = process.argv.includes('--no-first-run') || process.env.AGENT_HUD_NO_FIRST_RUN === '1';
const DEBUG = process.env.AGENT_HUD_DEBUG === '1';

const log = (...a) => console.error('[agent-hud]', ...a);
const debug = (...a) => { if (DEBUG) console.log('[agent-hud]', ...a); };

// I4: an error that escapes must never reach Electron's default error box, which blocks the main
// process and with it every hooked session waiting on its hooks. Log it and carry on.
process.on('uncaughtException', (err) => { try { log('uncaught', err); } catch { /* nothing left to do */ } });
process.on('unhandledRejection', (err) => { try { log('unhandled rejection', err); } catch { /* nothing left to do */ } });

let win = null;
let tray = null;
let server = null;
let cfg = null;
let configFile = null;
let claudeSessions = []; // from ~/.claude/sessions; Codex chats come from codexSessions
let collapsed = false;
let tuckOpen = false; // v1.3: the HUD's "N tucked away" list is unfolded
let contentHeight = 120;
let quitting = null;
// The detail panel: main owns which agent is selected (pick.selected = { id, rowY }: rowY is the row's
// centre in px from the HUD's top, null until the HUD reports it), and creates the panel window the
// first time one is. A question selects its agent by itself (autoSelect, pick.auto) and puts back what
// was open (pick.before) when it goes; a click or ✕ is the user's choice (userSelect).
let pick = { selected: null, auto: false, before: null, cardId: null };
let panelWin = null;
let panelHeight = 200; // until the panel reports its content height
let sentDetail; // JSON of the last detail sent, so an unchanged one doesn't re-render the panel
let place = null; // { side, arrowY } of the last placement, for the panel's arrow
let sentPlace; // JSON of the last place sent

const queue = createQueue({ holdMs: HOLD_MS, replyMs: REPLY_MS, onError: log });
const engine = createClassEngine();
// Full path of VS Code's code.cmd (a bare "code" makes code.cmd look for Code.exe in the wrong place).
const CODE_CMD = resolveCodeCmd({
  pathEnv: process.env.PATH ?? process.env.Path, localAppData: process.env.LOCALAPPDATA,
  exists: (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } },
});
const OPEN_OPTS = { codeCmd: CODE_CMD, codexActivate: CODEX_ACTIVATE };
const store = createStore({ engine, queue, holdMs: HOLD_MS, replyMs: REPLY_MS, onError: (err) => log('step log', err), canOpen: (s) => canOpen(s, OPEN_OPTS) });

// ---------------------------------------------------------------- snapshot

const hudState = () => ({ collapsed, tuckOpen, visible: !!win && !win.isDestroyed() && win.isVisible() });
// panelTarget's view of the HUD for agent `id`: hasCard when that agent owns the active question.
const panelHud = (id, snap) => ({ ...hudState(), hasCard: !!snap?.card && String(snap.card.sessionId) === String(id) });

// Every snapshot push also re-places the panel and refreshes its detail (spec 6.3: the same throttle).
// Run from timers and IPC, so guarded (I4): a throw is logged, never an error box.
const pushNow = guarded('push', () => {
  if (!win || win.isDestroyed()) return;
  const snap = store.snapshot();
  // A new question opens the panel on its agent; when it goes, the panel goes back to what was open.
  pick = autoSelect(pick, snap.card);
  // A selection the user made closes when its agent left the list, or the HUD was hidden or collapsed.
  // One the question made stays until the question goes (its agent can be missing from the list for a
  // poll or two; placePanel keeps the panel hidden meanwhile).
  if (pick.selected && !pick.auto && !panelTarget(pick.selected.id, snap, panelHud(pick.selected.id, snap))) pick = { ...pick, selected: null };
  try { win.webContents.send('snapshot', { ...snap, card: hudCard(snap.card), collapsed, tuckOpen, selected: pick.selected?.id ?? null }); } catch (err) { log('push', err); }
  placePanel(snap);
  pushDetail();
}, log);
const push = createThrottle(pushNow, PUSH_MS);
queue.onChange(push);

const pushDetailNow = guarded('detail', () => {
  if (!panelWin || panelWin.isDestroyed()) return;
  const d = pick.selected ? store.detail(pick.selected.id) : null; // null empties a hidden panel
  const json = JSON.stringify(d);
  if (json === sentDetail) return;
  try { panelWin.webContents.send('detail', d); sentDetail = json; } catch (err) { log('detail', err); }
}, log);
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
const stageTick = guarded('stage tick', () => {
  const k = store.stageKey();
  if (k === lastStageKey) return;
  lastStageKey = k;
  push();
  pushDetail();
}, log);

// ---------------------------------------------------------------- sessions

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}
const codexSessions = createCodexSessions({ readMeta: readRolloutMeta });
const merged = () => [...claudeSessions, ...codexSessions.list()];
const isInteractive = createInteractiveCheck({ current: merged, reread: () => readSessionFiles(SESSIONS_DIR) });

let polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  try {
    claudeSessions = await listSessions({ dir: SESSIONS_DIR, isAlive });
    store.setSessions(merged());
    push();
  } catch (err) { log('poll', err); } finally { polling = false; }
}

function sessionById(id) {
  return merged().find((s) => s.sessionId === id) ?? readSessionFiles(SESSIONS_DIR).find((s) => s.sessionId === id) ?? null;
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

// Focusable and focused only while the user types into a text box (a card's "Something else…" or
// reply); both windows are created non-focusable and are shown with showInactive.
function setInteractiveOf(w, on) {
  if (!w || w.isDestroyed()) return;
  if (on) { w.setFocusable(true); w.focus(); } else releaseFocusOf(w);
}
const releaseFocus = () => releaseFocusOf(win);
const setInteractive = (on) => setInteractiveOf(win, on);

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
    // A renderer that crashed mid-typing can't send setInteractive(false), and the reloaded one starts
    // out not typing: the panel goes back to non-focusable here and gives the focus back (M3).
    releaseFocusOf(pw);
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
// Guarded (I4): it runs from dock, the push and IPC.
const placePanel = guarded('place panel', (snap) => {
  const s = snap ?? store.snapshot();
  const id = pick.selected && !quitting ? panelTarget(pick.selected.id, s, panelHud(pick.selected.id, s)) : null;
  if (!id) {
    if (panelWin && !panelWin.isDestroyed() && panelWin.isVisible()) {
      releaseFocusOf(panelWin); // a panel hidden while typing gives the focus back first
      panelWin.hide();
    }
    return;
  }
  const pw = panelWindow();
  const b = panelBounds(win.getBounds(), workArea(), { width: PANEL_WIDTH, height: panelHeight, rowY: pick.selected.rowY });
  pw.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
  place = { side: b.side, arrowY: b.arrowY };
  sendPlace();
  // A minimized panel (system menu → Minimize) is restored without taking the focus (M4).
  if (!pw.isVisible() || pw.isMinimized()) pw.showInactive();
}, log);

// The user's new selection (or none): the HUD highlights the row, the panel moves and gets the agent's
// detail. It stands until a different question arrives (userSelect).
function select(next) {
  pick = userSelect(pick, next);
  placePanel();
  pushNow();
  pushDetail();
}

// ---------------------------------------------------------------- opening a session's window

// Runs the focus command; a failure is only logged (no Explorer-folder fallback any more).
// Resolves true when the command exits 0 (explorer.exe counts as success: it exits 1 when it works).
function spawnQuiet(cmd, args) {
  return new Promise((resolve) => {
    let child;
    try {
      if (process.platform === 'win32' && /\.cmd$/i.test(cmd)) {
        // code.cmd is a batch shim: run it through cmd.exe by its full path, every argument quoted.
        const line = [cmd, ...args].map((a) => `"${String(a).replace(/"/g, '')}"`).join(' ');
        child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], { windowsVerbatimArguments: true, windowsHide: true, stdio: 'ignore' });
      } else {
        child = spawn(cmd, args, { windowsHide: true, stdio: 'ignore' });
      }
    } catch (err) { log('open', err); resolve(false); return; }
    const explorer = /(^|[\\/])explorer\.exe$/i.test(cmd);
    child.on('error', (err) => { log('open', err.message); resolve(false); });
    child.on('exit', (code) => {
      if (code && !explorer) log('open', `${cmd} exited ${code}`);
      resolve(!code || explorer);
    });
  });
}

// Titles of the visible VS Code windows (empty on any failure: then no chat link is sent).
function vscodeWindowTitles() {
  return new Promise((resolve) => {
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', VSCODE_TITLES_PS], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (err) { log('open titles', err.message); resolve([]); return; }
      resolve(String(stdout).split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
    });
  });
}

// "Open window": the exact chat when its app has a chat link (focus.js), else the app or window as before.
const openChat = createChatOpener({
  commandFor: openCommandFor, linkFor: chatLinkFor, spawnQuiet, windowTitles: vscodeWindowTitles,
  openExternal: (url) => shell.openExternal(url), log,
});

function openWindow(sessionId) {
  const s = sessionById(sessionId);
  if (!s || !openCommandFor(s, OPEN_OPTS)) return; // the button is hidden for sessions we can't focus
  openChat(s, OPEN_OPTS).catch((err) => log('open', err));
}

// ---------------------------------------------------------------- IPC from the renderer

function fromHud(channel, handler) {
  ipcMain.on(channel, (e, ...args) => {
    if (!win || win.isDestroyed() || e.sender !== win.webContents) return;
    if (channel !== 'hud:reportHeight') debug('ipc', channel, JSON.stringify(args).slice(0, 200));
    try { handler(...args); } catch (err) { log('ipc', err); }
  });
}

// An answer from a card (the panel's; the HUD's channel stays for v1 and is harmless).
function answerCard(id, response) {
  const item = queue.list().find((i) => i.id === id);
  if (!item) return;
  // An answer that doesn't fit its card is handed back to the session's own window.
  const encoded = encodeAnswer(item, response);
  if (encoded && item.kind === 'reply') store.replySent(item.sessionId); // Claude carries on: not "finished"
  if (encoded && item.kind === 'permission' && response.kind === 'deny') store.permissionDenied(item); // R8a
  queue.answer(id, encoded ?? RELEASE);
}
const releaseCard = (id) => queue.answer(id, RELEASE);

fromHud('hud:answer', answerCard);
fromHud('hud:release', releaseCard);
fromHud('hud:setReplyOptIn', (sessionId, on) => { store.setReplyOptIn(sessionId, !!on); push(); });
// v1.3: ✕ takes a chat off the HUD until it asks something or starts a new turn; its open panel closes.
fromHud('hud:hideAgent', (sessionId) => {
  const id = String(sessionId);
  store.hide(id);
  if (pick.selected?.id === id) select(null); else push();
});
// v1.3: unfold or fold the "N tucked away" list (folding closes a tucked chat's panel: panelTarget).
fromHud('hud:showTucked', (on) => { tuckOpen = !!on; push(); });
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
  select(pick.selected?.id === sid ? null : { id: sid, rowY: Number(rowY) });
});
// The selected row moved inside the HUD (rows above it came or went), a question selected an agent
// whose row main didn't know, or the HUD collapsed (its face, then): the panel and its arrow follow.
fromHud('hud:rowOffset', (id, rowY) => {
  const y = Number(rowY);
  if (!pick.selected || pick.selected.id !== String(id) || !Number.isFinite(y)) return;
  pick = { ...pick, selected: { ...pick.selected, rowY: y } };
  placePanel();
});

function fromPanel(channel, handler) {
  ipcMain.on(channel, (e, ...args) => {
    if (!panelWin || panelWin.isDestroyed() || e.sender !== panelWin.webContents) return;
    if (channel !== 'panel:reportHeight') debug('ipc', channel, JSON.stringify(args).slice(0, 200));
    try { handler(...args); } catch (err) { log('ipc', err); }
  });
}

// ✕ names the agent it was showing: a question that switched the panel mid-click is not closed (M2).
fromPanel('panel:close', (id) => { if (closeApplies(id, pick.selected?.id)) select(null); });
// The id given wins: the footer's is the agent on show (M1), and the card's "open window ↗" names its
// own session, sent right after the card's release, which can already have put the previous selection
// back. No id: the selected agent.
fromPanel('panel:openWindow', (sessionId) => {
  const id = typeof sessionId === 'string' && sessionId ? sessionId : pick.selected?.id;
  if (id) openWindow(id);
});
fromPanel('panel:answer', answerCard);
fromPanel('panel:release', releaseCard);
fromPanel('panel:setInteractive', (on) => setInteractiveOf(panelWin, !!on));
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

// Both targets blocked (a dev build without the override variables, or no Codex folder): nothing to do.
function devBlocked() {
  if (!TARGET.blocked || !CODEX.blocked) return false;
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

async function confirmCodexInstall({ firstRun }) {
  const { response } = await dialog.showMessageBox({
    type: 'question', buttons: [firstRun ? 'Yes, add the hooks' : 'Add the hooks', firstRun ? 'No' : 'Cancel'],
    defaultId: firstRun ? 0 : 1, cancelId: 1, noLink: true,
    title: 'Agent HUD',
    message: 'Connect Agent HUD to Codex?',
    detail: `Agent HUD will add its hooks to this file:\n\n${CODEX_PATH}\n\n` +
      `The file is backed up first (to ${path.resolve(CODEX_PATH)}.agent-hud.bak; the very first original is also kept, once, as ` +
      `${path.resolve(CODEX_PATH)}.agent-hud.orig). Your other hooks are left as they are. ` +
      'Agent HUD will also mark its own hooks as trusted in Codex, so you won\'t need to approve them there. ' +
      'You can remove the hooks at any time from the tray menu.',
  });
  if (response === 0 && cfg) {
    cfg.codexAutoTrust = true;
    try { saveConfig(configFile, cfg); } catch (err) { log('config', err); }
  }
  return response === 0;
}

function doInstall() {
  if (TARGET.blocked) return;
  const r = installHooks(SETTINGS_PATH, { port: cfg.port, secret: cfg.secret });
  if (!r.ok) notify('Could not install the hooks', `${SETTINGS_PATH}: ${r.error}`, true);
  else if (!r.changed) notify('Agent HUD hooks already installed', `${SETTINGS_PATH} was left as it is.`);
  else notify('Agent HUD hooks installed', `Added to ${SETTINGS_PATH}${r.backup ? `\nBackup: ${r.backup}` : ''}\nChats you already have open start reporting after a restart.`);
}
function doCodexInstall() {
  if (CODEX.blocked) return;
  const r = installCodexHooksFile(CODEX_PATH, CODEX_COMMAND);
  if (!r.ok) { notify('Could not install the Codex hooks', `${CODEX_PATH}: ${r.error}`, true); return; }
  if (r.changed) resetCodexApproval();
  if (!r.changed) notify('Agent HUD Codex hooks already installed', `${CODEX_PATH} was left as it is.`);
  else notify('Agent HUD Codex hooks installed', `Added to ${CODEX_PATH}${r.backup ? `\nBackup: ${r.backup}` : ''}`);
  if (r.changed || codexState().missing.length) trustCodex({ reason: 'install' });
}
async function installFromTray() {
  if (devBlocked()) return;
  try {
    if (!TARGET.blocked && await confirmInstall({ firstRun: false })) doInstall();
    if (!CODEX.blocked && await confirmCodexInstall({ firstRun: false })) doCodexInstall();
  } catch (err) { log('install', err); }
  refreshMenu();
}
function doUninstall() {
  if (devBlocked()) return;
  if (!TARGET.blocked) {
    const r = uninstallHooks(SETTINGS_PATH);
    if (!r.ok) notify('Could not remove the hooks', `${SETTINGS_PATH}: ${r.error}`, true);
    else if (!r.changed) notify('No Agent HUD hooks to remove', `${SETTINGS_PATH} was left as it is.`);
    else notify('Agent HUD hooks removed', `Removed from ${SETTINGS_PATH}`);
  }
  if (!CODEX.blocked) {
    const r = removeCodexHooksFile(CODEX_PATH, CODEX_COMMAND);
    if (!r.ok) notify('Could not remove the Codex hooks', `${CODEX_PATH}: ${r.error}`, true);
    else if (!r.changed) notify('No Agent HUD Codex hooks to remove', `${CODEX_PATH} was left as it is.`);
    else {
      resetCodexApproval();
      const again =r.shifted?.length ? `\nCodex may ask you to re-approve hooks for: ${r.shifted.join(', ')} (Codex Settings → Hooks)` : '';
      notify('Agent HUD Codex hooks removed', `Removed from ${CODEX_PATH}${again}`);
    }
  }
  refreshMenu();
}

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

function claudeInstalled() {
  if (TARGET.blocked) return false;
  const doc = readJson(SETTINGS_PATH);
  return !!doc && typeof doc === 'object' && !isDeepStrictEqual(unmergeHooks(doc), doc);
}

// Codex hooks file state: { installed, missing } where missing lists the events that still need approval in
// Codex's hook approval (Settings → Hooks; /hooks in the terminal). config.toml unreadable -> missing [] (no approval line rather than a guess).
function codexState() {
  if (CODEX.blocked) return { installed: false, missing: [] };
  const doc = readJson(CODEX_PATH);
  const positions = doc && typeof doc === 'object' ? ourPositions(doc, CODEX_COMMAND) : [];
  let configText, configCode;
  if (positions.length) {
    try { configText = fs.readFileSync(path.join(path.dirname(CODEX_PATH), 'config.toml'), 'utf8'); } catch (err) { configCode = err?.code || 'EUNKNOWN'; }
  }
  const memory = cfg?.codexApproval && typeof cfg.codexApproval === 'object' ? cfg.codexApproval : {};
  const st = codexStatus({ positions, hooksPath: CODEX_PATH, configText, configCode, memory });
  if (cfg && !isDeepStrictEqual(st.memory, memory)) { cfg.codexApproval = st.memory; try { saveConfig(configFile, cfg); } catch (err) { log('config', err); } }
  return st;
}
// Our positions may have moved after an install or removal: start learning the approval hashes afresh.
function resetCodexApproval() {
  if (!cfg || !cfg.codexApproval || !Object.keys(cfg.codexApproval).length) return;
  cfg.codexApproval = {};
  try { saveConfig(configFile, cfg); } catch (err) { log('config', err); }
}

// Gets Codex to trust the HUD's own hooks (codex app-server). Never throws; one run at a time.
let trustRun = null;
function trustCodex({ reason }) {
  if (CODEX.blocked) return Promise.resolve();
  if (trustRun) return trustRun;
  trustRun = (async () => {
    let r;
    try {
      const exe = await findCodexExe();
      r = await trustCodexHooks({ exe, hooksPath: CODEX_PATH, command: CODEX_COMMAND, cwd: os.homedir() });
      log('codex trust', reason, r);
    } catch (err) {
      log('codex trust', err);
      r = { ok: false, trusted: [], already: [], untrusted: [], error: String(err?.message ?? err) };
    }
    try {
      const untrusted = Array.isArray(r.untrusted) ? r.untrusted : [];
      const trusted = Array.isArray(r.trusted) ? r.trusted : [];
      if (!r.ok || untrusted.length) notify('Agent HUD Codex hooks need approval', CODEX_APPROVE_BALLOON, true);
      else if (trusted.length) notify(reason === 'startup' ? 'Agent HUD re-trusted its Codex hooks' : 'Agent HUD Codex hooks installed and trusted', CODEX_TRUSTED_BODY);
      refreshMenu();
    } catch (err) { log('codex trust', err); }
  })().finally(() => { trustRun = null; });
  return trustRun;
}
function trustFromTray() {
  if (cfg) {
    cfg.codexAutoTrust = true;
    try { saveConfig(configFile, cfg); } catch (err) { log('config', err); }
  }
  trustCodex({ reason: 'tray' });
}

function refreshMenu() {
  if (!tray || tray.isDestroyed()) return;
  const visible = !!win && !win.isDestroyed() && win.isVisible();
  let atLogin = false;
  try { atLogin = app.getLoginItemSettings(loginOptions()).openAtLogin; } catch (err) { log('login item', err); }
  const codex = codexState();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: visible ? 'Hide' : 'Show', click: toggleWindow },
    { label: 'Collapse', type: 'checkbox', checked: collapsed, click: (mi) => setCollapsed(mi.checked) },
    { label: 'Move back to the corner', enabled: isAnchor(cfg?.position), click: resetPosition },
    { type: 'separator' },
    ...(TARGET.blocked ? [] : [{ label: `Claude hooks: ${claudeInstalled() ? 'installed' : 'not installed'}`, enabled: false }]),
    ...(CODEX.blocked ? [] : [{ label: codexStatusLabel(codex), enabled: false }]),
    ...(!CODEX.blocked && codex.missing.length ? [{ label: 'Trust Agent HUD hooks in Codex', click: trustFromTray }] : []),
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
    replyOptIn: (id) => store.wantsReply(id),
    onEvent: (ev) => {
      // A Codex chat exists only through its events: track it and list it before the store sees the event.
      if (ev.source === 'codex') { codexSessions.onEvent(ev); store.setSessions(merged(), { poll: false }); }
      store.onEvent(ev);
      push();
    },
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
  if (SKIP_FIRST_RUN) return;
  if (!cfg.offeredHooks && !TARGET.blocked) {
    const yes = await confirmInstall({ firstRun: true });
    cfg.offeredHooks = true;
    try { saveConfig(configFile, cfg); } catch (err) { log('config', err); }
    if (yes) doInstall();
    refreshMenu();
  }
  // The Codex-only offer, independent of the Claude one; asked once whether the user accepts or declines.
  if (codexOfferDue({ cfg, target: CODEX, installed: codexState().installed })) {
    const yes = await confirmCodexInstall({ firstRun: true });
    cfg.offeredCodexHooks = true;
    try { saveConfig(configFile, cfg); } catch (err) { log('config', err); }
    if (yes) doCodexInstall();
    refreshMenu();
  }
}

function quit() {
  if (!quitting) {
    pick = userSelect(pick, null);
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
  debug('config', configFile, 'settings', SETTINGS_PATH, 'codex', CODEX_PATH);
  createTray();
  createWindow();
  for (const ev of ['display-metrics-changed', 'display-added', 'display-removed']) screen.on(ev, dock);
  await poll();
  setInterval(poll, POLL_MS);
  setInterval(stageTick, STAGE_TICK_MS);
  setInterval(refreshMenu, 30000); // hook status lines follow edits made outside the HUD (e.g. approval in Codex Settings → Hooks)
  await startServer();
  await firstRun();
  if (codexTrustDue({ cfg, target: CODEX, missing: codexState().missing })) trustCodex({ reason: 'startup' });
}

// A second launch shows the running HUD; `--quit` asks it to quit the normal way (holds released).
// `--remove-hooks` (run by the uninstaller, build/installer.nsh) takes the hooks out of the settings
// file and exits 0: no window, no server, no single-instance handshake.
const WANT_QUIT = process.argv.includes('--quit');
if (process.argv.includes('--remove-hooks')) {
  const removed = removeHooksCli({
    target: TARGET, uninstall: uninstallHooks,
    codex: { target: CODEX, uninstall: (f) => removeCodexHooksFile(f, CODEX_COMMAND) },
  });
  for (const m of removed.messages) log('--remove-hooks:', m);
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
