# Claude Hooks Follow the HUD Implementation Plan

🕷️

```
╔═════════════╦══════════════════════════════════════════════╦═════════════╗
║ MARVEL      ║                                              ║  APPROVED   ║
║ COMICS      ║     A M A Z I N G   S P I D E R - M A N      ║   BY THE    ║
║ GROUP       ║                  #229 - 230                  ║ COMICS CODE ║
║ 60¢ · 1982  ║                                              ║  AUTHORITY  ║
╠═════════════╩══════════════════════════════════════════════╩═════════════╣
║                                                                          ║
║      " N O T H I N G  C A N  S T O P  T H E  J U G G E R N A U T "       ║
║                                                                          ║
║                     ROGER STERN  ◆  1982  ◆  TIER 2                      ║
║                       a few files, one clear seam                        ║
╟──────────────────────────────────────────────────────────────────────────╢
║  WHY THIS ISSUE                                                          ║
║  A small two-parter with one stubborn blocker: take the hooks out on     ║
║  quit, put them back on start; a crash is the Juggernaut that still      ║
║  leaves them in until the next start.                                    ║
╟──────────────────────────────────────────────────────────────────────────╢
║  ROGUES GALLERY                                                          ║
║  ◆ GREEN GOBLIN   another tool edits settings.json at the same           ║
║                   moment and one of the two edits is lost                ║
║  ◆ SCORPION       a crash, kill or Windows shutdown skips quit;          ║
║                   the red lines return until the next start              ║
║  ◆ CHAMELEON      the desktop app may not pick up live edits the         ║
║                   way the CLI engine does (untested)                     ║
║  ◆ THE SPOT       user settings touch every chat on the machine          ║
╚══════════════════════════════════════════════════════════════════════════╝
```

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The HUD's Claude hooks are present only while the HUD runs: removed on quit (and Windows logoff/shutdown), restored on start, unless the user removed them on purpose.

**Architecture:** `settings-hooks.js` gains a no-backup write option; `wiring.js` gains two pure decisions (the remembered choice, and what to do on start/quit); `main.js` calls them from `start()`, `quit()`, the window's `session-end`, the tray's install/remove, and `--remove-hooks`.

**Tech Stack:** Electron 44, ES modules, `node --test` (Node 20).

**Spec:** `docs/superpowers/specs/2026-11-20-agent-hud-hooks-follow-hud-design.md`

## Global Constraints

- Config flag name: `claudeHooksWanted` (boolean) in `config.json` (userData).
- Codex hooks are never touched by start/quit/session-end.
- Start/quit/session-end writes: no balloon, no `.bak` copy; the `.orig` copy rule is unchanged; failures only `log(...)`.
- A blocked target (`TARGET.blocked`, a dev build without `AGENT_HUD_SETTINGS_PATH`) is never written.
- Install balloon text loses the sentence `Chats you already have open start reporting after a restart.`
- Plan call (beyond the spec): `--remove-hooks` (real uninstall only; updates skip it, `build/installer.nsh`) sets `claudeHooksWanted = false` **and** `offeredHooks = false`, so a later reinstall offers the hooks again instead of starting silently disconnected.

## Review Focus

1. **Quit while the settings file is locked or broken JSON** — no throw out of `quit()`, the app still exits within `QUIT_GRACE_MS` (Task 3).
2. **First start of this version on a machine with hooks installed** — `claudeHooksWanted` becomes `true` and nothing visible happens (Task 2).
3. **User removed hooks, then restarts the HUD** — hooks stay out (Task 2).
4. **Second launch / `--quit` from another process** — only the running HUD's own quit removes hooks; the second instance writes nothing (Task 3).
5. **Dev HUD** — acts on the spike settings file only, never `~/.claude/settings.json` (Task 3, by `TARGET`).

---

### Task 1: Writes without a backup

**Files:** Modify `src/main/settings-hooks.js` (`rewrite`, `installHooks`, `uninstallHooks`); Test `test/settings-hooks.test.js`.

**Interfaces:**
- Produces: `rewrite(file, transform, { backup = true } = {})`; `installHooks(file, { port, secret }, { backup = true } = {})`; `uninstallHooks(file, { backup = true } = {})`. With `backup: false` no `.agent-hud.bak` is written (returned `backup: null`); `.agent-hud.orig` is still created once.

- [ ] **Step 1: Failing tests**

```js
test('install and uninstall with backup:false write no .bak but still keep the .orig once', () => {
  const t = tmp();
  try {
    fs.writeFileSync(t.file, JSON.stringify({ model: 'x' }, null, 2) + '\n');
    const a = installHooks(t.file, { port: 1, secret: 's' }, { backup: false });
    assert.equal(a.ok, true); assert.equal(a.changed, true); assert.equal(a.backup, null);
    assert.ok(!fs.existsSync(t.file + '.agent-hud.bak'));
    assert.ok(fs.existsSync(t.file + '.agent-hud.orig'));
    const b = uninstallHooks(t.file, { backup: false });
    assert.equal(b.changed, true); assert.equal(b.backup, null);
    assert.ok(!fs.existsSync(t.file + '.agent-hud.bak'));
    assert.deepEqual(JSON.parse(fs.readFileSync(t.file, 'utf8')), { model: 'x' });
  } finally { t.done(); }
});
```

- [ ] **Step 2: Run** `node --test test/settings-hooks.test.js` → FAIL. **Step 3: Implement.** **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** — `feat: settings writes can skip the .bak (for the HUD's own start/quit edits)`

---

### Task 2: The remembered choice and the start/quit decision

**Files:** Modify `src/main/wiring.js`; Test `test/wiring.test.js`.

**Interfaces:**
- Produces:
  - `hooksWanted(cfg, installedNow) -> { wanted: boolean, migrate: boolean }` — `cfg.claudeHooksWanted` when it is a boolean (`migrate: false`); otherwise `{ wanted: !!installedNow, migrate: true }` (caller saves it).
  - `hookSync({ phase, wanted, blocked }) -> 'install' | 'remove' | null` — `blocked` → `null`; `phase 'start'` → `'install'` when wanted; `phase 'quit'` (also used for session-end) → `'remove'` when wanted; otherwise `null`. Unknown phase → `null`.
  - `forgetHooks(cfg) -> cfg` — returns a copy with `claudeHooksWanted: false, offeredHooks: false` (for `--remove-hooks`).

- [ ] **Step 1: Failing tests**

```js
test('hooksWanted: a saved boolean wins; missing migrates from what is installed now', () => {
  assert.deepEqual(hooksWanted({ claudeHooksWanted: false }, true), { wanted: false, migrate: false });
  assert.deepEqual(hooksWanted({ claudeHooksWanted: true }, false), { wanted: true, migrate: false });
  assert.deepEqual(hooksWanted({}, true), { wanted: true, migrate: true });
  assert.deepEqual(hooksWanted({ claudeHooksWanted: 'yes' }, false), { wanted: false, migrate: true });
});
test('hookSync: install on start and remove on quit only when wanted and not blocked', () => {
  assert.equal(hookSync({ phase: 'start', wanted: true, blocked: false }), 'install');
  assert.equal(hookSync({ phase: 'quit', wanted: true, blocked: false }), 'remove');
  assert.equal(hookSync({ phase: 'start', wanted: false, blocked: false }), null);
  assert.equal(hookSync({ phase: 'quit', wanted: false, blocked: false }), null);
  assert.equal(hookSync({ phase: 'start', wanted: true, blocked: true }), null);
  assert.equal(hookSync({ phase: 'other', wanted: true, blocked: false }), null);
});
test('forgetHooks: not wanted and offer again, input untouched', () => {
  const c = { port: 1, offeredHooks: true, claudeHooksWanted: true };
  assert.deepEqual(forgetHooks(c), { port: 1, offeredHooks: false, claudeHooksWanted: false });
  assert.equal(c.claudeHooksWanted, true);
});
```

- [ ] **Step 2: Run** `node --test test/wiring.test.js` → FAIL. **Step 3: Implement.** **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** — `feat: remembered Claude-hooks choice and the start/quit hook decision`

---

### Task 3: Main wiring and the hands-on check

**Files:** Modify `src/main/main.js`, `spikes/SPIKES.md`.

**Interfaces:** Consumes Task 1 (`installHooks`/`uninstallHooks` with `{ backup: false }`) and Task 2 (`hooksWanted`, `hookSync`, `forgetHooks`), plus existing `claudeInstalled()`, `saveConfig`, `loadConfig`, `TARGET`, `SETTINGS_PATH`, `hookPort()`, `cfg`.

- [ ] **Step 1: Implement in `main.js`:**
  - `syncHooks(phase)` (guarded, synchronous, never throws): `const { wanted } = hooksWanted(cfg, claudeInstalled())`; act on `hookSync({ phase, wanted, blocked: TARGET.blocked })` with `installHooks(SETTINGS_PATH, { port: hookPort(), secret: cfg.secret }, { backup: false })` or `uninstallHooks(SETTINGS_PATH, { backup: false })`; `log` a failure; `refreshMenu()` after.
  - `start()`: right after `cfg = loadConfig(configFile)`, run the migration — if `hooksWanted(...).migrate`, set `cfg.claudeHooksWanted` to its `wanted` and `saveConfig`. Then, after `firstRun()` (so a first-run "No" is honoured), `syncHooks('start')`.
  - `doInstall()` success (changed or already there): `cfg.claudeHooksWanted = true`, save. `doUninstall()` Claude part on success: `cfg.claudeHooksWanted = false`, save. First-run "No" (`firstRun()` declines): `cfg.claudeHooksWanted = false`, save.
  - `quit()`: inside the existing `.finally` before `app.exit(0)` (the server is closed and holds released by then), call `syncHooks('quit')` once (guard so a second `quit()` call can't repeat it). Only the instance that ran `start()` does this — `--quit`/second-instance paths never reach `quit()` with a loaded `cfg`; guard on `cfg` being loaded.
  - Windows logoff/shutdown: `win.on('session-end', () => syncHooks('quit'))` where the HUD window is created (synchronous; idempotent with a later quit).
  - `--remove-hooks` branch: after `removeHooksCli`, load the config at `path.join(app.getPath('userData'), 'config.json')` if it exists, `saveConfig(file, forgetHooks(cfg))`; any failure only logs.
  - Install balloon: drop the sentence `Chats you already have open start reporting after a restart.`
- [ ] **Step 2: Run** `npm test` → PASS.
- [ ] **Step 3: Run the dev HUD isolated** (`env -u ELECTRON_RUN_AS_NODE AGENT_HUD_USER_DATA=<new temp dir> AGENT_HUD_PORT=47911 AGENT_HUD_NO_FIRST_RUN=1 npm run dev`) with a temp config containing `"claudeHooksWanted": true`; confirm the spike settings file (`C:\Consortis_projects\agent-hud-spike\.claude\settings.local.json`) gains the hooks with port 47911 within seconds of start, and loses them after tray Quit (inspect the file; no `.bak` changes). Restore the spike settings file to its exact prior content afterwards. Delete the temp dir.
- [ ] **Step 4: Add `## Live check - hooks follow the HUD` to `spikes/SPIKES.md`:** CLI, VS Code and desktop app, each with a throwaway chat in `C:\Consortis_projects\agent-hud-spike` and the dev HUD: (1) HUD running → row updates; (2) quit the HUD → send a message → no red line / no "hook gave no usable answer"; (3) start the HUD → send a message → the row updates without restarting the chat; (4) tray Remove hooks → quit → start → hooks stay out; results table.
- [ ] **Step 5: Commit** — `feat: Claude hooks follow the HUD (removed on quit and logoff, restored on start)`
